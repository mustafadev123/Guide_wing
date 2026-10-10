# Two-minute demo script

**Before recording:** run the launcher, do one rehearsal, then **Reset demo** on `/dev`. Have these on screen:
- Unreal (or `/sim` as the fallback)
- `/user` with the camera preview shown
- `/responder` in a second window

Turn the volume up. Put a chair just outside the camera's monitored region.

| Time | Action | What the audience sees or hears |
|---|---|---|
| 0:00 | Narrator: "GuideWing is a simulated drone companion for blind and low-vision pedestrians. We focus on the accessible path from asking for help to hearing that help is coming." | Three views, each with its "simulated" label |
| 0:10 | On `/user`, press **Start journey** with the keyboard (Tab, then Enter) | Speech: "Journey started…". The companion moves in Unreal and in the 2D view. |
| 0:20 | Slide the chair into the monitored region of the real camera | After about 1 s, speech: "Caution: obstruction detected in the path ahead. Journey paused." The red box shows in the preview, and Unreal or the 2D view stops. |
| 0:35 | Remove the chair and press **P** to resume | "Journey resumed." Movement continues. |
| 0:45 | Hold an open palm toward the camera for about 2 s | "Open palm recognized. Help request starting… unless you cancel." The countdown shows. |
| 0:52 | Press **C**: a false alarm, cancelled within 10 s | "Help request cancelled. Nothing was sent." The responder queue stays empty and history shows "never dispatched". |
| 1:00 | Lower your hand for at least 1 s, then hold the open palm again for 2 s ("staged threat") | A new request starts; the preview shows "hold 100%". |
| 1:12 | Wait 10 s | "Help request sent to the responder." The request appears on `/responder` with "Simulated location: near …", the timestamps, the briefing and a blurred snapshot. |
| 1:30 | On `/responder`, click **Accept request** | User side: "A responder accepted your request." It is heard once. Unreal shows "accepted". |
| 1:40 | Press **R** on `/user` | The acknowledgment repeats (deliberately). |
| 1:45 | Narrator: "Location and dispatch are simulated, detection runs on a real camera, and every step works by keyboard and speech." | |

**Backups (always say which one is in use):**
- **Camera fails:** start with `-Video clip.mp4`. The UI shows **REPLAY footage**.
- **Gesture fails:** press **H** (the Help button). Keep going.
- **Unreal fails:** use `/sim`, labeled "2D fallback view".
- **Never** use the `/dev` TEST buttons while claiming camera detection. TEST requests are labeled TEST on every page.
