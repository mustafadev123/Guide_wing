// Typed client for the GuideWing backend: schemas.py plus analytics.py wire types.

export type LocationSource = "simulated" | "device" | "unavailable";
export type JourneyStatus = "idle" | "active" | "paused" | "ended";
export type IncidentStatus = "pending" | "dispatched" | "acknowledged" | "cancelled" | "resolved";
export type InputMode = "live" | "replay" | "test" | "unavailable";
export type RequestSource = "gesture" | "button" | "test";

export interface Location {
  source: LocationSource;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  landmark: string | null;
  observed_at: string | null;
}

export interface Journey {
  id: string;
  status: JourneyStatus;
  armed: boolean;
  pause_reason: "user" | "obstruction" | "help_request" | null;
  route_id: string;
  route_progress: number;
  waypoint: string | null;
  waypoint_index: number | null;
  location: Location;
  created_at: string;
  version: number;
}

export interface Incident {
  id: string;
  journey_id: string;
  request_key: string;
  kind: "user_sos";
  status: IncidentStatus;
  request_source: RequestSource;
  created_at: string;
  dispatch_at: string;
  dispatched_at: string | null;
  acknowledged_at: string | null;
  cancelled_at: string | null;
  resolved_at: string | null;
  updated_at: string;
  location: Location;
  snapshot_url: string | null;
  responder: string | null;
  version: number;
  is_test: boolean;
}

export interface SnapshotIncident {
  id: string;
  status: IncidentStatus;
  request_source: RequestSource;
  created_at: string;
  dispatch_at: string;
  seconds_until_dispatch: number | null;
  acknowledged_at: string | null;
  updated_at: string;
  version: number;
}

export interface SimulationState {
  schema_version: number;
  data_source: "live" | "mock";
  boot_id: string;
  revision: number;
  sampled_at: string;
  journey: Journey;
  active_incident: SnapshotIncident | null;
  last_incident: SnapshotIncident | null;
  vision: {
    input_mode: InputMode;
    ready: boolean;
    obstruction_active: boolean;
    obstruction_source: InputMode | null;
    last_observed_at: string | null;
    error: string | null;
  };
}

export interface VisionStatus {
  input_mode: InputMode;
  ready: boolean;
  source_label: string | null;
  error: string | null;
  last_observed_at: string | null;
  frame_age_s: number | null;
  fps: number | null;
  inference_ms: number | null;
  obstruction_active: boolean;
  obstruction_source: InputMode | null;
  gesture_armed: boolean;
  gesture_hold_progress: number;
}

export interface RouteInfo {
  route_id: string;
  duration_s: number;
  waypoints: { name: string; latitude: number | null; longitude: number | null; progress: number }[];
}

export interface IncidentResult {
  incident: Incident;
  created: boolean;
  changed: boolean;
}

export interface AnalyticsConfiguration {
  configured: boolean;
  provider: string | null;
  model: string | null;
  record_limit: number;
}

export interface AnalyticsReport {
  job_id: string;
  status: "pending" | "ready" | "not_configured" | "empty" | "failed" | "rejected";
  provider: "gemini" | "unavailable";
  model: string | null;
  range: "day" | "week" | "loaded";
  include_tests: boolean;
  as_of: string;
  from_at: string | null;
  scope: string;
  metrics: {
    total: number;
    counts: Record<IncidentStatus, number>;
    accepted_seconds: number | null;
    accepted_sample: number;
    resolved_seconds: number | null;
    resolved_sample: number;
  };
  text: string | null;
  sections?: { overview: string; response_times: string; next_check: string } | null;
  reason: string | null;
  cached: boolean;
  retry_after_s: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
  const res = await fetch(path, {
    method,
    signal: controller.signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail, data);
  }
  return data as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  analyticsConfiguration: () => call<AnalyticsConfiguration>("GET", "/api/analytics/config"),
  generateAnalyticsSummary: (range: AnalyticsReport["range"], includeTests: boolean) =>
    call<AnalyticsReport>("POST", "/api/analytics/summary", { range, include_tests: includeTests }),
  analyticsSummary: (id: string) => call<AnalyticsReport>("GET", `/api/analytics/summary/${encodeURIComponent(id)}`),
  snapshot: (journeyId = "current") =>
    call<SimulationState>("GET", `/api/simulation/state?journey_id=${encodeURIComponent(journeyId)}`),
  route: () => call<RouteInfo>("GET", "/api/simulation/route"),
  currentJourney: () => call<Journey>("GET", "/api/journeys/current"),
  createJourney: () => call<Journey>("POST", "/api/journeys"),
  journeyAction: (id: string, action: "start" | "pause" | "resume" | "end") =>
    call<Journey>("POST", `/api/journeys/${id}/${action}`),
  requestHelp: (journeyId: string, requestKey: string) =>
    call<IncidentResult>("POST", "/api/incidents", {
      journey_id: journeyId,
      request_key: requestKey,
      request_source: "button",
    }),
  incidents: (limit = 50) => call<Incident[]>("GET", `/api/incidents?limit=${Math.max(1, Math.min(500, limit))}`),
  incident: (id: string) => call<Incident & { timeline: { type: string; at: string; detail: string | null }[] }>("GET", `/api/incidents/${id}`),
  cancel: (id: string) => call<IncidentResult>("POST", `/api/incidents/${id}/cancel`),
  accept: (id: string, responder: string) => call<IncidentResult>("POST", `/api/incidents/${id}/accept`, { responder }),
  resolve: (id: string) => call<IncidentResult>("POST", `/api/incidents/${id}/resolve`),
  briefing: (id: string) =>
    call<{ provider: string; text: string; deterministic: string; ai_status: string; ai_reason?: string }>("GET", `/api/incidents/${id}/briefing`),
  vision: () => call<VisionStatus>("GET", "/api/vision/status"),
  devReset: () => call<Journey>("POST", "/api/dev/reset"),
  devVision: (kind: "obstruction" | "clear" | "palm") => call<unknown>("POST", `/api/dev/vision/${kind}`),
};

export function newRequestKey(prefix: string): string {
  // randomUUID requires HTTPS, but a phone on the demo LAN may use HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleTimeString()} (${iso.slice(11, 19)} UTC)`;
}

export function describeLocation(loc: Location): string {
  if (loc.source === "unavailable") return "Location unavailable";
  const label = loc.source === "simulated" ? "Simulated location" : "Device location";
  const coords =
    loc.latitude !== null && loc.longitude !== null ? ` (${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)})` : "";
  return `${label}: near ${loc.landmark ?? "unknown landmark"}${coords}`;
}

export const MODE_LABEL: Record<InputMode, string> = {
  live: "LIVE camera",
  replay: "REPLAY footage",
  test: "TEST input",
  unavailable: "Camera unavailable",
};
