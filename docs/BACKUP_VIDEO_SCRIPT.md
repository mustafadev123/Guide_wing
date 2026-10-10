# GuideWing backup video: "An answer you can hear"

Target: approximately two minutes, following the existing submission checklist's video target. Confirm the actual event limit before export. The live judging plan and feature evidence are in [../backup.md](../backup.md).

Use the team's finished frontend for footage once it runs against the real backend. Until then, use the existing `/user`, `/responder`, and `/sim` pages. Gemini completed-response reports and analytics are planned additions, distinct from the currently implemented responder briefing. Include their footage only after implementation and rehearsal; a design mockup must be labeled as planned.

## Creative direction

Tell one ordinary campus journey, with the participant choosing when to ask for assistance. Use the moment of audible acceptance as the ending the audience anticipates. A simple arc is **companion -> interruption -> choice -> request -> acknowledgment -> continued journey**.

Open with sound and a clear question: "When you ask for help, how do you know someone heard you?" Keep the visual simple and readable. Bring back the actual application's spoken acknowledgment near the end. This makes audio part of the demonstrated experience, rather than background narration about an API.

Use Unreal briefly to establish the companion's form. Caption it **"Concept simulation - manual controls; backend not connected."** Transition decisively to real web footage captioned **"Running web prototype - journey, location, and responder organization simulated."** Keep mode labels visible and state when recognition uses replay. Do not intercut a backend event with a hand-triggered Unreal animation so that it appears to cause the animation.

For live judging, this same concept recording can play on a phone in landscape, silently, for 10-15 seconds. If the phone supplies DroidCam input, keep it dedicated to the camera during the web demonstration and use a second phone or play the clip on the laptop first. For the submission video, insert the original Unreal recording directly so the scene remains readable.

Use a teammate as a participant in a staged scenario, without claiming they represent blind users. No blindfold or staged mugging is necessary. The palm is a deliberate request control, not recognition of an attack. Avoid fear-driven music and claims that the prototype makes real-world travel safe.

## Shot-by-shot storyboard and exact narration

Times are edit targets. Actual UI messages must be captured from a working run. Give application speech its own space and adjust the edit if a message is longer than the allocated slot.

| Time | Picture / action | Narration and audio |
|---|---|---|
| 0:00-0:08 | Participant pauses on a campus-style set; simple title **An answer you can hear** | "When you ask for help, how do you know someone heard you?" |
| 0:08-0:19 | Unreal walker and nearby drone. Keep the manual/offline caption visible throughout | "GuideWing explores a drone companion for blind and low-vision pedestrians. This separate simulation illustrates the companion concept." |
| 0:19-0:29 | Clear cut to the finished participant frontend, or `/user` if it is not ready, and a brief `/sim` insert. Show the simulation labels. Start journey | "Our working web prototype connects camera input, a help request, and a simulated responder. The journey and location are simulated." Retain relevant start audio if it fits; avoid overlapping narration and app speech. |
| 0:29-0:44 | Real camera preview: chair enters the configured region, warning appears, journey pauses; chair removed, explicit resume | "A chair in the monitored camera region pauses the journey." Then let the actual warning be heard. Small caption: **Chair-region detection; no safe-route inference.** |
| 0:44-0:56 | Separate short cancellation episode: click Help, show the pending countdown, click Cancel request before dispatch, History shows never dispatched | "The user can change their mind. A request cancelled inside the ten-second window is never dispatched." Caption **Help -> Cancel request**. Retain cancellation speech if time allows. H/C are optional keyboard alternatives. |
| 0:56-1:17 | New gesture episode: lower hand/rearm, then show a two-second palm hold, request appears, actual countdown runs to dispatch | "For hands-free input, an open palm held for two seconds starts a new request." Then allow request and dispatch speech to play. Caption **Deliberate request gesture**. Keep the dispatch window real-time where possible. |
| 1:17-1:29 | Focus on dispatched responder card: request source, simulated landmark, timestamps, briefing, blurred snapshot if available | "The responder sees how the request was made, its recorded times, and a labeled simulated location. A camera snapshot is blurred before storage." Omit the last sentence if no snapshot is present. |
| 1:29-1:40 | Responder clicks Accept. Cut to `/user` showing accepted status. Optional split screen with the same incident | **No narration over the app.** Let it say: "A responder accepted your request." Leave a short beat afterward. |
| 1:40-1:52 | Mark resolved, then open the completed-response report in the finished frontend if implemented. Show its events and any actual implemented analytics briefly. Otherwise show History and explicit Resume journey. Omit Repeat to give the report room | **With report:** "After closure, Gemini summarizes the recorded response. Its event times and outcome remain available for review." **Without report:** "The responder closes the demonstration request, and its history remains available. The participant chooses when to resume." |
| 1:52-2:00 | Closing card: **GuideWing - deliberate help input, responder context, audible acknowledgment.** Smaller readable line: **Simulated drone and dispatch; no emergency service contacted; user evaluation pending.** | "GuideWing connects a request with an answer you can hear. Next: connect Unreal and evaluate the experience with participants." |

The main palm episode should produce the request seen in the responder and acceptance shots. Show its request source as gesture. Use the cancellation episode to demonstrate the Help button. Do not splice unrelated acceptance footage into the main incident as if it were the same request.

The current user announcement itself explains the ten-second window. At normal pacing, its speech consumes much of that window; test the audio timing in rehearsal. If the schedule is tight, trim the intro, Unreal, repeated speech, or optional shots before cutting the acknowledgment.

If an edit removes part of the waiting interval, label the cut **"Ten-second cancellation window elapsed - wait shortened in edit."** Do not change the backend deadline or accelerate only the countdown to imply instantaneous dispatch. It is also acceptable to keep the entire countdown while quietly showing the two web views.

## Suggested on-screen language

- Unreal: **Concept simulation - manually controlled; backend not connected**
- Web: **Running prototype - simulated journey and responder organization**
- Camera: preserve **LIVE** or **REPLAY** as actually used
- Gesture: **Open palm held for 2 s - deliberate help input**
- Cancellation: **Cancelled before dispatch**
- Responder: **Simulated campus responder**
- Snapshot: **Blurred before storage; not guaranteed anonymous**
- Acceptance: **Accepted - confirmation spoken to the participant**

Keep labels short enough to read. Speak important actions aloud, caption narration and app speech, and ensure text remains legible at the final export resolution. Avoid relying on red/green color alone to communicate status.

## Optional sponsor mentions

Include these only after a real, successful provider call and playback/display rehearsal. Sponsor code and stub tests alone are insufficient evidence.

**ElevenLabs:** During the acceptance shot, add a small **"Companion voice: ElevenLabs"** caption only if that captured audio actually came from ElevenLabs. A configured health-provider name is not proof that playback did not use the browser fallback. Keep the actual acknowledgment as the main audio; a separate sponsor explanation is unnecessary. If using browser speech, simply show the spoken-feedback feature.

**Gemini:** If the responder card visibly shows the AI summary, use a caption **"Gemini summary + recorded facts."** Optional narration replacement: "The responder receives a short summary alongside the recorded facts." Do not claim AI decides whether to dispatch or identifies the cause of the request. If Gemini is unavailable, retain the deterministic briefing and omit the sponsor caption.

**Planned Gemini response reports / analytics:** use the 1:40-1:52 closing segment only once the real feature exists. Show the same incident after resolution, including request source, labeled location, recorded event times, responder action, and final status. If a metric is implemented, show one clear value derived from recorded data, such as dispatch-to-acceptance time; identify it as a staged demonstration measurement. Gemini can explain the records while the application computes counts and durations. Do not invent aggregate trends from one incident or claim typical responder performance. A currently available briefing is not evidence of completed-response reporting. If only a report design exists, label it **Planned report interface** in a separate future-work shot.

Do not add scripted ElevenLabs clips to offline Unreal footage that appear to report live responder acceptance. In this fallback, connected speech belongs to the user web page.

## Recording plan

1. Prepare dependencies, model files, the built frontend, good lighting, and the actual camera index. The latest successful logged setup was DroidCam over USB at index 1.
2. Record the Unreal concept footage separately. Capture local walk, stop, and resume behavior if desired, but label it throughout and do not claim the backend drives it.
3. Record one full web run with system audio and clear UI: start, chair warning, resume, button request/cancel, hand lowered/rearmed, palm request, ten-second wait, dispatch, acceptance, optional repeat, resolution, and explicit resume. Use the current incident's timestamps to keep the story coherent.
4. Record camera/hand close-ups with a consenting teammate and no unrelated people in frame. These illustrate input; the camera preview remains evidence of recognition. If using replay, disclose it in both narration and captions.
5. Capture responder detail inserts before clicking Accept or Mark resolved; those controls change what is visible. The blurred snapshot belongs to the request and may arrive asynchronously. Record facts instead if it does not appear.
5a. If the finished frontend and response reports are ready, capture their actual backend-driven states. Record the completed report after resolution and verify that its facts match the same incident. Do not substitute a static design for working report output. If unavailable, use History for the closing segment.
6. Capture H/C/R/P on the user page with the correct browser focus. Do not show a key pressed in Unreal as the cause of a web event.
7. Record narration separately. Lower music under speech or omit it. Keep the actual spoken acknowledgment clearly audible and use accurate captions for the words the application says.
8. Export, then review without narration to verify the causal story and labels. Review with eyes off the screen to check whether spoken actions and acknowledgment remain understandable. This is a production check, not user validation.

## If Unreal or vision is unavailable

**No Unreal:** Replace its 11-second segment with a `/sim` route view. Narration: "GuideWing explores a drone companion for blind and low-vision pedestrians. Our connected 2D view illustrates the simulated journey." Spend any spare seconds on readable responder context and acknowledgment.

**Replay recognition:** Keep the same workflow, leave REPLAY visible, and say "Recognition is running on prerecorded footage." Rehearse the replay timing so the demonstration request corresponds to the shown gesture episode. If recording different clips, label them as separate feature examples rather than implying one continuous run.

**No usable vision:** Start with `-NoVision`. Replace the chair and palm segments with keyboard-controlled start/pause/resume and Help. Say "This demonstration uses the camera-independent Help control." Keep cancellation, dispatch, context, acknowledgment, resolution, and history. Omit snapshot and hands-free claims where unsupported. Do not use developer TEST injections as undisclosed camera evidence.

## Final review

- Does the first 20 seconds communicate the experience, not just a model or tool name?
- Is offline Unreal consistently distinguished from the running web prototype?
- Can viewers follow the same successful request from creation to acceptance?
- Is the ten-second cancellation window represented accurately?
- Is the actual spoken acknowledgment audible without narration over it?
- Are simulated location, responder organization, and flight described accurately?
- Do sponsor captions identify actual recorded provider output?
- Does the finished frontend show real backend state, and are planned report/analytics screens distinguished from implemented output?
- Do we avoid claims of emergency calls, physical assistance, autonomous safe navigation, anonymity, first-ever drone guidance, or validated usefulness?
- Does the exported runtime meet the event's confirmed limit?

## References

- [README](../README.md)
- [Live judging and backup plan](../backup.md)
- [Latest hands-on test checklist](HANDS_ON_TEST_CHECKLIST.md)
- [Limitations](LIMITATIONS.md)
- [Submission checklist](SUBMISSION_CHECKLIST.md)
- [Drone-assistance prior work: Flying Guide Dog](https://arxiv.org/abs/2108.07007)
