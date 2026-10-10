import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, describeLocation, formatTime, Incident } from "../api";
import { ServerEvent, usePolling, useServerEvents } from "../events";
import { ConnectionBadge } from "../components";

const RESPONDER_NAME = "Campus safety desk (simulated)";

interface BriefingData {
  provider: string;
  text: string;
  deterministic: string;
  ai_status: string;
  ai_reason?: string;
}

function Briefing({ incident }: { incident: Incident }) {
  const [b, setB] = useState<BriefingData | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = (tries: number) =>
      api
        .briefing(incident.id)
        .then((d) => {
          if (!alive) return;
          setB(d as BriefingData);
          // AI summary is generated asynchronously; check back briefly while pending.
          if ((d as BriefingData).ai_status === "pending" && tries < 15) timer = window.setTimeout(() => load(tries + 1), 2000);
        })
        .catch(() => alive && setB(null));
    load(0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [incident.id, incident.version]);
  if (!b) return null;
  return (
    <div className="briefing">
      {b.provider === "gemini" ? (
        <>
          <p>
            <strong>AI summary (Gemini, from recorded facts only):</strong> {b.text}
          </p>
          <p className="hint">Recorded facts: {b.deterministic}</p>
        </>
      ) : (
        <p>{b.deterministic ?? b.text}</p>
      )}
    </div>
  );
}

function IncidentCard({ incident, onAction, busy }: { incident: Incident; onAction: (fn: () => Promise<unknown>) => void; busy: boolean }) {
  const titleId = `inc-${incident.id}`;
  return (
    <article className={`card incident s-${incident.status}`} aria-labelledby={titleId}>
      <h3 id={titleId}>
        {incident.is_test && <span className="test-label">TEST </span>}
        Help request — <span className="status-word">{incident.status}</span>
      </h3>
      <dl className="facts">
        <dt>Requested via</dt>
        <dd>{{ gesture: "Open-palm gesture (camera)", button: "Help button", test: "Developer test control" }[incident.request_source]}</dd>
        <dt>Location source</dt>
        <dd>{incident.location.source === "simulated" ? "Simulated (demo route)" : incident.location.source}</dd>
        <dt>Landmark / position</dt>
        <dd>{describeLocation(incident.location)}</dd>
        <dt>Requested</dt>
        <dd>{formatTime(incident.created_at)}</dd>
        <dt>Dispatched</dt>
        <dd>{formatTime(incident.dispatched_at)}</dd>
        {incident.acknowledged_at && (
          <>
            <dt>Accepted</dt>
            <dd>{formatTime(incident.acknowledged_at)} by {incident.responder}</dd>
          </>
        )}
        {incident.cancelled_at && (
          <>
            <dt>Cancelled by user</dt>
            <dd>{formatTime(incident.cancelled_at)}</dd>
          </>
        )}
        {incident.resolved_at && (
          <>
            <dt>Resolved</dt>
            <dd>{formatTime(incident.resolved_at)}</dd>
          </>
        )}
      </dl>
      <Briefing incident={incident} />
      {incident.snapshot_url && (
        <img className="snapshot" src={incident.snapshot_url} alt="Blurred camera snapshot taken when help was requested (whole frame blurred)." />
      )}
      <div className="controls">
        {incident.status === "dispatched" && (
          <button className="btn primary huge" disabled={busy} onClick={() => onAction(() => api.accept(incident.id, RESPONDER_NAME))}>
            Accept request
          </button>
        )}
        {incident.status === "acknowledged" && (
          <button className="btn huge" disabled={busy} onClick={() => onAction(() => api.resolve(incident.id))}>
            Mark resolved
          </button>
        )}
      </div>
    </article>
  );
}

export function ResponderPage() {
  const list = usePolling<Incident[]>(api.incidents, 2000);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const seen = useRef<Map<string, string> | null>(null);

  const onEvent = useCallback((e: ServerEvent) => {
    if (e.type === "incident.updated") list.refresh();
  }, [list.refresh]);
  const connection = useServerEvents(onEvent, list.refresh);

  // Text notices for queue changes (the responder page never speaks; the user browser owns speech).
  useEffect(() => {
    if (!list.data) return;
    const current = new Map(list.data.map((i) => [i.id, i.status]));
    if (seen.current) {
      for (const i of list.data) {
        const prev = seen.current.get(i.id);
        if (prev === i.status) continue;
        if (i.status === "dispatched") setNotice(`New dispatched help request near ${i.location.landmark ?? "unknown landmark"}.`);
        if (i.status === "cancelled" && prev === "dispatched") setNotice("A dispatched request was cancelled by the user.");
      }
    }
    seen.current = current;
  }, [list.data]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = (await fn()) as { changed?: boolean };
      if (r && r.changed === false) setNotice("Already handled by another responder.");
      await list.refresh();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Cannot reach the GuideWing server.");
      await list.refresh();
    } finally {
      setBusy(false);
    }
  };

  const incidents = list.data ?? [];
  const actionable = incidents.filter((i) => i.status === "dispatched" || i.status === "acknowledged");
  const pending = incidents.filter((i) => i.status === "pending");
  const history = incidents.filter((i) => i.status === "cancelled" || i.status === "resolved");

  return (
    <main className="page responder">
      <header className="topbar">
        <h1>GuideWing <span className="sub">responder dashboard</span></h1>
        <ConnectionBadge connection={connection} error={list.error} />
      </header>
      <p className="notice">Simulated local responder organization. No real emergency service is contacted.</p>
      <p role="status" aria-live="polite" className="message">{notice}</p>

      <section aria-labelledby="queue-h">
        <h2 id="queue-h">Active queue ({actionable.length})</h2>
        {actionable.length === 0 && <p>No dispatched requests.</p>}
        {actionable.map((i) => (
          <IncidentCard key={i.id} incident={i} onAction={act} busy={busy} />
        ))}
      </section>

      {pending.length > 0 && (
        <section aria-labelledby="pending-h">
          <h2 id="pending-h">Incoming — user can still cancel ({pending.length})</h2>
          <p className="hint">Pending requests are not dispatched yet and cannot be accepted.</p>
          {pending.map((i) => (
            <p key={i.id} className="card pending-line">
              {i.is_test ? "TEST " : ""}Request near {i.location.landmark ?? "unknown landmark"}, dispatches at {formatTime(i.dispatch_at)}.
            </p>
          ))}
        </section>
      )}

      <section aria-labelledby="hist-h">
        <h2 id="hist-h">History</h2>
        {history.length === 0 && <p>No closed requests.</p>}
        <ul className="history">
          {history.map((i) => (
            <li key={i.id}>
              {i.is_test ? "TEST " : ""}
              <strong>{i.status}</strong> — requested {formatTime(i.created_at)}, near {i.location.landmark ?? "unknown"}
              {i.dispatched_at ? " (was dispatched)" : " (never dispatched)"}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
