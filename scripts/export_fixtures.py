r"""Capture real snapshot responses for docs/fixtures/ from a RUNNING backend (~15 s).

    .\.venv\Scripts\python.exe scripts\export_fixtures.py --base http://127.0.0.1:8000

Writes live-*.json (real states produced through the API) and mock-*.json
(canned fixtures from journey_id=mock-<scenario>).
"""

import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "docs" / "fixtures"


def call(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    base = ap.parse_args().base.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)

    def save(name, journey_id):
        snap = call(base, "GET", f"/api/simulation/state?journey_id={journey_id}")
        (OUT / f"{name}.json").write_text(json.dumps(snap, indent=2) + "\n", encoding="utf-8")
        print("wrote", name)
        return snap

    for s in call(base, "GET", "/api/dev/mock-scenarios")["journey_ids"]:
        save(s, s)

    j = call(base, "POST", "/api/dev/reset")["id"]
    save("live-idle", j)
    call(base, "POST", f"/api/journeys/{j}/start")
    time.sleep(2)
    save("live-active", j)
    call(base, "POST", f"/api/journeys/{j}/pause")
    save("live-paused", j)
    call(base, "POST", f"/api/journeys/{j}/resume")
    time.sleep(1)
    inc = call(base, "POST", "/api/incidents",
               {"journey_id": j, "request_key": f"fixture-{uuid.uuid4()}", "request_source": "button"})["incident"]
    time.sleep(1)
    save("live-pending", j)
    time.sleep(10)
    save("live-dispatched", j)
    call(base, "POST", f"/api/incidents/{inc['id']}/accept", {"responder": "Campus safety desk (simulated)"})
    save("live-acknowledged", j)
    call(base, "POST", f"/api/incidents/{inc['id']}/resolve")
    call(base, "POST", f"/api/journeys/{j}/resume")
    inc2 = call(base, "POST", "/api/incidents",
                {"journey_id": j, "request_key": f"fixture-{uuid.uuid4()}", "request_source": "button"})["incident"]
    call(base, "POST", f"/api/incidents/{inc2['id']}/cancel")
    save("live-cancelled", j)


if __name__ == "__main__":
    main()
