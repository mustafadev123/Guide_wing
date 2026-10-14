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

## 2026-10-10: Two small demo improvements

- **Journey UUID with a Copy button on `/sim` and `/dev`.** The button falls back to select-and-copy on plain-HTTP LAN pages. `/dev` warns that **Reset demo creates a new UUID**, and Unreal Option A must then update its JourneyId. Adds the frontend helper `api.currentJourney`, which uses the existing `GET /api/journeys/current`. No API change.
- **Spoken obstruction warnings are suppressed until the journey has started.**
  - Detection status is still published: `vision.obstacle` with `announce: false`, and `obstruction_active` in the status and the snapshot.
  - A chair still present when the journey starts is announced once and pauses the journey.
  - A suppressed warning doesn't use up the 10 s cooldown.
  - A chair reappearing during the cooldown still pauses an active journey silently (unchanged).
  - Thresholds and the help lifecycle are unchanged.
- pytest **60 passed** (3 new: silent then announced-after-start, cooldown not consumed, API/WebSocket `announce:false` while idle). Frontend build and `tsc` pass. e2e_check **PASS** on a real server. A real-server WebSocket check showed `announce: False` with the journey idle while `obstruction_active` stayed true. `/sim` and `/dev` are served (200).
- **Pending (manual):** the Copy button in a real browser (localhost and LAN), and a live chair before and after Start (checklist 4a, 23a).

## 2026-10-10: Hands-on test finding: "hang" after the route ended

- **Your report:** the page seemed to hang when you pressed Pause.
- **Cause, from the logs:** the server stayed healthy, with every request returning 200. The 90 s demo route had reached 100%, so the journey was `ended`. The Pause/Resume control disappears for ended journeys and **P** did nothing silently.
- **Fixes:**
  - The default route is now **180 s** of walking; pauses don't count. Tests keep 90 s explicitly.
  - Pressing **P** on an ended journey speaks "This journey has ended. Press Start a new journey…"
  - `/user` shows **"Start a new journey"**, which creates and starts a fresh journey using the existing `POST /api/journeys` and `/start`. The API contract is unchanged.
- pytest 60 passed. The frontend builds. On the real server: route 180 s, and the new journey was active while the old one stayed `ended`.
- **Pending (manual):** press the button and the P key in the browser.
- **Second finding:** Help and Cancel went grey after the request was accepted, with no explanation. This is the designed lifecycle: an `acknowledged` request stays open until the responder clicks **Mark resolved**, and only pending or dispatched requests can be cancelled. The UI now:
  - keeps both buttons focusable (`aria-disabled` instead of `disabled`),
  - shows the reason under them, and
  - speaks the reason when the button or the H/C key is pressed.

  The lifecycle is unchanged. The frontend build passes.

## 2026-10-10: Live camera journey test (user-observed): PASS

- **Camera:** the laptop (ASUS ROG Zephyrus G14 GA401QM) has **no built-in webcam**. The phone is used through **DroidCam over USB** at index 1. DroidCam only delivers frames through Media Foundation, so the camera opener now tries MSMF before DirectShow (commit `fce8d33`). Measured: live, about 20 fps, about 45–55 ms inference.
- **Full journey test, run by the user and reported "everything works":**
  - start
  - real chair warning and pause, with no repeats
  - resume
  - waves don't trigger
  - a 2 s palm hold creates one request
  - cancel while still holding, with no retrigger
  - rearm, then a new request
  - dispatch to the responder with simulated location and a blurred snapshot
  - accept, with the acknowledgment spoken once, and R repeats without replay on refresh
  - resolve
  - covered lens: Help still works
  - end of route, then Start a new journey
- **Lighting matters:** in a dark room the chair was rarely detected. With the room lit, detection worked at the **default thresholds (unchanged)**.
- **Still unverified:**
  - chair before Start (4a)
  - person overlay (11)
  - full keyboard Tab order, screen reader and reduced motion (16, 18, 19)
  - responder edge cases (20, 22, 23a)
  - all Unreal items
  - LAN or phone access
  - the live palm and chair scores were not recorded

## 2026-10-11: Web demo verification (website, DroidCam, responder, Gemini)

Scope: website, backend, live DroidCam vision, responder workflow and Gemini analytics. Automated workflow and browser checks used **separate test servers with temporary databases**. The real `backend/data/guidewing.sqlite3` was never reset or deleted.

**Automated (current build):**
- pytest **89 passed**
- Node tests **5/5**
- strict TypeScript + production build pass
- `scripts/e2e_check.py` **16/16** (real 10 s clock)

**Real browser:** new `scripts/web_browser_check.cjs` drives installed Microsoft Edge (headless, `playwright-core` in git-ignored `tools/browsertest`). **45/45** checks:
- start, with `/sim` movement and a "simulated" label
- pause/resume consistent across pages, progress frozen while paused
- backend-owned 10 s deadline and server countdown
- cancel before dispatch, still cancelled after the deadline
- double-click Help creates one request
- pending not acceptable
- two responders give one acknowledgment, with "Server confirmed" and "Already handled"
- acknowledgment spoken once, not replayed after refresh; Repeat works
- resolve re-enables Help
- visible keyboard focus and named buttons
- ended journey offers Start a new journey
- unavailable location shown without coordinates
- connection loss shown, then recovery
- analytics matches the API
- no stray placeholder characters, no console errors

Speech was observed by intercepting `speechSynthesis.speak`. That proves the page asked to speak, not that audio was audible.

**Fixes:**
- **Responder notice:** the second responder's "Already handled" was overwritten by the generic change notice (`ResponderPage.tsx`).
- **Gemini timeout:** raised from 15 s to 40 s. A live `gemini-3.8-flash` report took about 16 s and timed out (`analytics.py`, test, `docs/GEMINI_ANALYTICS.md`).
- **Favicon:** inline icon added; it was the only console 404.

**Display changes (requested):** the analytics panel title is now "Summary". The "Next rehearsal check" section and the caveat lines are no longer displayed; the backend prompt is unchanged.

**Live DroidCam** (hands-on by the user; evidence from a server-side event log, no frames saved):
- **Setup:** DroidCam is camera index 0 (640×480 via Media Foundation). Frames were black until the server was restarted after DroidCam started streaming, so the rule is: start DroidCam first, then the backend.
- **Chair:** detected, with one spoken-warning flag, and the journey paused (`obstruction`). Cleared after about 9 s; resume was explicit.
- **Palm:** a 2 s hold created exactly **one** gesture request (hold progress 0.2 → 0.9, then the request). Cancel while holding: no retrigger. Interrupted holds (0.5, 0.1) were ignored.
- **Button Help** created and cancelled correctly.
- **Snapshots:** a blurred snapshot was attached about 20 ms after each request.
- **Processing:** about 19–20 fps and 48–57 ms per frame on CPU. This is processing speed, not accuracy or end-to-end latency.
- **Observation:** a second warning fired 1 s after a clear (cooldown elapsed). Keep the chair clearly inside or clearly outside the region.
- **Not recorded today:** a live request through to acknowledgment (observed on 10 Oct), and camera unplug while running.

**REPLAY (labeled, default thresholds):** chair warning and pause 3/3. The palm photo scored below 0.6, so there was no palm request; thresholds were not lowered.

**Gemini (real key in git-ignored `.env`; key never printed, logged or returned):**
- First call: `TimeoutError` at 15 s, which led to the timeout fix.
- Second call: HTTP 503 from Google (temporary), surfaced correctly.
- Third call: **ready in 16.1 s**. Every figure matched the database: 6 requests, 1 resolved (16.7%), 5 cancelled (83.3%), 1 cancelled before / 4 after dispatch, 5 gesture / 1 button, 33.7 s to acceptance, 16.4 s to resolution. Labeled simulated.
- A later in-browser Generate also succeeded after the data changed.
- Missing-key fallback verified on a test server; no key or provider URL in the frontend bundle.

**Repository:**
- `backup.md` moved to `docs/BACKUP_PLAN.md`, with links fixed
- `docs/JUDGE_QUESTIONS.md` removed
- `LICENSE` added (AGPL-3.0, because of the Ultralytics/YOLO dependency; a team decision to confirm)
- README rewritten for submission

**Still open:**
- screen-reader pass
- ElevenLabs with a real key
- demo video and screenshots
- rotate the Gemini key after the event (it was shared in a chat)
- the architecture index reports drift, partly from Windows line endings, and was not rebaselined

## 2026-10-11: Summary fallback (branch `summary-fallback`)

- **Dry run before recording** (server event log): every flow worked, including a **live palm request → dispatched → accepted → resolved**, button flows and cancel before/after dispatch. 2 of 3 Gemini summaries succeeded; one timed out after 40 s.
- **Fix:**
  - The backend returns an **instant summary** written from the recorded figures with every response, and retries transient Gemini failures once.
  - The panel shows the instant summary immediately and swaps in Gemini's text when ready. No error, retry or setup text is shown.
- **Verified:**
  - pytest **92 passed** (3 new: instant summary always present and exact; 503 retried once then ready; 401 not retried)
  - TypeScript/build pass; Node 5/5; browser check **46/46** (no-key server)
  - **Invalid-key server:** real HTTP 400 from Google, summary visible in the browser after **84 ms** with no error text
  - **Real server with the key:** instant at 0.03 s, Gemini text after 12.1 s

## 2026-10-11: iMessage companion via Photon Spectrum (branch `imessage-agent`, uncommitted)

- **New `imessage-agent/`** (TypeScript on the project's Node 24, `spectrum-ts` 12.10.1; Bun not needed):
  - `agent.ts`: commands, allowlist, each update sent once
  - `guidewing.ts`: REST and `/ws/events` client with reconnection
  - `messages.ts`: wording
  - `main.ts`: Spectrum iMessage, or `--terminal` for development
- **Backend:** additive request source `imessage` (schema, briefing, Gemini facts, analytics source counts, responder labels).
- **Launcher:** `scripts/start_imessage_agent.ps1` / `stop_imessage_agent.ps1`, with PID and log handling like the backend launcher.
- **Docs:** [IMESSAGE_AGENT.md](IMESSAGE_AGENT.md); README and CONTRACT updated.
- **Verified:**
  - backend pytest **93 passed** (new: `imessage` source accepted, labeled, idempotent)
  - frontend build pass
  - agent **10 unit tests** (commands, allowlist, event/reply race sends once, reconnect resync, cancel rules, obstacle announce flag, server-down message, masked logs)
  - **2 integration tests against the real backend** (start → help → dispatched → accepted → resolved, each texted exactly once; redelivered message no duplicate; cancel inside the window stays cancelled; unregistered number refused)
  - strict TypeScript against the real `spectrum-ts` types
  - startup guards refuse without an allowlist or Photon credentials
- **Pending (needs Photon account + iPhone):** a live iMessage round trip on the assigned line.
- **Live test findings:**
  - The Photon credentials authenticate (`npm run check`, about 0.5 s).
  - Photon gates senders: an unregistered number gets Photon's "add your number under project → users" reply, and the agent receives nothing.
  - Free-tier shared lines can change: first +1 646-279-2668, then +1 717-481-1829.
- **First live `status` reached the agent** (06:52:22) and was answered. The agent then **looped**, answering non-text events with a "text only" message. It was stopped immediately.
- **Loop fix:** non-text and own messages are ignored, and `SendLimiter` caps sends at 4 per 10 s and 15 per minute per conversation. Agent tests are now **13/13** (11 unit + 2 against the real backend).
- **Switched to the responder perspective** (the user-side companion duplicated `/user` and wasn't useful in a demo):
  - Registered responders receive each new request once it is dispatched, and reply `accept` / `resolved` / `details` / `list`.
  - The agent uses the desk's accept/resolve endpoints. The responder is recorded as "iMessage responder (…last 4)". The first acceptor wins; other responders are told who accepted, and an actor is never pushed their own action.
  - User cancellation after dispatch is pushed; cancellation inside the window is never sent.
  - **Tests: 14/14** (12 unit + 2 against the real backend: a user requests through the API, responder A accepts and resolves, responder B is told; and the cancellation cases). Strict typecheck passes.
  - Backend request source `imessage` is kept but no longer used by the agent.


## 2026-10-14: Optional voice commands on `/user` (branch `voice-commands`, uncommitted)

- **New `frontend/src/voice.ts`:**
  - fixed grammar "GuideWing, help / cancel / status / repeat", final results only, confidence threshold
  - browser `SpeechRecognition` adapter
  - `VoiceController`: push-to-talk, opt-in continuous listening, pause during app speech, restart backoff, error states
- **`speech.ts`:** providers report speaking start/stop. `Announcer` has `urgent` / `normal` / `optional` priority and `silence()` for barge-in.
- **`UserPage.tsx`:**
  - Voice section (Enable/Disable, Keep listening, last heard), Status button (S) and Speak a command (V)
  - voice uses the same `help` / `cancel` / `repeat` handlers as the buttons
  - shows which input made the request
  - obstacle speech is now "Obstacle detected ahead. Please pause."
- **Additive source `voice`:** schema, briefing text, Gemini incident facts, analytics source counts and sentence, responder labels, iMessage agent wording. Existing rows are unchanged.
- **Tests:**
  - backend **97 passed**
  - frontend Node **20/20** (15 new voice tests)
  - iMessage agent **15/15** plus typecheck
  - `scripts/voice_browser_check.cjs` **33/33** in headless Edge against an isolated backend with a mock recognizer
  - existing `web_browser_check.cjs` **46/46** (focus check adjusted for the new last control)
- **Unverified:** real-microphone recognition and audible playback on the demo laptop; live iMessage round trip. See [VOICE_COMMANDS.md](VOICE_COMMANDS.md) and [LINKEDIN_VIDEO_SCRIPT.md](LINKEDIN_VIDEO_SCRIPT.md).

## 2026-10-14: Checkpoints, "On my way", readiness feedback (branch `voice-commands`, uncommitted)

- **Checkpoints:** spoken once per journey from the backend `waypoint_index`. A skipped boundary is merged into one sentence. Refresh, reconnect and a new journey don't replay. Paused or ended journeys stay silent. Labeled "simulated route".
- **On my way:**
  - `POST /api/incidents/{id}/on-my-way` with the `responder_token` returned once by the winning accept (SHA-256 stored). Status stays acknowledged.
  - Additive `on_my_way_at` field and DB columns, with migration for old databases.
  - Desk button in the accepting tab only. iMessage `on my way`/`onmyway`, pushed once to other responders.
  - User hears "Your responder says they are on the way." once.
- **Readiness/failure:** camera (fresh frame + model; live/replay/test wording; silent while starting), server loss/recovery, and voice microphone readiness/failures. Announced once with hysteresis; optional narration never interrupts urgent or normal speech.
- **Tests:**
  - backend **104 passed**
  - iMessage agent **18/18** plus typecheck
  - frontend Node **31/31**
  - `feedback_browser_check.cjs` **35/35**, `voice_browser_check.cjs` **33/33**, `web_browser_check.cjs` **46/46**
- **Unverified:** audible playback, real camera loss and recovery, live iMessage `on my way`. See [ROUTE_AND_READINESS_FEEDBACK.md](ROUTE_AND_READINESS_FEEDBACK.md).

## 2026-10-14: One-step voice (V turns voice on and listens)

- Voice is still off by default. Pressing **V** or **Speak a command** with voice off now enables it, asks for the microphone if needed, and listens in one step, without the readiness speech that would delay listening. A short tone marks "speak now" for push-to-talk. In an unsupported browser, V explains and points to Help.
- Decision: no always-on wake phrase, because of always-on cloud audio, false triggers, and Edge blocking audio after a reload. One key maps to a headset or side button in a real product.
- Cancel refused because the request was accepted in the meantime now speaks "Already accepted. Only the responder can now resolve this request." instead of the raw server text.
- Checks: `voice_browser_check.cjs` **38/38** (4 consecutive runs), `feedback_browser_check.cjs` **35/35** (3 runs; a new-journey race in the check fixed), `web_browser_check.cjs` **46/46**, frontend Node **31/31**.
- **Push-to-talk without the prefix:** after pressing V, a bare "help", "cancel", "status" or "repeat" (the whole utterance) is accepted. This is faster, and there is no "GuideWing" for Edge to mishear. Continuous listening still requires "GuideWing". Frontend Node **33/33**; voice browser check **38/38** (3 runs, one-step flow now says just "help"); existing **46/46**.
