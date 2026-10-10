# Scope and honest limitations

## What is real

- A backend incident lifecycle with SQLite persistence: idempotent requests, a 10 s cancellation window owned by the server, dispatch, acceptance, resolution and restart recovery.
- Real pretrained models running on the CPU:
  - Ultralytics YOLO26n detects chairs and people.
  - The MediaPipe Tasks Gesture Recognizer recognizes `Open_Palm`.
  - Both run on a laptop webcam or on a prerecorded video, labeled REPLAY.
- A user page, a responder page and a 2D view that all read the same backend state. Browser speech output on the user page.
- A blurred full-frame snapshot. The frame is blurred in memory before the only write.

## What is simulated

- **The journey, the flight and the location.** Route progress is a timer on configured waypoints. The coordinates in `backend/app/route_campus_demo_v1.json` are **illustrative, not surveyed**. Nothing is derived from video, GPS or Unreal world units.
- **The responder organization and dispatch.** A second browser tab plays the "local responder". No emergency service, SMS or call is ever contacted.
- **The drone.** It is a visual in Unreal or the 2D view. There is no physical drone and no flight control.

## Known limits

- **The obstruction rule is narrow.** It means "a chair overlaps a configured region of one calibrated camera view for about 1 s". It does not measure distance, decide that a path is safe, or recognize any obstacle class other than chairs. People are drawn as overlays only, so the participant is never treated as an obstacle.
- **The open palm is a configured control, not a universal distress sign.** It is tuned for one participant. With several people in view, the system cannot tell whose hand it saw. The "mugging" in the demo is staged; what the system recognizes is the participant's deliberate request.
- **Recognition quality has only been measured on sample footage.** On the development laptop (Ryzen 9 5900HS, CPU only), a replay clip ran at about 49 ms per frame (around 13 fps, detector plus gesture). The gesture model scored only 0.54 `Open_Palm` on a downloaded photo, so the replay check temporarily lowered the threshold to 0.5. **Live-webcam accuracy and latency have not been measured yet.**
- **The snapshot is blurred, not guaranteed anonymous.** The whole frame is pixelated and blurred. Nothing else is done to remove identity.
- **Speech uses the browser's built-in SpeechSynthesis.** Voices differ by browser and operating system, and audio only starts after the user clicks or presses a key. No speech recognition is used; cancelling is done by button or keyboard.
- **No user research has been done.** Nothing has been tested with blind or low-vision participants, so the prototype makes no claim of validated usefulness.
- **There is no authentication.** The backend binds to `127.0.0.1` by default. LAN mode is for a trusted demo network only, and anyone on that network can call the API.
- **The sponsor integrations have never been called against the real services.** ElevenLabs speech (cached, with browser speech as the fallback) and Gemini briefings (asynchronous, validated, with the deterministic briefing as the fallback) are implemented and tested only with stubbed HTTP, because no API keys were available. They are off unless a key is set. Gemini output is rejected if it:
  - mentions crimes, navigation or dispatch instructions,
  - drops the "simulated location" label, or
  - contains a number that isn't in the recorded facts.

  These checks reduce fabrication but **cannot prove** the summary contains no invented facts. That is why the responder page always shows the recorded facts next to the AI summary.

## Excluded by design

Real flight, autonomous safe routing, exact obstacle distance, crime recognition, real emergency calls, custom model training, capturing Unreal frames, live GPS, fall detection, voice cancellation, accounts, Kubernetes and multilingual output.
