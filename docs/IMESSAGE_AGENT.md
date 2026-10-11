# GuideWing responder agent in iMessage (Photon Spectrum)

The iMessage agent lets a registered **responder** work help requests from their phone instead of the `/responder` desk. When a user's request leaves the 10-second cancellation window, every registered responder gets a text. They reply `accept` to take it and `resolved` when it is handled. It is built on **Photon Spectrum** (`spectrum-ts`, MIT), which connects to Photon's hosted iMessage lines, so **no Mac is needed**.

```
user (/user page: Help button or open palm) → GuideWing backend :8000 → /ws/events
                                                     ↓
responder iPhones (iMessage) ⇄ Photon Spectrum Cloud ⇄ imessage-agent (Node, this laptop)
```

The agent makes no lifecycle decisions. It calls the same endpoints as the responder desk (`/api/incidents`, `/accept`, `/resolve`) and relays backend events. The cancellation window, dispatch, and who accepted first are owned by the backend. So when a responder accepts by iMessage, the `/user` page announces "A responder accepted your request" exactly as it does for the web desk.

## Commands (text to the assigned Photon line)

| Text | Effect |
|---|---|
| `accept` (also `yes`, `omw`, `coming`) | Accept the oldest request waiting for a responder. The backend records the responder as `iMessage responder (…last 4 digits)`. If someone else was first: "Already accepted by …" |
| `resolved` (also `done`, `handled`, `complete`) | Resolve the request **you** accepted. A request accepted by someone else is left to them |
| `details` | Recorded facts: simulated landmark, status, how it was requested, timestamps (UTC), whether a blurred snapshot is on the desk |
| `list` / `status` | Open requests: in the cancellation window, waiting for acceptance, or accepted (by whom) |
| anything else | List of commands |

Matching is by keyword, with no AI interpretation. `accept` during the user's cancellation window explains that the request is not sent yet; nothing is accepted early.

## Messages the agent pushes

Each message is sent **once** per request and status, whichever channel caused the change: iMessage, the web desk or the user. A responder is never pushed their own action; their direct reply covers it.

| When | Text (to every registered responder) |
|---|---|
| Request dispatched | New help request near *Library crossing (simulated location)*, requested with *the Help button*. Reply ACCEPT to take it, or DETAILS for more. |
| Accepted by another responder (iMessage or web desk) | The request near … was accepted by *name*. No action needed. |
| User cancelled after dispatch | The user cancelled the request near …. No action needed. |
| Resolved by someone else | The request near … was marked resolved (accepted by *name*). |

A request cancelled **inside** the window never reached responders, so nothing is sent.

- **Reconnecting to the backend:** on the first connection the agent only records the current state, so nothing is replayed (`list` shows what is open). After a later reconnect, a change missed while disconnected (for example a new request) is sent once.

## Loop protection

During the first live test, the agent answered every **non-text** iMessage event (receipts and similar system events) with a "text only" message. Each answer triggered another event, so the same message repeated. Fixed in `main.ts` and `agent.ts`:
- Non-text events are ignored silently. Only the event type is logged.
- Messages sent by the agent itself (`sender.kind === "agent"`, `direction === "outbound"`) are never answered.
- `SendLimiter` caps **every** outgoing message (replies and pushed updates) per conversation at 4 per 10 s and 15 per minute. Excess sends are dropped and logged.

## Setup

1. **Photon:** create an account at app.photon.codes, create a project, enable **Spectrum**, register each responder's number under **Project → Users**, and note the **assigned iMessage line** (the number to text).
2. **Configure:** copy `imessage-agent/.env.example` to `imessage-agent/.env` (git-ignored) and fill in:
   - `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`
   - `GUIDEWING_IMESSAGE_ALLOWED`: responder number(s) in E.164 format, e.g. `+15551234567`, comma-separated
   - `GUIDEWING_URL` (default `http://127.0.0.1:8000`)
3. **Run** (with the backend already running via `scripts\start.ps1`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1 -Foreground   # logs in this window
   powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1               # background, log in logs\imessage-agent.log
   powershell -ExecutionPolicy Bypass -File scripts\stop_imessage_agent.ps1
   powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1 -Terminal     # Spectrum's local terminal chat, no Photon account
   ```
4. **Each responder texts the line once** (e.g. `list`) before the demo. The agent can only push to conversations it knows, and on Photon's free shared line it can only message a number that has texted the line. After the agent restarts, text once more.

## Demo flow

1. Responder phone(s) text `list` → "No open requests."
2. On `/user`, press Help (or hold an open palm). After 10 seconds every responder gets "New help request near …".
3. A responder replies `accept`. `/user` announces the acceptance, the desk shows "iMessage responder (…1234)", and other responders are told.
4. The responder replies `resolved`. The request is resolved on `/user` and the desk.

The agent refuses to start without an allowlist or Photon credentials. Unregistered numbers get "This GuideWing responder line only responds to registered responder numbers." and cannot act.

## Tests

```powershell
cd imessage-agent
$env:PATH = "..\tools\node;$env:PATH"
..\tools\node\npm.cmd test          # 12 unit tests + 2 integration tests against a real backend
..\tools\node\npm.cmd run typecheck # strict TypeScript against the real spectrum-ts types
```

The integration tests start the real GuideWing backend from the project `.venv` on a free port, with a temporary database and a 2-second cancellation window:
- A simulated user presses Help through the API. Two responders are pushed the request after dispatch. Responder A accepts (the backend records the name), B is told and cannot accept or resolve it, and A resolves. Every push is sent once, and an unregistered number is refused.
- Cancelled inside the window: nobody is told, and it stays cancelled after the deadline. Cancelled after dispatch: responders are told.

## Privacy and limits

- **Request texts and the responders' numbers pass through Photon's cloud**, under Photon's terms. The agent never sends coordinates or images. It sends only the simulated landmark, labeled simulated, and says whether a blurred snapshot exists on the desk. Responders are named by the last 4 digits only.
- **Logs** mask phone numbers (last 4 digits only) and contain no message bodies.
- **Photon free tier** (as reported in a third-party integration guide, unverified): shared line pool, 5,000 messages per day, 50 new conversations per line per day.
- **Simulation:** the journey, location and dispatch are simulated; no real emergency service is contacted. iMessage availability depends on Photon and Apple.
