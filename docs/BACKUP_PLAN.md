# GuideWing: backup demonstration and live judging script

This plan assumes Unreal cannot connect to the GuideWing backend. The preferred presentation uses a 10-15-second recorded Unreal concept clip on a phone, followed by the working frontend on one web laptop. If the clip is unavailable, omit it and use the existing `/sim` view.

The core fallback uses existing functionality. The finished frontend and Gemini-generated response reports/analytics are planned additions and appear below with explicit readiness conditions; editing this plan does not implement those features. The companion video storyboard is in [docs/BACKUP_VIDEO_SCRIPT.md](BACKUP_VIDEO_SCRIPT.md), and the quick presentation runbook is in [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## Finished frontend and Gemini reports: presentation readiness

Use the team's finished frontend as the primary presentation when it connects to the real backend and passes a full rehearsal. The current `/user`, `/responder`, and `/sim` pages remain the fallback. Control names below describe the current implementation; map them to the actual finished UI before judging. A visual mockup is not a working workflow. Use the visible Start, Help, Cancel, Repeat, Resume, Accept, and Mark resolved controls for the main demonstration; H/C/R/P are optional keyboard shortcuts, not separate features or Unreal commands.

Gemini has two distinct presentation roles:

- **Current responder briefing:** the code supports a summary of recorded request facts after dispatch, alongside a deterministic briefing. Real Gemini-service success remains a rehearsal requirement.
- **Planned response report and analytics:** after the responder closes the demonstration request, open its actual report in the finished frontend. Show request method, labeled location source, recorded request/dispatch/acceptance/resolution times, responder identity when recorded, and final status. If implemented, show metrics calculated from those records, such as dispatch-to-acceptance time. Gemini supplies narrative interpretation; counts and durations should come from the recorded data. Do not describe one staged incident as evidence of typical response performance.

Do not invent a report route, Generate report button, chart, or automatic generation trigger before implementation determines those details. If reports are not ready, show History and say: "Gemini-generated response reports are our next frontend addition." If only a design is available, label it **Planned report interface** and keep it separate from the running demonstration.

## The story we want judges to remember

**A help request should end with an answer you can hear.**

GuideWing explores a simulated aerial companion for blind and low-vision pedestrians. Our hackathon prototype demonstrates a deliberate request for help, an opportunity to cancel, a handoff to a simulated responder, and spoken confirmation when that responder accepts.

The drone gives the concept a recognizable form. The working demonstration earns confidence through the complete user-to-responder workflow. We should present both, without claiming that the simulated drone is already carrying the camera, flying autonomously, navigating safely, or contacting emergency services.

Suggested one-sentence pitch:

> "GuideWing explores a drone companion that connects a pedestrian's request for help to a responder's acknowledgment, with spoken feedback at each meaningful step."

Explain immediately afterward that the journey, drone, location, and responder organization are simulated. The camera recognition and web workflow can be demonstrated running.

Drone assistance has prior work, including [Flying Guide Dog (2021)](https://arxiv.org/abs/2108.07007), which the README already cites. Do not claim to be the first drone guide or say other assistive products cannot request help. Our defensible emphasis is the combination we actually demonstrate: a companion concept, deliberate help input, cancellation, responder context, and acknowledgment the user can hear.

## Recommended phone-and-laptop arrangement

Record a short Unreal sequence: walker moving, drone following, obstacle stop, and optional resume. Play it once, offline, in landscape, with **"Concept simulation - recorded; manually controlled; backend not connected"** visible. Keep it silent. Then put the phone aside and direct attention to the web laptop. If judges cannot see the phone comfortably, play the same clip full-screen on the laptop before opening the web views.

If the phone is providing the DroidCam camera feed, keep it dedicated to camera input during the web demonstration. Use a second phone or play the concept clip on the laptop before the camera sequence. Rehearse the handoff before judging.

The original two-laptop option still works if needed:

| Laptop | What it runs | Role during judging |
|---|---|---|
| A: Unreal | Existing scene, controlled with its local keys | Brief illustration of the companion concept |
| B: web demonstration | Backend, camera input, `/user`, `/responder`, and `/sim`, all accessed locally | Working system and main evidence |

Use Unreal for approximately 10-15 seconds at the opening, then pause it or leave a still image. Put the judges' attention on laptop B for the working sequence. Avoid continuously operating two independent demonstrations: it divides attention and makes it harder to see what caused a change.

Put a physical card beside laptop A reading **"Unreal concept simulation - manually controlled; backend not connected."** In the video, use that same caption on Unreal footage. Put a card beside laptop B reading **"Running web prototype - simulated journey and dispatch."** These labels do not require modifying either application.

Do not manually synchronize Unreal keypresses with website events in a way that suggests integration. A stopped Unreal walker does not prove that YOLO detected an Unreal obstacle. Vision reads the real camera or replay footage, not the Unreal scene.

On laptop B, prepare separate browser windows rather than relying on tabs that hide each other. Show `/user` and `/responder` side by side when practical; keep `/sim` ready for a brief view of connected movement and state. Use a rehearsed browser zoom so the latest message, countdown, and acceptance control remain readable. Do not shrink three full pages until their text becomes unreadable.

This setup does not require a network connection between laptops. If an external display is available, connect it to laptop B and use it for the web demonstration. If Unreal will not launch, an optional short recording or still image can introduce the concept, with a clear recorded/concept label. The connected `/sim` view is sufficient for the main demo.

## What we can actually show

Reviewed sources: README, all four frontend pages, speech and event handling, backend lifecycle and provider code, and the hands-on/progress records. The latest progress entry records a user-observed live-camera run on 10 October 2026 using DroidCam over USB at camera index 1. Earlier limitations text still describes webcam testing as pending; use the latest checklist for rehearsal status, while retaining the prototype's actual scope limits.

| Feature | Visible evidence | Priority |
|---|---|---|
| Chair obstruction in a configured camera region | Annotated camera preview, spoken warning, paused journey | Core if lighting/camera is reliable |
| Open palm held for about two seconds | Preview and a new help request whose source is gesture | Core; switch to Help if unreliable |
| Help button / H | Request whose source is button | Brief second episode or failure fallback |
| Ten-second cancellation window | User countdown; Cancel / C / Esc closes the request | Core |
| Dispatch | Request moves from Incoming to Active on `/responder` | Core |
| Context for the responder | Request source, simulated landmark/location, request and dispatch times, briefing, blurred snapshot when available | Core |
| Acceptance | Accept click, matching user status, spoken acknowledgment | Main payoff |
| Repeat / R | Deliberate replay of the last message | Short, useful follow-up |
| Resolution and history | Mark resolved moves the incident into History | Strong ending |
| Explicit journey resume / P | Route progresses again in `/sim` | Strong ending |
| Keyboard controls and focus | Use shortcuts and a rehearsed Tab/Enter action | Show naturally; full Tab order and screen-reader behavior remain unverified in the checklist |
| Camera-independent Help | Button workflow still functions without vision | Optional separate demonstration |
| Backend reliability | One open incident, idempotency, recovery, deduplicated speech | Explain during questions; show edge cases only after rehearsal |
| ElevenLabs voice | Real audio served through `/api/speech` and heard on `/user` | Conditional: configured, verified, and rehearsed |
| Gemini briefing | Responder card explicitly displays an AI summary and recorded facts | Conditional: successful real call and visible result |
| Finished frontend | Actual participant/responder controls update the same running backend | Planned primary UI; use existing pages if not ready |
| Gemini response report / analytics | Completed incident report, underlying event records, and implemented metrics | Planned: demonstrate only once implemented and rehearsed |

The responder page already displays pending requests under **Incoming - user can still cancel**. Cancelling before the deadline prevents dispatch and acceptance; it does not mean the responder page never saw the pending request. History should show **never dispatched** for that episode.

Snapshot capture is asynchronous and needs a fresh frame. If no snapshot arrives, keep demonstrating the recorded facts and briefing. A blurred snapshot reduces visual detail; it is not guaranteed anonymous. The dashboard displays timestamps and history, while the detailed incident timeline is exposed through the API rather than a dedicated timeline widget.

## Live judging script: approximately three minutes

Roles: one presenter operates the user controls and camera demonstration; one teammate operates the responder dashboard. A third teammate can introduce Unreal. With two people, show Unreal first and then move the second person to the responder role. Approximate times are pacing targets, not reasons to skip waiting for actual state changes.

### 0:00-0:20 - Introduce the experience and the concept

**Do:** Play the recorded Unreal clip on the phone or web laptop for 10-15 seconds, then put it aside and open the finished frontend or existing web pages. If using the original two-laptop option, show the locally controlled scene briefly and pause it.

**Say:**

> "A help request should end with an answer you can hear. GuideWing explores a drone companion for blind and low-vision pedestrians. This recorded Unreal scene illustrates the companion; it was manually controlled and is not connected to the backend. Our working help workflow is running here in the browser. The journey, location, and responder organization are simulated."

**If Unreal will not run:** Replace the middle two sentences with: "Our connected 2D simulation shows the companion concept. Our working help workflow is running here in the browser."

### 0:20-0:45 - Start and demonstrate a limited obstruction

**Do:** Start the idle journey on `/user`. Let the start message finish. Briefly show progress in `/sim`. Put a chair in the calibrated camera region for at least about one second. Let the warning finish. Remove the chair and resume using P with `/user` focused.

**Say before the chair enters:**

> "The camera checks for a chair in this monitored region. When one is reported, the journey pauses and the user hears a warning."

**Say after the warning:**

> "The user chooses when to resume. This detector does not establish that a route is safe."

Skip this step in button-only mode. If detection fails once, do not keep moving the chair throughout the pitch. Use the failure line below and continue to help.

### 0:45-1:15 - Demonstrate user control over a request

**Do:** Click Help, show the countdown, and click Cancel request with a safe margin before the deadline. Briefly show History with the cancelled request marked never dispatched. This episode demonstrates the button alternative; the successful episode below demonstrates the palm. Keyboard shortcuts are optional.

**Say before raising the hand:**

> "Help is also available through a button. A ten-second window lets the user cancel if they change their mind."

**Say after cancellation speech:**

> "That request was cancelled before dispatch. The user remains in control."

Do not describe the gesture as detection of distress, crime, or an attack. It is a configured request gesture.

### 1:15-1:45 - Create the request that will reach a responder

**Do:** Confirm the palm control is armed, then hold an open palm for about two seconds. Lower it once the new request appears. Wait for the actual ten-second deadline. Show the countdown and the transition from Incoming to Active. Do not accept while pending; the UI intentionally provides no Accept control then.

**Say before the second request:**

> "Holding an open palm for two seconds is our deliberate hands-free help control. This time, the participant wants help. The request moves from the cancellation window into the responder's active queue."

Use the wait to direct attention to the user-controlled process, not to add unrelated features. Keep quiet for the request and dispatch announcements.

### 1:45-2:15 - Show what the responder receives

**Do:** Point to the request source, simulated landmark, timestamps, briefing, and blurred snapshot if present. Do not dwell on coordinates. Let the responder operator prepare to click Accept.

**Say:**

> "The responder receives how the request was made, a labeled simulated location, and recorded times. When a camera frame is available, they also receive a blurred snapshot. This gives context for reviewing the request."

If Gemini is visibly active and has been verified, add: "Gemini provides a short summary alongside the recorded facts." Otherwise, call it a briefing without naming Gemini. Skip the snapshot claim if none is present.

### 2:15-2:35 - Acceptance: the main moment

**Do:** Click **Accept request** on `/responder`. Face laptop B toward the audience. Stop narrating while `/user` speaks: **"A responder accepted your request."** Let that line finish. Press R on `/user` once if time allows, and let the repeat finish.

**Say after the first acknowledgment:**

> "The participant now has confirmation that a responder accepted the request. They can repeat it without looking for a visual notification."

Acceptance does not mean a responder has arrived, a phone call happened, or an obstacle disappeared. Do not say "help is on the way" as an established fact.

### 2:35-3:00 - Close the request and show its record

**Do:** Click **Mark resolved** on `/responder`. Describe this as closing the demonstration request; do not pretend physical assistance occurred. Show History. If the planned Gemini response report is implemented, ready, and rehearsed, open the completed incident's report and point to its recorded events and any implemented metrics. Then explicitly click Resume journey and briefly show `/sim` progressing. For a three-minute slot, omit Repeat and the final `/sim` insert if the report needs their time. Allow another 20-30 seconds only if the judging slot permits it.

**Say when the actual report is available:**

> "This report summarizes the recorded response: how the request started, when it was accepted, and when it was closed. The recorded events remain available to check the summary."

If a metric is shown, name exactly what it measures, for example "time from dispatch to acceptance in this staged request." Do not call it real emergency-service response time. If report generation is slow, show History and move on; do not delay acknowledgment or closure to wait for Gemini.

**Say:**

> "For this demonstration, the responder closes the request and it remains in history. Resuming the journey is a separate user choice. GuideWing brings deliberate help input, responder context, and audible acknowledgment into one companion workflow. Our next steps are connecting the 3D scene and evaluating the experience with blind and low-vision participants."

## Short version when judges allow only 90 seconds

Rehearse this separately. Allocate about 10 seconds to the opening, 15 to a single chair example if reliable, 25 to the palm request and real dispatch window, 15 to responder context, 15 to acceptance and its audio, and 10 to the closing. Omit the live cancellation episode, repeat, resolution, and technical edge cases. Explain the cancellation window while the main countdown runs. If the spoken messages overrun the slot, omit the chair or Unreal segment rather than rushing acceptance or overlapping the voice.

Opening: "GuideWing explores a simulated drone companion that connects a pedestrian's request for help to an acknowledgment they can hear. Our 3D scene is a separate concept demo; the working workflow is here."

Countdown: "The user has ten seconds to cancel. After that, the simulated responder receives the request and its context."

After acceptance: "That spoken confirmation is the complete loop: a deliberate request, a human acceptance, and feedback to the participant."

## Showing more features without overwhelming the demo

Prepare a follow-up menu for questions, rather than making the main pitch a tour of every button.

- **Keyboard access:** demonstrate a rehearsed Tab/Enter start and H/C/R/P. Say "keyboard controls and spoken feedback are implemented." Do not claim verified screen-reader compatibility unless actually tested.
- **Help without camera input:** use H for a second request after the first is resolved. This proves an alternative input without needing to unplug hardware mid-pitch. For a camera-free demonstration, use a separately rehearsed `-NoVision` run; keep its unavailable input label visible. Covering the lens can leave fresh frames arriving, so it is not a reliable demonstration of a camera-readiness error.
- **Duplicates:** if rehearsed, press Help again while one request is open and show the explanation. Avoid leaving an unresolved request that blocks the next demo.
- **Late cancellation:** in a separate episode, cancel a dispatched request before acceptance and show the responder notice/history. Explain that accepted requests cannot be cancelled through the user controls; the responder resolves them.
- **Persistence and recovery:** discuss the implementation and automated test evidence. Only stop the backend live if there is dedicated time and the recovery sequence was rehearsed.
- **Developer tools:** use `/dev` for preparation and clearly labeled test demonstrations. Keep it out of the core user story. It is not proof of live recognition.

## ElevenLabs and Gemini should have an evident job

For this backup, speech comes from `/user`, where the workflow is connected. Keep Unreal muted so scripted concept audio cannot be mistaken for a backend acknowledgment. Prior discussion of adding voice clips to Unreal was a proposal, not an implemented feature.

If ElevenLabs has been configured and real requests verified, explain its role in one sentence: "ElevenLabs supplies the companion voice for meaningful status changes; the browser voice is our fallback." The code caches phrases, but the browser has a short timeout, so rehearse the exact phrases and confirm actual audio playback. A configured provider name alone does not prove the audience heard ElevenLabs. Do not promise intelligibility or accessibility benefits that have not been evaluated.

If Gemini is active and its summary is visible, explain: "Gemini summarizes the recorded request facts for the responder, and those facts stay visible beside it." It does not decide dispatch, infer crimes, or choose a safe route. Validation reduces unsupported output but does not guarantee factual accuracy. A deterministic briefing remains available if the optional provider fails.

Once the planned completed-response reports are implemented, show them after resolution rather than before acceptance. Analytics should identify the demonstrated dataset and use deterministic counts/durations from the records. Gemini may explain those values, but it should not manufacture metrics or imply a wider evaluation. The current code inspection found a briefing integration, not a completed-response report or analytics page.

The repository records stub-based sponsor tests, not successful real-service calls. Make sponsor claims conditional on your own rehearsal evidence. The presentation remains complete without either provider.

## Preparation and rehearsal

On laptop B, from the backend/frontend repository:

```powershell
Set-Location D:\work\guide_wing\Guide_wing
# Latest successful hands-on run used DroidCam over USB at index 1.
# Reconfirm the index on the demo machine before using it.
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Camera 1
```

Prepare these local pages:

- http://127.0.0.1:8000/user
- http://127.0.0.1:8000/responder
- http://127.0.0.1:8000/sim
- http://127.0.0.1:8000/dev for preparation only, when developer controls are enabled

The setup and frontend build must be ready beforehand. Do not install models or dependencies during judging. For the camera demonstration, use good lighting and rehearse the chair position and palm angle. Keep only the intended hand in view when possible.

Before each run:

1. Verify the chosen camera mode and recognition readiness. Confirm no stray chair occupies the monitored region and no palm is raised.
2. Open the exact windows and rehearse browser focus: H/C/R/P act on `/user`, not the responder page or Unreal window.
3. Reset on `/dev` if enabled. Reset creates a new journey and does not imply all old history is erased. Existing closed requests may remain visible; point to the timestamps of the current demonstration.
4. Refresh and settle the user page before starting, then enable spoken feedback. Test volume during rehearsal and enable it again if you reload.
5. Confirm the route is idle and no old incident remains open. Start only when the presenter is ready. The default route lasts 180 seconds of walking; paused time does not advance it. If it has ended, use **Start a new journey**.
6. Rehearse full speech timing, cancellation with margin before ten seconds, rearming, dispatch, acceptance, resolution, and resume. Avoid pressing the next control while the previous important phrase is still playing; newer speech can replace older speech.
7. Record one successful web run with system audio as the last-resort backup. Prepare the 10-15-second Unreal concept clip separately and transfer it to the playback device before judging.
7a. On the finished frontend, verify every control against the running backend. Locate the actual completed-response report view if implemented, verify its output for this incident, and rehearse the History fallback. Leave report/analytics claims out if only mock data is available.
8. Set a suggested integration cutoff 30 minutes before judging and use that time for a complete fallback rehearsal. Adjust this margin to the event schedule.

## Failures: immediate response and wording

| Failure | Action | What to say |
|---|---|---|
| Unreal will not run | Skip it; show `/sim` | "We will show the companion through our connected 2D renderer." |
| Unreal looks out of sync | Pause it; focus on the web pages | "The 3D scene is a separately controlled concept demo. These browser views share the running backend." |
| Chair is missed | Stop repeating the chair attempt; continue to help | "The chair detector depends on this calibrated view and lighting. We will continue with the help workflow." |
| Palm request is missed | Press H on `/user` | "The Help control reaches the same request workflow." |
| A gesture request arrives just before H | Check whether a request is already open | "The request is already active; we will continue with this one." |
| Camera fails | Use Help immediately; restart only between demos if needed | "The camera is unavailable, and button help remains available." |
| Optional provider fails | Use browser speech or the deterministic briefing | Describe the actual fallback instead of claiming the sponsor output succeeded |
| Finished frontend is not ready | Use the existing `/user`, `/responder`, and `/sim` pages | "These prototype views demonstrate the working backend workflow." |
| Gemini response report is unavailable or slow | Show History and recorded incident details | "The recorded response remains available; report generation is optional." If unimplemented, say it is planned. |
| No snapshot | Show request source, location label, times, and briefing | "There is no camera snapshot for this request; its recorded facts are still available." |
| Speech is inaudible | Enable audio/check volume, then use R | "The acknowledgment is also shown as text; I will repeat it." |
| Backend fails | Briefly use the prepared recording with disclosure | "This is a recording of an earlier successful run." |

If a restart is necessary, run `scripts\stop.ps1` before launching again. For replay, use `scripts\start.ps1 -Video "<existing clip path>"`; the page must show REPLAY. For button-only mode, use `scripts\start.ps1 -NoVision`. Do not describe either mode as live-camera recognition. Rehearse these choices in advance; avoid disrupting a request midway through the main pitch.

## Answers to likely judge questions

**"Is the drone actually recognizing the chair?"**

"In this prototype, recognition runs on a laptop camera or replay footage. Unreal visualizes the companion. Moving camera processing onto a physical drone is future work."

**"Why a drone instead of something worn?"**

"We are exploring a companion that moves near the pedestrian rather than being worn. We have demonstrated its help workflow, but we have not established that this form is better. Flight safety, noise, battery life, usable sensing, and user preference would need evaluation."

**"What makes this different?"**

"Our emphasis is the request-to-acknowledgment experience: a deliberate gesture or button, time to cancel, context for a simulated responder, and spoken acceptance. The aerial companion is the concept around that workflow."

**"Are you calling dispatch or emergency services?"**

"No. A teammate operates a simulated campus responder dashboard. Dispatch here means a backend request becomes available for acceptance; no phone call, SMS, or emergency service is contacted."

**"Can it safely guide a blind pedestrian?"**

"We demonstrate a narrow chair-region warning and a simulated route, not safe autonomous navigation. We have not tested the experience with blind or low-vision participants."

**"What have you tested?"**

"Our checklist records a successful live-camera run of the main help flow, keyboard shortcuts, speech, acceptance, and resolution. The repository also records automated lifecycle tests. Full screen-reader testing, user evaluation, and the connected packaged Unreal build remain unverified." Do not turn these recorded results into a claim that today's venue setup is already verified.

## Project references

- [README](../README.md)
- [Hands-on testing](HANDS_ON_TEST_CHECKLIST.md)
- [Progress and latest user-observed results](PROGRESS.md)
- [Limitations](LIMITATIONS.md)
- [API contract](CONTRACT.md)
- [Unreal integration](UNREAL_INTEGRATION.md)
- [Original demo script](DEMO_SCRIPT.md) - this backup supersedes its assumptions about connected Unreal and its staged-threat framing for this demonstration
