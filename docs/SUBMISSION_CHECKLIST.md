# Submission checklist

Tick an item only after you have seen it work yourself. Automated checks don't count for device items.

## Automated (re-run before submitting)
- [ ] `.\.venv\Scripts\python.exe -m pytest` all pass
- [ ] `.\.venv\Scripts\python.exe scripts\check_environment.py` → `RESULT: PASS`
- [ ] `powershell -ExecutionPolicy Bypass -File scripts\build_frontend.ps1` succeeds (includes the `tsc` type check)
- [ ] With the server running: `.\.venv\Scripts\python.exe scripts\e2e_check.py` → `RESULT: PASS`

## Manual device checks (owner: you)
- [ ] `scripts\test_camera.py 0` shows the webcam; note the fps
- [ ] Live chair warning: the chair enters the region, then one warning plays; no repeats while it stays
- [ ] Ordinary waves and brief palms do **not** create a request
- [ ] One 2 s palm hold creates exactly one request; holding longer does not create a second
- [ ] After cancelling while the palm is still raised, nothing retriggers until the hand is lowered for at least 1 s
- [ ] Speech plays in your browser: start, obstruction, pending, cancelled, dispatched, acknowledged; each only once
- [ ] Refreshing `/user` during an acknowledged request does **not** replay the acknowledgment; **R** does
- [ ] Keyboard-only run: Tab reaches every control, focus is visible, H, C, Esc, R and P work, and shortcuts don't fire while typing
- [ ] Screen reader (NVDA or Narrator): status messages are announced; countdown seconds are not
- [ ] Two responder tabs click Accept at the same moment: the user hears one acknowledgment
- [ ] Unplugging the camera or covering it shows "not ready" or an error; the Help button still works
- [ ] Optional phone webcam (DroidCam): find the index with `scripts\test_camera.py --list`, then `start.ps1 -Camera <index>`

## Unreal (owner: teammate; verify together)
- [ ] The packaged executable (not editor Play) polls `/api/simulation/state` and reacts to start, pause, pending, dispatched, acknowledged and cancelled
- [ ] Stopping the backend shows Disconnected within about 2 s; restarting recovers (boot_id change)
- [ ] If on a second laptop: `-Lan`, firewall rule, and `Test-NetConnection <ip> -Port 8000` all pass on the demo network

## Materials
- [ ] Demo video recorded (≤ 2 min), following [DEMO_SCRIPT.md](DEMO_SCRIPT.md); replay or fallbacks labeled if used
- [ ] README run instructions tested from a fresh terminal
- [ ] [LIMITATIONS.md](LIMITATIONS.md) reviewed; no claims of user validation, real dispatch or anonymization
- [ ] Prior work cited (Flying Guide Dog, 2021: https://arxiv.org/abs/2108.07007); other pitch citations checked individually
- [ ] Third-party licenses noted (README → Credits). YOLO weights are AGPL-3.0; check that the event allows it
- [ ] The hackathon's official deadline, track and disclosure rules have been rechecked on the event site
- [ ] No secrets, `.env`, personal footage, databases or model weights in git (`git status` before committing)
