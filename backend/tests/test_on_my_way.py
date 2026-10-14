"""'On my way' progress update: assigned responder only, idempotent, separate from the status."""

import sqlite3
import threading

from backend.app.db import Database


def accepted(h, responder="Desk A"):
    jid = h.start()
    inc = h.request_help(jid, key="omw-request-0001").json()["incident"]
    h.tick(10.5)
    r = h.client.post(f"/api/incidents/{inc['id']}/accept", json={"responder": responder})
    assert r.status_code == 200 and r.json()["changed"] is True
    return inc["id"], r.json()["responder_token"]


def omw(h, iid, token):
    return h.client.post(f"/api/incidents/{iid}/on-my-way", json={"responder_token": token})


def test_assigned_responder_reports_on_my_way_once(h):
    iid, token = accepted(h)
    assert token and len(token) >= 16
    r = omw(h, iid, token)
    assert r.status_code == 200 and r.json()["changed"] is True
    inc = r.json()["incident"]
    assert inc["status"] == "acknowledged" and inc["on_my_way_at"]
    again = omw(h, iid, token)  # repeated command
    assert again.status_code == 200 and again.json()["changed"] is False
    assert again.json()["incident"]["on_my_way_at"] == inc["on_my_way_at"]
    timeline = [e["type"] for e in h.client.get(f"/api/incidents/{iid}").json()["timeline"]]
    assert timeline.count("on_my_way") == 1
    snap = h.snapshot()
    assert snap["active_incident"]["status"] == "acknowledged" and snap["active_incident"]["on_my_way_at"] == inc["on_my_way_at"]
    assert "responder_token" not in str(h.client.get("/api/incidents").json())  # never listed


def test_token_is_returned_only_to_the_winning_accept(h):
    iid, token = accepted(h)
    second = h.client.post(f"/api/incidents/{iid}/accept", json={"responder": "Desk B"})
    assert second.status_code == 200 and second.json()["changed"] is False and second.json()["responder_token"] is None


def test_unauthorized_attempts_are_rejected(h):
    iid, token = accepted(h)
    for bad in ("x" * 32, token[:-1] + ("A" if token[-1] != "A" else "B")):
        r = omw(h, iid, bad)
        assert r.status_code == 403
    assert h.client.post(f"/api/incidents/{iid}/on-my-way", json={}).status_code == 422
    assert h.client.post(f"/api/incidents/{iid}/on-my-way", json={"responder_token": "short"}).status_code == 422
    assert h.client.get(f"/api/incidents/{iid}").json()["on_my_way_at"] is None


def test_only_accepted_requests_and_not_terminal_ones(h):
    jid = h.start()
    inc = h.request_help(jid, key="omw-request-0002").json()["incident"]
    assert omw(h, inc["id"], "t" * 32).status_code == 409  # pending
    h.tick(10.5)
    assert omw(h, inc["id"], "t" * 32).status_code == 409  # dispatched, not accepted
    token = h.client.post(f"/api/incidents/{inc['id']}/accept", json={"responder": "Desk"}).json()["responder_token"]
    assert h.client.post(f"/api/incidents/{inc['id']}/resolve").status_code == 200
    r = omw(h, inc["id"], token)
    assert r.status_code == 409 and r.json()["status"] == "resolved"
    h.client.post("/api/dev/reset")
    jid2 = h.start()
    c = h.request_help(jid2, key="omw-request-0003").json()["incident"]
    h.client.post(f"/api/incidents/{c['id']}/cancel")
    assert omw(h, c["id"], token).status_code == 409


def test_concurrent_repeats_publish_one_update(h):
    iid, token = accepted(h)
    codes = []
    barrier = threading.Barrier(6)

    def send():
        barrier.wait()
        codes.append(omw(h, iid, token).json()["changed"])

    ts = [threading.Thread(target=send) for _ in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert codes.count(True) == 1
    timeline = [e["type"] for e in h.client.get(f"/api/incidents/{iid}").json()["timeline"]]
    assert timeline.count("on_my_way") == 1


def test_old_database_gains_columns_and_keeps_rows(tmp_path):
    path = tmp_path / "old.sqlite3"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE incidents (id TEXT PRIMARY KEY, journey_id TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL, status TEXT NOT NULL, request_source TEXT NOT NULL, created_at TEXT NOT NULL,
          dispatch_at TEXT NOT NULL, dispatched_at TEXT, acknowledged_at TEXT, cancelled_at TEXT, resolved_at TEXT,
          updated_at TEXT NOT NULL, location_json TEXT NOT NULL, snapshot_path TEXT, responder TEXT,
          version INTEGER NOT NULL DEFAULT 1);
        INSERT INTO incidents VALUES ('old-1','j','k-old-0001','user_sos','acknowledged','button','t','t',NULL,'t',NULL,NULL,'t','{}',NULL,'Desk',1);
    """)
    old.commit(); old.close()
    db = Database(path)
    row = db.query_one("SELECT * FROM incidents WHERE id = 'old-1'")
    assert row["responder"] == "Desk" and row["on_my_way_at"] is None and row["responder_token_hash"] is None
    db.close()
    Database(path).close()  # second open: migration is idempotent


def test_acceptance_without_token_cannot_report(h):
    """Requests accepted before this feature (no stored token) are refused, not silently allowed."""
    iid, _ = accepted(h)
    with h.svc.db.transaction() as c:
        c.execute("UPDATE incidents SET responder_token_hash = NULL WHERE id = ?", (iid,))
    assert omw(h, iid, "z" * 32).status_code == 403
