// Minimal client for the GuideWing backend: the responder endpoints the /responder desk uses,
// plus the browser event stream (/ws/events) with automatic reconnection.

export type IncidentStatus = "pending" | "dispatched" | "acknowledged" | "cancelled" | "resolved";
export type RequestSource = "gesture" | "button" | "test" | "imessage" | "voice";

export interface Location {
  source: "simulated" | "device" | "unavailable";
  landmark: string | null;
  latitude?: number | null;
  longitude?: number | null;
}
export interface Incident {
  id: string;
  journey_id: string;
  status: IncidentStatus;
  request_source: RequestSource;
  created_at: string;
  dispatched_at: string | null;
  acknowledged_at: string | null;
  cancelled_at: string | null;
  resolved_at: string | null;
  location: Location;
  responder: string | null;
  snapshot_url: string | null;
  is_test: boolean;
  /** Assigned responder reported "On my way" (a progress update; status stays acknowledged). */
  on_my_way_at?: string | null;
}
export interface ActionResult { incident: Incident; changed: boolean; responder_token?: string | null }
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

/** Responder-side operations: the same endpoints the /responder desk uses. */
export interface Backend {
  incidents(status?: IncidentStatus): Promise<Incident[]>;
  accept(incidentId: string, responder: string): Promise<ActionResult>;
  resolve(incidentId: string): Promise<ActionResult>;
  /** Requires the token returned by this responder's own successful accept. */
  onMyWay(incidentId: string, responderToken: string): Promise<ActionResult>;
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

  incidents(status?: IncidentStatus) {
    return this.call<Incident[]>("GET", `/api/incidents?limit=50${status ? `&status=${status}` : ""}`);
  }
  accept(incidentId: string, responder: string) {
    return this.call<ActionResult>("POST", `/api/incidents/${encodeURIComponent(incidentId)}/accept`, { responder });
  }
  resolve(incidentId: string) {
    return this.call<ActionResult>("POST", `/api/incidents/${encodeURIComponent(incidentId)}/resolve`);
  }
  onMyWay(incidentId: string, responderToken: string) {
    return this.call<ActionResult>("POST", `/api/incidents/${encodeURIComponent(incidentId)}/on-my-way`, { responder_token: responderToken });
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
