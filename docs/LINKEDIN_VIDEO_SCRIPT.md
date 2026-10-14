# LinkedIn demo video (60-90 seconds)

One continuous screen recording of the laptop, plus the responder's iPhone filmed or mirrored. Use only what you have checked on the demo devices that day. **Before recording, complete the manual checks in [VOICE_COMMANDS.md](VOICE_COMMANDS.md#manual-checks-on-the-demo-laptop-still-unverified) and [ROUTE_AND_READINESS_FEEDBACK.md](ROUTE_AND_READINESS_FEEDBACK.md#manual-checks-unverified-until-done-on-the-demo-devices)**, including one live iMessage round trip with `on my way`. All are unverified as of 2026-10-14. If either fails, cut that beat and keep the button, keyboard or web-desk equivalent.

## What is real and what is simulated

- **Real:**
  - the FastAPI backend and SQLite records
  - live webcam chair detection and the open-palm gesture
  - spoken feedback
  - voice-command transcripts (processed by the browser's cloud speech service)
  - the iMessage messages through Photon Spectrum
  - Gemini analytics, if a key is configured and the output is visible
- **Simulated:**
  - the journey and route, and the location (labeled "simulated location")
  - the drone and flight
  - the responder organization
  - dispatch
- No emergency service is contacted.
- **Unreal:** its live connection to the backend has not been verified, so it is not part of the workflow in this video. If you show Unreal footage at all, caption it "Simulated concept sequence – not connected to the live demo". Show the 2D `/sim` view if you need a map.
- **Checkpoints** are positions on the simulated demo route, not real navigation.

## Setup (before pressing record)

```powershell
Set-Location C:\guide_wing\Guide_wing
$env:GUIDEWING_ROUTE_DURATION_S = "60"   # shorter demo route: first checkpoint after about 20 s of walking
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Camera 0 -Rebuild   # use the camera index you verified
powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1        # needs imessage-agent\.env
```

1. Edge: open http://127.0.0.1:8000/user, plus http://127.0.0.1:8000/responder in a second window. Use `/dev` → reset for a clean, idle journey.
2. On `/user`, press **V** once and allow the microphone (this turns voice on). Leave **Keep listening** off. During the recording, press **V** before each command and wait for the tone.
3. Check the speaker volume. Keep the chair out of the camera region and your hands lowered.
4. The responder phone texts `list` to the Photon line once (required after every agent restart).
5. Optional: start a screen recorder that captures system audio, so the spoken announcements are in the video.

## Short sequence (about 75 seconds)

Checkpoint → real chair warning → voice Help → actual iMessage acceptance → On my way → spoken confirmation.

| Time | On screen | Do | Say (narration, or captions) |
|---|---|---|---|
| 0:00-0:08 | `/user` Home | Click **Start journey**. "Camera ready. Live chair and open-palm recognition is running." may already have played | "GuideWing is a prototype companion for blind and low-vision pedestrians. This journey and its location are simulated." |
| 0:08-0:22 | `/user`, `/sim` optional | Let the simulated route reach the first checkpoint | (App: "You've reached Library crossing on the simulated route.") "Checkpoints come from the simulated route on the server." |
| 0:22-0:34 | Camera preview | Slide a real chair into the camera region, wait for the warning and the paused state, remove the chair | (App: "Obstacle detected ahead. Please pause.") "A live camera detects the chair and pauses. It says something is ahead; it doesn't give directions." |
| 0:34-0:46 | Voice section | Press **V**, wait for the tone, and say **"help."** | (App: "Voice command received. Help request recorded. You have 10 seconds to cancel…") "Voice is the hands-free way in." |
| 0:46-0:58 | iPhone | The iMessage arrives after 10 s. Reply `accept` | (App: "A responder accepted your request.") "A registered responder accepts by iMessage." |
| 0:58-1:10 | iPhone, then `/user` | Reply `on my way` | (App: "Your responder says they are on the way.") "Only the responder who accepted can send that, and it carries no arrival time." |
| 1:10-1:15 | End card | Reply `resolved` off camera | "Simulated journey and dispatch. Not an emergency service." |

## Longer script

| Time | On screen | Do | Say (narration, or captions) |
|---|---|---|---|
| 0:00-0:08 | `/user` Home | Click **Start journey** | "GuideWing is a prototype companion for blind and low-vision pedestrians. The journey and location here are simulated." |
| 0:08-0:22 | Camera preview open | Slide a real chair into the camera region. Wait for the spoken warning and the paused state. Remove the chair, then **Resume journey** | (Stay silent for the warning: "Obstacle detected ahead. Please pause.") "A live camera detects the chair and pauses the journey. It only says something is ahead; it doesn't give directions." |
| 0:22-0:35 | Voice section | Press **V**, wait for the tone, and say **"help."** Show "Last heard" and the countdown | (App: "Voice command received. Help request recorded. You have 10 seconds to cancel…") "Voice is the hands-free way in. The server owns the 10-second cancel window." |
| 0:35-0:48 | iPhone | The iMessage arrives after the 10 seconds | "Once the window closes, the request goes to a registered responder over iMessage." |
| 0:48-0:58 | iPhone, then `/user` | Reply `accept`, then show `/user` | (App: "A responder accepted your request.") "The responder accepts by text, and the user hears it." |
| 0:58-1:08 | `/user`, camera | Responder replies `resolved`. Then hold an open palm for 2 s to show the backup, and press **Cancel** within the window | "Gestures and buttons remain as backups. Cancel works the same way however the request was made." |
| 1:08-1:20 | `/responder` → Analytics | Show the deterministic figures, then the Gemini summary only if it actually generated | "Responders can review timings and input methods. The Gemini summary uses only the recorded aggregate figures." |
| 1:20-1:25 | End card | (none) | "Simulated journey and dispatch. Not an emergency service." |

## Rules while recording

- Say "GuideWing" clearly before each command. If recognition misses, press the Help button: same request path, and the cut is honest.
- Do not say "move left/right" or imply navigation, safe routing, real location, or a real flight.
- Name Gemini only if its output is on screen. Name ElevenLabs only if it is configured and audible.
- Only claim iMessage delivery that you just watched arrive on the phone.
- If the voice-plus-gesture beat makes a second request attempt, the screen shows "A help request is already active". That is expected, so you can keep it in.

## Fallbacks

| Problem | Do instead |
|---|---|
| Voice not recognized or no network | Press Help (H). Caption: "Voice command (shown with button)". Don't fake a transcript |
| iMessage did not arrive | Accept on `/responder`, then press **On my way** in that same tab, and say "the web responder desk" |
| Checkpoint missed because something else was speaking | Keep recording; Status (S) reports the journey position. Don't stage a second checkpoint |
| No Gemini output | Show the deterministic analytics only |
| Chair not detected | Skip the obstacle beat; do not use the `/dev` TEST obstruction unless the "Test." label stays visible and audible |
