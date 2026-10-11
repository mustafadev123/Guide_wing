import { useEffect, useRef, useState } from "react";
import { api, ApiError, AnalyticsReport } from "./api";
import { AnalyticsMetrics, AnalyticsRange, summaryMatches } from "./analyticsMetrics";


export function AnalyticsSummary({ range, includeTests, metrics, stale }: {
  range: AnalyticsRange; includeTests: boolean; metrics: AnalyticsMetrics; stale: boolean;
}) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkAgain, setCheckAgain] = useState(false);
  const alive = useRef(false);
  const epoch = useRef(0);
  const lock = useRef(false);

  useEffect(() => {
    alive.current = true;
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
    const deadline = Date.now() + 90_000; // provider attempt + one quiet retry
    let running = false;
    let closed = false;
    const timer = window.setInterval(async () => {
      if (running || closed) return;
      if (Date.now() >= deadline) { clearInterval(timer); setCheckAgain(true); return; } // keep the instant summary
      running = true;
      try {
        const result = await api.analyticsSummary(id);
        if (!closed && alive.current && epoch.current === requested) setReport(result);
      } catch (e) {
        // Status reads failing never replace the instant summary already on screen.
        if (!closed && alive.current && epoch.current === requested) { clearInterval(timer); setCheckAgain(true); void e; }
      } finally { running = false; }
    }, 1000);
    return () => { closed = true; clearInterval(timer); };
  }, [report?.job_id, report?.status]);

  const generate = async () => {
    if (lock.current || stale) return;
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
        setError("Summary unavailable while the server is unreachable. The recorded figures above are still current.");
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
  const blocked = busy || stale || metrics.total === 0 || (pending && !checkAgain);
  // Gemini text when it is ready; otherwise the instant summary written from the recorded figures.
  const shown = report?.status === "ready" && report.sections ? report.sections : report?.instant_sections ?? null;
  return <section className="ai-summary" aria-labelledby="ai-title">
    <div className="ai-summary-content">
      <h3 id="ai-title">Summary</h3>
      <div aria-live="polite" aria-atomic="true">
        {!shown && <p>{metrics.total === 0 ? "No requests in this selection yet." : "Summarize queue outcomes and response times."}</p>}
        {shown && <div className="analytics-report">
          <div><h4>Queue outcomes</h4><p className="ai-generated">{shown.overview}</p></div>
          <div><h4>Response times</h4><p className="ai-generated">{shown.response_times}</p></div>
        </div>}
        {error && <p className="warn">{error}</p>}
      </div>
      {shown && changed && <p className="warn">The recorded figures have changed since this summary was requested. Generate an updated summary.</p>}
    </div>
    <div className="ai-summary-actions">
      <button className="btn" onClick={generate} disabled={!!blocked}>{busy ? "Summarizing..." : shown && changed ? "Update summary" : "Generate summary"}</button>
    </div>
  </section>;
}
