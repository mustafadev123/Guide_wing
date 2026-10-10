# GuideWing hackathon backup plan

If Unreal Engine cannot be connected, packaged, or run reliably on the demo laptop, we will present GuideWing using the existing browser-based 2D simulation at `/sim`. This preserves the main demonstration: a participant requests help, the backend dispatches the request, and the participant hears an acknowledgment when a responder accepts.

Unreal provides the 3D presentation. The backend, vision worker, user page, responder page, and 2D renderer operate independently of it. This fallback uses existing functionality and requires no code changes.

## When we switch

Choose the fallback if Unreal fails the final rehearsal, its state does not match the backend, or packaging or networking remains unreliable. Set a team cutoff before judging so there is time to rehearse the browser demo. During the presentation, switch directly to the prepared browser windows if Unreal fails; avoid spending the presentation troubleshooting the engine.

## Primary fallback: browser demo

Run everything on one laptop to avoid cross-device network dependencies. Keep these three views ready:

| View | URL | Purpose |
|---|---|---|
| User companion | http://127.0.0.1:8000/user | Start the journey, request or cancel help, and hear speech |
| Responder dashboard | http://127.0.0.1:8000/responder | Show dispatched requests and accept one |
| 2D simulation | http://127.0.0.1:8000/sim | Show the participant, drone, route progress, journey state, and help status |

The 2D view reads the same backend simulation snapshot intended for Unreal. The backend continues to own route progress, the 10-second cancellation window, dispatch, and acknowledgment. The user page remains the speech owner.

### Preparation

1. Complete the existing setup in `./README.md` before demo day. Confirm the frontend build, dependencies, and model files are available locally.
2. From PowerShell, start the application:

   ```powershell
   Set-Location D:\work\guide_wing\Guide_wing
   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
   ```

3. Open `/user`, `/responder`, and `/sim`. Arrange the windows so judges can follow the user and responder actions while seeing the simulation.
4. Click or press a key on `/user` to enable browser audio. Check volume and rehearse the spoken acknowledgment.
5. Check that starting and pausing the journey updates `/sim`, and that a dispatched request appears on `/responder`.
6. Before the presentation, use **Reset demo** on `/dev` if developer controls are enabled. Reset before starting the demonstration, since it creates a fresh journey.

### Two-minute presentation

| Step | Action | Expected result |
|---|---|---|
| Introduce | Explain that GuideWing is a simulated drone companion and that this demo uses the 2D fallback renderer | Judges understand what is simulated and what is running live |
| Start | Select **Start journey** on `/user` | Route progress advances and the participant and drone move in `/sim` |
| Obstruction, if camera is working | Place a chair in the calibrated camera region for about one second | The backend pauses the journey, `/user` speaks a warning, and the 2D journey state changes |
| Resume | Remove the chair and explicitly resume with **P** on `/user` | The journey continues |
| Request help | Hold an open palm for about two seconds, or use the Help button / **H** | The journey pauses and the cancellation countdown appears |
| Dispatch | Allow the 10-second cancellation window to expire | The request becomes dispatched and appears on `/responder` |
| Accept | Select **Accept request** on `/responder` | `/user` speaks the acknowledgment and `/sim` shows the acknowledged help status |
| Repeat | Press **R** on `/user` if useful | The participant can deliberately repeat the last spoken message |

Acceptance acknowledges the request; it does not automatically resume walking or establish that the path is clear. Keep resuming an explicit user action.

If time permits, first demonstrate a cancelled request using **C** or **Esc** within the cancellation window. Then create a new request for the dispatch-and-accept sequence.

## Additional fallbacks

| Problem | Backup | What we tell judges |
|---|---|---|
| Unreal fails | Use `/sim` | "We are using our existing 2D renderer, which reads the same backend state." |
| Webcam fails | Restart with prerecorded footage using `-Video` | "Recognition is running on replay footage, labeled REPLAY." |
| Palm recognition is unreliable | Use the Help button or **H** | "We are demonstrating the button-based help workflow." |
| Vision cannot run | Restart with `-NoVision` and demonstrate Start, Help, dispatch, and acceptance | "This is the button-only workflow; camera recognition is unavailable." |
| Cross-laptop connection fails | Run the browser views and backend on the same laptop | "The demo is running locally." |
| Optional speech or briefing provider fails | Use the existing browser speech and deterministic briefing fallbacks | Identify the provider fallback if discussing that integration |
| The application cannot run at all | Show a recording captured during a successful rehearsal, if prepared | "This is a recording of an earlier working demonstration." |

For replay or button-only mode, stop the existing backend before restarting. Run these commands from `Guide_wing`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

Then choose one restart command:

```powershell
# Replace this example path with an existing, rehearsed replay clip.
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Video "D:\path\to\demo.mp4"
```

```powershell
# Camera-free help workflow.
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoVision
```

Recheck the browser pages after restarting. Skip the chair and gesture steps in button-only mode. A recording is a last resort and must be prepared in advance; it is not a substitute for a live demonstration when the application works.

## Honest presentation

Say clearly that the journey, location, drone, and responder organization are simulated. No physical drone is controlled and no emergency service is contacted. Chair recognition is limited to a configured camera region; it does not prove that a walking route is safe. Keep REPLAY and TEST labels visible. Developer-injected observations must be described as test inputs, never as camera detections.

Suggested explanation:

> "Our planned 3D renderer is Unreal Engine. For this demonstration, we are using the existing 2D browser renderer connected to the same backend. We can still demonstrate requesting help, the cancellation window, dispatch to our simulated responder, and spoken acknowledgment when the responder accepts."

## Ready-to-demo checklist

- Browser fallback rehearsed from start through acknowledgment.
- `/user`, `/responder`, and `/sim` open and readable.
- Browser audio enabled and acknowledgment audible.
- Help button and keyboard controls verified.
- Camera checked, or replay / button-only mode chosen and disclosed.
- No dependency downloads or optional external providers required during judging.
- A short recording of a successful rehearsal prepared if possible.
- One teammate operates the user page, one operates the responder page, and one narrates; combine roles if needed.

The fallback succeeds when judges can follow one complete help request through dispatch and responder acceptance, hear the acknowledgment, and see the matching backend state in the browser views.

## Existing project references

- [Setup and run instructions](./README.md)
- [Original demo script](./docs/DEMO_SCRIPT.md)
- [Scope and limitations](./docs/LIMITATIONS.md)
- [API contract](./docs/CONTRACT.md)
- [Unreal integration guide](./docs/UNREAL_INTEGRATION.md)
