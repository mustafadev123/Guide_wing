// Minimal client for the GuideWing backend (same REST endpoints the web pages use)
// plus the browser event stream (/ws/events) with automatic reconnection.

export type IncidentStatus = "pending" | "dispatched" | "acknowledged" | "cancelled" | "resolved";
export type RequestSource = "gesture" | "button" | "test" | "imessage";

export interface Location {
  source: "simulated" | "device" | "unavailable";
  landmark: string | null;
}
export interface Journey {
  id: string;
  status: "idle" | "active" | "paused" | "ended";
  armed: boolean;
  pause_reason: "user" | "obstruction" | "help_request" | null;
  route_progress: number;
  location: Location;
}
export interface Incident {
  id: string;
  journey_id: string;
  status: IncidentStatus;
  request_source: RequestSource;
  dispatched_at: string | null;
}
export interface SnapshotIncident {
  id: string;
  status: IncidentStatus;
  request_source: RequestSource;
  seconds_until_dispatch: number | null;
}
export interface Snapshot {
  boot_id: string;
  journey: Journey;
  active_incident: SnapshotIncident | null;
  last_incident: SnapshotIncident | null;
  vision: { obstruction_active: boolean };
}
export interface ServerEvent {
  boot_id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
}

export class BackendError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Backend {
  snapshot(): Promise<Snapshot>;
  createJourney(): Promise<Journey>;
  journeyAction(id: string, action: "start" | "pause" | "resume"): Promise<Journey>;
  requestHelp(journeyId: string, requestKey: string): Promise<{ incident: Incident; created: boolean }>;
  cancel(incidentId: string): Promise<{ incident: Incident; changed: boolean }>;
}

export class GuideWingClient implements Backend {
  private readonly base: string;
  private readonly timeoutMs: number;
  constructor(baseUrl: string, timeoutMs = 5000) {
    this.base = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new BackendError(res.status, typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`);
    return data as T;
  }

  snapshot() { return this.call<Snapshot>("GET", "/api/simulation/state?journey_id=current"); }
  createJourney() { return this.call<Journey>("POST", "/api/journeys"); }
  journeyAction(id: string, action: "start" | "pause" | "resume") {
    return this.call<Journey>("POST", `/api/journeys/${encodeURIComponent(id)}/${action}`);
  }
  requestHelp(journeyId: string, requestKey: string) {
    return this.call<{ incident: Incident; created: boolean }>("POST", "/api/incidents", {
      journey_id: journeyId, request_key: requestKey, request_source: "imessage",
    });
  }
  cancel(incidentId: string) {
    return this.call<{ incident: Incident; changed: boolean }>("POST", `/api/incidents/${encodeURIComponent(incidentId)}/cancel`);
  }

  /** Subscribe to /ws/events. Calls onOpen after every (re)connect so the caller can resync. */
  subscribe(onEvent: (e: ServerEvent) => void, onOpen: () => void, log: (msg: string) => void): () => void {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      ws = new WebSocket(this.base.replace(/^http/, "ws") + "/ws/events");
      ws.onmessage = (msg) => {
        const event = JSON.parse(String(msg.data)) as ServerEvent;
        if (event.type === "hello") { retry = 0; log("backend events connected"); onOpen(); return; }
        if (event.type !== "ping") onEvent(event);
      };
      ws.onclose = () => {
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        log(`backend events disconnected; retrying in ${retry} s`);
        timer = setTimeout(connect, retry * 1000);
      };
      ws.onerror = () => { /* onclose follows and schedules the retry */ };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }
}
