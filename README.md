# GuideWing

GuideWing is a hackathon prototype of a **simulated** drone companion for blind and low-vision pedestrians. It can:

- warn about a limited obstruction (a chair in a monitored camera region),
- accept a hands-free help request (an open palm held for 2 s, or a Help button), and
- speak to the user when a responder accepts.

We focus on the accessible workflow from requesting help to receiving acknowledgment. The journey, location, drone and responder organization are simulated. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

```
webcam / replay video ──> vision worker (YOLO26n chairs, MediaPipe Open_Palm)
                                  │ observations
Help button ─────────────> FastAPI backend (SQLite) ── owns lifecycle, deadlines, route progress
                             │            │                  │
              WebSocket + REST        REST poll 2 Hz     REST poll 2 Hz
                             │            │                  │
                 /user  /responder     /sim (2D)      Unreal scene (teammate)
              (speech owner)          fallback          primary renderer
```

## Setup (Windows PowerShell, once)

Requirements: Windows 10 or 11 with the `py` launcher and Python 3.14 (tested with 3.14.7). Everything installs **inside this folder**: `.venv`, `tools\node` (portable Node 24.21.0) and `models\`.

```powershell
cd "C:\guide_wing\Guide_wing"
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

The setup script creates `.venv`, installs CPU-only PyTorch and the pinned packages from [requirements.txt](requirements.txt), downloads portable Node with a checksum check, builds the frontend, downloads both models, and runs `scripts\check_environment.py`.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1              # webcam 0, loopback only
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoVision    # button-only (no camera)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Video clip.mp4   # labeled REPLAY input
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Camera 1    # other webcam, e.g. DroidCam
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Lan         # trusted LAN for Unreal on another laptop
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Foreground  # logs in this window; Ctrl+C stops
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1               # stops only the server start.ps1 launched
```

The backend serves everything on one port:

| Page | URL |
|---|---|
| User companion (speech, Help, Cancel, Repeat) | http://127.0.0.1:8000/user |
| Responder dashboard | http://127.0.0.1:8000/responder |
| 2D fallback renderer | http://127.0.0.1:8000/sim |
| Developer controls (TEST labeled, reset) | http://127.0.0.1:8000/dev |
| Unreal snapshot | http://127.0.0.1:8000/api/simulation/state?journey_id=current |
| API docs | http://127.0.0.1:8000/docs |

The launcher refuses to start if port 8000 is busy, and it names the process that owns the port. It records the PID of the server process tree it starts in `run\backend.pid`. Logs go to `logs\`.

**Keyboard on `/user`:** H = help, C or Esc = cancel, R = repeat last message, P = pause/resume. Audio starts after your first click or keypress, because browsers require that.

Unreal integration and LAN setup are in [docs/UNREAL_INTEGRATION.md](docs/UNREAL_INTEGRATION.md).

## Phone as the camera (optional)

1. Install DroidCam on the phone and the DroidCam Windows client (https://droidcam.app/windows/), then connect them.
2. Find the camera index with the backend stopped: `.\.venv\Scripts\python.exe scripts\test_camera.py --list`, then `scripts\test_camera.py <index>`.
3. Start with `scripts\start.ps1 -Camera <index>`. The UI still says LIVE camera; the source label shows the index.

The phone index on your laptop hasn't been confirmed yet. The laptop webcam (`-Camera 0`) and `-Video` stay available as fallbacks.

## Optional sponsor providers

Copy `.env.example` to `.env` and set:

- `ELEVENLABS_API_KEY`: the user page then plays ElevenLabs audio, cached per phrase in `backend\data\tts_cache`, and falls back to browser speech on any error.
- `GEMINI_API_KEY`: enables the optional incident briefing and the responder **Analytics → Generate summary** action. Analytics sends only server-computed aggregate counts and timings. Its model is independently configurable with `GEMINI_ANALYTICS_MODEL`.

Both providers are optional. Keys remain server-side. Synthetic live Gemini checks have succeeded for aggregate analytics and incident response reviews; ElevenLabs service success remains unverified. Incident reviews use GEMINI_MODEL independently of GEMINI_ANALYTICS_MODEL, both defaulting to gemini-3.8-flash.

For key setup, restart commands, the analytics contract and verification details, see [docs/GEMINI_ANALYTICS.md](docs/GEMINI_ANALYTICS.md). Edit an existing `.env` rather than replacing it. New frontend source requires `start.ps1 -Rebuild` when an older build exists.

## Tests and checks

```powershell
.\.venv\Scripts\python.exe -m pytest                         # backend lifecycle, simulation, vision logic
.\.venv\Scripts\python.exe scripts\check_environment.py      # imports, versions, real model inference
powershell -ExecutionPolicy Bypass -File scripts\build_frontend.ps1   # tsc + vite build
.\.venv\Scripts\python.exe scripts\e2e_check.py              # against a running server, real 10 s clock
.\.venv\Scripts\python.exe scripts\vision_replay_check.py    # against a server started with -Video
.\.venv\Scripts\python.exe scripts\test_camera.py 0          # your webcam (Q quits)
.\.venv\Scripts\python.exe scripts\unreal_diag_client.py     # polls like Unreal
```

## Configuration

Settings are environment variables; see [.env.example](.env.example) and [backend/app/config.py](backend/app/config.py). The useful ones are:

- `GUIDEWING_PATH_REGION`: the monitored image region, as normalized `x1,y1,x2,y2`.
- `GUIDEWING_CHAIR_CONFIDENCE` and `GUIDEWING_PALM_SCORE`: detection thresholds.
- `GUIDEWING_CANCEL_WINDOW_S`: the cancellation window.
- `GUIDEWING_ROUTE_DURATION_S`: how long the demo route takes.

The route waypoints are in [backend/app/route_campus_demo_v1.json](backend/app/route_campus_demo_v1.json). They are illustrative, not surveyed.

## Layout

```
backend/app/        FastAPI app, services, schemas, simulation, vision/
backend/tests/      pytest suites (fake clock; no real sleeps)
frontend/src/       React + TypeScript pages: user, responder, sim, dev
scripts/            setup, start/stop, checks, diagnostic client, camera test
docs/               contract, Unreal integration, progress, demo, checklist, limitations, fixtures/
models/             downloaded weights (git-ignored)
```

## Credits and licenses

| Component | Use | License |
|---|---|---|
| [Ultralytics](https://github.com/ultralytics/ultralytics) 8.4.175 and **YOLO26n** pretrained weights (COCO) | chair and person detection | **AGPL-3.0** |
| [MediaPipe](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer) 1.1.0 Tasks Gesture Recognizer and `gesture_recognizer.task` | Open_Palm recognition | Apache-2.0 |
| OpenCV (opencv-contrib-python 5.0) | capture, drawing, blur | Apache-2.0 |
| PyTorch 2.14 (CPU) | detector runtime | BSD-3-Clause |
| FastAPI, Starlette, Pydantic, Uvicorn | backend | MIT / BSD |
| React 19, Vite 8, TypeScript 6 | frontend | MIT / Apache-2.0 |
| Node.js 24 (portable, local) | frontend build | MIT |
| ElevenLabs API, Google Gemini API (optional, off by default) | speech, responder summary | provider terms of service |

Prior work: Tan et al., *Flying Guide Dog* (2021), https://arxiv.org/abs/2108.07007. No user research with blind or low-vision participants has been done for this prototype.
