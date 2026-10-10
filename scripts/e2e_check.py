r"""End-to-end check against a RUNNING backend with the real clock (takes ~35 s).

    .\.venv\Scripts\python.exe scripts\e2e_check.py [--base http://127.0.0.1:8000]

Exercises: reset -> start -> progress -> button request (idempotent) -> real 10 s
dispatch -> double accept -> snapshot shows acknowledged -> resolve -> resume ->
second request cancelled inside the window -> stays cancelled past the deadline.
A WebSocket subscriber (second client) must see the transitions. Requires dev
controls (GUIDEWING_DEV_CONTROLS=1, the default) for the reset step.
"""

import argparse
import json
import sys
import threading
import time
import urllib.request
import uuid

from websockets.sync.client import connect

FAILS = []


def call(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + str(detail)) if detail and not ok else ''}")
    if not ok:
        FAILS.append(name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    base = ap.parse_args().base.rstrip("/")

    events = []
    stop = threading.Event()

    def listen():
        with connect(base.replace("http", "ws", 1) + "/ws/events") as ws:
            while not stop.is_set():
                try:
                    events.append(json.loads(ws.recv(timeout=0.5)))
                except TimeoutError:
                    pass

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    time.sleep(0.5)

    st, h = call(base, "GET", "/api/health")
    check("health ok", st == 200 and h["status"] == "ok", h)
    st, j = call(base, "POST", "/api/dev/reset")
    check("dev reset creates idle journey", st == 200 and j["status"] == "idle", j)
    jid = j["id"]
    st, s0 = call(base, "GET", "/api/simulation/state?journey_id=current")
    check("snapshot current == new journey", s0["journey"]["id"] == jid)
    st, _ = call(base, "POST", f"/api/journeys/{jid}/start")
    time.sleep(1.6)
    _, s1 = call(base, "GET", f"/api/simulation/state?journey_id={jid}")
    check("backend advances route while active", s1["journey"]["route_progress"] > 0, s1["journey"])

    key = f"e2e-{uuid.uuid4()}"
    st, r1 = call(base, "POST", "/api/incidents", {"journey_id": jid, "request_key": key, "request_source": "button"})
    st2, r2 = call(base, "POST", "/api/incidents", {"journey_id": jid, "request_key": key, "request_source": "button"})
    iid = r1["incident"]["id"]
    check("request created (201) then idempotent (200, same id)", st == 201 and st2 == 200 and r2["incident"]["id"] == iid)
    _, s2 = call(base, "GET", f"/api/simulation/state?journey_id={jid}")
    check("snapshot: pending + journey paused for help",
          s2["active_incident"]["status"] == "pending" and s2["journey"]["pause_reason"] == "help_request", s2)
    st, early = call(base, "POST", f"/api/incidents/{iid}/accept")
    check("accept before dispatch rejected (409)", st == 409)

    time.sleep(10.5)
    _, s3 = call(base, "GET", f"/api/simulation/state?journey_id={jid}")
    check("dispatched after real 10 s window", s3["active_incident"]["status"] == "dispatched", s3["active_incident"])
    _, a1 = call(base, "POST", f"/api/incidents/{iid}/accept", {"responder": "e2e responder A"})
    _, a2 = call(base, "POST", f"/api/incidents/{iid}/accept", {"responder": "e2e responder B"})
    check("first accept changes, second does not", a1["changed"] is True and a2["changed"] is False)
    _, s4 = call(base, "GET", f"/api/simulation/state?journey_id={jid}")
    check("snapshot shows acknowledged with newer revision",
          s4["active_incident"]["status"] == "acknowledged" and s4["revision"] > s3["revision"])
    _, rs = call(base, "POST", f"/api/incidents/{iid}/resolve")
    check("resolve", rs["incident"]["status"] == "resolved")

    call(base, "POST", f"/api/journeys/{jid}/resume")
    st, r3 = call(base, "POST", "/api/incidents",
                  {"journey_id": jid, "request_key": f"e2e-{uuid.uuid4()}", "request_source": "button"})
    iid2 = r3["incident"]["id"]
    time.sleep(2)
    _, c = call(base, "POST", f"/api/incidents/{iid2}/cancel")
    check("cancel inside window", c["incident"]["status"] == "cancelled")
    time.sleep(9.5)
    _, d = call(base, "GET", f"/api/incidents/{iid2}")
    check("cancelled request never dispatched", d["status"] == "cancelled" and d["dispatched_at"] is None, d["timeline"])
    _, s5 = call(base, "GET", f"/api/simulation/state?journey_id={jid}")
    check("snapshot: no active incident, last cancelled",
          s5["active_incident"] is None and s5["last_incident"]["status"] == "cancelled")

    stop.set()
    t.join(timeout=2)
    transitions = [(e["payload"]["incident"]["id"], e["payload"]["transition"])
                   for e in events if e["type"] == "incident.updated"]
    want = [(iid, "created"), (iid, "dispatched"), (iid, "acknowledged"), (iid, "resolved"),
            (iid2, "created"), (iid2, "cancelled")]
    check("second client (WebSocket) saw every transition exactly once",
          [x for x in transitions if x[0] in (iid, iid2)] == want, transitions)
    seqs = [e["sequence"] for e in events if e["type"] not in ("hello", "ping")]
    check("event sequences strictly increasing", all(b > a for a, b in zip(seqs, seqs[1:])))

    print("RESULT:", "PASS" if not FAILS else f"FAIL ({len(FAILS)})")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
