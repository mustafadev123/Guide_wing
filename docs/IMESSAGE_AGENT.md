# GuideWing in iMessage (Photon Spectrum)

The iMessage agent makes a normal iMessage conversation the GuideWing companion. A registered iPhone texts commands and receives the same updates the `/user` page announces. It is built on **Photon Spectrum** (`spectrum-ts`, MIT), which connects to Photon's hosted iMessage lines, so **no Mac is needed**.

```
iPhone (iMessage) ⇄ Photon Spectrum Cloud ⇄ imessage-agent (Node, this laptop) ⇄ GuideWing backend :8000
                                                     ↑ live updates from /ws/events
```

The agent makes no lifecycle decisions. It calls the same backend endpoints as the web page (`/api/journeys/...`, `/api/incidents`, `/cancel`) and relays backend events. The 10-second cancellation window, dispatch, acceptance and resolution are all still owned by the backend.

## Commands (text to the assigned Photon line)

| Text | Effect |
|---|---|
| `start` | Start the journey, or a new one if it ended |
| `help` / `sos` | Create a help request (`request_source: "imessage"`). The message ID is the idempotency key, so a redelivered message cannot create a duplicate |
| `cancel` / `stop` | Cancel the active request while it is `pending` or `dispatched` (backend rules) |
| `status` | Journey state, progress, **simulated** location, help status |
| `pause` / `resume` | Journey pause/resume |
| `repeat` | Repeat the last update |
| anything else | List of commands |

Matching is by keyword, with no AI interpretation, so `help` and `cancel` behave predictably. A message containing both "cancel" and "help" cancels; it never creates a request.

## Updates the agent sends

Each update is sent **once**, keyed by incident ID and status (or obstacle observation ID), whichever channel caused it: iMessage, the Help button, an open-palm gesture or the responder.

| When | Text |
|---|---|
| Request created | Help request started. It will be sent to a responder in 10 seconds. Reply CANCEL to stop it. (a gesture request starts with "Open palm recognized.") |
| Dispatched | Your help request was sent to the responder. Waiting for acceptance. |
| Accepted | A responder accepted your request. |
| Cancelled | Help request cancelled. Nothing was sent. / … The responder was notified. |
| Resolved | The responder marked your request as resolved. |
| Obstruction (when the backend says to announce) | Caution: obstruction detected in the path ahead. Journey paused. Reply RESUME when ready. |
| Route finished | You reached the end of the demo route. Reply START for a new journey. |

- **Reconnecting to the backend:** on the first connection the agent only records the current state, so nothing is replayed. After a later reconnect, a change missed while disconnected (for example an acceptance) is sent once.
- **Avoid double speech:** set `/user` → Settings → **Text only** during an iMessage demo, so the laptop doesn't also speak.

## Loop protection

During the first live test, the agent answered every **non-text** iMessage event (receipts and similar system events) with a "text only" message. Each answer triggered another event, so the same message repeated. Fixed in `main.ts` and `agent.ts`:
- Non-text events are ignored silently. Only the event type is logged.
- Messages sent by the agent itself (`sender.kind === "agent"`, `direction === "outbound"`) are never answered.
- `SendLimiter` caps **every** outgoing message (replies and pushed updates) per conversation at 4 per 10 s and 15 per minute. Excess sends are dropped and logged.

## Setup

1. **Photon:** create an account at app.photon.codes, create a project, enable **Spectrum**, register the iPhone's number and note the **assigned iMessage line** (the number you text).
2. **Configure:** copy `imessage-agent/.env.example` to `imessage-agent/.env` (git-ignored) and fill in:
   - `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`
   - `GUIDEWING_IMESSAGE_ALLOWED`: the iPhone number(s) in E.164 format, e.g. `+15551234567`, comma-separated
   - `GUIDEWING_URL` (default `http://127.0.0.1:8000`)
3. **Run** (with the backend already running via `scripts\start.ps1`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1 -Foreground   # logs in this window
   powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1               # background, log in logs\imessage-agent.log
   powershell -ExecutionPolicy Bypass -File scripts\stop_imessage_agent.ps1
   powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1 -Terminal     # Spectrum's local terminal chat, no Photon account
   ```
4. **Text the line first** from the iPhone (e.g. `status`). On Photon's free shared line, the agent can only message a number that has texted the line. After the agent restarts, text once more so it knows the conversation again.

The agent refuses to start without an allowlist or Photon credentials. Unregistered numbers get "This GuideWing demo line only responds to registered numbers." and cannot control anything.

## Tests

```powershell
cd imessage-agent
$env:PATH = "..\tools\node;$env:PATH"
..\tools\node\npm.cmd test          # 10 unit tests + 2 integration tests against a real backend
..\tools\node\npm.cmd run typecheck # strict TypeScript against the real spectrum-ts types
```

The integration tests start the real GuideWing backend from the project `.venv` on a free port, with a temporary database and a 2-second cancellation window, and run a full conversation:
- start, help, dispatched, accepted (through the real responder API), resolved
- a redelivered message (no duplicate), cancel refused after acceptance, an unregistered number refused
- cancel inside the window, still cancelled after the deadline

## Privacy and limits

- **Message text and the iPhone's number pass through Photon's cloud**, under Photon's terms. The agent sends only its update texts. It never sends coordinates, images or responder identity. The location it mentions is the simulated landmark, labeled simulated.
- **Logs** mask phone numbers (last 4 digits only) and contain no message bodies.
- **Photon free tier** (as reported in a third-party integration guide, unverified): shared line pool, 5,000 messages per day, 50 new conversations per line per day.
- **Simulation:** the journey and the responder are simulated; no real emergency service is contacted. iMessage availability depends on Photon and Apple.
- **Single demo user:** the agent controls the backend's current journey, intended for the one registered user.
