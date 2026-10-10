# Hands-on test checklist (in order)

Every item is **UNVERIFIED** until a person sees it work. Change `UNVERIFIED` to `PASS <date>` or `FAIL: <what happened>`.

**Thresholds are unchanged:** palm score 0.6, chair confidence 0.45, region overlap 0.25, 1 s persistence, 10 s cooldown. Only retune them after watching the live webcam, never from the replay photo. The replay photo scored 0.54 because it is a close-up still, not a live hand.

## 0. Prepare
1. Close other apps that use the camera. Confirm port 8000 is free: `Get-NetTCPConnection -LocalPort 8000 -State Listen` prints nothing.
2. Run `.\.venv\Scripts\python.exe scripts\test_camera.py 0`. The webcam shows; note the fps; press Q. **UNVERIFIED**
3. Run `powershell -ExecutionPolicy Bypass -File scripts\start.ps1`, then open `/user`, `/responder` and `/dev` (Show camera preview on `/user`). **UNVERIFIED**

## 1. Live camera
4. `/user` shows the badge **LIVE camera** and the text "Recognition running". **UNVERIFIED**
5. Start the journey. Move a chair into the yellow region and hold it there for at least 1 s: you get **one** warning, the journey pauses, and the box turns red. **UNVERIFIED**
6. Leave the chair in place for 15 s: there are no repeated warnings. **UNVERIFIED**
7. Remove the chair and press P: the journey resumes. **UNVERIFIED**
8. Wave or show your palm for less than 1 s, several times: **no** request. **UNVERIFIED**
9. Hold an open palm for 2 s: **one** request. Keep holding for 5 s more: still one. Write down the palm score shown on the preview: ____ **UNVERIFIED**
10. Press C while the palm is still raised: cancelled, with no new request until you lower your hand for at least 1 s and raise it again. **UNVERIFIED**
11. Walk into view yourself: you show as a person overlay and never as an obstruction. **UNVERIFIED**
12. Cover or unplug the camera: the badge shows "not ready" or an error, and the **Help button still works**. **UNVERIFIED**

## 2. Speech (on `/user`, volume up)
13. Click Start: you hear "Journey started…" (no audio before the first click is expected). **UNVERIFIED**
14. You hear each of these **once**: obstruction, request starting, cancelled, sent to responder, responder accepted. The countdown seconds are **not** spoken. **UNVERIFIED**
15. Refresh `/user` while a request is accepted: the acknowledgment is **not** replayed. Pressing R repeats it. **UNVERIFIED**

## 3. Keyboard (no mouse)
16. Tab reaches every control in a sensible order, and the yellow focus ring is always visible. **UNVERIFIED**
17. H (help), C or Esc (cancel), R (repeat) and P (pause/resume) all work. **UNVERIFIED**
18. With NVDA or Narrator, status messages are read aloud and the countdown is not. **UNVERIFIED**
19. Windows "Show animations" off (reduced motion): `/sim` stops extrapolating movement. **UNVERIFIED**

## 4. Responder
20. A request is **not** acceptable while pending (it appears under "Incoming — user can still cancel"). **UNVERIFIED**
21. After 10 s it moves to the Active queue with "Simulated location: near …", timestamps, the briefing and a blurred snapshot. **UNVERIFIED**
22. Open `/responder` in two tabs and click Accept in both: one says "Already handled", and the user hears the acknowledgment once. **UNVERIFIED**
23. Mark resolved: it moves to History. A request cancelled after dispatch shows the notice "cancelled by the user". **UNVERIFIED**

## 5. Unreal (with the teammate)
24. Choose how to handle the journey ID (see [UNREAL_INTEGRATION.md §9](UNREAL_INTEGRATION.md)): Option A (paste the UUID) or Option B (patch, `JourneyId = current`). Choice: ____ **UNVERIFIED**
25. Set `JourneyId = mock-obstacle`, then `mock-pending`, then `mock-cancelled`: the widget and chair react, and nothing shows "Journey ID mismatch". **UNVERIFIED**
26. On the live journey: Start on `/user` moves the Unreal walker; Pause stops it; a Help request shows pending, then dispatched, then accepted. **UNVERIFIED**
27. Stop the backend (`scripts\stop.ps1`): Unreal shows connection lost within about 3 s and freezes. Start it again: it recovers. **UNVERIFIED**
28. The **packaged** executable (not editor Play) repeats 26–27. **UNVERIFIED**
29. If using two laptops: `start.ps1 -Lan`, the firewall rule, and `Test-NetConnection <ip> -Port 8000` all succeed from the Unreal laptop. **UNVERIFIED**
