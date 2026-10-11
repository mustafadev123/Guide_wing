# GuideWing presentation script: recorded Unreal + working web frontend

Use this runbook for live judging when Unreal is not connected to the backend. Use [BACKUP_VIDEO_SCRIPT.md](BACKUP_VIDEO_SCRIPT.md) for the two-minute submission video, and [BACKUP_PLAN.md](BACKUP_PLAN.md) for detailed actions, contingencies, and judge questions.

## Presentation setup and feature status

**Preferred setup:** one web laptop, two operators, and a 10-15-second Unreal concept recording on a phone. Play it silently in landscape with the caption **Recorded concept simulation - manually controlled; backend not connected**. Then put the phone aside. If the phone supplies DroidCam input, keep it dedicated to the camera during the working demonstration; use another phone or play the clip on the laptop first. If Unreal footage is unavailable, show the connected `/sim` view.

**Frontend:** use the team's finished frontend once its participant and responder controls work against the backend and a full run has been rehearsed. The existing `/user`, `/responder`, and `/sim` pages remain the working fallback. Map the names below to the actual finished controls before presenting. Use visible buttons for the main walkthrough. H = Help, C/Esc = Cancel, R = Repeat, and P = Pause/Resume are optional shortcuts on `/user`, separate from Unreal's 1-4 controls.

**Gemini briefing:** the existing implementation can show an AI summary of recorded request facts after dispatch, alongside a deterministic briefing. Name Gemini only when actual provider output is visible and verified.

**Gemini response reports and analytics:** planned addition. Once implemented, show the completed incident report after resolution. Its events, times, outcome, and any metrics must come from recorded data. Gemini supplies the narrative summary. There is currently no completed-response analytics/report page found in the reviewed source. Until ready, show History and describe reporting as planned. Do not invent a report route or button name.

## Before the presentation

1. Start the already-prepared app on the web laptop. The latest successful logged camera setup was DroidCam over USB at index 1; reconfirm on the demo machine:

   ```powershell
   Set-Location D:\work\guide_wing\Guide_wing
   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Camera 1
   ```

2. Open the finished participant/responder frontend, or http://127.0.0.1:8000/user and http://127.0.0.1:8000/responder. Keep http://127.0.0.1:8000/sim ready. Arrange readable windows.
3. Use `/dev` to reset beforehand if enabled. Confirm an idle journey and no open request. Old closed history may remain; distinguish the current demonstration by its timestamps.
4. Enable spoken feedback, check volume, show the camera preview, and verify recognition readiness in good lighting. Keep the chair out of the monitored region and hands lowered.
5. Verify actual ElevenLabs audio and Gemini output if presenting them. Locate and rehearse the completed-report view only if implemented. Prepare History as the report fallback.
6. One teammate operates the participant/camera; another operates the responder. Rehearse focus so shortcuts, if used, act on `/user`.

## Live script: approximately three minutes

Allow important application speech to finish. Exact times depend on voice pacing and recognition; wait for real state transitions. The report segment may need another 20-30 seconds if the judging slot permits it. In a strict three-minute slot, omit Repeat and the final `/sim` insert to make room for a ready report.

| Time | Exact action and evidence | What to say |
|---|---|---|
| 0:00-0:20 | Play the short Unreal recording, then open the participant and responder frontend | "A help request should end with an answer you can hear. GuideWing explores a drone companion for blind and low-vision pedestrians. That recorded scene illustrates the concept; it is not backend-connected. Here is our working web workflow. The journey, location, and responder organization are simulated." |
| 0:20-0:30 | Click Start journey. Briefly show `/sim` progressing, then return to the participant view | "The participant receives spoken feedback, and this 2D view reads the running backend's state." Let the start announcement finish. |
| 0:30-0:45 | Put a real chair in the configured camera region for about one second. Show detection/paused state. Remove it and click Resume journey | "The camera checks for a chair in this monitored region. A detection pauses the journey and gives a spoken warning." Stop narrating for the warning. "Resuming is the participant's choice." |
| 0:45-1:10 | Click Help, show the countdown, then click Cancel request comfortably before ten seconds. Show the cancelled entry in History | "The button reaches the same help workflow. The participant has ten seconds to cancel if they change their mind." After cancellation: "This request was never dispatched." |
| 1:10-1:40 | Confirm the hand control is armed. Hold an open palm for about two seconds, lower it after the request appears, and let the actual ten-second window expire | "An open palm held for two seconds is our deliberate hands-free request control. This time, the participant wants help." Keep quiet for request and dispatch speech. Show Incoming becoming Active. |
| 1:40-2:00 | Show request source, simulated landmark, request/dispatch times, briefing, and blurred snapshot if present | "The responder receives recorded request details and context." If verified Gemini output is visible: "Gemini summarizes those facts, which remain available beside the summary." |
| 2:00-2:15 | Teammate clicks Accept request; show accepted status on both views | **No narration during the application acknowledgment:** "A responder accepted your request." Then: "The participant has confirmation they can hear." |
| 2:15-2:25 | Optionally click Repeat last message and let the acknowledgment finish | "They can repeat the confirmation without searching for a visual notification." Omit if report timing is tight. |
| 2:25-2:35 | Teammate clicks Mark resolved. Show resolution and History | "We are closing this demonstration request. Its outcome remains in history." Do not imply physical assistance occurred. |
| 2:35-2:50 | If implemented and ready, open the completed incident's Gemini report and any actual analytics. Otherwise stay on History | **With report:** "Gemini summarizes the recorded response: how it started, when it was accepted, and when it was closed. The event records remain available to check it." Name only metrics that are displayed and identify them as staged-demo measurements. **Without report:** "Response reporting is our next frontend addition; the recorded outcome is already available here." |
| 2:50-3:00 | Click Resume journey; optionally show `/sim` moving again | "The participant chooses when to resume. GuideWing connects deliberate help input, responder context, and an acknowledgment you can hear." |

Pending requests can already appear under Incoming, but cannot be accepted before dispatch. Cancellation prevents dispatch; do not claim the pending request was invisible to the responder. Acceptance is acknowledgment, not proof of arrival, physical assistance, a phone call, or a clear path.

## Planned report/analytics segment

Once available, show the completed report for the same demonstrated incident. Useful fields: request source, labeled location source, recorded request/dispatch/acceptance/resolution times, responder identity if recorded, and final status. Show one implemented metric at most in the main pitch, for example time from dispatch to acceptance. Calculate values from records; Gemini should not invent numbers or conclusions. Do not describe a single staged request as average real-world response performance.

If the report is still generating, show recorded History and continue. A static report design can appear separately with a **Planned interface** label, but does not demonstrate Gemini analytics working.

## Two-minute video

Follow [BACKUP_VIDEO_SCRIPT.md](BACKUP_VIDEO_SCRIPT.md): concept clip -> finished frontend or current pages -> chair warning -> Help/Cancel -> palm request and real dispatch window -> responder briefing -> uninterrupted acceptance audio -> resolution and actual response report if ready -> closing.

The report has a reserved closing segment with alternate History footage. Keep the main request consistent across request, acceptance, and report shots. Preserve LIVE/REPLAY labels and disclose shortened waiting intervals. Omit sponsor captions if the captured output came from a fallback.

## Immediate fallbacks

- No Unreal clip: show `/sim` and continue.
- Finished frontend unavailable: use the existing participant and responder pages.
- Palm missed: click Help, checking first whether a request has already appeared.
- Chair missed: stop retrying and continue with the help workflow; describe the detection limit.
- Camera unavailable: Help still works. Use a separately rehearsed `-NoVision` run if restarting between demonstrations.
- Gemini briefing unavailable: use the deterministic briefing.
- Response report unavailable: show History and recorded facts; describe the report as planned if unimplemented.
- ElevenLabs unavailable: use browser speech. Keep the acknowledgment audible and use Repeat if needed.
- Application cannot run: show a prepared successful-run recording and identify it as recorded.

The drone, journey, location, and responder organization are simulated. Camera vision does not analyze Unreal footage. No emergency service is contacted. Developer TEST observations must stay labeled as tests.
