# Voice commands on `/user`

Voice commands are optional and off by default. Once enabled, they are the hands-free way to ask for help. Gestures, buttons, keyboard shortcuts and spoken feedback all keep working as before.

Press **V** (or **Speak a command**), wait for the tone, then say the command.

| Say after pressing V | Effect | Changes state? |
|---|---|---|
| "help" (or "help me", "GuideWing, help") | Creates a help request (same path as the Help button) | Yes: backend request with `request_source: "voice"` |
| "cancel" | Tries to cancel under the existing backend rules | Yes, only if the backend allows it |
| "status" | Speaks journey and help-request status | No (read-only) |
| "repeat" | Replays the latest announcement | No |

This is **transcript matching against a fixed four-word vocabulary**, not a wake-word model and not conversational AI. The whole utterance must be the command, with optional filler before ("um") and "please" after. "help me find the exit", "I need help" and low-confidence results show "Nothing was changed" and do nothing.

- **Push-to-talk (after pressing V):** the "GuideWing" prefix is optional. Pressing the key already shows intent, and a single word is recognized faster and is not at risk of "GuideWing" being misheard.
- **Keep listening (continuous):** every command must start with "GuideWing", because the microphone hears everything, including the app's own speech ("Press Help…").

## Recognition approach and its limits

- **Engine:** the browser's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). There are no new dependencies and no paid service.
- **Demo browser:** the installed Microsoft Edge 155 exposes both constructors (checked on 2026-10-14 by probing headless Edge). That only shows the API exists. **Real microphone recognition on the demo laptop is UNVERIFIED**; see the manual checks below.
- **Not offline.** In Edge and Chrome, recognition normally streams microphone audio to the browser vendor's speech service (Microsoft or Google). GuideWing does not use or claim on-device recognition. Without internet, recognition reports a `network` error, voice shows the problem, and every other control keeps working.
- **Firefox and some other browsers have no SpeechRecognition.** The voice section then says "Not supported" with no Enable button, and buttons, keyboard and gestures are unchanged.
- **Secure context:** microphone access needs `http://127.0.0.1` / `localhost` or HTTPS. A phone opening the laptop over plain-HTTP LAN will most likely not get voice. Use the laptop for voice.
- **Nothing is stored.** No recordings, and no transcripts in storage or on the server. The last recognized phrase is held in page memory only, so it can be shown on screen for the demo.

## How it is wired (`frontend/src/voice.ts`)

- **Same handlers as buttons.** `help("voice")`, `cancel()` and `repeat()` in `UserPage.tsx` are the exact functions the buttons and H/C/R keys call. Voice adds only `request_source: "voice"` and a `voice-…` request key.
- **Backend still owns the lifecycle.** The 10-second deadline, dispatch, cancellation eligibility (no cancel after acceptance) and one-open-request-per-journey are enforced server-side. Voice never resumes a journey.
- **Duplicates.**
  - Only final results are used; interim results are disabled.
  - The same command within 4 s is ignored.
  - A command cannot start while the previous one is processing.
  - Help keeps the existing idempotent request key.
  - If an open-palm gesture and a voice Help arrive together, the backend creates one request. The loser gets "A help request is already active. No second request was sent."
- **Confirmation only after the backend confirms.** "Voice command received. Help request recorded…" is spoken only from the backend response. While waiting, the voice panel shows "Working on it…" without speaking. Rejections speak the backend's reason. An unconfirmed result uses the existing "may have reached the server" wording.
- **One audio coordinator.** `Announcer` reports when app speech starts and stops (browser speech or ElevenLabs audio), and `VoiceController` reacts:
  - While the app speaks, the open recognition session is aborted once, and any result from that session is discarded.
  - Continuous listening restarts 0.7 s after speech ends.
  - Sessions that keep ending immediately back off exponentially. After 5 rapid ends, continuous listening stops with a message, so it cannot loop.
  - Fatal errors (microphone denied, no microphone, service blocked) stop voice until the user enables it again.
  - When the tab goes to the background, listening pauses. It resumes when the tab is visible again.
- **Priority.** Obstacle warnings are spoken as `urgent`, and a spoken Status is `optional`. A Status requested during an obstacle warning is dropped rather than interrupting it. Newer messages otherwise replace older ones (no queue of stale speech).
- **No command phrase in app speech.** Announcements never contain "GuideWing, help" etc., so even audio leaking past the pause cannot match the grammar.

## Using it

1. Start the backend as usual (`scripts\start.ps1`) and open **http://127.0.0.1:8000/user** in Edge on the laptop.
2. **One step:** press the **V** key (or **Speak a command**) anywhere on the page. If voice is off, this turns it on, asks for the microphone the first time, and starts listening. A short **tone** means "speak now". Then say "GuideWing, help". **Enable voice** still exists as an explicit switch.
3. **Push-to-talk (default, recommended for the demo):** press V for every command. Pressing it while GuideWing is talking stops the speech first, so you can always interrupt. A key press also lets Edge play audio, so confirmations are audible even right after a reload.

**Why not an always-listening wake phrase?** The microphone would have to stream room audio to the browser's speech service the whole time the page is open, a conversation or the app's own voice could trigger commands, and after a reload Edge blocks speech until the page is touched. One key press works from anywhere, needs no on-screen target, and maps to a headset or phone side button in a real product.
4. **Keep listening (experimental):** listens continuously and pauses while GuideWing speaks. It is opt-in because its reliability on the demo laptop is unverified.
5. **Status** is also a button and the **S** key. Repeat is a button and the **R** key.

**Saying "Cancel" while GuideWing is speaking:** in continuous mode the microphone is paused during announcements, so that phrase can be missed. Press **Speak a command** first (it interrupts speech), or use the **Cancel** button or **C/Escape**, which are always available.

## Obstacle wording

The chair detector reports only that a chair overlaps the monitored camera region. It does not measure depth or find a clear path, so the warning is factual: **"Obstacle detected ahead. Please pause."** (plus "Journey paused. Resume when ready." when the journey paused). GuideWing never says "move left/right" and offers no navigation guidance.

## Automated verification (2026-10-14)

- `frontend`: `node --test tests/*.test.cjs` → **20/20**. These include 15 voice tests with a mock recognizer and manual timers:
  - grammar and prefix rules, low confidence, final-only results
  - duplicate final results, no command while processing
  - speech pause/discard/resume, one abort per speech
  - push-to-talk barge-in and push-to-talk while a session is closing
  - restart-loop backoff, denied/unsupported/revoked microphone, network error, hidden tab
  - announcer priority
- `tsc -b` and `vite build`: pass.
- Backend `pytest`: **97 passed**. New cases:
  - voice source accepted, labeled, idempotent, and following the deadline
  - voice after gesture is refused with 409
  - concurrent voice + gesture creates exactly one request
  - voice counted in analytics sources
- iMessage agent: **15/15** tests and strict typecheck. The new integration test runs a voice-source request against the real backend: pushed to responders as "requested with a spoken voice command", then accepted and resolved by iMessage command.
- `scripts/voice_browser_check.cjs` in headless Edge against an isolated backend: **38/38**, stable over repeated runs. This includes one-step V with voice off (listens, plays the tone, no readiness speech delay, voice Help created) and V in an unsupported browser (explains, points to Help). Recognition is a scripted mock and speech is a stub.
  - one spoken Help creates exactly one request, with `voice` source and confirmation after the backend
  - a duplicate final result creates nothing extra
  - Status and Repeat leave journey and request versions unchanged
  - voice Cancel inside the window works; no auto-resume
  - a command heard during app speech is discarded
  - continuous listening resumes after speech
  - simultaneous voice + gesture creates exactly one request
  - voice Cancel after acceptance is refused
  - obstacle wording is correct, with no left/right
  - unsupported browser and denied microphone leave Help/Cancel working
  - no horizontal overflow at 320 px
- `scripts/web_browser_check.cjs` (existing): **46/46**. Its focus check now skips the document body when Tab leaves the page, because the new Status button is the last control.

## Manual checks on the demo laptop (still UNVERIFIED)

Run these with the real microphone and speakers before recording:

1. **Permission:** with voice off, press V and allow the microphone. You should hear a tone and see "Listening". The chip shows "Ready". Deny once in a private window: a clear "denied" message, and Help/Cancel still work.
2. **Recognition:** start a journey, press Speak a command, say "GuideWing, help". Expect "Last heard: …" with `command: help`, the spoken confirmation, and the request on `/responder` labeled "Voice command". If the transcript differs, note the exact text shown. "Guide wing", "GuideWing" and "Guide wings" are accepted.
3. **Duplicate:** say "GuideWing, help" twice quickly. Only one request appears.
4. **Self-hearing:** with speakers loud and Keep listening on, press Status (the app speaks). No request is created by the app's own voice.
5. **Cancel during speech:** while an announcement plays, press Speak a command and say "GuideWing, cancel". Speech stops, and the cancellation is confirmed inside the 10-second window.
6. **Status / Repeat:** each speaks without changing anything on `/responder`.
7. **Offline:** disconnect Wi-Fi briefly. Voice should report a network problem while the Help button still works against the local backend.
8. **Audible playback:** the confirmation and obstacle warning are actually heard at demo volume.

Record the results in `docs/HANDS_ON_TEST_CHECKLIST.md` or PROGRESS. Until then, describe voice as tested with a simulated recognizer only.
