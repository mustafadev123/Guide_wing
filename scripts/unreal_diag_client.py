r"""Diagnostic client that polls the snapshot exactly the way Unreal should.

    .\.venv\Scripts\python.exe scripts\unreal_diag_client.py --base http://127.0.0.1:8000 --journey current
    .\.venv\Scripts\python.exe scripts\unreal_diag_client.py --journey mock-pending

Standard library only (works with any Python 3.10+ on the Unreal laptop too).
Behavior to mirror in Unreal:
  * poll about every 0.5 s with at most one request in flight
  * ignore a response whose revision is older than the last applied one (same boot_id)
  * a changed boot_id means the server restarted: reset revision tracking
  * no successful response for > 2 s -> show DISCONNECTED and stop the scene
"""

import argparse
import json
import time
import urllib.request

STALE_S = 2.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--journey", default="current")
    ap.add_argument("--interval", type=float, default=0.5)
    ap.add_argument("--seconds", type=float, default=0, help="stop after N seconds (0 = run until Ctrl+C)")
    a = ap.parse_args()
    url = f"{a.base.rstrip('/')}/api/simulation/state?journey_id={a.journey}"
    print(f"polling {url}")

    boot, revision, last_ok, shown, connected = None, -1, time.monotonic(), None, None
    started = time.monotonic()
    while not a.seconds or time.monotonic() - started < a.seconds:
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=1.5) as r:  # one request in flight
                s = json.loads(r.read())
            last_ok = time.monotonic()
            if connected is not True:
                print("CONNECTED")
                connected = True
            if s["boot_id"] != boot:
                print(f"boot {s['boot_id'][:8]} (server (re)started) -> reset revision tracking")
                boot, revision = s["boot_id"], -1
            if s["revision"] < revision:
                continue  # stale response; discard
            revision = s["revision"]
            j, inc, v = s["journey"], s["active_incident"], s["vision"]
            view = (
                s["data_source"], j["status"], j["pause_reason"], j["waypoint"],
                inc and inc["status"], v["input_mode"], v["obstruction_active"],
            )
            if view != shown:
                shown = view
                loc = j["location"]
                print(
                    f"rev {revision:>5} [{s['data_source']}] journey={j['status']}"
                    f"{'/' + j['pause_reason'] if j['pause_reason'] else ''} progress={j['route_progress']:.3f}"
                    f" waypoint={j['waypoint']} location={loc['source']}"
                    f" incident={(inc['status'] + ' ' + inc['id'][:8]) if inc else 'none'}"
                    f"{' T-' + str(inc['seconds_until_dispatch']) if inc and inc['seconds_until_dispatch'] is not None else ''}"
                    f" vision={v['input_mode']}{' OBSTRUCTION' if v['obstruction_active'] else ''}"
                )
        except Exception as e:  # noqa: BLE001
            if connected is not False and time.monotonic() - last_ok > STALE_S:
                print(f"DISCONNECTED ({type(e).__name__}: {e}) - stop the scene, keep retrying")
                connected = False
        time.sleep(max(0.0, a.interval - (time.monotonic() - t0)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
