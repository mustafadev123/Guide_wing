# Unreal integration guide

For the Unreal developer. Unreal **renders** the backend's state. It never decides lifecycle, timing, route progress or location, and it never speaks; the user's browser owns speech.

Real responses captured from the running backend are in [fixtures/](fixtures/): the `live-*.json` files came from real API calls and the `mock-*.json` files are canned test states.

## 1. Endpoint

```
GET {BACKEND_URL}/api/simulation/state?journey_id={JOURNEY_ID}
```

| Setting | Default | Notes |
|---|---|---|
| `BACKEND_URL` | `http://127.0.0.1:8000` | Only works when Unreal runs on the **same laptop** as the backend. See §6 for another laptop. |
| `JOURNEY_ID` | `current` | `current` (or leaving the parameter out) = the demo journey the user page is driving. The response's `journey.id` is then that journey's **real UUID**, not the word `current`. A journey UUID also works. `mock-<scenario>` returns canned test states (§4), and their `journey.id` equals the requested name. Anything else, including `demo`, returns HTTP 404. **The unmodified Unreal HTTP starter needs a workaround here; see §9.** |

Make both values configurable, for example in an ini file or as editor variables. Don't hard-code them.

Check the connection quickly in a browser or PowerShell:
```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/health"
Invoke-RestMethod "http://127.0.0.1:8000/api/simulation/state?journey_id=current" | ConvertTo-Json -Depth 5
```

## 2. Polling rules

- Poll about every **0.5 s** with the asynchronous HTTP module (`FHttpModule`), and allow **at most one request in flight**. Send the next request only after the previous one completes or times out. The Unreal HTTP starter uses a 3 s timeout, which is fine.
- **Discard stale responses.** Keep the last applied `revision`. If `boot_id` is unchanged and `revision` is lower, ignore the response.
- **Server restart.** If `boot_id` changes, reset the stored revision (so accept the response) and re-read everything.
- **Disconnected.** If no successful response arrives for about **2–3 s**, show "Disconnected from GuideWing server", stop all movement and keep retrying. The starter uses `StaleAfterSeconds = 3`, and the diagnostic client uses 2 s. Do not animate fake dispatch or acceptance.
- **Movement.** Interpolate the character and drone **visually** along your local spline toward `journey.route_progress` (0 to 1). Stop interpolating when `journey.status != "active"`. Never write progress back. Never invent world-to-GPS conversions.
- **HTTP errors.** HTTP 404 means an unknown journey or mock name; show it as an error. HTTP 5xx and network errors count toward Disconnected.

The diagnostic client implements exactly these rules, so you can compare it with Unreal:
```powershell
.\.venv\Scripts\python.exe scripts\unreal_diag_client.py --base http://127.0.0.1:8000 --journey current
```
It uses only the Python standard library, so any Python 3.10 or newer on the Unreal laptop can run it.

## 3. Schema (schema_version 1)

Keys are snake_case and timestamps are ISO-8601 UTC with `Z` (`FDateTime::ParseIso8601` reads them). Nullable fields are **always present** and are `null` when empty, so check for null. Don't rely on keys being missing.

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | int | `1`. Additive fields may appear later; ignore unknown fields. |
| `data_source` | `"live"` \| `"mock"` | `mock` = canned fixture. Show a "MOCK" label when it's mock. |
| `boot_id` | string | Changes on every server restart. |
| `revision` | int | Monotonic within one boot. Bumps on any change, including route movement. |
| `sampled_at` | timestamp | Server time of this snapshot. |
| `journey.id` | string | Journey UUID (`mock-…` in fixtures). |
| `journey.status` | `idle` \| `active` \| `paused` \| `ended` | Move only when `active`. |
| `journey.armed` | bool | Help requests possible (true while active or paused). |
| `journey.pause_reason` | `user` \| `obstruction` \| `help_request` \| null | Why it is paused. Use it to choose an animation. |
| `journey.route_id` | string | `campus_demo_v1`. |
| `journey.route_progress` | float 0..1 | Backend-owned position along the route. |
| `journey.waypoint` / `waypoint_index` | string / int | Last waypoint passed (0-based). |
| `journey.location.source` | `simulated` \| `device` \| `unavailable` | Always shown as a label. `unavailable` means there is no location; it is **not** (0,0). |
| `journey.location.latitude/longitude` | float \| null | Configured simulation coordinates (illustrative, not surveyed). |
| `journey.location.accuracy_m` | float \| null | `null` for simulated locations. |
| `journey.location.landmark` | string \| null | Nearest configured waypoint name. |
| `journey.location.observed_at` | timestamp \| null | |
| `active_incident` | object \| **null** | The open help request (`pending`, `dispatched` or `acknowledged`). `null` when there is none. |
| `active_incident.status` | `pending` \| `dispatched` \| `acknowledged` | |
| `active_incident.seconds_until_dispatch` | float \| null | Only while `pending`. Countdown display only; the server dispatches. |
| `active_incident.request_source` | `gesture` \| `button` \| `test` | Label `test` visibly. |
| `active_incident.dispatch_at`, `created_at`, `acknowledged_at`, `updated_at`, `version`, `id` | | |
| `last_incident` | object \| null | The most recent incident in **any** status (same shape). Use it to show "cancelled" or "resolved" briefly. |
| `vision.input_mode` | `live` \| `replay` \| `test` \| `unavailable` | Camera input label. Show `REPLAY` and `TEST` clearly. |
| `vision.ready` | bool | Camera frames are fresh and recognition is running. |
| `vision.obstruction_active` | bool | An obstruction is active. This is not an Unreal collision. Check `obstruction_source` to see where it came from. |
| `vision.obstruction_source` | `live` \| `replay` \| `test` \| null | *(added 10 Oct, additive)* `live` or `replay` = the real models saw a chair in the monitored camera region. `test` = a developer-injected TEST obstruction from `/dev`; label it TEST and never present it as camera detection. `null` when there is no obstruction. |
| `vision.last_observed_at` / `vision.error` | timestamp \| null / string \| null | |

Suggested Unreal mapping:

| Condition | Visual |
|---|---|
| `status == active` | Walk and fly along the spline toward `route_progress` |
| `pause_reason == obstruction` | Stop; drone hover or warn animation |
| `active_incident.status == pending` | Stop; "Help request starting… (cancel possible)" |
| `dispatched` | "Help request sent to responder" |
| `acknowledged` | "Responder accepted" |
| `active_incident == null && last_incident.status == cancelled` | "Request cancelled" |
| `status == ended` | Arrived or ended; idle |
| Disconnected for more than 2 s | "Disconnected", everything stops |

## 4. Mock fixtures (no running journey needed)

Set `JOURNEY_ID` to any of these. The shape is identical to live data and `data_source` is `"mock"`.

| journey_id | journey | active_incident | last_incident |
|---|---|---|---|
| `mock-active` | active | null | null |
| `mock-paused` | paused / user | null | null |
| `mock-obstacle` | paused / obstruction; `vision.obstruction_active = true`, `obstruction_source = test` | null | null |
| `mock-pending` | paused / help_request | pending (6 s left) | pending |
| `mock-dispatched` | paused / help_request | dispatched | dispatched |
| `mock-acknowledged` | paused / help_request | acknowledged | acknowledged |
| `mock-cancelled` | paused / help_request | **null** | cancelled |
| `mock-resolved` | paused / help_request | **null** | resolved |
| `mock-no-location` | active, `location.source = unavailable`, lat/lon null | null | null |

There is no "disconnected" fixture because disconnection is something Unreal detects on its side. To test it, stop the backend while Unreal polls.

Live captures from a real run (10 Oct, button workflow, server started with `-NoVision`): `live-idle`, `live-active`, `live-paused`, `live-pending`, `live-dispatched`, `live-acknowledged` and `live-cancelled`. In those captures `vision.input_mode` is `unavailable`, because no camera was used.

Mapping to the starter's mock scenarios: `walking` → `mock-active`, `obstacle` → `mock-obstacle`, `pending`/`dispatched`/`acknowledged` → same names. For `resolved` and `cancelled`, the starter's mock keeps the incident in `active_incident`. This backend sets `active_incident` to **null** for those and puts the incident in `last_incident`. The starter's README already says these "clear the active alert", so the visible behavior is the same.

## 5. Example: pending (live capture `fixtures/live-pending.json`, `last_incident` trimmed)

```json
{
  "schema_version": 1, "data_source": "live",
  "boot_id": "9cc3695de33644ad93c41ba3f6300680", "revision": 18,
  "sampled_at": "2026-10-10T03:03:18.040Z",
  "journey": {
    "id": "f0ae514d-e572-4f32-b7fd-47855b348c7c", "status": "paused", "armed": true,
    "pause_reason": "help_request", "route_id": "campus_demo_v1", "route_progress": 0.032,
    "waypoint": "North entrance", "waypoint_index": 0,
    "location": {"source": "simulated", "latitude": 33.751962, "longitude": -84.384957,
                 "accuracy_m": null, "landmark": "North entrance", "observed_at": "2026-10-10T03:03:17.025Z"},
    "created_at": "2026-10-10T03:03:13.990Z", "version": 5
  },
  "active_incident": {"id": "cb7d8593-c6e7-4fdb-b5b1-8fa427e4a940", "status": "pending",
    "request_source": "button", "created_at": "2026-10-10T03:03:17.023Z",
    "dispatch_at": "2026-10-10T03:03:27.023Z", "seconds_until_dispatch": 8.98,
    "acknowledged_at": null, "updated_at": "2026-10-10T03:03:17.023Z", "version": 1},
  "last_incident": { "...": "same object as active_incident here" },
  "vision": {"input_mode": "unavailable", "ready": false, "obstruction_active": false,
             "obstruction_source": null, "last_observed_at": null,
             "error": "vision not configured (set GUIDEWING_VISION_SOURCE)"}
}
```

## 6. Unreal on a different laptop (trusted LAN)

`localhost` or `127.0.0.1` on the Unreal laptop points to **that** laptop, not to the backend. You need all three of the following.

1. **On the backend laptop**, start in LAN mode. The backend binds to loopback by default, so LAN access must be explicit:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Lan
   ```
   The launcher prints `Unreal backend URL: http://<IPv4>:8000`. Use that as `BACKEND_URL`.
2. **Firewall (admin PowerShell, once).** This allows only devices on the same subnet:
   ```powershell
   New-NetFirewallRule -DisplayName "GuideWing 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private,Public -RemoteAddress LocalSubnet
   ```
3. **Network.** Both laptops must be on a network that allows device-to-device traffic. **Campus Wi-Fi often blocks it** (ping times out). This happened on our campus network during development. A phone hotspot or a private router usually works. Test early:
   ```powershell
   # on the Unreal laptop
   Test-NetConnection <backend-IPv4> -Port 8000
   Invoke-RestMethod "http://<backend-IPv4>:8000/api/health"
   ```

The IP can change when Wi-Fi reconnects (DHCP), so check it again before the demo. If cross-laptop networking fails, run Unreal on the backend laptop, or use the 2D fallback at `/sim`.

## 7. Optional controls from Unreal

The user page normally drives the journey. If the Unreal scene has its own Start, Resume or Reset buttons, they must call the backend and nothing else:

```
POST /api/journeys/current/start
POST /api/journeys/current/pause
POST /api/journeys/current/resume
POST /api/dev/reset          (development only: creates a fresh idle journey)
```

Unreal must not create or cancel incidents, and must not speak.

## 8. Ownership and limits

- Backend owner: lifecycle, timing, route progress, location, this contract.
- Unreal owner (teammate): scene, character, drone, spline, status widget, packaged build.
- Camera inference uses the real webcam or replay footage. **Unreal frames are not analyzed.** A scripted Unreal collision is a simulated hazard, not a YOLO detection.
- Passing Python integration tests does **not** prove the Unreal executable works. The packaged build must be tested on the demo machine.

## 9. Compatibility with the Unreal HTTP starter (`GuideWing_Unreal_HTTP_Starter.zip`, 9 Oct)

I checked it against the real backend on 10 Oct. The starter's README says it has not been compiled in Unreal yet; nothing here proves it compiles.

| Starter behavior | Real backend | Effect | Fix |
|---|---|---|---|
| `JourneyId` defaults to `demo` | `journey_id=demo` → **HTTP 404** | "Backend unavailable or non-200 response" | Set `JourneyId` in the component's Details panel |
| Requires `journey.id == JourneyId` exactly | `journey_id=current` returns the real **UUID** as `journey.id` | `current` → "Journey ID mismatch", so it never connects | Option A or B below |
| `StaleAfterSeconds = 3`, timeout 3 s | No requirement | Compatible | none |
| Reads `schema_version`, `boot_id`, `revision`, `journey.status/route_progress/waypoint/location.source`, `active_incident.status/dispatch_at`, `vision.ready/obstruction_active` | All present with the same names and types; `active_incident` may be null | Compatible | none |
| Mock `resolved`/`cancelled` stay in `active_incident` | Real backend: `active_incident = null`, incident moves to `last_incident` | `IncidentStatus` becomes empty, which the starter treats as "clear the alert" | none (read `last_incident` from `RawJson` to show "cancelled" briefly) |
| Chair visibility = `ObstructionActive` | Also true for TEST injections | A TEST chair would look like a detection | Read `vision.obstruction_source` from `RawJson` and label `test` |
| Mock `/api/health` returns `{"ok": true}` | Returns `{"status": "ok", …}` | The component doesn't call health | none |

**Option A: no code change.** Set `JourneyId` to the current journey's UUID. Copy it from `/sim` or `/dev` (each has a Copy button), or run:
```powershell
(Invoke-RestMethod http://127.0.0.1:8000/api/journeys/current).id
```
Every **Reset demo** creates a new UUID. After a reset, Unreal would keep showing the old, now `ended`, journey until you paste in the new ID. So don't reset during the recorded demo, or update the ID after every reset. Mock fixtures work unchanged: `JourneyId = mock-pending` and so on.

**Option B (recommended, teammate applies it): follow `current`.** In `GuideWingHttpComponent.cpp`, replace the journey ID check:
```cpp
FString ReceivedJourney;
const bool bFollowCurrent = JourneyId.Equals(TEXT("current"), ESearchCase::IgnoreCase);
if (!(*Journey)->TryGetStringField(TEXT("id"), ReceivedJourney) || ReceivedJourney.IsEmpty()
    || (!bFollowCurrent && ReceivedJourney != JourneyId))
{
    Connection(false, TEXT("Journey ID mismatch"));
    return;
}
```
Then set `JourneyId = current`. With `current`, the check only confirms that a journey ID is present; the revision and boot logic is unchanged. This has not been compiled; the teammate must build it in their engine version.
