# API contract (backend ↔ browser ↔ Unreal)

The source of truth is [backend/app/schemas.py](../backend/app/schemas.py). Interactive docs are at `http://127.0.0.1:8000/docs` while the server runs. Unreal-specific rules are in [UNREAL_INTEGRATION.md](UNREAL_INTEGRATION.md).

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
| POST | `/api/incidents` | `{journey_id, request_key, request_source: button\|gesture\|test}` → `{incident, created, changed}` (201 or 200) |
| GET | `/api/incidents?status=&journey_id=&limit=` | Newest first |
| GET | `/api/incidents/{id}` | Includes `timeline` |
| POST | `/api/incidents/{id}/cancel` `/accept` `/resolve` | `accept` body `{responder}` is optional |
| GET | `/api/incidents/{id}/snapshot` | Blurred JPEG only; 404 if none |
| GET | `/api/incidents/{id}/briefing` | Deterministic text from recorded facts |
| GET | `/api/simulation/state?journey_id=` | Unreal and 2D snapshot; `mock-<scenario>` for fixtures |
| GET | `/api/simulation/route` | Configured waypoints for the 2D view |
| GET | `/api/vision/status` | `input_mode`, readiness, error, frame age, fps, inference ms, gesture state |
| GET | `/api/vision/stream` | MJPEG annotated preview; 503 when there is no camera |
| WS | `/ws/events` | Browser live updates (see below) |
| POST | `/api/dev/reset`, `/api/dev/vision/{obstruction\|clear\|palm}` | Dev only (`GUIDEWING_DEV_CONTROLS=1`); observations labeled `test` |

## WebSocket events

`{boot_id, sequence, type, occurred_at, payload}`. The first message is `hello`, and `ping` arrives every 15 s when idle.

- `journey.updated` `{journey}`
- `incident.updated` `{incident, transition, previous_status}`. `transition` is one of `created`, `dispatched`, `acknowledged`, `cancelled`, `resolved` or `snapshot_attached`.
- `vision.obstacle` `{observation_id, state: detected|cleared, announce, source, journey_paused}`
- `vision.status` `{vision}`

Sequences are monotonic within a boot. On reconnect, on a new `boot_id` or on a sequence gap, clients must re-read REST state. Speech is deduplicated by `incident id + status` and by obstacle `observation_id`, never by connection. A refreshed page seeds its dedupe set from current state, so acknowledgment is not replayed; the user can press **Repeat** to hear it again on purpose.

## Changes from the earlier mock

The first mock backend (uncommitted, 9 Oct) returned camelCase keys without `journey_id`. Unreal never tested it, so it was replaced by this snake_case schema from the build guide. The endpoint path `/api/simulation/state` is unchanged. The Unreal HTTP starter (C++ component, 9 Oct) reads the same snake_case field names. Its two incompatibilities, the `demo` journey ID and the exact `journey.id` match against `current`, are covered in [UNREAL_INTEGRATION.md §9](UNREAL_INTEGRATION.md). Additions to the guide's suggested shape: `data_source`, `journey.pause_reason`, `journey.waypoint_index`, `journey.created_at`, `journey.version`, `active_incident.seconds_until_dispatch` (plus `request_source`, `created_at`, `acknowledged_at`, `updated_at`, `version`), `last_incident`, `vision.error` and `vision.obstruction_source` (added 10 Oct so TEST obstructions can be told apart from camera detections).
