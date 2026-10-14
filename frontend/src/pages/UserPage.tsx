import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, describeLocation, IncidentStatus, MODE_LABEL, newRequestKey, SimulationState, SnapshotIncident, SOURCE_LABEL, VisionStatus } from "../api";
import { ServerEvent, useFreshness, usePolling, useServerEvents } from "../events";
import { Announcer, ServerThenBrowserSpeech } from "../speech";
import { createBrowserRecognizer, requestMicrophone, VoiceCommand, VoiceController, VoiceSnapshot, VoiceState } from "../voice";
import { CheckpointTracker } from "../checkpoints";
import { cameraHold, cameraMessage, CameraSignal, cameraSignal, SERVER_DOWN_MESSAGE, serverHold, ServerSignal, StableSignal } from "../readiness";
import { ConnectionBadge, ModeBadge } from "../components";
import { Atmosphere, Entrance, Icon } from "../ui";

const STATUS_TEXT: Record<IncidentStatus, string> = { pending: "Cancellation window", dispatched: "Waiting for a responder", acknowledged: "Accepted by a responder", cancelled: "Canceled", resolved: "Resolved" };
function incidentMessage(inc: Pick<SnapshotIncident, "status" | "request_source">): string {
  const test = inc.request_source === "test" ? "Test request. " : "";
  switch (inc.status) {
    case "pending": return `${test}${inc.request_source === "gesture" ? "Open palm recognized. " : inc.request_source === "voice" ? "Voice command received. " : ""}Help request recorded. You have 10 seconds to cancel before simulated dispatch.`;
    case "dispatched": return `${test}Your request reached the simulated responder queue. Waiting for acceptance.`;
    case "acknowledged": return `${test}A responder accepted your request.`;
    case "cancelled": return `${test}The server confirmed your help request is canceled.`;
    case "resolved": return `${test}The responder marked your request as resolved.`;
  }
}
type Feedback = "voice" | "screen-reader" | "text";
type HelpSource = "button" | "voice";
type Attempt = { journeyId: string; key: string; source?: HelpSource };
const VOICE_STATE_LABEL: Record<VoiceState, string> = { unsupported: "Not supported", off: "Off", permission: "Asking for microphone", ready: "Ready", listening: "Listening", processing: "Processing", speaking: "Paused while GuideWing speaks", error: "Problem" };
// Must never contain a spoken command phrase: announcements are not allowed to sound like "GuideWing, help".
const OBSTACLE_MESSAGE = "Obstacle detected ahead. Please pause.";
const ON_MY_WAY_MESSAGE = "Your responder says they are on the way.";
function readStored<T>(key: string, fallback: T): T {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function store(key: string, value: unknown) {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* memory state still works */ }
}

export function UserPage() {
  const [message, setMessage] = useState("Connecting to your journey. No real emergency service is contacted.");
  const announcer = useMemo(() => new Announcer(new ServerThenBrowserSpeech(), setMessage), []);
  const [feedback, setFeedback] = useState<Feedback>(() => {
    const stored = readStored<Feedback>("guidewing.feedback", "voice");
    return ["voice", "screen-reader", "text"].includes(stored) ? stored : "voice";
  });
  const [audioOn, setAudioOn] = useState(false);
  const [shortcutsOn, setShortcutsOn] = useState(() => readStored("guidewing.shortcuts", true));
  const [view, setView] = useState(location.hash === "#settings" ? "settings" : "home");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [repeatCount, setRepeatCount] = useState(0);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const voiceHandlers = useRef<Record<VoiceCommand, () => unknown>>({ help: () => undefined, cancel: () => undefined, status: () => undefined, repeat: () => undefined });
  const [voice, setVoice] = useState<VoiceSnapshot | null>(null);
  const voiceCtl = useMemo(() => new VoiceController({
    createRecognizer: () => createBrowserRecognizer(),
    requestMicrophone,
    onCommand: command => voiceHandlers.current[command](),
    onChange: setVoice,
  }), []);
  const voiceSnap = voice ?? voiceCtl.snapshot;
  const offset = useRef(0);
  const seeded = useRef(false);
  const lock = useRef(false);
  const submitted = useRef<string | null>(null);
  const cancellationToConfirm = useRef<string | null>(null);
  const routeNames = useRef<string[]>([]);
  const checkpoints = useMemo(() => new CheckpointTracker(() => routeNames.current), []);
  const server = useMemo(() => new StableSignal<ServerSignal>(serverHold), []);
  const camera = useMemo(() => new StableSignal<CameraSignal>(cameraHold), []);
  const prevVoice = useRef<VoiceState | null>(null);
  const attempt = useRef<Attempt | null>(readStored<Attempt | null>("guidewing.helpAttempt", null));
  const snap = usePolling<SimulationState>(async () => {
    const s = await api.snapshot();
    offset.current = Date.parse(s.sampled_at) - Date.now();
    return s;
  }, 1000);
  const vision = usePolling<VisionStatus>(api.vision, 2000);
  const stale = useFreshness(snap.lastOk);
  const state = snap.data;
  const journey = state?.journey;
  const active = state?.active_incident ?? null;
  const ready = !!state && !snap.error && !stale;
  const v = vision.data;
  const pending = active?.status === "pending" ? active : null;
  useEffect(() => { document.getElementById("main-content")?.scrollTo({ top: 0 }); }, [view]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    const change = () => setView(location.hash === "#settings" ? "settings" : "home");
    const clock = () => setNow(Date.now());
    window.addEventListener("hashchange", change);
    document.addEventListener("visibilitychange", clock);
    return () => { clearInterval(timer); window.removeEventListener("hashchange", change); document.removeEventListener("visibilitychange", clock); announcer.stop(); };
  }, [announcer]);
  useEffect(() => {
    const off = announcer.onSpeaking(on => voiceCtl.setSpeaking(on));
    const visible = () => voiceCtl.setHidden(document.hidden);
    document.addEventListener("visibilitychange", visible);
    return () => { off(); document.removeEventListener("visibilitychange", visible); voiceCtl.disable(); };
  }, [announcer, voiceCtl]);
  const onEvent = useCallback((e: ServerEvent) => {
    if (e.type === "vision.obstacle" && e.payload.announce) {
      announcer.announce(`obstacle:${e.payload.observation_id}`, `${e.payload.source === "test" ? "Test. " : ""}${OBSTACLE_MESSAGE}${e.payload.journey_paused ? " Journey paused. Resume when ready." : ""}`, "urgent");
    }
    if (e.type.startsWith("incident.") || e.type.startsWith("journey.")) void snap.refresh();
    if (e.type.startsWith("vision.")) void vision.refresh();
  }, [announcer, snap.refresh, vision.refresh]);
  const connection = useServerEvents(onEvent, () => { void snap.refresh(); void vision.refresh(); });

  useEffect(() => { api.route().then(r => { routeNames.current = r.waypoints.map(w => w.name); }).catch(() => undefined); }, []);

  // Readiness and failure feedback, evaluated on the 250 ms clock with hysteresis (readiness.ts).
  useEffect(() => {
    if (state || snap.error) {
      const t = server.update(ready ? "up" : "down", now);
      if (t?.to === "down") announcer.say(SERVER_DOWN_MESSAGE);
      else if (t?.to === "up" && t.from === "down") announcer.say(`Connection restored. ${active ? `Request status: ${STATUS_TEXT[active.status].toLowerCase()}.` : "No active help request."}`);
    }
    if (v && !vision.error && server.value === "up") {
      const t = camera.update(cameraSignal(v), now);
      // A page refresh does not repeat the camera message it already gave in this tab.
      const text = t && cameraMessage(t);
      if (t && text && readStored<string | null>("guidewing.cameraAnnounced", null) !== t.to) announcer.say(text, t.to === "unavailable" ? "normal" : "optional");
      if (text) store("guidewing.cameraAnnounced", t!.to);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voice readiness only after the microphone was granted; failures are spoken once.
  useEffect(() => {
    const prev = prevVoice.current;
    prevVoice.current = voiceSnap.state;
    if (prev === null || prev === voiceSnap.state) return;
    if (voiceSnap.state === "ready" && voiceSnap.enabled && ["off", "permission", "error"].includes(prev)) announcer.say("Voice commands on. Microphone access granted. Press Speak a command, or the V key, before each command.", "optional");
    else if (voiceSnap.state === "error") announcer.say(`Voice commands unavailable. ${voiceSnap.message}`);
  }, [voiceSnap.state, voiceSnap.enabled, voiceSnap.message, announcer]);

  useEffect(() => {
    if (!state) return;
    const j = state.journey;
    const inc = state.last_incident;
    if (inc?.id === cancellationToConfirm.current && inc.status === "cancelled") {
      cancellationToConfirm.current = null; setActionError(null);
    }
    const jKey = `journey:${j.id}:${j.version}`;
    if (submitted.current && (inc?.id === submitted.current || state.active_incident?.id === submitted.current)) submitted.current = null;
    if (attempt.current && (attempt.current.journeyId !== j.id || state.active_incident)) {
      if (state.active_incident) setActionError(null);
      attempt.current = null; store("guidewing.helpAttempt", null);
    }
    const checkpoint = checkpoints.observe(j, j.waypoint); // first sight of a journey only records its position
    if (!seeded.current) {
      seeded.current = true;
      announcer.seed(jKey);
      if (inc) announcer.seed(`incident:${inc.id}:${inc.status}`);
      if (inc?.on_my_way_at) announcer.seed(`incident:${inc.id}:on_my_way`);
      // Restore status as text; refresh never submits or replays an old request.
      const restored = state.active_incident;
      announcer.say(restored ? `Existing request: ${STATUS_TEXT[restored.status].toLowerCase()}. No new request was sent on this page load.` : j.status === "idle" ? "Ready when you are. Start a journey to enable Help." : `Journey ${j.status}. ${inc ? `Last request: ${STATUS_TEXT[inc.status].toLowerCase()}.` : "No active help request."}`);
      return;
    }
    if (inc) announcer.announce(`incident:${inc.id}:${inc.status}`, incidentMessage(inc));
    if (inc?.on_my_way_at && inc.status === "acknowledged") announcer.announce(`incident:${inc.id}:on_my_way`, `${inc.request_source === "test" ? "Test request. " : ""}${ON_MY_WAY_MESSAGE}`);
    if (checkpoint) announcer.announce(checkpoint.key, checkpoint.text, "optional");
    if (j.pause_reason === "help_request" || j.pause_reason === "obstruction") announcer.seed(jKey);
    else if (j.status === "active") announcer.announce(jKey, j.route_progress > 0.001 ? "Journey resumed." : "Journey started. Press Help, or hold an open palm for two seconds when camera recognition is ready.");
    else if (j.status === "paused") announcer.announce(jKey, "Journey paused. Your help request is unchanged.");
    else if (j.status === "ended") announcer.announce(jKey, j.route_progress >= 1 ? "You reached the end of the demo route." : "Journey ended.");
  }, [state, announcer]);

  const enableAudio = () => { if (feedback === "voice") { announcer.enable(); setAudioOn(true); } };
  const explain = (text: string) => { enableAudio(); announcer.say(text); };
  const canHelp = ready && !!journey?.armed && !active && !submitted.current && !busy;
  const canCancel = ready && !!active && ["pending", "dispatched"].includes(active.status) && !busy;
  const helpBlocked = busy ? "Waiting for server confirmation." : !ready ? "Reconnect to the server before requesting help." : !journey?.armed ? journey?.status === "ended" ? "Start a new journey to request help." : "Start your journey to enable Help." : active ? "A help request is already active." : submitted.current ? "Your request is being synchronized." : null;
  const cancelBlocked = busy === "cancel" ? "Cancellation requested. Waiting for server confirmation." : busy ? "Waiting for the current action to finish." : !ready ? "Reconnect to confirm cancellation." : active?.status === "acknowledged" ? "Already accepted. Only the responder can now resolve this request." : !canCancel ? "No request to cancel." : null;
  const run = async (kind: string, fn: () => Promise<unknown>) => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(kind); setActionError(null); enableAudio();
    try { await fn(); await snap.refresh(); }
    catch (e) {
      const msg = e instanceof ApiError && e.status < 500 ? e.message : "Server confirmation unavailable. The action may have reached the server. Reconnect and check the current status before trying again.";
      setActionError(msg); announcer.say(msg); void snap.refresh();
    } finally { lock.current = false; setBusy(null); }
  };
  const start = () => journey && run("journey", () => api.journeyAction(journey.id, "start"));
  const startNew = () => {
    if (active) { explain("Cancel or resolve the active help request before starting a new journey."); return; }
    return run("journey", async () => { const fresh = await api.createJourney(); await api.journeyAction(fresh.id, "start"); });
  };
  const togglePause = () => journey && run("journey", () => api.journeyAction(journey.id, journey.status === "paused" ? "resume" : "pause"));
  // Button, keyboard and voice all use this one path. The request key keeps retries idempotent, and the
  // backend allows one open request per journey, so a simultaneous gesture cannot create a second one.
  const help = (source: HelpSource = "button") => {
    if (!canHelp || !journey) { if (!lock.current) explain(helpBlocked ?? "A help request is already active."); return Promise.resolve(); }
    return run("help", async () => {
      if (attempt.current?.journeyId !== journey.id) attempt.current = { journeyId: journey.id, key: newRequestKey(source), source };
      store("guidewing.helpAttempt", attempt.current);
      try {
        const result = await api.requestHelp(journey.id, attempt.current!.key, attempt.current!.source ?? "button");
        submitted.current = result.incident.id;
        attempt.current = null; store("guidewing.helpAttempt", null);
        announcer.announce(`incident:${result.incident.id}:${result.incident.status}`, incidentMessage(result.incident));
      } catch (e) {
        if (e instanceof ApiError && e.status < 500) { attempt.current = null; store("guidewing.helpAttempt", null); }
        if (e instanceof ApiError && e.status === 409 && (e.body as { active_incident_id?: string } | null)?.active_incident_id)
          throw new ApiError(409, "A help request is already active. No second request was sent.", e.body);
        throw e;
      }
    });
  };
  const cancel = () => {
    if (!canCancel || !active) { if (!lock.current) explain(cancelBlocked ?? "No request to cancel."); return Promise.resolve(); }
    return run("cancel", async () => {
      announcer.say("Cancellation requested. Waiting for server confirmation.");
      const result = await api.cancel(active.id).catch(e => {
        if (!(e instanceof ApiError) || e.status >= 500) cancellationToConfirm.current = active.id;
        throw e;
      });
      if (result.incident.status === "cancelled") announcer.announce(`incident:${active.id}:cancelled`, incidentMessage(result.incident));
      else announcer.say(`Cancellation not confirmed. Current request status: ${result.incident.status}.`);
    });
  };
  const repeat = () => {
    enableAudio(); setRepeatCount(n => n + 1);
    if (feedback === "voice" && !announcer.speechAvailable()) { setSpeechNotice("Speech is unavailable in this browser. Your latest message remains visible as text."); return; }
    if (!announcer.lastMessage) announcer.say(message); else announcer.repeat();
  };
  // Read-only: describes journey and request state and never calls a state-changing endpoint.
  const statusText = () => {
    if (!state) return "Status unavailable. The server has not been reached yet.";
    const j = state.journey, inc = state.active_incident, last = state.last_incident;
    const parts = ready ? [] : ["Connection unavailable, so this status may be out of date."];
    parts.push(j.status === "idle" ? "Journey not started." : j.status === "active" ? `Journey active near ${j.waypoint ?? "the start"}, ${Math.round(j.route_progress * 100)} percent of the simulated route.` : j.status === "paused" ? `Journey paused. ${pauseReason}` : j.route_progress >= 1 ? "Journey complete." : "Journey ended.");
    if (inc) parts.push(`Help request: ${STATUS_TEXT[inc.status].toLowerCase()}.${inc.status === "pending" && secondsLeft ? ` ${secondsLeft} seconds left to cancel.` : ""}${inc.status === "acknowledged" && inc.on_my_way_at ? ` ${ON_MY_WAY_MESSAGE}` : ""}`);
    else parts.push(last ? `No active help request. Last request ${STATUS_TEXT[last.status].toLowerCase()}.` : "No active help request.");
    if (v?.obstruction_active) parts.push("Obstacle currently detected ahead.");
    return parts.join(" ");
  };
  const status = () => { enableAudio(); announcer.say(statusText(), "optional"); };
  voiceHandlers.current = { help: () => help("voice"), cancel, status, repeat };
  const speakCommand = () => {
    if (!voiceSnap.enabled) return;
    announcer.silence(); // barge-in: stop app speech so it cannot be heard as a command
    voiceCtl.pushToTalk();
  };
  const toggleVoice = () => {
    if (voiceSnap.enabled) { voiceCtl.disable(); return; }
    enableAudio();
    void voiceCtl.enable();
  };
  const shortcuts = useRef({ help, cancel, repeat, togglePause, status, speakCommand });
  shortcuts.current = { help, cancel, repeat, togglePause, status, speakCommand };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (!shortcutsOn && k !== "escape") return;
      if (k === "h") void shortcuts.current.help();
      else if (k === "c" || k === "escape") void shortcuts.current.cancel();
      else if (k === "r") shortcuts.current.repeat();
      else if (k === "s") shortcuts.current.status();
      else if (k === "v") shortcuts.current.speakCommand();
      else if (k === "p") { if (journey && ["active", "paused"].includes(journey.status)) shortcuts.current.togglePause(); else return; }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [journey, shortcutsOn]);
  const changeFeedback = (mode: Feedback) => { announcer.stop(); setAudioOn(false); setSpeechNotice(null); setFeedback(mode); store("guidewing.feedback", mode); };
  const secondsLeft = pending ? Math.max(0, Math.ceil((Date.parse(pending.dispatch_at) - (now + offset.current)) / 1000)) : null;
  const journeyTitle = !journey ? "Connecting to your journey." : journey.status === "idle" ? "Ready when you are." : journey.status === "active" ? "A little room to move." : journey.status === "paused" ? "Take the time you need." : journey.route_progress >= 1 ? "Your journey is complete." : "Your journey has ended.";
  const pauseReason = journey?.pause_reason === "obstruction" ? "Obstacle detected ahead." : journey?.pause_reason === "help_request" ? "Paused for your help request." : "Paused by you.";
  const speechLive = feedback === "screen-reader" || (feedback === "voice" && (!audioOn || !announcer.speechAvailable()));

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#home" onClick={() => setView("home")} aria-label="Guide Wing home"><Icon name="drone" /><span>Guide Wing</span></a>
      <nav aria-label="Main navigation"><a href="#home" onClick={() => setView("home")} aria-current={view === "home" ? "page" : undefined}>Home</a><a href="#settings" onClick={() => setView("settings")} aria-current={view === "settings" ? "page" : undefined}>Settings</a></nav>
      <a className="desk-link" href="/responder">Responder desk <Icon name="arrow" /></a>
    </div></header>
    <main id="main-content" tabIndex={-1} className="companion-main">
      <div className="content-width">
        <Entrance ready={!!state} error={!state ? snap.error : null} retry={() => { void snap.refresh(); }} />
        {view === "home" ? <>
          <section className="hero" aria-labelledby="home-title"><div><p className="eyebrow">Your journey, at your pace</p><h1 id="home-title">A little guidance.<br /><span>Room to move.</span></h1><p className="hero-caption">Simple controls. Clear updates.<br />Your next step is always yours.</p></div><Atmosphere /></section>
          <section className="journey-section" aria-labelledby="journey-title"><div className="journey-copy"><p className="eyebrow">Journey <span className="status-chip">{journey?.status ?? "Connecting"}</span></p><h2 id="journey-title">{journeyTitle}</h2><p>{journey?.status === "paused" ? pauseReason : journey?.status === "active" ? `Near ${journey.waypoint ?? "the start"}. Location and movement are simulated.` : journey?.status === "ended" ? "Start a new journey when you are ready." : "Start the simulated route to enable Help and open-palm requests."}</p>{journey && journey.status !== "idle" && <><progress max="1" value={journey.route_progress} aria-label="Simulated journey progress" /><p className="hint">{Math.round(journey.route_progress * 100)}% of the demo route &middot; {describeLocation(journey.location)}</p></>}</div><div className="journey-action">
            {journey?.status === "idle" && <button className="btn primary" disabled={!!busy || !ready} onClick={start}>Start journey <Icon name="arrow" /></button>}
            {journey && ["active", "paused"].includes(journey.status) && <button className="btn primary" disabled={!!busy || !ready} onClick={togglePause} aria-keyshortcuts="P">{journey.status === "paused" ? "Resume journey" : "Pause journey"}<Icon name={journey.status === "paused" ? "play" : "pause"} /></button>}
            {journey?.status === "ended" && <><button className="btn primary" disabled={!!busy || !ready || !!active} onClick={startNew}>Start a new journey <Icon name="arrow" /></button>{active && <p className="hint">Cancel or resolve the active help request first.</p>}</>}
          </div></section>
          <section className="request-strip" aria-label="Help request status"><span className="status-dot" /><div><strong>{busy === "cancel" ? "Cancellation requested" : active ? STATUS_TEXT[active.status] : state?.last_incident ? `Last request: ${STATUS_TEXT[state.last_incident.status].toLowerCase()}` : "No active help request"}</strong><p aria-live="off">{secondsLeft !== null ? secondsLeft > 0 ? `${secondsLeft} seconds left to cancel before simulated dispatch.` : "Deadline reached. Waiting for the server dispatch confirmation." : active?.status === "acknowledged" ? active.on_my_way_at ? `${ON_MY_WAY_MESSAGE} No arrival time is available.` : "Acceptance is confirmed by the backend. The responder can mark the request resolved." : active?.status === "dispatched" ? "Cancel remains available until the request is accepted." : "Tap Help once. No holding is required."}</p>{(active ?? state?.last_incident) && <p className="hint">Requested with: {SOURCE_LABEL[(active ?? state!.last_incident!).request_source] ?? "unknown input"}</p>}</div></section>
          <section className="voice-section" aria-labelledby="voice-title"><div className="voice-copy"><p className="eyebrow">Voice commands <span className={`status-chip voice-${voiceSnap.state}`}>{VOICE_STATE_LABEL[voiceSnap.state]}</span></p><h2 id="voice-title">Say &ldquo;GuideWing, help.&rdquo;</h2><p>{voiceSnap.message}</p><p className="hint">Commands: GuideWing help, cancel, status, repeat. Each must start with &ldquo;GuideWing&rdquo;. In Edge and Chrome, the browser sends microphone audio to its speech service; GuideWing saves no recordings or transcripts.</p>{voiceSnap.lastHeard && <p className="voice-heard">Last heard: &ldquo;{voiceSnap.lastHeard.transcript.trim()}&rdquo; &middot; {voiceSnap.lastHeard.command ? `command: ${voiceSnap.lastHeard.command}` : "no command"}</p>}</div>
            <div className="voice-action">{voiceSnap.state !== "unsupported" && <button className="btn" onClick={toggleVoice} aria-pressed={voiceSnap.enabled} disabled={voiceSnap.state === "permission"}>{voiceSnap.enabled ? "Disable voice" : "Enable voice"}</button>}{voiceSnap.enabled && <label className="checkbox-option"><input type="checkbox" checked={voiceSnap.continuous} onChange={e => voiceCtl.setContinuous(e.target.checked)} />Keep listening (experimental)</label>}</div></section>
          <details className="camera-details"><summary>Camera & hands-free help {v && <ModeBadge mode={v.input_mode} ready={v.ready} />}</summary><p>{v ? `${MODE_LABEL[v.input_mode]}. ${v.ready ? "Recognition running." : v.error ?? "Not ready."} ${v.ready ? v.gesture_armed ? "Hold an open palm for two seconds to request help." : "Lower your hand to re-arm open-palm help." : ""} ${v.obstruction_active ? "Obstruction detected in the monitored region." : ""}` : "Checking camera..."}</p><p className="hint">Button help works independently of camera recognition.</p>{v && ["live", "replay"].includes(v.input_mode) && <><button className="btn" onClick={() => setShowPreview(x => !x)} aria-expanded={showPreview}>{showPreview ? "Hide camera preview" : "Show camera preview"}</button>{showPreview && <img className="preview" src="/api/vision/stream" alt="Live annotated camera preview showing the monitored region and recognized objects and hands." />}</>}</details>
        </> : <section className="settings" aria-labelledby="settings-title"><p className="eyebrow">Make it yours</p><h1 id="settings-title">Settings</h1><fieldset><legend>How you hear updates</legend><p>Choose one announcement channel to avoid hearing the same update twice.</p>{([["voice", "Spoken feedback", "Browser speech, or the configured server voice. Starts after a button or keyboard interaction."], ["screen-reader", "Screen reader", "Announce updates through TalkBack or your screen reader. App speech is off."], ["text", "Text only", "Keep messages visible without automatic spoken updates."]] as const).map(([value, label, hint]) => <label className="radio-option" key={value}><input type="radio" name="feedback" value={value} checked={feedback === value} onChange={() => changeFeedback(value)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset>
          <label className="checkbox-option"><input type="checkbox" checked={shortcutsOn} onChange={e => { setShortcutsOn(e.target.checked); store("guidewing.shortcuts", e.target.checked); }} />Enable single-key shortcuts (H, C, R, P, S, V)</label><section className="settings-section"><h2>Connected to the prototype</h2><p>The FastAPI backend stores requests, owns the 10-second window, and confirms responder actions. Dispatch and location are simulated. No real emergency service is contacted.</p><p>Sign-in is not implemented in this source project. No assistance service or account provider is implied.</p><a href="/responder">Open responder desk</a> ? <a href="/sim">Open 2D simulation</a></section>
          <section className="settings-section"><h2>Journey & browser limits</h2><p>The backend ends the route when progress reaches 100%. Ending or pausing a journey does not cancel an existing help request.</p>{journey && ["active", "paused"].includes(journey.status) && <button className="btn" disabled={!!busy || !ready} onClick={() => { void run("journey", () => api.journeyAction(journey.id, "end")); }}>End journey</button>}<p>Keep this page open for spoken acknowledgment. After submission, the running backend owns dispatch even if this tab is suspended. The browser cannot guarantee audio or gesture delivery while closed. Refresh restores server state and never sends a request automatically.</p><p className="hint">Keyboard: H Help / C or Escape Cancel / R Repeat / S Status / V Speak a voice command / P Pause or Resume. Tab and Enter also work on every control.</p><p>Voice commands are optional and off until you enable them on Home. Recognition pauses while GuideWing speaks, so &ldquo;GuideWing, cancel&rdquo; may be missed during an announcement: press Speak a command (V) to interrupt, or use Cancel or Escape, which always work.</p></section>
        </section>}
        <div className="connection-row"><ConnectionBadge connection={connection} error={snap.error || (state && stale ? "Stale state" : null)} />{(!ready && state) && <button className="text-button" onClick={() => { void snap.refresh(); }}>Retry connection</button>}<p>Demonstration only. No real help service or physical drone is connected.</p></div>
        {attempt.current && !active && <p className="warn">A previous Help attempt has no confirmation. Pressing Help explicitly retries the same request key; refresh never retries it.</p>}
        {actionError && <p className="error">{actionError}</p>}
      </div>
    </main>
    <section className="action-area" aria-label="Assistance controls"><div className="content-width">
      <div className="latest-message"><svg className="message-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="12" cy="12" r="5" fill="currentColor" /></svg><div><p className="eyebrow">Latest message</p><p aria-live={speechLive ? "polite" : "off"} aria-atomic="true"><span key={repeatCount}>{message}</span></p></div></div>
      <div className="primary-controls"><button className="btn help-button" onClick={() => { void help(); }} aria-disabled={!canHelp} aria-describedby="help-hint" aria-keyshortcuts="H"><Icon name="help" /><span>{busy === "help" ? "Requesting..." : "Help"}</span></button><button className="btn cancel-button" onClick={() => { void cancel(); }} aria-disabled={!canCancel} aria-describedby="cancel-hint" aria-keyshortcuts="C Escape"><Icon name="cancel" /><span>Cancel</span></button><button className="btn repeat-button" onClick={repeat} aria-keyshortcuts="R"><Icon name="repeat" /><span>Repeat last message</span></button></div>
      <div className="secondary-controls"><button className="btn" onClick={status} aria-keyshortcuts="S">Status</button>{voiceSnap.enabled && <button className={`btn talk-button${voiceSnap.state === "listening" ? " listening" : ""}`} onClick={speakCommand} aria-keyshortcuts="V" aria-describedby="voice-live">{voiceSnap.state === "listening" ? "Listening..." : "Speak a command"}</button>}<p id="voice-live" className="hint" aria-live="polite">{voiceSnap.enabled || voiceSnap.state === "error" ? `Voice: ${VOICE_STATE_LABEL[voiceSnap.state].toLowerCase()}` : ""}</p></div>
      <div className="action-hints"><p id="help-hint">{helpBlocked ?? "Tap Help \u00b7 10 seconds to cancel"}</p><p id="cancel-hint">{cancelBlocked ?? "Cancel this request"}</p></div>
      {(speechNotice || (feedback === "voice" && !announcer.speechAvailable())) && <p className="hint" role="status">{speechNotice ?? "Speech is unavailable in this browser. Messages remain visible as text."}</p>}
    </div></section>
  </div>;
}
