# Checkpoints, "On my way" and readiness feedback

Three additions to spoken feedback on `/user`, plus a responder progress update. None of them gives directions, recognizes traffic, or claims a path is safe.

## 1. Simulated-route checkpoints

- **Source of truth:** the backend's `journey.waypoint_index`, which is the last waypoint whose boundary has been passed. Boundaries are the cumulative fractions of the route definition in `backend/app/route_campus_demo_v1.json`, served by `/api/simulation/route`. No frontend timer is used, and the nearest-landmark label is not used either.
- **What is said:** "You've reached Library crossing on the simulated route." If one poll skips a boundary, a single sentence names both: "You've passed Library crossing and reached Fountain plaza on the simulated route."
- **Once per journey:** the dedupe key is `checkpoint:<journey UUID>:<waypoint index>`.
- **On page load, reconnect or a new journey,** the current position is recorded without speaking, so old checkpoints are never replayed. A new journey UUID resets tracking.
- **Paused or ended journeys** never speak a crossing. The final waypoint is covered by the existing "You reached the end of the demo route."
- **Priority:** checkpoints are *optional* narration. They never interrupt an obstacle warning or an assistance update. If something more important is playing, the checkpoint is dropped rather than queued, so nothing stale plays later.
- Implementation: `frontend/src/checkpoints.ts` and `UserPage.tsx`.

## 2. "On my way" (responder progress update)

- **Lifecycle unchanged:** pending → dispatched → acknowledged → resolved. "On my way" is a separate persistent field, `incidents.on_my_way_at`, plus an `on_my_way` timeline event. The status stays `acknowledged`.
- **Endpoint:** `POST /api/incidents/{id}/on-my-way` with `{responder_token}`. It returns 409 unless the request is `acknowledged` (pending, dispatched, cancelled or resolved are all refused) and 403 without the matching token. A repeat returns 200 with `changed: false`, and no second event or notification is sent.
- **Who may send it, enforced server-side:**
  - The accept that wins gets a random `responder_token` in its response, once. The database stores only the token's SHA-256.
  - A display name is never trusted as authorization.
  - The web desk keeps the token in that browser tab's `sessionStorage`. A different desk or tab shows an explanation instead of the button.
  - The iMessage agent keeps the token in memory, mapped to the phone number that accepted.
- **Limitation:** there is no login. The token proves which *client* (browser tab or agent process) won the acceptance, not which *person* is using it. Anyone with that tab open can press the button. After an agent restart, the agent cannot send On my way for a request it accepted earlier, and says so. Requests accepted before this feature have no token and are refused.
- **User hears** "Your responder says they are on the way." once. It is deduplicated by `incident:<id>:on_my_way` and seeded on refresh, so it is not repeated. Status and the request strip still report it. No ETA or arrival is implied.
- **iMessage:** `on my way` / `onmyway`. The other registered responders get "*name* is on the way to the request near …" once, including after a reconnect resync. Details and List show it. The send limiter, allowlist and loop protection are unchanged.
- **Compatibility:** `on_my_way_at` is added to `Incident` and `SnapshotIncident` (nullable). Existing Unreal snapshot fields are unchanged. Older databases gain the two columns on startup with NULL values.

## 3. Readiness and failure feedback

Signals come from backend health, not just a successful HTTP request:

- **Camera:** `/api/vision/status` reports `ready` only with a frame younger than 2 s *and* a loaded model. A stale frame or a capture failure comes with an error.
  - "Camera ready. Live chair and open-palm recognition is running."
  - "Replay input ready. Recognition is running on recorded video, not a live camera."
  - "Test input mode. No camera is connected; only developer test observations are used."
  - "Camera unavailable. You can still request help."
  - "Camera ready again. …"
  - A configured camera that has not produced its first frame yet is not announced as a failure.
- **Server:** if snapshots fail or go stale, the page says: "Connection to the GuideWing server lost. Help requests and cancellations cannot be confirmed right now. If you need help urgently, use another way to get it." Help is blocked with an explanation, and nothing implies delivery. On recovery: "Connection restored. …"
- **Voice:** "Voice commands on. Microphone access granted. …" is spoken only after the microphone was granted. Voice failures (denied, no microphone, network) are spoken once.
- **Hysteresis:** camera failure must persist 3 s, recovery 3 s, and the first state 1.5 s. Server loss must persist 2 s and recovery 3 s. Brief flickers stay silent, and each change is announced once. Trackers live outside React state, so rerenders never repeat a message. A refresh in the same tab does not repeat the last camera message.
- Implementation: `frontend/src/readiness.ts` and `UserPage.tsx`.

## Audio coordination

All speech goes through the existing `Announcer`, which supports browser speech and ElevenLabs with a browser fallback.

- **Priorities:**
  - *urgent:* obstacle warnings
  - *normal:* assistance updates, On my way, connection and camera loss, voice failures
  - *optional:* checkpoints, camera/voice readiness, spoken Status
- Optional speech never interrupts urgent or normal speech, and is dropped instead of queued.
- Repeat replays the latest message that was actually shown.
- The voice controller still pauses recognition whenever the app speaks.
- A unit test checks that none of the new announcements matches the "GuideWing …" command grammar.

## Verification (2026-10-14)

- **Backend pytest: 104 passed.** The 7 new tests in `test_on_my_way.py` cover:
  - assigned responder, once
  - token only for the winning accept
  - forged or missing token rejected
  - pending, dispatched, resolved and cancelled requests refused
  - 6 concurrent repeats produce one update
  - an old database migrates and keeps its rows
  - a tokenless acceptance is refused
- **iMessage agent: 18/18 plus strict typecheck.**
  - New unit tests: parsing (`yes, on my way` still accepts), acceptor-only and once, pushed once to others, refused after a restart, desk update pushed once including after a resync.
  - The real-backend integration test runs voice Help → accept → `on my way` (other responder refused, repeat ignored, other responder told once) → resolve.
- **Frontend: 31/31** Node tests: checkpoints, hysteresis, priority, and that no announcement matches a command. `tsc -b` and `vite build` pass.
- **`scripts/feedback_browser_check.cjs`: 35/35** in headless Edge against an isolated backend with a 24-second route. Covered:
  - crossing, once, simulated label
  - no replay on refresh
  - pause, resume, route end, new journey
  - On my way from the accepting desk only, forged token 403
  - the user hears it once, the dashboard shows it, a repeat is a no-op, no repeat after refresh, 409 after resolve
  - camera unavailable once and not repeated on refresh
  - fake live camera: starting stays silent, ready, flicker ignored, stale → unavailable once, recovery once, no repeat on rerender
  - replay label
  - server loss announced once, Help blocked without claiming delivery, recovery once
  - no page errors
- **Regression:** `voice_browser_check.cjs` 33/33 and `web_browser_check.cjs` 46/46.

## Manual checks (UNVERIFIED until done on the demo devices)

1. **Audible checkpoint:** start a journey with spoken feedback on (click any button first). Within roughly the first third of the route you should hear "You've reached Library crossing on the simulated route." exactly once.
2. **Real camera readiness:** start with `-Camera <index>`. "Camera ready. Live chair…" plays once after the preview shows frames. Unplug the camera or close DroidCam: "Camera unavailable. You can still request help." plays about 3 s later. Reconnecting is announced once only if the backend recovers the stream; if it doesn't, restart the backend.
3. **Server loss:** run `scripts\stop.ps1` while `/user` is open. You hear the "cannot be confirmed" message once, and Help explains it cannot reach the server. Start the server again: "Connection restored" once.
4. **Live iMessage On my way:**
   1. The responder phone texts `list`, then the user requests help. After the push, reply `accept`, then `on my way`.
   2. `/user` says "Your responder says they are on the way." once.
   3. The desk shows the On my way time.
   4. A second registered phone gets one "… is on the way" text.
   5. Texting `on my way` again replies "already told".
5. **Desk On my way:** accept on `/responder`. The **On my way** button appears in that tab only; a second browser window shows the explanation instead.
6. **Self-trigger:** with voice **Keep listening** on and the volume up, let a checkpoint and the On my way message play. No command is triggered.
