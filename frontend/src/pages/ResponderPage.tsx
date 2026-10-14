import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, describeLocation, formatTime, Incident, SOURCE_LABEL } from "../api";
import { ServerEvent, usePolling, useServerEvents } from "../events";
import { ConnectionBadge } from "../components";
import { ViewHeader } from "../ui";
import { AnalyticsPanel } from "../analytics";
import { useFreshness } from "../events";

const RESPONDER_NAME = "Campus safety desk (simulated)";
// Token from this browser tab's own successful accept; the backend requires it for "On my way".
const TOKENS_KEY = "guidewing.responderTokens";
function tokenFor(id: string): string | null {
  try { return (JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? "{}") as Record<string, string>)[id] ?? null; } catch { return null; }
}
function saveToken(id: string, token: string) {
  try { const all = JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? "{}") as Record<string, string>; all[id] = token; sessionStorage.setItem(TOKENS_KEY, JSON.stringify(all)); } catch { /* this tab cannot send On my way */ }
}

interface BriefingData {
  provider: string;
  text: string;
  deterministic: string;
  ai_status: string;
  ai_reason?: string;
  ai_model?: string;
  ai_retry_after_s?: number;
  ai_review?: { outcome: string; timing: string } | null;
}

function Briefing({ incident }: { incident: Incident }) {
  const [b, setB] = useState<BriefingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retryAfter, setRetryAfter] = useState(0);
  const [checkingStopped, setCheckingStopped] = useState(false);
  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setTimeout(() => setRetryAfter(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);
  useEffect(() => {
    let alive = true;
    setB(null); setError(null); setCheckingStopped(false); setRetryAfter(0);
    let timer: number | undefined;
    const load = (tries: number) =>
      api
        .briefing(incident.id)
        .then((d) => {
          if (!alive) return;
          setB(d as BriefingData);
          setRetryAfter((d as BriefingData).ai_retry_after_s ?? 0);
          // AI summary is generated asynchronously; check back briefly while pending.
          if ((d as BriefingData).ai_status === "pending" && tries < 30) timer = window.setTimeout(() => load(tries + 1), 2000);
          else if ((d as BriefingData).ai_status === "pending") setCheckingStopped(true);
        })
        .catch(() => { if (alive) { setError("AI review status unavailable. Check again when connected; recorded details remain available."); setCheckingStopped(true); } });
    load(0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [incident.id, incident.version, attempt]);
  if (!b) return <div><p className="hint">{error ?? "Loading AI response review..."}</p>{error && <button className="btn" onClick={() => setAttempt(value => value + 1)}>Check AI review</button>}</div>;
  return (
    <div className="briefing">
      {b.provider === "gemini" ? (
        <>
          <p className="eyebrow">Gemini response review{b.ai_model ? ` / ${b.ai_model}` : ""}</p>
          {b.ai_review ? <div className="analytics-report">
            <div><h4>What the timeline shows</h4><p>{b.ai_review.outcome}</p></div>
            <div><h4>Response pattern</h4><p>{b.ai_review.timing}</p></div>
          </div> : <p>{b.text}</p>}
          <p className="hint">AI interpretation of this recorded request. A resolved label does not independently verify assistance.</p>
        </>
      ) : (
        <p className="hint">{b.ai_status === "pending" ? "Gemini is reviewing this response timeline..." : b.ai_reason ?? (b.ai_status === "not_requested" ? "AI review becomes available after dispatch or when a request closes." : "AI review unavailable. Recorded details remain available.")}</p>
      )}
      {error && <p className="warn">{error}</p>}
      {(b.ai_status === "failed" || b.ai_status === "rejected" || checkingStopped) && <button className="btn" disabled={retryAfter > 0} onClick={() => setAttempt(value => value + 1)}>{retryAfter > 0 ? `Retry in ${retryAfter}s` : b.ai_status === "pending" ? "Check AI review" : "Retry AI review"}</button>}
      <details className="briefing-source"><summary>Source facts (recorded)</summary><p className="briefing-facts">{b.deterministic ?? b.text}</p></details>
    </div>
  );
}

function IncidentCard({ incident, onAction, busy }: { incident: Incident; onAction: (fn: () => Promise<unknown>) => void; busy: boolean }) {
  const titleId = `inc-${incident.id}`;
  const [showBriefing, setShowBriefing] = useState(false);
  const detail = usePolling(() => api.incident(incident.id), 3000);
  return (
    <article className={`card incident s-${incident.status}`} aria-labelledby={titleId}>
      <h3 id={titleId}>
        {incident.is_test && <span className="test-label">TEST </span>}
        Help request — <span className="status-word">{incident.status}</span>
      </h3>
      <dl className="facts">
        <dt>Requested via</dt>
        <dd>{SOURCE_LABEL[incident.request_source] ?? incident.request_source}</dd>
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
        {incident.on_my_way_at && (
          <>
            <dt>On my way</dt>
            <dd>{formatTime(incident.on_my_way_at)}, reported by the assigned responder (no arrival time)</dd>
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
      <button className="btn" onClick={() => setShowBriefing(x => !x)} aria-expanded={showBriefing}>{showBriefing ? "Hide briefing" : "View incident briefing"}</button>
      {showBriefing && <Briefing incident={incident} />}
      {incident.status === "pending" && <p className="hint">The user can still cancel. Acceptance is available only after dispatch.</p>}
      <details className="timeline"><summary>Recorded event timeline</summary>{detail.error && <p className="error">Timeline unavailable. {detail.error}</p>}<ol>{detail.data?.timeline.map((event, index) => <li key={`${event.at}:${index}`}><strong>{event.type.replaceAll("_", " ")}</strong> ? {formatTime(event.at)}{event.detail ? ` ? ${event.detail}` : ""}</li>)}</ol></details>
      {incident.snapshot_url && (
        <img className="snapshot" src={incident.snapshot_url} alt="Blurred camera snapshot taken when help was requested (whole frame blurred)." />
      )}
      <div className="controls">
        {incident.status === "dispatched" && (
          <button className="btn primary huge" disabled={busy} onClick={() => onAction(async () => {
            const result = await api.accept(incident.id, RESPONDER_NAME);
            if (result.changed && result.responder_token) saveToken(incident.id, result.responder_token);
            return result;
          })}>
            Accept request
          </button>
        )}
        {incident.status === "acknowledged" && !incident.on_my_way_at && tokenFor(incident.id) && (
          <button className="btn primary huge" disabled={busy} onClick={() => onAction(() => api.onMyWay(incident.id, tokenFor(incident.id)!))}>
            On my way
          </button>
        )}
        {incident.status === "acknowledged" && (
          <button className="btn huge" disabled={busy} onClick={() => onAction(() => api.resolve(incident.id))}>
            Mark resolved
          </button>
        )}
      </div>
      {incident.status === "acknowledged" && !incident.on_my_way_at && !tokenFor(incident.id) && <p className="hint">On my way can be sent only by the responder who accepted this request{incident.responder ? ` (${incident.responder})` : ""}, from the tab or iMessage conversation that accepted it.</p>}
    </article>
  );
}

export function ResponderPage() {
  const list = usePolling<Incident[]>(() => api.incidents(500), 2000);
  const stale = useFreshness(list.lastOk);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "history" | "analytics">("active");
  const seen = useRef<Map<string, string> | null>(null);
  // Status reached through this desk's own action: keep the server's reply ("Server confirmed" /
  // "Already handled") instead of overwriting it with the generic change notice.
  const ownChange = useRef<{ id: string; status: string } | null>(null);
  const onEvent = useCallback((e: ServerEvent) => { if (e.type.startsWith("incident.")) void list.refresh(); }, [list.refresh]);
  const connection = useServerEvents(onEvent, () => { void list.refresh(); });
  useEffect(() => {
    if (!list.data) return;
    const current = new Map(list.data.map(i => [i.id, `${i.status}${i.on_my_way_at ? "+on_my_way" : ""}`]));
    if (seen.current) for (const i of list.data) {
      const previous = seen.current.get(i.id);
      const now = current.get(i.id)!;
      if (previous === now) continue;
      if (ownChange.current?.id === i.id && ownChange.current.status === now) { ownChange.current = null; continue; }
      if (previous === "acknowledged" && now === "acknowledged+on_my_way") setNotice(`${i.responder ?? "The assigned responder"} reported On my way.`);
      else if (i.status === "dispatched") setNotice(`New dispatched request near ${i.location.landmark ?? "unknown landmark"}.`);
      else if (i.status === "cancelled") setNotice("A request was canceled by the user.");
      else if (i.status === "acknowledged") setNotice("A responder accepted a request.");
      else if (i.status === "resolved") setNotice("A request was marked resolved.");
    }
    seen.current = current;
  }, [list.data]);
  const act = async (fn: () => Promise<unknown>) => {
    if (lock.current || list.error || stale) return;
    lock.current = true; setBusy(true); setActionError(null);
    try {
      const result = await fn() as { changed?: boolean; incident?: { id: string; status: string; on_my_way_at?: string | null } };
      if (result.incident) ownChange.current = { id: result.incident.id, status: `${result.incident.status}${result.incident.on_my_way_at ? "+on_my_way" : ""}` };
      setNotice(result.changed === false ? "Already handled. Current server state is shown." : "Server confirmed the action.");
    } catch (e) { setActionError(e instanceof ApiError ? e.message : "Server confirmation unavailable. Refresh the queue before trying again."); }
    finally { await list.refresh(); lock.current = false; setBusy(false); }
  };
  const incidents = list.data ?? [];
  const active = incidents.filter(i => ["pending", "dispatched", "acknowledged"].includes(i.status));
  const history = incidents.filter(i => ["cancelled", "resolved"].includes(i.status));
  const shown = tab === "history" ? history : active;
  const selected = incidents.find(i => i.id === selectedId) ?? shown.find(i => i.status === "dispatched") ?? shown[0];
  return <><ViewHeader current="responder" /><main className="page responder">
    <header className="desk-heading"><div><p className="eyebrow">Simulated campus response</p><h1>A human acknowledgment.</h1><p>Review the request. Understand the context. Let the person know you are there.</p></div><ConnectionBadge connection={connection} error={list.error || (stale && list.data ? "Stale state" : null)} /></header>
    <p className="notice">Demonstration only. No real emergency service is contacted. This desk never speaks; the companion page owns speech.</p>
    <p className="desk-notice" role="status" aria-live="polite">{notice}</p>
    {(list.error || (stale && list.data)) && <p className="error">The queue may be out of date. Actions are disabled until fresh server state arrives. <button className="text-button" onClick={() => { void list.refresh(); }}>Retry connection</button></p>}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    <nav className="desk-tabs" aria-label="Responder sections">{(["active", "history", "analytics"] as const).map(value => <button key={value} className="btn" aria-current={tab === value ? "page" : undefined} onClick={() => { setTab(value); setSelectedId(null); }}>{value === "active" ? `Active queue (${active.length})` : value === "history" ? `History (${history.length})` : "Analytics"}</button>)}</nav>
    {tab === "analytics" ? <AnalyticsPanel incidents={incidents} lastOk={list.lastOk} stale={!!list.error || stale} /> : <div className="desk-grid"><section className="request-list" aria-label={tab === "active" ? "Active requests" : "Closed requests"}>
      <h2>{tab === "active" ? "Requests needing attention" : "Closed requests"}</h2>
      {shown.length === 0 && <p className="empty-state">{list.lastOk === null ? "Loading recorded requests?" : tab === "active" ? "No active requests. Incoming help will appear here." : "No closed requests in the latest 500 records."}</p>}
      {shown.map(i => <button key={i.id} className={`queue-item ${selected?.id === i.id ? "selected" : ""}`} onClick={() => setSelectedId(i.id)} aria-pressed={selected?.id === i.id}><span className={`badge s-${i.status}`}>{i.status}{i.is_test ? " \u00b7 TEST" : ""}</span><strong>Near {i.location.landmark ?? "unknown landmark"}</strong><span>{i.request_source === "gesture" ? "Open palm" : i.request_source === "test" ? "Developer test" : i.request_source === "imessage" ? "iMessage" : i.request_source === "voice" ? "Voice" : "Help button"} &middot; {formatTime(i.created_at)}</span></button>)}
    </section><section className="request-detail" aria-label="Selected request">{selected ? <IncidentCard key={selected.id} incident={selected} onAction={act} busy={busy || !!list.error || stale} /> : <div className="detail-empty"><p className="eyebrow">Every request is a person</p><h2>Ready to listen.</h2><p>Select a request to see recorded context and available actions.</p></div>}</section></div>}
    <p className="hint">Showing the latest 500 stored requests at most. {incidents.length === 500 ? "Older requests may be omitted." : ""} Location is simulated unless explicitly labeled otherwise.</p>
  </main></>;
}
