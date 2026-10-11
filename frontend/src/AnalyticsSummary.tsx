import { useEffect, useRef, useState } from "react";
import { api, ApiError, AnalyticsConfiguration, AnalyticsReport } from "./api";
import { AnalyticsMetrics, AnalyticsRange, summaryMatches } from "./analyticsMetrics";

const RANGE_NAMES = { day: "Last 24 hours", week: "Last 7 days", loaded: "All loaded records" };

export function AnalyticsSummary({ range, includeTests, metrics, stale }: {
  range: AnalyticsRange; includeTests: boolean; metrics: AnalyticsMetrics; stale: boolean;
}) {
  const [configuration, setConfiguration] = useState<AnalyticsConfiguration | null>(null);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkAgain, setCheckAgain] = useState(false);
  const alive = useRef(false);
  const epoch = useRef(0);
  const lock = useRef(false);

  const checkConfiguration = async () => {
    try {
      const result = await api.analyticsConfiguration();
      if (alive.current) { setConfiguration(result); setError(null); }
    } catch {
      if (alive.current) setError("Cannot check Gemini configuration. Reconnect and check setup again.");
    }
  };
  useEffect(() => {
    alive.current = true;
    void checkConfiguration();
    return () => { alive.current = false; epoch.current++; };
  }, []);
  useEffect(() => {
    epoch.current++; lock.current = false;
    setReport(null); setError(null); setBusy(false); setCheckAgain(false);
  }, [range, includeTests]);

  // Poll only the already-requested job. No automatic generation on mount,
  // navigation, changed metrics, or REST refresh.
  useEffect(() => {
    if (report?.status !== "pending") return;
    const id = report.job_id;
    const requested = epoch.current;
    const deadline = Date.now() + 45_000;
    let running = false;
    let closed = false;
    const timer = window.setInterval(async () => {
      if (running || closed) return;
      if (Date.now() >= deadline) {
        clearInterval(timer); setCheckAgain(true);
        setError("The summary is still generating. Check its status without sending a new Gemini request.");
        return;
      }
      running = true;
      try {
        const result = await api.analyticsSummary(id);
        if (!closed && alive.current && epoch.current === requested) setReport(result);
      } catch (e) {
        if (!closed && alive.current && epoch.current === requested) {
          clearInterval(timer);
          if (e instanceof ApiError && e.status === 404) {
            setReport(null); setCheckAgain(false);
            setError("Summary unavailable after restart or cache eviction. Generate again explicitly.");
          } else {
            setCheckAgain(true);
            setError("Summary status unavailable. Reconnect, then check the existing request.");
          }
        }
      } finally { running = false; }
    }, 1000);
    return () => { closed = true; clearInterval(timer); };
  }, [report?.job_id, report?.status]);

  const generate = async () => {
    if (lock.current || stale || !configuration?.configured) return;
    lock.current = true; setBusy(true); setError(null); setCheckAgain(false);
    const requested = ++epoch.current;
    try {
      const result = report?.status === "pending"
        ? await api.analyticsSummary(report.job_id)
        : await api.generateAnalyticsSummary(range, includeTests);
      if (alive.current && epoch.current === requested) {
        setReport(result);
        // A manual check of a pending job remains repeatable without regeneration.
        if (result.status === "pending" && report?.status === "pending") setCheckAgain(true);
      }
    } catch (e) {
      if (alive.current && epoch.current === requested) {
        setError(e instanceof Error ? e.message : "Summary unavailable. Recorded metrics are still usable.");
        if (report?.status === "pending") {
          if (e instanceof ApiError && e.status === 404) { setReport(null); setCheckAgain(false); }
          else setCheckAgain(true);
        }
      }
    } finally {
      if (alive.current && epoch.current === requested) { lock.current = false; setBusy(false); }
    }
  };
  const pending = report?.status === "pending";
  const changed = !!report && !summaryMatches(metrics, report.metrics);
  const blocked = busy || stale || !configuration?.configured || (!pending && metrics.total === 0) || (pending && !checkAgain);
  return <section className="ai-summary" aria-labelledby="ai-title">
    <div className="ai-summary-content">
      <p className="eyebrow">Optional interpretation</p>
      <h3 id="ai-title">Gemini analytics summary</h3>
      <div aria-live="polite" aria-atomic="true">
        {!configuration && !error && <p>Checking Gemini setup...</p>}
        {configuration && !configuration.configured && <p>Gemini is not configured. Add the server API key to Guide_wing/.env and restart the backend, then check setup.</p>}
        {configuration?.configured && !report && <p>Generate a short interpretation of this selection. Only aggregate counts and timings are sent to Gemini.</p>}
        {pending && <p>Generating from the recorded snapshot. Journey and help controls remain available.</p>}
        {report?.status === "ready" && <p className="ai-generated">{report.text}</p>}
        {report && !["ready", "pending"].includes(report.status) && <p>{report.reason} {report.retry_after_s > 0 ? `Retry after about ${report.retry_after_s} seconds.` : ""}</p>}
        {error && <p className="warn">{error}</p>}
      </div>
      {report && <p className="hint">{report.status === "ready" ? "AI generated interpretation" : "Requested snapshot"} · {RANGE_NAMES[report.range]} · {report.include_tests ? "TEST records included" : "TEST records excluded"} · {report.metrics.total} requests · {report.as_of} UTC. {report.scope}.{report.cached ? " Cached result reused." : ""}</p>}
      {report?.status === "ready" && changed && <p className="warn">The recorded figures have changed since this summary was requested. Generate an updated summary.</p>}
      <p className="hint">Read alongside the recorded figures. This is simulated dispatch. AI text is not a safety assessment or instruction.</p>
    </div>
    <div className="ai-summary-actions">
      <button className="btn" onClick={generate} disabled={!!blocked}>{busy ? "Requesting..." : pending && !checkAgain ? "Generating..." : pending ? "Check summary" : report?.status === "ready" ? changed ? "Update summary" : "Generate summary" : report?.status === "failed" || report?.status === "rejected" ? "Retry summary" : "Generate summary"}</button>
      {(!configuration || !configuration.configured) && <button className="text-button" onClick={() => { void checkConfiguration(); }}>Check setup</button>}
    </div>
  </section>;
}
