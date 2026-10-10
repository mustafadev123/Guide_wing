r"""Check the real vision pipeline against a RUNNING backend started with a replay video:

    powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Video path\to\clip.mp4
    .\.venv\Scripts\python.exe scripts\vision_replay_check.py --seconds 40

Starts a fresh journey, then records what the real models produce from the clip:
vision status, obstruction events, gesture-created incidents and snapshot presence.
It injects nothing; results depend entirely on the footage.
"""

import argparse
import json
import threading
import time
import urllib.request

from websockets.sync.client import connect


def call(base, method, path):
    req = urllib.request.Request(base + path, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read() or b"null")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--seconds", type=float, default=40)
    a = ap.parse_args()
    base = a.base.rstrip("/")

    events, stop = [], threading.Event()

    def listen():
        with connect(base.replace("http", "ws", 1) + "/ws/events") as ws:
            while not stop.is_set():
                try:
                    events.append(json.loads(ws.recv(timeout=0.5)))
                except TimeoutError:
                    pass

    threading.Thread(target=listen, daemon=True).start()
    j = call(base, "POST", "/api/dev/reset")
    call(base, "POST", f"/api/journeys/{j['id']}/start")
    t0 = time.monotonic()
    resumed = 0
    samples = []
    while time.monotonic() - t0 < a.seconds:
        v = call(base, "GET", "/api/vision/status")
        samples.append(v)
        s = call(base, "GET", f"/api/simulation/state?journey_id={j['id']}")
        if s["journey"]["status"] == "paused" and s["journey"]["pause_reason"] == "obstruction":
            call(base, "POST", f"/api/journeys/{j['id']}/resume")  # the participant resumes explicitly
            resumed += 1
        time.sleep(0.5)
    stop.set()

    ready = [x for x in samples if x["ready"]]
    print(f"input_mode={samples[-1]['input_mode']} source={samples[-1]['source_label']}")
    print(f"ready samples {len(ready)}/{len(samples)}; last error: {samples[-1]['error']}")
    if ready:
        inf = sorted(x["inference_ms"] for x in ready if x["inference_ms"])
        fps = sorted(x["fps"] for x in ready if x["fps"])
        print(f"inference ms median {inf[len(inf)//2]:.0f} (min {inf[0]:.0f}, max {inf[-1]:.0f}); "
              f"pipeline fps median {fps[len(fps)//2]:.1f}")
    obstacles = [e["payload"] for e in events if e["type"] == "vision.obstacle"]
    print(f"obstacle events: {[(o['state'], o['announce'], o['source']) for o in obstacles]}")
    print(f"journey resumed after obstruction pauses: {resumed}")
    incs = [e["payload"] for e in events if e["type"] == "incident.updated"]
    created = [i["incident"] for i in incs if i["transition"] == "created"]
    print(f"incidents created: {[(i['request_source'], i['id'][:8]) for i in created]}")
    snaps = [i["incident"]["id"][:8] for i in incs if i["transition"] == "snapshot_attached"]
    print(f"blurred snapshots attached: {snaps}")


if __name__ == "__main__":
    main()
