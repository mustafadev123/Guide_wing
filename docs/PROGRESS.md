# Progress log

Results below come from commands I actually ran. "Pending (manual)" means it needs a person, a device or the Unreal build.

## 2026-10-09/10: Milestones 0–5 (core) implemented

### Starting point
- The repo held only `README.md`, plus an uncommitted camelCase mock backend from earlier the same day. **Unreal had never tested that mock**, and there was no `AGENTS.md` and no Unreal connection code. The mock was replaced by the build guide's snake_case contract. The path `/api/simulation/state` is unchanged; the differences are documented in [CONTRACT.md](CONTRACT.md#changes-from-the-earlier-mock).
- At first, an old mock server (`backend\.venv`, PID 27824) was still listening on port 8000. I left it running; stop it before starting the new backend (see Next commands).

### Environment (verified)
- Python 3.14.7 (the only interpreter installed; the guide suggests 3.11/3.12). MediaPipe 1.1.0 ships a `py3-none-win_amd64` wheel, so 3.14 works and no extra interpreter was installed.
- Project `.venv`: fastapi 0.143.0, uvicorn 0.54.0, pydantic 2.14.0, starlette 1.7.0, websockets 17.2, torch 2.14.1+cpu, torchvision 0.29.1+cpu, ultralytics 8.4.175, mediapipe 1.1.0, opencv-contrib-python 5.0.0.93, numpy 2.5.2, pytest 9.1.1, httpx 0.28.1.
- **OpenCV conflict resolved:** only `opencv-contrib-python` provides `cv2`, and ultralytics is installed with `--no-deps`. `pip check` reports only the expected "ultralytics requires opencv-python".
- Portable Node v24.21.0 / npm 11.19.0 in `tools\node` (SHA-256 verified). React 19.3, Vite 8.3.4, TypeScript 6.0.3. I chose TypeScript 6.0.3 over 7.0, because 7.0 is the new native rewrite and less certain to work with the tooling.
- Models: `models\yolo26n.pt` (Ultralytics release v8.4.0) and `models\gesture_recognizer.task` (MediaPipe float16 latest).
- `scripts\check_environment.py`: **PASS**. The detector ran at 37 ms on bus.jpg (CPU), and the gesture model gave `Victory 0.91` on the MediaPipe sample (20 ms).

### Backend workflow (milestones 1–2): PASS
- **pytest: 48 passed in 2.3 s** (fake clock, no real sleeps). Covered:
  - idempotent keys, including after cancellation
  - one open incident per journey
  - armed requirement
  - cancel before the deadline is never resurrected
  - ticker dispatch, and lazy dispatch when the snapshot is read
  - cancel exactly at the deadline (recorded as dispatched, then cancelled)
  - cancel after dispatch, and accept rejected before dispatch
  - 8 simultaneous accepts give exactly one acknowledgment
  - a 20-round cancel/dispatch race
  - resolve rules
  - restart recovery across three app instances
  - REST state after reconnect
  - invalid and unavailable location (not zero)
  - a WebSocket second client receives created, dispatched and acknowledged in order
  - dev reset, TEST labeling, and the briefing uses only recorded facts
- **Real server, real clock: `scripts\e2e_check.py`: 16/16 PASS.** This includes the real 10 s dispatch, double accept, cancel inside the window staying cancelled past the deadline, and the WebSocket client seeing every transition exactly once.
- **Real restart:** a request was pending, the server was stopped for 12 s and restarted, and the request came back `dispatched` (timeline `created,dispatched`).

### Interfaces (milestone 3): built, browser checks pending
- `/user`, `/responder`, `/sim` and `/dev` are served by the backend from `frontend/dist`. The `tsc` and `vite build` pass.
- **Pending (manual):** actual speech output, keyboard-only run, screen reader, focus visibility, and reduced motion. I have not seen them work in a browser.

### Shared simulation (milestone 4): PASS
- The backend advances the route: a 90 s route with 0.25 s ticks, a 1 s cap per tick (no jump after a stall), and persistence every tick. Arrival ends the journey. Reading a snapshot never advances the route (tested).
- Mock fixtures for `mock-active`, `-paused`, `-pending`, `-dispatched`, `-acknowledged`, `-cancelled` and `-no-location`. Real captures are in `docs/fixtures/live-*.json`.
- `scripts\unreal_diag_client.py` polled the live server and detected the boot change after the restart.
- **Pending (teammate):** the packaged Unreal executable has not been tested against this backend.

### Computer vision (milestone 5): real models PASS on a replay clip; live webcam pending
- I did **not** open your webcam: switching it on without asking would record you. Instead I built a 16 s replay clip from two CC BY-SA Wikimedia photos (a chair scene and an open palm). It stayed in my temporary scratchpad, not in the repo.
- `scripts\vision_replay_check.py` against `start.ps1 -Video …`:
  - mode `replay`, ready 68/68 samples
  - **inference median 49 ms (46–73), pipeline ~13.4 fps** on a Ryzen 9 5900HS, CPU only
  - chair: `detected` with announce, then `cleared`, then `detected` again on the next loop after the 10 s cooldown
  - palm: **exactly one** gesture incident, with a **blurred snapshot attached**
- **The palm threshold was lowered to 0.5 for this run only**, because the photo scored `Open_Palm 0.54`. The default stays 0.6, and the live-webcam score is not yet measured.
- **Snapshot privacy:** the served image has Laplacian variance 1.15, against 353 for the source frame. The snapshot folder holds only the processed JPEG.
- **Pending (manual):** live webcam (`scripts\test_camera.py 0`), a real chair in the region, real palm holds, waves not triggering, and rearm after release.

### Launcher
- `scripts\start.ps1` refuses to start on a busy port (it named PID 27824) and records the cmd.exe that owns the server's process tree. `scripts\stop.ps1` kills that tree only, and I confirmed the port was free afterwards. Background: the venv's `python.exe` is a launcher that starts a child Python. Killing only the launcher leaves the child holding the port, which is the "port already in use" problem from earlier.

### Sponsor providers (milestone 6): implemented, stub-tested only
- `backend/app/sponsors.py`:
  - `ElevenLabsSpeech`: `/api/speech`, phrase cache, 8 s timeout, browser fallback in `frontend/src/speech.ts`.
  - `GeminiBriefing`: generated asynchronously after dispatch, JSON schema output, content validation, and the deterministic briefing kept on any failure.
- pytest now **54 passed**: the original 48 plus 6 sponsor tests with stubbed HTTP (cache hit, failure fallback, rejecting crime, navigation and invented-number output, keys never returned in `/api/health`, AI never generated before dispatch).
- `scripts\start.ps1` loads an optional git-ignored `.env` and prints only the key names.
- **Pending (manual, needs keys):** a real ElevenLabs voice and a real Gemini call. Model and voice defaults (`gemini-2.5-flash`, `eleven_flash_v2_5`, voice `JBFqnCBsd6RMkjVDRZzb`) are configurable and unverified.
- e2e_check re-run after these changes on a fresh server: **16/16 PASS**.

## Not done yet
- Phone webcam input: the same `-Camera <index>` path; the index is not confirmed.
- All manual device checks in [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md).
- No git commits have been made; everything is uncommitted in the working tree.

## Next commands
```powershell
cd "C:\guide_wing\Guide_wing"
# stop the OLD mock server first: Ctrl+C in its terminal, or
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
powershell -ExecutionPolicy Bypass -File scripts\start.ps1          # webcam 0
start http://127.0.0.1:8000/user ; start http://127.0.0.1:8000/responder
.\.venv\Scripts\python.exe scripts\test_camera.py 0                 # run while the backend is stopped
```

## 2026-10-10: Contract review and preparation for hands-on testing

- **Live `/api/simulation/state` compared with CONTRACT.md and UNREAL_INTEGRATION.md** (script run against a real server):
  - Every field path in the live and mock responses is documented.
  - Every status value is listed: journey `idle|active|paused|ended`; incident `pending|dispatched|acknowledged|cancelled|resolved`; pause reason `user|obstruction|help_request`.
  - `journey_id=current`, or leaving the parameter out, returns the current journey's **UUID** as `journey.id`. It matches `/api/journeys/current` and `health.current_journey_id`.
  - `journey_id=demo` returns 404, and `mock-*` echoes its own ID.
- **Found `Downloads\GuideWing_Unreal_HTTP_Starter.zip`** (a C++ component and a mock backend, 9 Oct; its README says it has not been compiled). It is incompatible in two ways: its default `JourneyId=demo` gets 404, and its exact `journey.id == JourneyId` check fails with `current`. I did **not** modify the starter. A no-code workaround and a 3-line patch are documented in UNREAL_INTEGRATION.md §9.
- **Additive changes:**
  - `vision.obstruction_source` in the snapshot, so Unreal can tell a TEST obstruction from a camera detection.
  - New fixtures `mock-obstacle` and `mock-resolved`, matching the starter's mock scenarios.
  - Fixtures regenerated (9 mock, 7 live, captured with `-NoVision`).
- **Detection thresholds unchanged.**
- pytest **57 passed**. Frontend build passes. e2e_check **PASS** after the change.
- Hands-on checklist: [HANDS_ON_TEST_CHECKLIST.md](HANDS_ON_TEST_CHECKLIST.md); all items UNVERIFIED.
