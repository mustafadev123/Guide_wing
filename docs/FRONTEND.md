# Guide Wing frontend

Implemented and reviewed 2026-10-10. Journey/help lifecycle rules were preserved; optional aggregate analytics adds a separate backend provider and three documented endpoints. This checkout uses React/TypeScript/Vite with FastAPI and SQLite; it does not contain a browser-Python runtime or an OAuth adapter. No second runtime, authentication flow or real assistance service was added.

## Layout and theme

- **Home (`/` or `/user`):** Guide Wing wordmark, Home/Settings navigation, quiet charcoal and graphite surfaces, warm off-white text, teal depth and mint controls. Original abstract mist artwork replaces bird imagery. The phone removes the decorative panel to prioritize controls.
- **Entrance:** a brief original SVG drone flyby with banking and shadow, then a smooth collapse into Home. Backend snapshot loading determines readiness. Skip removes animation without bypassing initialization. Errors show Retry; reduced motion uses a static state. Help never waits for decoration. Home/Settings navigation does not replay the entrance.
- **Journey:** backend idle/active/paused/ended states, Start, Pause/Resume, and New journey only after ending. The route ends automatically at 100%; Settings also provides an explicit backend End journey action. Pause and End do not cancel help requests. A new journey waits for an existing help request to close, keeping its acknowledgment visible.
- **Persistent assistance area:** latest meaningful text, large Help, Cancel, and Repeat buttons. The page scrolls above this area, so controls do not cover content or keyboard focus. Phone safe areas are respected. Unavailable controls remain focusable and explain their state.
- **Settings:** app speech, screen-reader announcements, or text only; optional single-key shortcuts; integration and browser limitations. Assistance controls remain mounted and visible.
- **Responder (`/responder`):** Active queue, History, selected request detail, recorded timeline, Accept/Resolve, optional incident briefing, and deterministic Analytics with explicit Gemini summary generation.
- **Simulation (`/sim`):** existing backend-driven 2D fallback with shared navigation and matching theme. `/dev` retains existing TEST controls.

## Integration and reliability

`src/api.ts` is the typed service adapter for the existing REST contract. Calls have an eight-second timeout; a timeout cannot prove the server did not receive a command.

| Control | Existing service |
|---|---|
| Initial state, reconciliation | GET `/api/simulation/state?journey_id=current` |
| Help | POST `/api/incidents` with a unique, reusable `request_key` |
| Cancel | POST `/api/incidents/{id}/cancel` |
| Journey | POST `/api/journeys/{id}/{start,pause,resume,end}` |
| New journey | POST `/api/journeys`, then start the returned UUID |
| Responder queue and detail | GET `/api/incidents?limit=500`, GET `/api/incidents/{id}` |
| Accept / Resolve | POST `/api/incidents/{id}/{accept,resolve}` |
| Incident briefing | GET `/api/incidents/{id}/briefing` |
| Analytics setup | GET `/api/analytics/config` |
| Explicit analytics summary | POST `/api/analytics/summary` with `{range, include_tests}` |
| Summary status, no regeneration | GET `/api/analytics/summary/{job_id}` |

Help is enabled after a journey starts, matching existing backend rules. A normal button activation creates a **server-stored pending request** immediately. The backend owns its ten-second cancellation window and subsequent simulated dispatch. Countdown text uses the server deadline and clock offset; it does not dispatch from a browser timer. The camera's existing two-second palm gesture remains an alternative; holding the Help button is unnecessary.

An immediate synchronous action lock and server idempotency prevent duplicates. An unconfirmed Help attempt retains its request key in session storage for an **explicit** retry. Refresh only reads state; it never resends. Cancellation is labeled requested while waiting, and canceled only after a server response or authoritative snapshot confirms it. Acknowledged requests cannot be canceled under the current contract; the responder resolves them. Stale state disables actions until fresh state returns.

WebSockets trigger REST reconciliation, including reconnects and sequence gaps. REST polling remains the fallback. Speech replaces older output and deduplicates meaningful transitions. Countdown seconds are not spoken individually. App speech and screen-reader live announcements are separate selectable modes to avoid duplicate output. Use Repeat to deliberately replay the visible latest message. Unsupported speech preserves text and explains the limitation. Optional voice commands ("GuideWing, help/cancel/status/repeat", push-to-talk or experimental continuous listening) call the same handlers as the buttons. Status (S) speaks the current state without changing it. See [VOICE_COMMANDS.md](VOICE_COMMANDS.md). Simulated-route checkpoints, the responder's "On my way" (desk button for the tab that accepted) and readiness/failure announcements use the same announcer with urgent/normal/optional priority; see [ROUTE_AND_READINESS_FEEDBACK.md](ROUTE_AND_READINESS_FEEDBACK.md).

## Analytics and Gemini boundary

Analytics aggregates actual stored incident records in the browser: total requests, mutually exclusive current status counts, average dispatch-to-acceptance time, and average acceptance-to-resolution time, with qualifying sample counts. Missing/invalid/reversed timestamps do not become zero-duration responses. Empty data shows zero counts and unavailable durations.

Ranges select requests by **creation time**, not event time. They use the browser clock and explicitly show the as-of UTC time. TEST records are excluded by default and can be included. The API returns only the latest 500 records with no pagination/completeness metadata; figures are labeled with that scope and cannot claim all-time totals.

The existing Gemini service generates **incident briefings**. Choose View incident briefing to read its deterministic facts and optional Gemini output. Its existing cache/generation rules are unchanged.

Analytics now has a separate **Generate summary** adapter. The browser sends only the range and TEST inclusion flag; the backend recomputes counts and timing samples from the latest 500 stored records using its UTC clock. Only those aggregate facts go to Gemini. Its snapshot scope and server as-of time remain visible beside the AI text. If live figures change, the page offers an explicit Update summary. Changing filters clears old text without generating; refresh/navigation never regenerate automatically.

Generation runs outside journey/help commands. Identical selections and figures reuse a result for 15 minutes, with duplicate pending jobs joined and failed responses cooled down for 30 seconds. Pending jobs are checked once a second for up to 45 seconds; connectivity failures expose a read-only Check summary action. A lost job after server restart returns to explicit Generate. Missing keys, empty selections, quota/model errors and rejected output retain ordinary analytics. No server key is sent to the frontend. Setup and exact limitations: [GEMINI_ANALYTICS.md](GEMINI_ANALYTICS.md). Real dispatch, authentication and durable completed-response reporting remain unimplemented.

## Run

From `Guide_wing`, using the existing local installation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build_frontend.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoVision
```

Open `http://127.0.0.1:8000/user` and `/responder`. Use the existing camera/replay launcher options instead of `-NoVision` for recognition. For a phone on the trusted demo LAN, use `scripts\start.ps1 -Lan` and open `http://<laptop-LAN-IP>:8000/user`; firewall and venue networking need rehearsal. No frontend environment variable or API key is required for the built same-origin application. For Vite development, the existing `/api` and `/ws` proxy uses `GUIDEWING_BACKEND` (default localhost:8000).

Run analytics tests with the portable Node:

```powershell
.\tools\node\node.exe --test .\frontend\tests\analytics.test.cjs
```

If dependencies are absent, use the existing README setup instructions. No frontend dependency was added.

## Verification and remaining device checks

Actually verified during this change:

- TypeScript strict compilation and Vite production build.
- Four Node tests for creation-time ranges, test/future/invalid record exclusion, status partitioning, duration anchors, missing/reversed timestamps, and empty selections.
- Thirty headless Edge browser checks against a **separate FastAPI/SQLite test database**: start, server-owned ten-second deadline, repeated activation, cancellation before/after dispatch, refresh without resend or old speech, responder accept/resolve, replay of the visible message, pause/resume/end/new journey, Home/Settings continuity, screen-reader mode, keyboard Enter/Escape, accessible action names, reduced-motion flyby removal, and stored-record analytics with unavailable AI clearly labeled.
- Responsive checks at 1440x900, 768x1024, 390x844, 360x800, 320x568 and 720x450: no horizontal overflow; all persistent controls fit and exceed 44x44 pixels. Desktop and phone-size screenshots were inspected.
- Four targeted browser follow-ups: Start is visible on a 320x568 phone even during the ready flyby, manual pause/resume preserves an active request, a new journey waits for an open request to close, and cancellation works after journey end.
- Eleven additional browser checks with injected transport failures: skip does not bypass initialization, failure/retry, unconfirmed request storage, no refresh resend, explicit idempotent retry, lost cancellation-response reconciliation, disabled controls on connection loss, reconnection without resend, unavailable-speech text retention, and no uncaught application exceptions.

Gemini analytics addition verified on 2026-10-10: initially all 78 backend cases passed, five Node analytics tests passed, TypeScript strict compilation and the production build passed. Twenty-seven additional headless Edge checks used a separate SQLite database and **stubbed Gemini HTTP**: explicit/keyboard generation, duplicate prevention, cached reuse, changed-figure warning, range/TEST selection, quota/cooldown/retry, rejected output, missing-key setup, refresh without resend, help/cancel during generation, mobile overflow, accessible names, transport recovery, and lost-job recovery. After configuring the key, a synthetic live Gemini call exposed an incorrect JSON MIME enum. The corrected `APPLICATION_JSON` request returned a valid live summary; all 80 backend cases pass with the regression/error-handling additions. The browser checks used stubs; the live call verified the provider with synthetic counts, not physical-device behavior or general model quality.

Speech invocation was checked with a browser speech stub; audible OS/server voice quality was not verified. Accessibility tree checks and a live-region mode check are not a real screen-reader evaluation. Rehearse TalkBack double-tap, screen-reader reading order/repetition, physical phone safe areas, text scaling/zoom, actual speech, camera/palm recognition, background suspension, venue LAN, and any configured Gemini/ElevenLabs credentials. The basic prototype has no real assistance organization attached.

The running backend can dispatch an already stored request while a browser tab is closed or suspended. A closed page cannot provide reliable speech, camera interaction, or delivery of a new gesture/button request. This is a simulated hackathon workflow, not a dependable real-world assistance service.

Current analytics/briefing revision: reports render **Queue outcomes**, **Response times**, and **Next rehearsal check** as separate sections. The backend supplies percentages, cancellation stage, request-source counts, timing medians/slowest values and minute conversions; AI numeric tokens must match supplied facts. A server-derived rehearsal focus steers recommendations toward a recorded workflow step, without guessed causes. Incident briefing facts preserve newlines with `white-space: pre-line`, including resolution and intact coordinates/timestamps. Verification: **84 backend cases, five Node cases, strict TypeScript/build and 12 additional browser checks** at desktop and 390/320-pixel widths; the final prompt also produced an accepted live Gemini result from synthetic facts. Browser checks used a stubbed provider. This is not general AI semantic or physical-device accessibility validation.

Incident history now renders Gemini interpretation separately from raw facts: timeline outcome, response pattern, missing context. Recorded facts are collapsed under Source facts (recorded). Model metadata, precise error reasons, failure cooldown and explicit retry/check controls replace the generic unavailable message. Late acceptance/resolution refreshes the review using a facts hash; stale workers cannot overwrite newer interpretation. A resolved state is not independent verification of assistance. No client API key is introduced.

Incident-review revision verified: all **88 backend cases** passed, strict TypeScript/build passed, and **14 additional browser checks** covered delayed generation, cache reuse, expandable multiline facts, specific model errors, cooldown/explicit retry, and 1440/390/320-pixel layouts. Synthetic live requests diagnosed the old model HTTP 404 and produced accepted reviews on gemini-3.8-flash; a temporary HTTP 503 was surfaced correctly and a later explicit test succeeded. No actual history or private key was printed/sent in those diagnostic payloads. Device/screen-reader behavior and semantic accuracy are not established by these checks.
