import { useMemo, useState } from "react";
import { Incident } from "./api";
import { AnalyticsRange, summarizeIncidents } from "./analyticsMetrics";
import { AnalyticsSummary } from "./AnalyticsSummary";
const STATUSES = ["pending", "dispatched", "acknowledged", "resolved", "cancelled"] as const;

function duration(value: number | null) { return value === null ? "No qualifying records" : value < 60 ? `${value.toFixed(1)} seconds` : `${(value / 60).toFixed(1)} minutes`; }

export function AnalyticsPanel({ incidents, lastOk, stale }: { incidents: Incident[]; lastOk: number | null; stale: boolean }) {
  const [range, setRange] = useState<AnalyticsRange>("day");
  const [includeTests, setIncludeTests] = useState(false);
  const asOf = lastOk ?? Date.now();
  const summary = useMemo(() => summarizeIncidents(incidents, range, includeTests, asOf), [incidents, range, includeTests, asOf]);
  return <section className="analytics" aria-labelledby="analytics-title">
    <div className="analytics-heading"><div><p className="eyebrow">From recorded responses</p><h2 id="analytics-title">A clearer view of the queue.</h2></div><label className="range-label">Requests created in<select value={range} onChange={e => setRange(e.target.value as AnalyticsRange)}><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="loaded">All loaded records</option></select></label></div>
    <label className="checkbox-option"><input type="checkbox" checked={includeTests} onChange={e => setIncludeTests(e.target.checked)} />Include developer TEST requests</label>
    <p className="hint">{lastOk ? `As of ${new Date(lastOk).toISOString().replace("T", " ").slice(0, 19)} UTC (this browser’s clock).` : "Waiting for stored records."} {stale ? "Connection unavailable: these figures may be stale." : ""}</p>
    <div className="analytics-grid"><div className="metric-total"><p className="eyebrow">Requests in this selection</p><strong>{lastOk === null ? "—" : summary.total}</strong><p>{includeTests ? "Includes developer test records." : "Developer test records excluded."}</p></div><div><table><caption>Current request status</caption><thead><tr><th scope="col">Status</th><th scope="col">Requests</th></tr></thead><tbody>{STATUSES.map(status => <tr key={status}><th scope="row">{status === "acknowledged" ? "Accepted" : status === "cancelled" ? "Canceled" : status[0].toUpperCase() + status.slice(1)}</th><td>{lastOk === null ? "—" : summary.counts[status]}</td></tr>)}</tbody></table></div></div>
    <div className="duration-metrics"><div><h3>Average time to acceptance</h3><p>{duration(summary.acceptedSeconds)}</p><small>Dispatch → acceptance. {summary.acceptedSample} records with both timestamps.</small></div><div><h3>Average time to resolution</h3><p>{duration(summary.resolvedSeconds)}</p><small>Acceptance → resolution. {summary.resolvedSample} records with both timestamps.</small></div></div>
    <AnalyticsSummary range={range} includeTests={includeTests} metrics={summary} stale={stale} />
  </section>;
}
