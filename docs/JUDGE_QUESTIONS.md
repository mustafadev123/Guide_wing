# GuideWing judge preparation: questions and answer bank

Prepared from this checkout on 2026-10-10. This guide assumes the fallback presentation: a 10–15-second, manually controlled Unreal recording on a phone, followed by a live web demonstration on a laptop. The web story is Start → chair warning → explicit Resume → Help/Cancel → palm request → dispatch → responder acceptance with audible acknowledgment → resolution/history, with analytics if time permits.

The rankings below are preparation priorities based on that demonstration, not measured probabilities. A technical judge may jump straight to architecture; an accessibility judge may start with participant research. Questions and answers are separated so one teammate can quiz another without revealing the response.

## Read this before rehearsing

The demo scripts contain older feature-status wording. The polished React frontend, deterministic Analytics, explicit Gemini aggregate summaries, and two-section Gemini incident reviews are now implemented. Durable completed-response reports/export are still unimplemented. Do not describe the existing analytics as planned, or describe a persistent report system as finished.

Gemini has returned successful synthetic results in earlier checks, but recent incident-generation checks encountered HTTP 503 and timeouts. A configured key or provider label does not establish availability at judging time. Show a generated review only after it actually appears; otherwise show recorded facts and explain the failure. ElevenLabs live playback remains unverified in the reviewed notes. Browser speech is a valid fallback.

The current incident review has **What the timeline shows** and **Response pattern**. There is no “What remains unknown” section. Removing that section does not create new incident facts: the application still does not record the user's reason for requesting help or a description of physical assistance.

The older LIMITATIONS document also predates successful Gemini checks. For current provider behavior use [GEMINI_ANALYTICS.md](GEMINI_ANALYTICS.md); for layout/integration use [FRONTEND.md](FRONTEND.md). Keep the real/simulated distinction from the demo scripts.

## How to use this document

- Rehearse questions 01–15 first. Give the direct answer in one sentence, then add evidence only if the judge asks.
- Keep ordinary answers to roughly 15–30 seconds. A technical follow-up can be longer.
- Speak as “we” only after the team confirms the claim. Team contributions, personal motivation, event eligibility, and any newly completed testing require your own facts.
- Show the relevant UI state when possible. Do not trigger a new help request just to answer a question while another request is active.
- Never substitute a hypothetical future capability for an answer about what works today.

## Part I — questions only

### Tier 1: most likely — learn these first

01. What problem does GuideWing solve, and who is it for?
02. What is actually working here, and what is simulated or prerecorded?
03. Why use a drone instead of a phone, cane, guide dog, or wearable camera?
04. How is this different from existing obstacle-detection or assistance products?
05. Is the Unreal drone connected to the backend? Why are you showing a recording?
06. Can you walk us through what happens from the palm gesture to the spoken acceptance?
07. Are you contacting emergency services or a real dispatcher? Who answers the request?
08. What exactly does Gemini do? Is it just turning database fields into sentences?
09. If Python calculates the numbers, why use Gemini at all?
10. Have blind or low-vision people tested this? How do you know it helps them?
11. What can the vision system detect, and how reliable is it?
12. What happens if the camera, internet, Gemini, or speech fails during the demo?
13. Does “accepted” or “resolved” mean someone arrived or the user is safe?
14. Why is there a ten-second cancellation window and a two-second palm hold?
15. What is your strongest next step after the hackathon?

### Tier 2: likely follow-ups — expect several of these

16. How does the participant know a request was received without looking at the screen?
17. How do you prevent accidental palm requests or repeated Help taps?
18. What if the participant cannot raise a hand or use that gesture?
19. What accessibility features have you implemented, and which have you actually tested?
20. Why are you using a real chair and camera if the journey and drone are simulated?
21. Where is the displayed location coming from? Is GPS implemented?
22. What information does the responder see, and why is it useful?
23. What happens if the participant cancels after dispatch or after acceptance?
24. Why does the participant have to choose Resume after a warning?
25. What happens if nobody accepts the request?
26. What happens if the page refreshes, the phone locks, or the backend restarts?
27. Can you show that the frontend is connected rather than playing scripted animations?
28. What is the technical architecture? What owns the state?
29. Which AI models are used? Did you train them yourselves?
30. What data is stored, and where?
31. What is sent to Gemini? Does it see the camera snapshot or exact location?
32. How do you stop Gemini inventing explanations, timings, or safety claims?
33. What do the response-time metrics actually measure?
34. Are those analytics real-world results? How representative is your sample?
35. What did you build during the hackathon, and who built which parts?

### Tier 3: plausible deeper questions — prepare if judges have time

36. What would connecting Unreal properly involve?
37. Can the 2D simulation replace Unreal? What does it prove?
38. How does the system distinguish the participant's hand from a bystander's?
39. Why only chairs? What about people, stairs, vehicles, and other hazards?
40. Does the camera measure obstacle distance or tell the user where to walk?
41. How would this work indoors, in crowds, or in poor lighting?
42. Is the camera on the drone right now? Where does computation happen?
43. Would drone noise drown out the spoken messages or environmental sounds?
44. What about battery life, charging, portability, and cost?
45. Could the drone harm the user or other pedestrians?
46. Would users be comfortable with a drone accompanying them?
47. Who would operate the responder desk, and how would you arrange coverage?
48. Why would a campus or organization pay for this? What is the business model?
49. How would you scale beyond one participant and one laptop?
50. Is the system authenticated? Could someone accept or cancel another user's request?
51. Is the camera snapshot anonymous? What about consent and retention?
52. Why not make the core workflow depend on a large language model?
53. Why use ElevenLabs when browser speech already works?
54. Are Gemini reports stored permanently? Can a responder export a report?
55. Why is the design dark and visually polished if your audience includes blind users?

### Tier 4: less likely, but high-value challenge questions

56. Isn't this a website with an unrelated drone video attached?
57. What experiment would show that a drone adds value over the web workflow alone?
58. What would make you abandon the drone part of the idea?
59. What evidence would persuade you the help workflow is better than existing options?
60. What does “safe to pilot” mean, and what still prevents deployment?
61. Why aren't there voice commands, fall detection, or automatic distress recognition?
62. Could GPS make Gemini understand why a person needed help?
63. Is a generic Gemini recommendation really analysis? What would make it richer?
64. What happens when cancel and accept happen almost simultaneously?
65. How do you avoid duplicate speech and overwhelming the participant with alerts?
66. Could a request created just before the countdown expires be lost after a crash?
67. What are the limitations of the analytics date ranges and the latest-500-record limit?
68. What licensing or operating permissions would matter if you commercialized this?
69. Is your video one continuous run? Have you edited the waiting time or used replay?
70. If we remember one thing about GuideWing, what should it be?

## Part II — answer bank

These are suggested spoken answers, grounded in the current prototype. Future proposals are explicitly described as such. Adjust them when the implementation changes.

### Tier 1 answers

#### 01 — Problem and audience

“GuideWing explores journey assistance for blind and low-vision pedestrians. Our focus is the gap between asking for help and knowing someone has responded: deliberate input, a cancellation opportunity, responder context, and acknowledgment the participant can hear.”

**Show:** the persistent Help/Cancel/Repeat area, then the acceptance announcement. Avoid opening with a list of technologies.

#### 02 — Real versus simulated

“The web interface, camera recognition, request lifecycle, database, and spoken feedback are working software. The journey, coordinates, drone flight, and responder organization are simulated. This Unreal clip is a separate manually controlled concept recording. Gemini is optional and only demonstrated as working when an actual generated result is visible.”

**Show:** the recording caption, live web state, and recorded timeline. Do not equate real software with real assistance delivery.

#### 03 — Why a drone?

“The hypothesis is that a companion could carry a camera without requiring the participant to wear one, and eventually offer a movable viewpoint. We haven't established that those benefits outweigh the noise, safety, and battery trade-offs. This prototype tests the help workflow first; it does not establish that a drone should replace a cane or guide dog.”

**Follow-up:** the drone's usefulness needs its own comparison study; the website can provide value independently.

#### 04 — Differentiation

“We aren't claiming to be the first drone-assistance project. Our demonstration combines deliberate help input, a chance to cancel, context for a responder, and an audible acknowledgment. Obstacle recognition starts the story, but closing that communication loop is the part we're emphasizing.”

**Show:** cancellation and acceptance, rather than claiming better detection than products you have not compared. The repository already acknowledges drone-assistance prior work.

#### 05 — Offline Unreal

“The fallback Unreal scene isn't connected. It illustrates the companion concept, while the laptop shows the actual integrated request workflow. We label that separation explicitly. The 2D view is our connected renderer, so we can still show backend-driven simulation without relying on Unreal.”

**Show:** the offline caption and `/sim`. Never claim Unreal's 1–4 keys cause web events.

#### 06 — End-to-end sequence

“MediaPipe recognizes an open palm held for two seconds. The backend creates a pending request and stores its ten-second deadline. Unless canceled, it becomes dispatched. A responder accepts it in the web desk, and the participant page announces the confirmed acceptance. Resolution is a separate responder action retained in history.”

**Show:** one incident's matching source, timeline, and states across both views. The Help button enters the same lifecycle.

#### 07 — Who responds?

“A teammate is acting as a simulated campus responder in another browser view. We don't place a phone call, send an SMS, or contact emergency services. A real deployment would need an actual organization, authenticated responders, agreed coverage, and an escalation process.”

**Avoid:** “dispatch calling” or “campus safety is connected.” A desk label in the demo does not establish a partnership.

#### 08 — Gemini's role

“Gemini has two bounded roles: interpreting one incident's recorded handoff and timing, and summarizing aggregate queue outcomes with a suggested rehearsal check. It doesn't identify the reason for help, inspect the snapshot, decide to dispatch, or resolve an incident. The recorded data remains available separately.”

**Show:** actual provider/model metadata, a generated review, and expandable source facts. If generation failed, show that honestly instead.

#### 09 — Why AI if the arithmetic is deterministic?

“The calculations should be deterministic. Gemini's intended contribution is connecting the figures into a short explanation of where the recorded interval was concentrated or what workflow step to rehearse. If it merely repeats the fields, its added value is limited. We preserve the figures and workflow so assistance never depends on that narrative.”

**Follow-up:** aggregate recommendations are partly guided by server-supplied context; this is constrained interpretation, not an independent investigation of root causes.

#### 10 — Participant validation

“We haven't tested this with blind or low-vision participants, so we can't claim validated usefulness. We have implemented and checked several accessible interactions, but those checks aren't a substitute for participant research. A next step is compensated, consent-based evaluation with users and accessibility specialists, starting with the web workflow.”

**Avoid:** claiming a teammate, blindfold exercise, or eyes-off-screen rehearsal represents the target community.

#### 11 — Vision capabilities and reliability

“YOLO26n detects chairs and people, but only chairs overlapping a configured camera region can trigger our obstruction rule. MediaPipe supplies open-palm recognition. We use persistence thresholds rather than one frame. We haven't established accuracy across users and environments, and the system doesn't estimate distance or certify a path as clear.”

**Show:** the camera preview and narrow chair example. Processing FPS is not detection accuracy.

#### 12 — Failures

“The Help button works without camera recognition. If Gemini fails, the timeline and ordinary analytics remain available. Speech has visible text and browser fallback where supported. Loss of the backend connection is more serious: the interface must reconcile confirmed state rather than claim delivery. For a complete demo failure we use a labeled recording.”

**Demo move:** stop repeated retries, show the working evidence, and continue. Recent Gemini timeouts are a reason to keep AI outside the main acceptance moment.

#### 13 — Meaning of accepted and resolved

“Accepted means a responder acknowledged the request in the system. Resolved means that responder marked it closed. Neither state independently verifies arrival, physical help, a clear path, or the participant's safety.”

**Show:** separate Accept and Resolve actions. Use these meanings consistently in the narration and video captions.

#### 14 — Timing choices

“Two seconds makes the palm a deliberate input, and ten seconds gives a participant a chance to cancel before simulated dispatch. Those are configurable prototype choices, not values validated with users. The window is not an emergency-response guarantee; evaluating the delay and cancellation experience is part of the next usability work.”

**Show:** cancel comfortably before expiry. Do not accelerate the backend clock to fit the pitch.

#### 15 — Strongest next step

“First, evaluate whether people can request, cancel, and recognize acknowledgment reliably. For the engineering demo, connect Unreal to the existing snapshot contract. For a real service, establish a responder partner and security before adding flight. A physical drone needs a separate safety and usefulness evaluation.”

**Avoid:** a roadmap that promises autonomous flight, GPS, new models, and a dispatch partnership all at once.

### Tier 2 answers

#### 16 — Nonvisual confirmation

“The participant page owns spoken feedback and displays the same meaningful message as text. Acceptance speech follows the backend-confirmed transition. Repeat replays the latest message. Settings offers app speech, screen-reader announcements, or text-only output so the user can choose the announcement method.”

#### 17 — Accidental and duplicate requests

“The gesture needs a sustained hold and rearming. The web button has an immediate action lock; the backend uses request keys for idempotency and permits only one open request per journey. There's also a cancellation window. These mechanisms reduce duplicates, but don't prove accidental activation is eliminated.”

#### 18 — Alternatives to the palm

“The palm is optional. Help is a normal semantic button that supports keyboard activation; holding it is unnecessary. Repeat and cancellation are also visible controls. Whether these alternatives are sufficient for particular motor or assistive-technology needs still needs user testing.”

#### 19 — Accessibility implementation versus validation

“We use large controls, visible focus, text status, selectable announcement modes, reduced-motion behavior, and a persistent action area. Browser checks covered keyboard interaction and multiple viewport sizes. Physical-phone, TalkBack, and real screen-reader evaluation remain to be done; we aren't claiming full accessibility compliance.”

#### 20 — Real chair in a simulated journey

“We separate two experiments: real recognition from camera input and simulated journey behavior. The chair demonstrates a narrow observation feeding backend state. The prerecorded Unreal scene is not the camera source, and it isn't responding to that live detection.”

#### 21 — Location and GPS

“Today's demo coordinates come from configured route waypoints, not GPS. The backend already accepts device location, but browser acquisition hasn't been added. A future phone integration would need permission, secure delivery, accuracy and freshness labels, and a fallback when location is unavailable.”

#### 22 — Responder context

“The responder sees the input method, simulated location, event times, status, and a blurred snapshot when available. This establishes what the system recorded before acceptance. It doesn't tell us why help was requested or what action the responder should take; those aren't inferred from a palm or image.”

#### 23 — Cancellation after dispatch or acceptance

“Cancellation is supported while pending and after dispatch. After the deadline it is recorded as cancellation after dispatch; it doesn't undo the fact that dispatch happened. The current contract doesn't allow cancellation after acceptance—the responder resolves that request. The interface claims cancellation only after confirmation.”

#### 24 — Explicit Resume

“A warning pauses the simulated journey, and the participant chooses to resume. Removing a detected chair doesn't prove a real path is safe. Explicit resume preserves agency without presenting the camera's narrow observation as a navigation decision.”

#### 25 — No responder accepts

“The request remains dispatched and visible. The prototype has no implemented responder-coverage guarantee or automatic escalation to another service. A deployable service would need a clearly communicated unanswered-request process with a real partner; we don't imply somebody is coming.”

#### 26 — Refresh, suspension, and restart

“Refresh reconciles server state without silently resending Help. Already stored deadlines belong to the backend, which can dispatch without the page staying open. A closed or suspended page can't provide dependable speech or new camera input. SQLite retains incidents across backend restart; optional AI results in memory do not persist.”

#### 27 — Proving integration

“Watch the same incident appear in the responder view, then accept it there: the participant view changes and speaks the acknowledgment. Its ID, source, and timeline match. The connected 2D renderer reads that same backend snapshot. That cross-view transition is stronger evidence than a local animation.”

**Show:** two readable views and one acceptance. Keep narration quiet during the app's speech.

#### 28 — Architecture

“A vision worker sends observations into a FastAPI application. That backend owns journey progress, deadlines, and incident transitions and stores records in SQLite. React renders state using REST with WebSocket-triggered reconciliation and polling fallback. Optional Gemini work runs asynchronously, away from help commands.”

#### 29 — Models and training

“We use pretrained YOLO26n for chair/person detection and MediaPipe's Gesture Recognizer for Open_Palm. We did not train a custom vision model. Gemini is a configurable hosted text model for interpretation; the reviewed default is gemini-3.8-flash. ElevenLabs is an optional speech provider, not a perception model.”

#### 30 — Storage

“SQLite in backend/data stores journeys, incidents, and timeline events. Blurred snapshots and cached speech audio are local files. Raw camera frames stay in memory. Gemini summaries and jobs also stay in backend memory, so they aren't durable reports and disappear on restart.”

#### 31 — Gemini payloads

“Aggregate analytics sends counts, derived timing statistics, selection scope, and interpretation context—not raw incidents. Incident review sends input method, status, location source, event types and times, computed intervals, and whether a snapshot exists. The current incident payload excludes image content, coordinates, landmarks, and responder identities.”

**Follow-up:** API keys stay on the server. Don't generalize the aggregate-only privacy boundary to every provider path.

#### 32 — Hallucinations

“We supply recorded facts, constrain the JSON sections, check output length and numerical grounding, and reject certain unsupported instruction types. These are partial safeguards, not proof of semantic truth. The original records stay visible, and AI never controls dispatch, movement, acceptance, or resolution.”

#### 33 — Timing definitions

“Response time here is dispatch-to-acceptance. Resolution time is acceptance-to-resolution. These measure logged workflow steps, not arrival or physical assistance. Missing or invalid timestamp pairs are excluded and we show qualifying sample counts. The cancellation delay is a different interval.”

#### 34 — Representativeness

“The database contains staged prototype requests. The measured timings reflect our rehearsals and how long we took to click, not real-world response performance. We can use them to inspect the demo workflow, but not claim service effectiveness, typical response time, or trends from a handful of records.”

#### 35 — Work and contributions

Use actual team facts: “During the event, [name] built [specific part], [name] built [specific part], and we integrated [specific behavior]. We reused pretrained models and frameworks. [Earlier work] existed before the event, and [event work] was completed during it.”

Prepare one concrete contribution per person and disclose AI coding assistance if asked or required. Don't infer eligibility or contribution history from repository timestamps alone.

### Tier 3 answers

#### 36 — Connecting Unreal

“The backend already exposes a simulation snapshot with journey, incident, vision, and revision data. Unreal would poll it and map confirmed states to its actor and drone behavior. We need to verify pause, resume, countdown, reconnect, and stale-state behavior against the real backend; local key-driven animations don't establish that integration.”

#### 37 — Connected 2D alternative

“Yes, `/sim` already reads the backend and visualizes the simulated journey. It proves that a renderer can consume the shared state. It doesn't prove physical flight or that the Unreal scene uses that state. Its simpler presentation makes it a useful fallback for judging.”

#### 38 — Whose hand?

“The current prototype cannot reliably associate a detected palm with the intended participant when multiple people are visible. The demo uses one participant in a controlled camera view. A real system would need user association or a different deliberate input before relying on recognition in public.”

#### 39 — Why chairs only?

“We deliberately restricted the trigger to a chair overlapping one configured image region so we could demonstrate a complete workflow. People are overlays, not obstruction triggers. We haven't implemented a general hazard detector for stairs, traffic, drop-offs, or every obstacle class.”

#### 40 — Distance and navigation

“No. Region overlap is an image-space rule. It doesn't provide distance, traversability, or safe directions. The spoken warning means that narrow rule fired, not that we know where the participant should walk next.”

#### 41 — Difficult environments

“Recognition depends on camera framing and visibility, and we haven't validated crowds, occlusion, poor lighting, or varied indoor spaces. We rehearse the controlled setup and retain the Help button. Expanding conditions should follow measured testing, rather than simply lowering thresholds until the demo triggers.”

#### 42 — Camera and computation

“Today the camera is a laptop webcam or a phone connected as webcam input. Vision runs on the laptop CPU; there is no onboard drone computer or drone video link. The Unreal camera and character are a separate visual concept.”

#### 43 — Noise and audible feedback

“That's an unresolved hardware and interaction question. We haven't measured rotor noise or how users would hear feedback while preserving environmental awareness. We'd test the audio arrangement and user preference under controlled conditions before assuming spoken output remains usable near a drone.”

#### 44 — Battery, cost, and portability

“We don't have physical hardware measurements or a bill of materials. The prototype demonstrates software behavior on a laptop, so it can't establish flight endurance, range, or product price. Hardware selection and an operating model would need to be specified before giving credible figures.”

#### 45 — Physical drone safety

“A drone near pedestrians introduces its own risks, and this prototype has no flight-control or physical safety validation. Any hardware exploration would require controlled testing, qualified review, and a safe operating plan. We aren't proposing deployment around people based on the simulation.”

#### 46 — Comfort and acceptance

“We don't know yet. Visibility, sound, personal space, stigma, and trust could all affect willingness to use it. We should ask participants about those trade-offs and offer a web-only comparison instead of assuming a futuristic appearance is desirable.”

#### 47 — Responder coverage

“A staffed campus or venue desk is a possible starting point, not an existing partnership. We'd need an agreed service boundary, coverage hours, training, permissions, and unanswered-request handling. The simulated desk only demonstrates the software handoff.”

#### 48 — Adoption and business model

“A possible customer is an organization already responsible for assistance in a bounded setting, such as a campus or venue. The hypothesis is that clear request context and acknowledgment improve coordination. We haven't validated willingness to pay or operating costs; a supervised web-only pilot would help test that before financing drone hardware.”

#### 49 — Scale

“The current application is a single local demo backend with SQLite, not a multi-tenant production service. Scaling would require identity and access control, organization and user isolation, reliable queue ownership, monitoring, a suitable persistence strategy, and load testing. The UI having multiple requests doesn't prove operational scale.”

#### 50 — Authentication

“There's no authentication in this prototype. It binds to loopback by default; LAN mode is only for a trusted demo network. Authorized identities, per-request access checks, and protected responder actions are prerequisites for sharing this as a real service.”

#### 51 — Snapshot privacy

“The full frame is blurred before its stored image is written, but blur isn't guaranteed anonymity. The live preview is not blurred. We should use consenting teammates and avoid bystanders in the demo. Production would need meaningful consent, access restrictions, retention/deletion policy, and review of whether storing images is necessary.”

#### 52 — Keeping an LLM outside the core

“Request state and timing need predictable rules. A language-model failure shouldn't prevent cancellation or acknowledgment, and a generated sentence shouldn't authorize an action. That's why the lifecycle is deterministic and Gemini is optional commentary.”

#### 53 — ElevenLabs rationale

“The intended benefit is a more consistent companion voice; browser speech already provides a fallback. We haven't established that the optional voice improves accessibility, and live provider playback must be verified before naming it in the demo. The user should hear a clear acknowledgment regardless of the provider.”

#### 54 — Durable reports

“Recorded incidents and their timelines persist. AI text does not: it lives in memory and can be regenerated. A durable completed-response report with export or review history is a separate planned feature, not something the current analytics panel supplies.”

#### 55 — Visual design

“The audience includes low-vision users and responders, and the interface still needs readable structure for everyone. Large controls, focus visibility, text equivalents, and selectable speech matter more than the decorative artwork. Reduced motion and a phone layout reduce distraction. We haven't validated that one color theme suits every user.”

### Tier 4 answers

#### 56 — Drone video challenge

“For this fallback, the video is a separate concept illustration, and the working product evidence is the web workflow. We don't count the clip as an integrated flight feature. The useful result today is the request-to-acknowledgment system; whether the drone earns a place in that system is still a hypothesis.”

#### 57 — Test the drone's added value

“I'd first compare the same assistance workflow with phone/wearable camera input and a controlled companion-camera setup. Evaluate whether the viewpoint improves useful context, and ask about effort, noise, comfort, and preference. Physical drone trials would follow safety review; we'd keep the help workflow consistent so the comparison isolates the companion.”

#### 58 — When to abandon the drone

“If participants prefer a simpler option, or the camera benefit doesn't outweigh operational and accessibility costs, we should keep the useful assistance workflow and change the hardware direction. The drone concept shouldn't determine the answer before we test it.”

#### 59 — Evidence of workflow value

“Use agreed tasks and a comparison condition, then measure successful requests, unintended activations, cancellation understanding, and recognition of acceptance, alongside workload and participant feedback. We need to see whether the interaction is useful, not just whether buttons change state. We don't have those results yet.”

#### 60 — Readiness for a pilot

“The next pilot should be supervised evaluation of the web interaction without anyone relying on it for safety. Real assistance operation needs a responder partner, security, privacy arrangements, tested failure communication, and service procedures. Physical flight adds another evaluation track. A successful hackathon run isn't deployment approval.”

#### 61 — Missing input features

“We focused on two explicit ways to request help and a reliable acknowledgment loop. Voice, fall detection, and automatic distress recognition would add distinct requirements and failure modes. We don't currently detect distress, interpret crimes, or support spoken cancellation.”

#### 62 — GPS and Gemini understanding

“GPS could supply a measured position, but a coordinate doesn't reveal intent or what help occurred. It could improve responder context with accuracy and freshness clearly labeled. Richer incident analysis needs recorded reasons or responder notes, not an AI guess based on location.”

#### 63 — Richer AI analysis

“With only state changes and timestamps, analysis is limited to the logged sequence. We should judge it on whether it identifies the relevant interval and explains the evidence clearly. Richer context would need structured help reasons and responder notes, neither currently recorded. We shouldn't market generic prose as discovering causes.”

#### 64 — Cancel/accept race

“The backend enforces allowed transitions; the first valid transition determines which later action remains legal. Accept cannot succeed on an already canceled request, and cancellation isn't allowed after acknowledgment. The interface needs to reconcile the resulting server state rather than promise both actions succeeded.”

#### 65 — Speech overload

“The participant page owns speech, meaningful transitions are deduplicated, and new output replaces older output. We don't announce every countdown second. App speech and screen-reader announcements are selectable alternatives, while Repeat is a deliberate replay. Real assistive-technology behavior still needs device testing.”

#### 66 — Crash near the deadline

“The request and its deadline are stored server-side. Restart recovery processes overdue pending requests; the browser doesn't need to restart a countdown. If a submission response was lost, the client must reconcile and use the same request key for an explicit retry, rather than silently create another incident. Recovery still depends on intact local storage and a running backend.”

#### 67 — Analytics scope

“The selection starts with the latest 500 stored requests and filters by creation time: last 24 hours, seven days, or loaded records. That's not a complete all-time dataset. TEST requests are excluded by default. The live browser metrics and Gemini's server snapshot can differ at a time boundary or with clock differences, so we show scope, sample counts, and snapshot time.”

#### 68 — Commercialization constraints

“We'd review dependency licenses and hosted-provider terms, especially the repository's documented AGPL component, before choosing a distribution model. Physical operation would also need jurisdiction-specific review. We haven't completed that work, so we aren't claiming commercial or public-flight readiness.”

**If pressed:** identify the relevant location and deployment model before researching specific requirements; don't invent a universal rule or give a legal conclusion.

#### 69 — Video edits and replay

“The Unreal footage is a separate labeled concept recording. The main web request should remain the same incident through dispatch, acceptance, and closure. If recognition uses prerecorded input, we label REPLAY. If we shorten the ten-second wait in editing, we disclose the shortened interval instead of implying faster dispatch.”

**Team check:** confirm this answer against your exported video, not just the planned storyboard.

#### 70 — One thing to remember

“GuideWing makes the help handoff explicit: the participant chooses to request assistance and receives an acknowledgment they can hear. We've built that simulated workflow end to end, and we're clear about the hardware and service work still ahead.”

## Quick evidence map for live follow-ups

| If a judge asks about… | Show… | What it establishes |
|---|---|---|
| Working integration | Responder acceptance changing participant state | Shared backend state and acknowledgment, not arrival |
| User choice | Help → Cancel before deadline; explicit Resume | Cancellation and control over the simulated journey |
| Vision | LIVE camera preview and narrow chair/palm example | Those observations in this setup, not general accuracy |
| AI value | Generated incident review or aggregate summary beside records | An actual optional provider result, not autonomous decisions |
| AI failure | Visible error plus recorded timeline/figures | Workflow evidence remains without generated prose |
| Persistence | Closed incident in History | Stored event record, not a durable AI report |
| Renderer fallback | Backend-connected `/sim` | A functioning state consumer; offline Unreal remains separate |
| Timing | Timeline anchors and qualifying sample counts | Logged dispatch/accept/resolve intervals, not physical response |

## Claims to replace before judging

| Tempting claim | More accurate wording |
|---|---|
| “The drone detects hazards around you.” | “The laptop camera detects a chair in a configured image region; the drone is simulated.” |
| “Our AI knows why help was needed.” | “Gemini interprets recorded events; the reason isn't recorded.” |
| “We call campus safety.” | “A teammate operates a simulated responder desk; no call is placed.” |
| “Help is coming.” | “A responder accepted the request in the prototype.” |
| “Resolved means the person was helped.” | “The responder marked the record resolved.” |
| “GPS tracks the user.” | “The demo location is simulated; device-location acquisition is not implemented.” |
| “The snapshot is anonymous.” | “The stored frame is blurred; anonymity is not guaranteed.” |
| “Fully accessible and tested.” | “Accessible interactions were implemented and browser-checked; participant and real screen-reader evaluation is pending.” |
| “Average response time proves this is fast.” | “These are timings from staged requests, with stated scope and sample size.” |
| “Everything in Unreal is integrated.” | “This fallback clip is manually controlled; `/sim` is the connected renderer.” |

## Five-minute team rehearsal

1. Spend two minutes answering questions 02, 03, 08, 10, and 13 with no screen assistance.
2. Spend one minute showing the matching incident across participant and responder views; allow acceptance speech to finish.
3. Spend one minute answering 12 and 56 without apologizing for the fallback or hiding its scope.
4. Spend one minute confirming actual team contributions, camera mode, audio provider, Gemini availability, and video captions. Do not assume yesterday's successful provider check still works.

Assign one person to the short product/accessibility answers and one to technical follow-ups. If a question reaches outside your evidence, say what is implemented, what is unresolved, and how you'd test it. That is a stronger answer than inventing a capability.

## Project references

- [Live demo script](DEMO_SCRIPT.md) and [backup video script](BACKUP_VIDEO_SCRIPT.md): presentation sequence; older feature-status passages need interpretation as noted above.
- [Frontend implementation](FRONTEND.md): controls, integration, browser checks, remaining device work.
- [Gemini implementation and setup](GEMINI_ANALYTICS.md): AI payloads, timing definitions, caching, provider failures, and current two-section incident review.
- [Architecture](ARCHITECTURE.md), [API contract](CONTRACT.md), and [README](../README.md): state ownership, storage, integration, model usage.
- [Limitations](LIMITATIONS.md): core simulated scope and research/security/vision limits; its sponsor-call history is older than current implementation notes.
