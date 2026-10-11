import type { Incident, IncidentStatus, AnalyticsReport } from "./api";

export type AnalyticsRange = "day" | "week" | "loaded";
const STATUSES: IncidentStatus[] = ["pending", "dispatched", "acknowledged", "resolved", "cancelled"];
function elapsed(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
export interface AnalyticsMetrics { total: number; counts: Record<IncidentStatus, number>; acceptedSeconds: number | null; acceptedSample: number; resolvedSeconds: number | null; resolvedSample: number; }

export function summarizeIncidents(incidents: Incident[], range: AnalyticsRange, includeTests: boolean, asOf: number) {
  const from = range === "loaded" ? -Infinity : asOf - (range === "day" ? 24 : 168) * 3600_000;
  const selected = incidents.filter(i => {
    const created = Date.parse(i.created_at);
    return Number.isFinite(created) && created >= from && created <= asOf && (includeTests || !i.is_test);
  });
  const counts = Object.fromEntries(STATUSES.map(status => [status, selected.filter(i => i.status === status).length])) as Record<IncidentStatus, number>;
  const acceptance = selected.map(i => elapsed(i.dispatched_at, i.acknowledged_at)).filter((n): n is number => n !== null);
  const resolution = selected.map(i => elapsed(i.acknowledged_at, i.resolved_at)).filter((n): n is number => n !== null);
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { total: selected.length, counts, acceptedSeconds: average(acceptance), acceptedSample: acceptance.length, resolvedSeconds: average(resolution), resolvedSample: resolution.length };
}

export function summaryMatches(current: AnalyticsMetrics, saved: AnalyticsReport["metrics"]) {
  const rounded = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;
  return current.total === saved.total && Object.entries(current.counts).every(([status, count]) => saved.counts[status as IncidentStatus] === count)
    && rounded(current.acceptedSeconds) === saved.accepted_seconds && current.acceptedSample === saved.accepted_sample
    && rounded(current.resolvedSeconds) === saved.resolved_seconds && current.resolvedSample === saved.resolved_sample;
}
