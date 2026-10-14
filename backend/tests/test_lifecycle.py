"""Incident lifecycle through the real HTTP API with a controlled clock."""

import threading

from backend.tests.conftest import Harness


def test_health(h):
    body = h.client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["vision"]["input_mode"] == "unavailable"
    assert body["current_journey_id"]


def test_request_requires_started_journey(h):
    jid = h.journey_id()
    r = h.request_help(jid)
    assert r.status_code == 409
    assert "not armed" in r.json()["detail"]


def test_duplicate_request_key_is_idempotent(h):
    jid = h.start()
    first = h.request_help(jid, key="dup-key-0001")
    second = h.request_help(jid, key="dup-key-0001")
    assert first.status_code == 201 and first.json()["created"] is True
    assert second.status_code == 200 and second.json()["created"] is False
    assert first.json()["incident"]["id"] == second.json()["incident"]["id"]
    assert len(h.client.get("/api/incidents").json()) == 1


def test_same_key_after_cancellation_returns_cancelled_incident(h):
    jid = h.start()
    iid = h.request_help(jid, key="retry-key-0001").json()["incident"]["id"]
    h.client.post(f"/api/incidents/{iid}/cancel")
    again = h.request_help(jid, key="retry-key-0001")
    assert again.json()["incident"]["status"] == "cancelled"
    assert again.json()["created"] is False


def test_one_active_incident_per_journey(h):
    jid = h.start()
    first = h.request_help(jid, key="first-key-0001").json()["incident"]
    r = h.request_help(jid, key="second-key-0002")
    assert r.status_code == 409
    assert r.json()["active_incident_id"] == first["id"]


def test_request_pauses_journey_and_freezes_location(h):
    jid = h.start()
    h.tick(9)
    loc_before = h.snapshot(jid)["journey"]["location"]
    inc = h.request_help(jid).json()["incident"]
    assert inc["location"]["source"] == "simulated"
    assert inc["location"]["latitude"] == loc_before["latitude"]
    snap = h.snapshot(jid)
    assert snap["journey"]["status"] == "paused"
    assert snap["journey"]["pause_reason"] == "help_request"
    assert snap["active_incident"]["status"] == "pending"
    assert snap["active_incident"]["seconds_until_dispatch"] == 10.0


def test_cancel_before_deadline_is_never_resurrected(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    h.tick(5)
    r = h.client.post(f"/api/incidents/{iid}/cancel")
    assert r.status_code == 200 and r.json()["incident"]["status"] == "cancelled"
    h.tick(30)  # deadline long past; timer must not dispatch it
    detail = h.client.get(f"/api/incidents/{iid}").json()
    assert detail["status"] == "cancelled"
    assert detail["dispatched_at"] is None
    assert [e["type"] for e in detail["timeline"]] == ["created", "cancelled"]
    assert h.snapshot(jid)["active_incident"] is None
    assert h.snapshot(jid)["last_incident"]["status"] == "cancelled"


def test_deadline_dispatches_via_ticker(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    h.tick(9.9)
    assert h.client.get(f"/api/incidents/{iid}").json()["status"] == "pending"
    h.tick(0.1)
    inc = h.client.get(f"/api/incidents/{iid}").json()
    assert inc["status"] == "dispatched"
    assert inc["dispatched_at"] == inc["dispatch_at"]


def test_snapshot_read_dispatches_expired_pending_without_ticker(h):
    jid = h.start()
    h.request_help(jid)
    h.clock.advance(11)  # no tick: snapshot read must not report stale pending
    assert h.snapshot(jid)["active_incident"]["status"] == "dispatched"


def test_cancel_at_deadline_counts_as_after_dispatch(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    h.clock.advance(10)  # exactly at dispatch_at, ticker has not run
    r = h.client.post(f"/api/incidents/{iid}/cancel")
    assert r.json()["incident"]["status"] == "cancelled"
    timeline = [e["type"] for e in h.client.get(f"/api/incidents/{iid}").json()["timeline"]]
    assert timeline == ["created", "dispatched", "cancelled"]


def test_cancel_after_dispatch_propagates(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    h.tick(10)
    r = h.client.post(f"/api/incidents/{iid}/cancel")
    assert r.json()["incident"]["status"] == "cancelled"
    dispatched = h.client.get("/api/incidents", params={"status": "dispatched"}).json()
    assert dispatched == []
    assert h.client.post(f"/api/incidents/{iid}/accept").status_code == 409


def test_accept_only_after_dispatch(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    early = h.client.post(f"/api/incidents/{iid}/accept")
    assert early.status_code == 409
    assert "not been dispatched" in early.json()["detail"]
    h.tick(10)
    ok = h.client.post(f"/api/incidents/{iid}/accept", json={"responder": "Campus desk"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["changed"] is True
    assert body["incident"]["status"] == "acknowledged"
    assert body["incident"]["responder"] == "Campus desk"
    assert h.client.post(f"/api/incidents/{iid}/cancel").status_code == 409


def test_simultaneous_accepts_produce_one_acknowledgment(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    h.tick(10)
    results = []
    barrier = threading.Barrier(8)

    def accept():
        barrier.wait()
        results.append(h.client.post(f"/api/incidents/{iid}/accept").json()["changed"])

    threads = [threading.Thread(target=accept) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [False] * 7 + [True]
    timeline = [e["type"] for e in h.client.get(f"/api/incidents/{iid}").json()["timeline"]]
    assert timeline.count("acknowledged") == 1


def test_cancel_dispatch_race_is_consistent(h):
    """Ticker dispatch and user cancel racing at the deadline: final state is always cancelled,
    and dispatch never happens after cancellation."""
    for n in range(20):
        jid = h.client.post("/api/journeys").json()["id"]
        h.client.post(f"/api/journeys/{jid}/start")
        iid = h.request_help(jid, key=f"race-key-{n:04d}").json()["incident"]["id"]
        h.clock.advance(10)
        barrier = threading.Barrier(2)

        def ticker():
            barrier.wait()
            h.svc.tick(0.0)

        def cancel():
            barrier.wait()
            h.client.post(f"/api/incidents/{iid}/cancel")

        ts = [threading.Thread(target=ticker), threading.Thread(target=cancel)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        h.tick(5)
        detail = h.client.get(f"/api/incidents/{iid}").json()
        assert detail["status"] == "cancelled"
        types = [e["type"] for e in detail["timeline"]]
        assert types[-1] == "cancelled" and types.count("dispatched") <= 1


def test_resolve_only_from_acknowledged(h):
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    assert h.client.post(f"/api/incidents/{iid}/resolve").status_code == 409
    h.tick(10)
    h.client.post(f"/api/incidents/{iid}/accept")
    r = h.client.post(f"/api/incidents/{iid}/resolve")
    assert r.json()["incident"]["status"] == "resolved"
    assert h.client.post(f"/api/incidents/{iid}/resolve").json()["changed"] is False
    # after resolution a new request may be made
    assert h.request_help(jid, key="next-key-0002").status_code == 201


def test_restart_recovery(settings, clock):
    a = Harness(settings, clock)
    jid = a.start()
    pending = a.request_help(jid, key="pending-key-0001").json()["incident"]["id"]
    jid2 = a.client.post("/api/journeys").json()["id"]  # new current journey; old one's open incident closed
    a.client.post(f"/api/journeys/{jid2}/start")
    still_pending = a.request_help(jid2, key="pending-key-0002").json()["incident"]["id"]
    a.close()

    clock.advance(60)  # server down past the deadline
    b = Harness(settings, clock)
    try:
        assert b.client.get(f"/api/incidents/{still_pending}").json()["status"] == "dispatched"
        assert b.client.get(f"/api/incidents/{pending}").json()["status"] == "cancelled"
        assert b.journey_id() == jid2
        snap = b.snapshot()
        assert snap["journey"]["id"] == jid2
        assert snap["active_incident"]["status"] == "dispatched"
        b.client.post(f"/api/incidents/{still_pending}/accept")
    finally:
        b.close()

    c = Harness(settings, clock)
    try:
        assert c.client.get(f"/api/incidents/{still_pending}").json()["status"] == "acknowledged"
    finally:
        c.close()


def test_reconnect_state_retrieval(h):
    """A refreshed browser rebuilds state from REST alone."""
    jid = h.start()
    iid = h.request_help(jid).json()["incident"]["id"]
    h.tick(10)
    h.client.post(f"/api/incidents/{iid}/accept")
    snap = h.snapshot()
    assert snap["journey"]["id"] == jid
    assert snap["active_incident"]["id"] == iid
    assert snap["active_incident"]["status"] == "acknowledged"
    detail = h.client.get(f"/api/incidents/{iid}").json()
    assert [e["type"] for e in detail["timeline"]] == ["created", "dispatched", "acknowledged"]


def test_unknown_incident_404(h):
    assert h.client.post("/api/incidents/nope/cancel").status_code == 404


def test_imessage_request_source_is_accepted_and_labeled(h):
    jid = h.start()
    r = h.request_help(jid, key="imessage-msg-0001", source="imessage")
    assert r.status_code == 201
    inc = r.json()["incident"]
    assert inc["request_source"] == "imessage" and inc["is_test"] is False
    assert "iMessage" in h.client.get(f"/api/incidents/{inc['id']}/briefing").json()["deterministic"]
    assert h.request_help(jid, key="imessage-msg-0001", source="imessage").status_code == 200  # same message id: same request


def test_voice_request_source_is_accepted_labeled_and_idempotent(h):
    jid = h.start()
    r = h.request_help(jid, key="voice-0123456789abcdef", source="voice")
    assert r.status_code == 201
    inc = r.json()["incident"]
    assert inc["request_source"] == "voice" and inc["is_test"] is False and inc["status"] == "pending"
    assert "voice command" in h.client.get(f"/api/incidents/{inc['id']}/briefing").json()["deterministic"]
    again = h.request_help(jid, key="voice-0123456789abcdef", source="voice")  # duplicate final result / retry
    assert again.status_code == 200 and again.json()["incident"]["id"] == inc["id"] and again.json()["created"] is False
    assert len(h.client.get("/api/incidents").json()) == 1
    h.tick(10.5)  # voice requests follow the same backend-owned deadline
    assert h.client.get(f"/api/incidents/{inc['id']}").json()["status"] == "dispatched"


def test_voice_after_gesture_does_not_duplicate(h):
    jid = h.start()
    h.svc._on_palm_hold(jid, "gesture")
    r = h.request_help(jid, key="voice-after-gesture-01", source="voice")
    assert r.status_code == 409 and r.json()["active_incident_id"]
    incidents = h.client.get("/api/incidents").json()
    assert [i["request_source"] for i in incidents] == ["gesture"]


def test_concurrent_voice_and_gesture_create_one_request(h):
    jid = h.start()
    barrier = threading.Barrier(2)
    codes = []

    def voice():
        barrier.wait()
        codes.append(h.request_help(jid, key="voice-concurrent-0001", source="voice").status_code)

    def gesture():
        barrier.wait()
        h.svc._on_palm_hold(jid, "gesture")  # swallows its own 409

    ts = [threading.Thread(target=voice), threading.Thread(target=gesture)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    incidents = h.client.get("/api/incidents").json()
    assert len(incidents) == 1
    assert codes[0] == (201 if incidents[0]["request_source"] == "voice" else 409)

