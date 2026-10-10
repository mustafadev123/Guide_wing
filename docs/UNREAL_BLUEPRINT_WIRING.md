# Wiring `BP_GuideWingSim` to the backend (Blueprint only, no C++)

For the person editing the Unreal project `C:\UnrealProjects\GuideWingSim` (Unreal 5.5, map `ThirdPersonMap`).

**The goal:** in **Backend Mode**, the scene shows the backend's state. In **Local Demo Mode**, your existing Tick walk and keys 1–4 keep working exactly as now. Nothing about the scene's assets changes.

This uses two built-in, prebuilt engine plugins, so **no C++ compiler is needed**:
- **HttpBlueprint**: gives you the `Http Request` node.
- **Json Blueprint Utilities**: gives you `Load Json from String` and `Get Field`.

Both are already enabled in `MAWN_900.uproject` on the branch `backend-integration`. **Restart the Unreal Editor once** so they load. If it asks about experimental or beta plugins, accept.

> I built these steps from the names stored in `BP_GuideWingSim` (components `CampusPath`, `PedestrianMesh`, `DroneMesh`; variables `CurrentDistance`, `WalkSpeed`, `bIsWalking`, `bIsConnected`, `bLocalDemoMode`; events `ApplySimulationState(NewState)`, `SetConnectionStatus(bIsConnected)`; keys 1–4) and from the plugins' engine source. I could not open the graph itself, so adapt the node positions to what you see.

---

## 0. Before you start
- **Backend:** running on this laptop (`scripts\start.ps1 -Camera 0`). Check http://127.0.0.1:8000/api/health in a browser.
- **Safety net:** you're on the git branch `backend-integration`, so `main` keeps the current working scene. Commit after each step that works.

## 1. Add variables (My Blueprint → Variables → +)

| Name | Type | Default | Notes |
|---|---|---|---|
| `BackendBaseUrl` | String | `http://127.0.0.1:8000` | Instance Editable |
| `JourneyId` | String | `current` | Instance Editable. Use `mock-obstacle` etc. for fixture tests |
| `PollInterval` | Float | `0.5` | |
| `StaleAfterSeconds` | Float | `3.0` | |
| `bRequestInFlight` | Boolean | false | |
| `RequestStartTime` | Float | 0 | |
| `LastValidReceiptTime` | Float | 0 | |
| `LastBootId` | String | (empty) | |
| `LastRevision` | Integer | `-1` | |
| `BackendProgress` | Float | 0 | 0–1 from the backend |
| `BackendStatus` | String | (empty) | idle / active / paused / ended |
| `PauseReason` | String | (empty) | user / obstruction / help_request |
| `IncidentStatus` | String | (empty) | pending / dispatched / acknowledged, or empty |
| `LastIncidentStatus` | String | (empty) | shows cancelled / resolved briefly |
| `bObstructionActive` | Boolean | false | |
| `ObstructionSource` | String | (empty) | live / replay / **test** |
| `DataSource` | String | (empty) | live / **mock** |
| `AppliedState` | Integer | `0` | last value sent to `ApplySimulationState` |
| `ObstacleActor` | Actor (Object Reference) | none | Instance Editable, optional (step 7) |

Set **`bLocalDemoMode` default = false** to use Backend Mode. Set it to true to get your current demo back unchanged.

Use **`Get Real Time Seconds`** for every "now" below, so timing doesn't depend on game pause.

## 2. Event BeginPlay: start polling (Backend Mode only)
After your existing BeginPlay nodes (camera blend etc.):
1. `Branch` on `bLocalDemoMode`. **False →**
2. `SetConnectionStatus` (bIsConnected = false), then set `LastValidReceiptTime` = now.
3. `Set Timer by Event`, with **Time** = `PollInterval` and **Looping** = true. Connect its red **Event** pin to a new **Custom Event `PollBackend`**.

## 3. Custom Event `PollBackend`: one request in flight
1. `Branch` on `bRequestInFlight`.
   - **True →** if `now − RequestStartTime > 3`, set `bRequestInFlight` = false (a stuck request gets dropped). Then stop.
   - **False →** continue.
2. Set `bRequestInFlight` = true, and `RequestStartTime` = now.
3. Add the **`Http Request`** node (category *Http*). Set **Verb = GET**, and the node title becomes "Http GET Request".
   - **Url** = `Append` (`BackendBaseUrl`, `/api/simulation/state?journey_id=`, `JourneyId`).
   - Leave Header and Body empty.
4. **Result Body**: drag it into the input of a new custom event call `HandleSnapshot`, which takes a String input `Body`. Connecting it to a String makes the wildcard a String.
5. **Request Was Successful →** set `bRequestInFlight` = false, then call `HandleSnapshot(Result Body)`.
6. **Request Was Not Successful →** set `bRequestInFlight` = false. Nothing else; step 6 handles "disconnected".

> The node reports "successful" for **any** HTTP answer, including a 404, and gives no status code. That's why `HandleSnapshot` validates the content.

## 4. Custom Event `HandleSnapshot(Body: String)`: validate and store
Each "Get Field" below is the **Json → Get Field** node. Its output type follows what you connect it to: connect it to a Set node of the right type. It also has a **Success** boolean.

1. `Load Json from String`(Body) → **Root** (Json Object). If **Success** is false, stop.
2. Get Field `schema_version` → Integer. If not Success, or ≠ 1, stop. This rejects 404 answers like `{"detail": "journey demo not found"}`.
3. Get Field `boot_id` → String, and Get Field `revision` → Integer.
4. If `boot_id` ≠ `LastBootId`: set `LastBootId` = boot_id and `LastRevision` = −1. The server restarted.
5. If `revision` < `LastRevision`: stop (old response). Otherwise set `LastRevision` = revision.
6. Set `LastValidReceiptTime` = now. If `bIsConnected` is false, call `SetConnectionStatus(true)`.
7. Get Field `data_source` → `DataSource`.
8. Get Field `journey` → a **Json Object** variable `J`:
   - Get Field `id` from `J` (String). **Only if** `JourneyId` is **not** `current` and not empty, it must equal `JourneyId`; otherwise stop. With `current`, accept any ID. This is the §9 fix.
   - Get Field `status` → `BackendStatus`.
   - Get Field `route_progress` → `BackendProgress` (Float).
   - Get Field `pause_reason` → `PauseReason`. If Success is false (the value is null), set it to empty.
9. Get Field `active_incident` → Json Object `I`.
   - If Success, Get Field `status` from `I` → `IncidentStatus`.
   - If Success is false (null = no active request), set `IncidentStatus` = empty. **This clears the help alert.**
10. Get Field `last_incident` → Json Object. If Success, Get Field `status` → `LastIncidentStatus`; otherwise empty.
11. Get Field `vision` → Json Object `V`:
    - `obstruction_active` → `bObstructionActive` (Boolean)
    - `obstruction_source` → `ObstructionSource` (empty if null)
12. Call **`UpdateScene`** (step 5).

> If a nested **Get Field** won't connect to a Json Object variable in your editor, tell me. The fallback is the C++ starter.

## 5. Function `UpdateScene`: map backend state to your 1–4 states
Pick the state with a chain of Branches, top to bottom:

| Condition | Desired state |
|---|---|
| `IncidentStatus` is not empty | **3** (help alert) |
| `PauseReason` == `obstruction` | **2** (obstacle stop) |
| `BackendStatus` == `active` | if `AppliedState` is 1 or 4, keep it. If `AppliedState` is 0, use **1** (initial walk). Otherwise **4** (resume walk) |
| anything else (idle, paused by user, ended) | **none**. Don't call ApplySimulationState. Set `AppliedState` = 0 if idle, or 9 otherwise |

Then:
1. If the desired state is 1–4 **and** differs from `AppliedState`: call **`ApplySimulationState(desired)`** and set `AppliedState` = desired.
2. **Always, after that:** set `bIsWalking` = (`BackendStatus` == `active`) AND `bIsConnected`. The backend is authoritative, so this overrides whatever a state sets.
3. **Status text:** `Print String`, with **Key** = `GW_Status` (it replaces the previous line), Duration 1.0, and the text built with `Append`:
   `SIMULATED | <DataSource> | journey <BackendStatus> <PauseReason> | help <IncidentStatus or LastIncidentStatus> | obstruction <bObstructionActive> <ObstructionSource>`
   This shows "mock" for fixtures and "test" for developer-injected obstructions. Unreal **never speaks**; the browser does.

## 6. Event Tick: movement and staleness
At the start of Tick, add `Branch` on `bLocalDemoMode`:
- **True →** your existing Tick logic, **unchanged** (WalkSpeed, the `%` loop, etc.).
- **False → Backend Mode:**
  1. **Staleness:** if `bIsConnected` and `now − LastValidReceiptTime > StaleAfterSeconds`, call `SetConnectionStatus(false)` and set `bIsWalking` = false.
  2. **Only if `bIsConnected`** (otherwise the walker freezes in its last pose):
     - `TargetDistance` = `BackendProgress × GetSplineLength(CampusPath)`.
     - If `abs(TargetDistance − CurrentDistance) > 0.2 × SplineLength`, set `CurrentDistance` = TargetDistance. This snap covers a new journey or a reset.
     - Otherwise set `CurrentDistance` = `FInterp To`(Current = CurrentDistance, Target = TargetDistance, DeltaTime = DeltaSeconds, InterpSpeed = 3).
  3. Continue into your **existing** nodes that place `PedestrianMesh` and `DroneMesh` from `CurrentDistance` (`GetLocationAtDistanceAlongSpline`, `GetRotationAtDistanceAlongSpline`, `SetWorldLocationAndRotation`). **Do not use the `%` (Percent) node in this branch**, because the backend route ends at 1.0 and doesn't loop.

There must be no WalkSpeed-based movement in Backend Mode. The backend alone advances progress.

## 7. Optional: obstacle visibility
In the level, select `BP_GuideWingSim` and set **ObstacleActor** to your obstacle (the cube or chair in front). In `UpdateScene`, add `Set Actor Hidden In Game`(ObstacleActor, **Hidden = NOT bObstructionActive**). The obstacle in Unreal then appears only when the **real camera** (or a TEST injection) reports one. It's a visualization, not an Unreal detection.

## 8. Keys 1–4
At the start of each key event, add `Branch` on `bLocalDemoMode`: only **True** continues. In Backend Mode the keys do nothing, so there's no competing movement.

## 9. Disconnection event
Your existing `SetConnectionStatus` already prints "Connected to Backend" and "Backend Disconnected". Keep it. Disconnected means frozen pose plus that message.

---

## Test order (fill in results)
Compile and save the Blueprint, then press Play. Watch the top-left Print String lines.

1. **`JourneyId = mock-active`** → "Connected", walker at about 42% of the spline, walking, `mock`. ☐
2. **`mock-obstacle`** → state 2, stopped, `obstruction true test`. ☐
3. **`mock-pending`**, then **`mock-acknowledged`** → state 3 with help pending, then acknowledged. ☐
4. **`mock-cancelled`** → help alert cleared, last cancelled. ☐
5. **`JourneyId = demo`** → must **not** connect (404 rejected by the schema check). ☐
6. **`JourneyId = current`**, the live milestone:
   - **/user Start** → state 1, the walker moves.
   - **Real chair** → spoken warning in the browser, state 2, the walker stops.
   - **Remove the chair, press P** → state 4, walking again.
   - **Palm 2 s** → state 3, pending, then dispatched.
   - **/responder Accept** → spoken confirmation in the browser, status acknowledged.
   - **Mark resolved** → the help alert clears. ☐
7. **Stop the backend** (`scripts\stop.ps1`) → "Backend Disconnected" within about 3 s, and the walker freezes. **Start it again** → reconnects, and the new boot is accepted. ☐
8. **/user "Start a new journey"** or **/dev Reset** → with `current`, Unreal follows the new journey (snaps to 0). ☐
9. **Packaged build** (Platforms → Windows → Package) → repeat 6–7 with the .exe. ☐

Tick a box only after seeing it work.
