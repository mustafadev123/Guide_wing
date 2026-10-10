import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, ApiError, describeLocation, IncidentStatus, MODE_LABEL, newRequestKey, RequestSource,
  SimulationState, SnapshotIncident, VisionStatus,
} from "../api";
import { ServerEvent, usePolling, useServerEvents } from "../events";
import { Announcer, ServerThenBrowserSpeech } from "../speech";
import { ConnectionBadge, ModeBadge } from "../components";

const TERMINAL: IncidentStatus[] = ["cancelled", "resolved"];

function incidentMessage(inc: SnapshotIncident, previous: IncidentStatus | undefined): string {
  switch (inc.status) {
    case "pending": {
      const lead: Record<RequestSource, string> = {
        gesture: "Open palm recognized. ",
        button: "",
        test: "Test request. ",
      };
      return `${lead[inc.request_source]}Help request starting. It will be sent in 10 seconds unless you cancel.`;
    }
    case "dispatched":
      return "Help request sent to the responder. Waiting for acceptance.";
    case "acknowledged":
      return "A responder accepted your request.";
    case "cancelled":
      return previous === "dispatched" || previous === "acknowledged"
        ? "Help request cancelled. The responder was notified."
        : "Help request cancelled. Nothing was sent.";
    case "resolved":
      return "The responder marked your request as resolved.";
  }
}

const STATUS_TEXT: Record<IncidentStatus, string> = {
  pending: "Starting — you can still cancel",
  dispatched: "Sent — waiting for a responder",
  acknowledged: "Accepted by a responder",
  cancelled: "Cancelled",
  resolved: "Resolved",
};

export function UserPage() {
  const [message, setMessage] = useState<string>("");
  const announcer = useMemo(() => new Announcer(new ServerThenBrowserSpeech(), setMessage), []);
  const [audioOn, setAudioOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offsetRef = useRef(0);
  const seeded = useRef(false);
  const lastIncidentStatus = useRef<Map<string, IncidentStatus>>(new Map());
  const helpKey = useRef<string | null>(null);

  const snap = usePolling<SimulationState>(async () => {
    const s = await api.snapshot();
    offsetRef.current = Date.parse(s.sampled_at) - Date.now();
    return s;
  }, 1000);
  const vision = usePolling<VisionStatus>(api.vision, 2000);
  const state = snap.data;

  const onEvent = useCallback(
    (e: ServerEvent) => {
      if (e.type === "vision.obstacle" && e.payload.announce) {
        const paused = e.payload.journey_paused ? " Journey paused. Press Resume when ready." : "";
        const test = e.payload.source === "test" ? "Test. " : "";
        announcer.announce(`obstacle:${e.payload.observation_id}`, `${test}Caution: obstruction detected in the path ahead.${paused}`);
      }
      if (e.type.startsWith("incident.") || e.type.startsWith("journey.")) snap.refresh();
      if (e.type === "vision.status") vision.refresh();
    },
    [announcer, snap.refresh, vision.refresh],
  );
  const connection = useServerEvents(onEvent, snap.refresh);

  // Announce meaningful transitions once; the first snapshot after load only seeds.
  useEffect(() => {
    if (!state) return;
    const j = state.journey;
    const inc = state.last_incident;
    const journeyKey = `journey:${j.id}:${j.version}`;
    if (!seeded.current) {
      seeded.current = true;
      announcer.seed(journeyKey);
      if (inc) {
        announcer.seed(`incident:${inc.id}:${inc.status}`);
        lastIncidentStatus.current.set(inc.id, inc.status);
      }
      return;
    }
    if (inc) {
      const prev = lastIncidentStatus.current.get(inc.id);
      if (prev !== inc.status) {
        announcer.announce(`incident:${inc.id}:${inc.status}`, incidentMessage(inc, prev));
        lastIncidentStatus.current.set(inc.id, inc.status);
      }
    }
    if (j.pause_reason === "help_request" || j.pause_reason === "obstruction") {
      announcer.seed(journeyKey); // covered by the incident/obstacle message
    } else if (j.status === "active") {
      announcer.announce(journeyKey, j.route_progress > 0.001 ? "Journey resumed." : "Journey started. To request help, hold up an open palm for two seconds or press Help.");
    } else if (j.status === "paused") {
      announcer.announce(journeyKey, "Journey paused.");
    } else if (j.status === "ended") {
      announcer.announce(journeyKey, j.route_progress >= 1 ? "You have reached the end of the demo route." : "Journey ended.");
    }
  }, [state, announcer]);

  // Visual countdown only (not announced every second).
  const pending = state?.active_incident?.status === "pending" ? state.active_incident : null;
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [pending]);
  const secondsLeft = pending
    ? Math.max(0, Math.ceil((Date.parse(pending.dispatch_at) - (now + offsetRef.current)) / 1000))
    : null;

  const enableAudio = () => {
    announcer.enable();
    setAudioOn(true);
  };

  const run = async (fn: () => Promise<unknown>) => {
    enableAudio(); // every control is a user gesture
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await snap.refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Cannot reach the GuideWing server.";
      setActionError(msg);
      announcer.say(msg);
    } finally {
      setBusy(false);
    }
  };

  const journey = state?.journey;
  const active = state?.active_incident ?? null;
  const canHelp = !!journey && journey.armed && !active;
  const canCancel = !!active && (active.status === "pending" || active.status === "dispatched");

  const start = () => journey && run(() => api.journeyAction(journey.id, "start"));
  const togglePause = () =>
    journey && run(() => api.journeyAction(journey.id, journey.status === "paused" ? "resume" : "pause"));
  const help = () =>
    journey &&
    run(async () => {
      helpKey.current ??= newRequestKey("button"); // retried with the same key after a network error
      try {
        await api.requestHelp(journey.id, helpKey.current);
        helpKey.current = null;
      } catch (e) {
        if (e instanceof ApiError) helpKey.current = null;
        throw e;
      }
    });
  const cancel = () => active && run(() => api.cancel(active.id));
  const repeat = () => {
    enableAudio();
    if (!announcer.repeat()) announcer.say("There is no message to repeat yet.");
  };

  // Keyboard shortcuts (ignored inside text fields and with modifiers).
  const shortcuts = useRef({ start, togglePause, help, cancel, repeat, canHelp, canCancel, journey });
  shortcuts.current = { start, togglePause, help, cancel, repeat, canHelp, canCancel, journey };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const s = shortcuts.current;
      const k = e.key.toLowerCase();
      if (k === "h" && s.canHelp) s.help();
      else if ((k === "c" || k === "escape") && s.canCancel) s.cancel();
      else if (k === "r") s.repeat();
      else if (k === "p" && s.journey && (s.journey.status === "active" || s.journey.status === "paused")) s.togglePause();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const v = vision.data;
  const pauseText =
    journey?.pause_reason === "obstruction"
      ? "Paused: obstruction detected in the path"
      : journey?.pause_reason === "help_request"
        ? "Paused: help request"
        : journey?.pause_reason === "user"
          ? "Paused by you"
          : "";

  return (
    <main className="page user">
      <header className="topbar">
        <h1>GuideWing <span className="sub">companion</span></h1>
        <div className="badges">
          <ConnectionBadge connection={connection} error={snap.error} />
          {v && <ModeBadge mode={v.input_mode} ready={v.ready} />}
        </div>
      </header>

      <p className="notice">Simulated journey and simulated dispatch organization. This is a prototype, not an emergency service.</p>

      <section aria-labelledby="msg-h" className="card message-card">
        <h2 id="msg-h">Latest message</h2>
        <p role="status" aria-live="polite" aria-atomic="true" className="message">
          {message || "No messages yet."}
        </p>
        {!audioOn && (
          <button className="btn secondary" onClick={enableAudio}>
            Turn on spoken feedback
          </button>
        )}
        {audioOn && !announcer.speechAvailable() && <p className="warn">Speech is not available in this browser; messages appear as text.</p>}
      </section>

      <section aria-labelledby="help-h" className="card">
        <h2 id="help-h">Help request</h2>
        {active ? (
          <div className={`incident-status s-${active.status}`}>
            <p className="big">{STATUS_TEXT[active.status]}</p>
            {secondsLeft !== null && (
              <p className="countdown" aria-live="off">
                Sends in <strong>{secondsLeft}</strong> second{secondsLeft === 1 ? "" : "s"} unless cancelled.
              </p>
            )}
            {active.request_source === "test" && <p className="test-label">TEST request (developer control)</p>}
          </div>
        ) : (
          <p className="big">
            {state?.last_incident && TERMINAL.includes(state.last_incident.status)
              ? `No active request. Last request: ${STATUS_TEXT[state.last_incident.status].toLowerCase()}.`
              : "No active request."}
          </p>
        )}
        <div className="controls">
          <button className="btn danger huge" onClick={help} disabled={busy || !canHelp} aria-keyshortcuts="H">
            Help <kbd>H</kbd>
          </button>
          <button className="btn huge" onClick={cancel} disabled={busy || !canCancel} aria-keyshortcuts="C Escape">
            Cancel request <kbd>C</kbd>
          </button>
          <button className="btn" onClick={repeat} aria-keyshortcuts="R">
            Repeat last message <kbd>R</kbd>
          </button>
        </div>
        {journey && !journey.armed && <p className="hint">Start the journey to enable help requests.</p>}
      </section>

      <section aria-labelledby="journey-h" className="card">
        <h2 id="journey-h">Journey</h2>
        {journey ? (
          <dl className="facts">
            <dt>Status</dt>
            <dd>{journey.status}{pauseText ? ` — ${pauseText}` : ""}</dd>
            <dt>Progress</dt>
            <dd>{Math.round(journey.route_progress * 100)}% of the demo route, last waypoint {journey.waypoint ?? "—"}</dd>
            <dt>Location</dt>
            <dd>{describeLocation(journey.location)}</dd>
          </dl>
        ) : (
          <p>Loading journey…</p>
        )}
        <div className="controls">
          {journey?.status === "idle" && (
            <button className="btn primary huge" onClick={start} disabled={busy}>
              Start journey
            </button>
          )}
          {(journey?.status === "active" || journey?.status === "paused") && (
            <button className="btn huge" onClick={togglePause} disabled={busy} aria-keyshortcuts="P">
              {journey.status === "paused" ? "Resume journey" : "Pause journey"} <kbd>P</kbd>
            </button>
          )}
          {journey?.status === "ended" && <p className="hint">Journey ended. Use the developer page to reset the demo.</p>}
        </div>
      </section>

      <section aria-labelledby="cam-h" className="card">
        <h2 id="cam-h">Camera</h2>
        {v ? (
          <p>
            {MODE_LABEL[v.input_mode]}
            {v.source_label ? ` (${v.source_label})` : ""}. {v.ready ? "Recognition running." : v.error ?? "Not ready."}{" "}
            {v.ready && (v.gesture_armed ? "Open-palm request armed." : "Lower your hand to re-arm the open-palm request.")}
            {v.obstruction_active ? " Obstruction currently in the monitored path region." : ""}
          </p>
        ) : (
          <p>Checking camera…</p>
        )}
        {v && (v.input_mode === "live" || v.input_mode === "replay") && (
          <>
            <button className="btn secondary" onClick={() => setShowPreview((x) => !x)} aria-expanded={showPreview}>
              {showPreview ? "Hide camera preview" : "Show camera preview"}
            </button>
            {showPreview && (
              <img
                className="preview"
                src="/api/vision/stream"
                alt="Annotated camera preview: monitored path region, detected chairs and people, and hand landmarks."
              />
            )}
          </>
        )}
        <p className="hint">Button help keeps working if the camera fails.</p>
      </section>

      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      <footer className="shortcuts">
        Shortcuts: <kbd>H</kbd> help, <kbd>C</kbd>/<kbd>Esc</kbd> cancel, <kbd>R</kbd> repeat, <kbd>P</kbd> pause/resume.
      </footer>
    </main>
  );
}
