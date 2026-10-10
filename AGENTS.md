# GuideWing repository orientation

Start here for architecture/status questions. Detailed implementation notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), reviewed 2026-10-10. They are a dated reference, not authority over changed code or the user's instructions.

## Fast orientation

- Python FastAPI/Uvicorn backend; React/TypeScript/Vite frontend. Built web pages and API share port 8000. Source frontend already works; the team's upcoming finished UI is a planned replacement.
- Backend owns journey progression, incident states, cancellation deadlines, dispatch, and location. Browsers render state; `/user` owns speech. Unreal lives in sibling `../GuideWingSim`; backend integration/packaged build remain unverified.
- Entry/routes: `backend/app/main.py`; lifecycle: `services.py`; SQLite schema: `db.py`; wire types: `schemas.py`; defaults: `config.py`.
- Vision: `vision/service.py`, `vision/logic.py`, `vision/camera.py`. CPU YOLO26n chairs/person overlays; MediaPipe Open_Palm. Two-second palm hold; one-second chair persistence; request has a ten-second cancellation window.
- Durable data: `backend/data/guidewing.sqlite3`, `snapshots/<incident UUID>.jpg`, `tts_cache/<phrase hash>.mp3`. Raw camera frames stay in memory. Annotated live preview is not blurred. Gemini results and WebSocket events are memory-only.
- Optional providers: `sponsors.py`; deterministic fallback: `providers.py`; browser speech: `frontend/src/speech.ts`. Gemini default `gemini-2.5-flash`, ElevenLabs `eleven_flash_v2_5`; configurable, actual provider success requires rehearsal evidence.
- Implemented: journey, help/cancel/dispatch/accept/resolve, responder history, camera/replay, speech/repeat, 2D renderer, mock/test controls, provider adapters. Planned: finished frontend, completed-response Gemini reports/analytics, audio playback within Unreal. No real flight, emergency calls, safe routing, or implemented browser GPS acquisition.

## Reduce repeated lookups

For an overview, use the notes; before depending on a topic's cached implementation detail, optionally run `python scripts/check_architecture_index.py --topic <topic>` (or project `.venv` Python). Topics: `api`, `lifecycle`, `vision`, `simulation`, `frontend`, `sponsors`, `operations`, `tests`, `status`, `reference`. The standard-library-only checker prints changed/missing/new source paths without dumping source. Exit 0 = hashes match; 1 = drift; 2 = invalid index/options or IO error. It makes no writes, imports no application/models, and uses no network/camera.

If drift is relevant, read only the reported files and their necessary dependencies. Refresh the corresponding architecture notes and SHA-256 index entries together after reviewing changes. Never silently rebaseline to make the check pass. Hashes establish byte equality, not runtime correctness, dependency availability, security, or provider readiness. Unknown new source files require triage; do not assume a clean topic covers them.

Do not routinely ingest `.venv`, `node_modules`, portable tools, model weights, `.env`, runtime databases/images/audio, or large logs for architecture questions. Read secrets/runtime content only when the task needs it. Test/fixture-export scripts may mutate a running demo; inspect before executing. Use current source for exact signatures, code changes, and debugging. Test results in PROGRESS/HANDS_ON_TEST_CHECKLIST are historical or user-reported unless freshly verified.
