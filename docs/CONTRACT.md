# API contract (backend ↔ browser ↔ Unreal)

Lifecycle/snapshot shapes are defined in [backend/app/schemas.py](../backend/app/schemas.py); optional aggregate analytics shapes are in [backend/app/analytics.py](../backend/app/analytics.py). Interactive docs are at `http://127.0.0.1:8000/docs` while the server runs. Unreal-specific rules are in [UNREAL_INTEGRATION.md](UNREAL_INTEGRATION.md).

## Ownership

The backend owns the incident lifecycle, deadlines, timestamps, route progress and location. Browsers and Unreal render server state, and their countdowns are display-only. Vision produces observations that go through the same incident and journey services as the buttons do.

## Lifecycle

```
pending --(10 s deadline, backend)--> dispatched --(responder accept)--> acknowledged --(resolve)--> resolved
   |                                      |
   +--(user cancel)--> cancelled <--------+  (cancel after dispatch is shown to responders)
```

- Any other transition returns **409**, and accepting a `pending` request returns 409. Repeating a transition whose target equals the current status returns **200** with `changed: false`. This covers duplicate cancel messages and a second responder accepting.
- **Deadline boundary:** a pending incident is due when `now >= dispatch_at`. Every cancel and accept first applies due deadlines, so a cancel at or after the deadline is recorded as dispatched and then cancelled.
- **Idempotency:** `POST /api/incidents` with a known `request_key` returns the same incident (HTTP 200, `created: false`), even after it was cancelled. A new episode needs a new key. The Help button reuses its key when retrying after a network error. Each gesture hold generates a new key.
- At most one open incident (`pending`, `dispatched` or `acknowledged`) per journey. This is enforced in the service **and** by a partial unique index in SQLite. A second request returns 409 with `active_incident_id`.
- Requests need an armed journey (`active` or `paused`). Creating one pauses an active journey (`pause_reason = help_request`). Resuming is always an explicit user action.
- All changes run in one SQLite transaction under one lock, and status updates are compare-and-set (`WHERE status = expected`). A cancelled incident can't be dispatched by a late timer.
- **Restart recovery:** on startup, overdue pending incidents are dispatched. Cancelled, acknowledged and resolved incidents are kept as they are. Route progress resumes from the last persisted value, and one tick moves at most 1 s, so the companion never jumps ahead.

## HTTP

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | boot_id, current journey, database, vision status, providers |
| POST | `/api/journeys` | New idle journey; becomes `current` and ends the previous one |
| GET | `/api/journeys/{id\|current}` | |
| POST | `/api/journeys/{id\|current}/start` `/pause` `/resume` `/end` | 409 on an invalid transition |
| POST | `/api/journeys/{id}/location` | Optional device location `{source: device\|unavailable, latitude, longitude, accuracy_m, landmark}`; validated (422) |
| POST | `/api/incidents` | `{journey_id, request_key, request_source: button\|gesture\|test\|imessage\|voice}` → `{incident, created, changed}` (201 or 200) |
| GET | `/api/incidents?status=&journey_id=&limit=` | Newest first |
| GET | `/api/incidents/{id}` | Includes `timeline` |
| POST | `/api/incidents/{id}/cancel` `/accept` `/resolve` | `accept` body `{responder}` is optional |
| GET | `/api/incidents/{id}/snapshot` | Blurred JPEG only; 404 if none |
| GET | `/api/incidents/{id}/briefing` | Deterministic text from recorded facts |
| GET | `/api/analytics/config` | Safe provider/model configuration; key presence does not prove provider access |
| POST | `/api/analytics/summary` | `{range: day\|week\|loaded, include_tests: boolean}`; defaults day/false; rejects extra fields; explicit server-computed aggregate Gemini summary |
| GET | `/api/analytics/summary/{job_id}` | Existing job/snapshot only; never generates; 404 after restart or eviction |
| GET | `/api/simulation/state?journey_id=` | Unreal and 2D snapshot; `mock-<scenario>` for fixtures |
| GET | `/api/simulation/route` | Configured waypoints for the 2D view |
| GET | `/api/vision/status` | `input_mode`, readiness, error, frame age, fps, inference ms, gesture state |
| GET | `/api/vision/stream` | MJPEG annotated preview; 503 when there is no camera |
| WS | `/ws/events` | Browser live updates (see below) |
| POST | `/api/dev/reset`, `/api/dev/vision/{obstruction\|clear\|palm}` | Dev only (`GUIDEWING_DEV_CONTROLS=1`); observations labeled `test` |

## Aggregate analytics

Analytics does not alter the simulation schema or lifecycle transitions. POST reads the latest 500 incidents, filters by creation time using server UTC, excludes TEST by default, computes deterministic counts/timing samples and optionally starts a background Gemini job. The normal incident-list read still settles overdue dispatch deadlines. Only aggregate figures cross this provider boundary.

The response includes `job_id`, `status` (`pending|ready|not_configured|empty|failed|rejected`), `provider`, `model`, `range`, `include_tests`, `as_of`, `from_at`, `scope`, `metrics`, `text`, `sections`, `reason`, `cached` and `retry_after_s`. Ready `sections` contains `overview`, `response_times`, `next_check`; `text` is the same content joined into paragraphs. Existing metric fields remain unchanged. Additional server-derived interpretation facts include percentages, cancellation stage, request-source counts and timing medians/slowest/minute values. Unknown numerical tokens are rejected; contextual correctness is not guaranteed.

SHA-256 job identity uses model/prompt version/selection/aggregates. Identical pending jobs join; ready results reuse for 15 minutes; failures cool down for 30 seconds. Jobs/text are memory-only, maximum 64 cached/two pending (409 when busy). GET reads without regeneration. Only explicit POST can regenerate/retry; refresh/navigation must not automatically resend. Keys stay server-side. Setup, privacy distinction from incident briefings and full details: [GEMINI_ANALYTICS.md](GEMINI_ANALYTICS.md).

## WebSocket events

`{boot_id, sequence, type, occurred_at, payload}`. The first message is `hello`, and `ping` arrives every 15 s when idle.

- `journey.updated` `{journey}`
- `incident.updated` `{incident, transition, previous_status}`. `transition` is one of `created`, `dispatched`, `acknowledged`, `cancelled`, `resolved` or `snapshot_attached`.
- `vision.obstacle` `{observation_id, state: detected|cleared, announce, source, journey_paused}`. `announce` is true only when the journey has started (active or paused). An obstruction seen before Start is published with `announce: false`, stays visible in vision status and the snapshot, and is announced once if it is still present after Start. A suppressed warning doesn't use up the cooldown.
- `vision.status` `{vision}`

Sequences are monotonic within a boot. On reconnect, on a new `boot_id` or on a sequence gap, clients must re-read REST state. Speech is deduplicated by `incident id + status` and by obstacle `observation_id`, never by connection. A refreshed page seeds its dedupe set from current state, so acknowledgment is not replayed; the user can press **Repeat** to hear it again on purpose.

## Changes from the earlier mock

The first mock backend (uncommitted, 9 Oct) returned camelCase keys without `journey_id`. Unreal never tested it, so it was replaced by this snake_case schema from the build guide. The endpoint path `/api/simulation/state` is unchanged. The Unreal HTTP starter (C++ component, 9 Oct) reads the same snake_case field names. Its two incompatibilities, the `demo` journey ID and the exact `journey.id` match against `current`, are covered in [UNREAL_INTEGRATION.md §9](UNREAL_INTEGRATION.md). Additions to the guide's suggested shape: `data_source`, `journey.pause_reason`, `journey.waypoint_index`, `journey.created_at`, `journey.version`, `active_incident.seconds_until_dispatch` (plus `request_source`, `created_at`, `acknowledged_at`, `updated_at`, `version`), `last_incident`, `vision.error` and `vision.obstruction_source` (added 10 Oct so TEST obstructions can be told apart from camera detections).

Deterministic incident-briefing text separates each recorded fact with a newline, including status and resolution when recorded. Clients should preserve those breaks instead of splitting on periods, which would break decimal coordinates and timestamps.

Incident briefing response adds `ai_model`, `ai_review` with `outcome` and `timing`, and `ai_retry_after_s`. Eligible statuses now include cancelled. Pending remains not_requested. Model/prompt/fact-hash caching refreshes on later recorded changes; failed/rejected unchanged facts can retry on an explicit read after 30 seconds. Source facts stay available as deterministic text. Lifecycle and simulation wire schemas are unchanged.
