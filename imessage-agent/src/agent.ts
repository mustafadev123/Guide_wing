// GuideWing companion agent: platform-independent core.
// main.ts connects it to Photon Spectrum (iMessage) or the Spectrum terminal provider.
//
// Rules:
// - The GuideWing backend owns every decision (deadlines, dispatch, acceptance). The agent only
//   calls the same endpoints as the web page and relays updates.
// - Every update is sent once per conversation, keyed by incident id + status or obstacle id,
//   whether it comes from a command reply or from the backend event stream.
// - Only allowlisted senders may control the journey (when an allowlist is configured).

import { BackendError, type Backend, type Incident, type ServerEvent, type Snapshot } from "./guidewing.ts";
import * as say from "./messages.ts";

export type Command = "help" | "cancel" | "status" | "start" | "pause" | "resume" | "repeat" | "menu";

export function parseCommand(text: string): Command {
  const words = new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const has = (...w: string[]) => w.some((x) => words.has(x));
  if (has("cancel", "stop")) return "cancel"; // "cancel help" must cancel, never create
  if (has("help", "sos")) return "help";
  if (has("status", "update", "where")) return "status";
  if (has("start", "begin")) return "start";
  if (has("pause")) return "pause";
  if (has("resume", "continue")) return "resume";
  if (has("repeat", "again")) return "repeat";
  return "menu";
}

export interface Conversation {
  readonly id: string;
  send(text: string): Promise<unknown>;
}

export interface AgentOptions {
  /** E.164 numbers / emails allowed to control the journey; null = allow everyone (terminal dev only). */
  allowedSenders: Set<string> | null;
  log?: (message: string) => void;
}

export function maskSender(id: string | undefined): string {
  if (!id) return "unknown";
  return id.length <= 4 ? "****" : `${"*".repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

export class GuideWingAgent {
  private readonly conversations = new Map<string, Conversation>(); // sender id -> latest conversation
  private readonly announced = new Set<string>();
  private readonly lastMessage = new Map<string, string>(); // conversation id -> last update sent
  private readonly known = new Map<string, string>(); // incident id -> last status seen
  private readonly dispatched = new Set<string>(); // incident ids that reached dispatch
  private seeded = false;
  private readonly log: (message: string) => void;
  private readonly backend: Backend;
  private readonly options: AgentOptions;

  constructor(backend: Backend, options: AgentOptions) {
    this.backend = backend;
    this.options = options;
    this.log = options.log ?? (() => {});
  }

  isAllowed(senderId: string | undefined): boolean {
    return this.options.allowedSenders === null || (!!senderId && this.options.allowedSenders.has(senderId));
  }

  /** Handle one inbound text. Returns a direct reply, or null when the update was already sent. */
  async handleText(senderId: string | undefined, conversation: Conversation, text: string, messageId: string): Promise<string | null> {
    if (!this.isAllowed(senderId)) {
      this.log(`refused message from ${maskSender(senderId)}`);
      return say.NOT_ALLOWED;
    }
    this.conversations.set(senderId ?? conversation.id, conversation);
    const command = parseCommand(text);
    this.log(`command ${command} from ${maskSender(senderId)}`);
    try {
      return await this.run(command, conversation, messageId);
    } catch (e) {
      if (e instanceof BackendError) return `${e.message.replace(/\.$/, "")}. Reply STATUS for an update.`;
      this.log(`backend unreachable: ${(e as Error).name}`);
      return say.SERVER_DOWN;
    }
  }

  private async run(command: Command, conversation: Conversation, messageId: string): Promise<string | null> {
    if (command === "menu") return say.MENU;
    if (command === "repeat") return this.lastMessage.get(conversation.id) ?? "There is no message to repeat yet.";
    const snap = await this.backend.snapshot();
    const journey = snap.journey;
    switch (command) {
      case "status":
        return say.describeStatus(snap);
      case "start": {
        if (journey.status === "active" || journey.status === "paused") return `Your journey is already ${journey.status}. ${say.describeStatus(snap)}`;
        const id = journey.status === "ended" ? (await this.backend.createJourney()).id : journey.id;
        await this.backend.journeyAction(id, "start");
        return "Journey started. Movement and location are simulated. Reply HELP at any time to request assistance.";
      }
      case "pause":
        if (journey.status !== "active") return `Your journey is ${journey.status}, so there is nothing to pause.`;
        await this.backend.journeyAction(journey.id, "pause");
        return "Journey paused.";
      case "resume":
        if (journey.status !== "paused") return `Your journey is ${journey.status}, so there is nothing to resume.`;
        await this.backend.journeyAction(journey.id, "resume");
        return "Journey resumed.";
      case "help": {
        if (snap.active_incident) return `A help request is already ${say.describeStatus(snap).split("Help: ")[1]?.replace(/\.$/, "") ?? "active"}.`;
        if (!journey.armed) return journey.status === "ended" ? "This journey has ended. Reply START for a new journey, then HELP." : "Start your journey first: reply START, then HELP.";
        const { incident } = await this.backend.requestHelp(journey.id, `imessage-${messageId}`);
        this.relay(incident); // the update itself is the reply; sent once even if the event arrived first
        return null;
      }
      case "cancel": {
        const active = snap.active_incident;
        if (!active) return "There is no help request to cancel.";
        if (active.status === "acknowledged") return "This request was already accepted by a responder, so it can no longer be cancelled here.";
        const { incident } = await this.backend.cancel(active.id);
        this.relay(incident);
        return null;
      }
    }
  }

  /** Announce an incident status once (to every registered conversation). Returns true if sent now. */
  private relay(incident: Pick<Incident, "id" | "status" | "request_source" | "dispatched_at">): boolean {
    if (incident.dispatched_at || incident.status === "dispatched" || incident.status === "acknowledged") this.dispatched.add(incident.id);
    this.known.set(incident.id, incident.status);
    const text = say.incidentUpdate(incident.status, incident.request_source, this.dispatched.has(incident.id));
    return this.announce(`incident:${incident.id}:${incident.status}`, text);
  }

  private announce(key: string, text: string): boolean {
    if (this.announced.has(key)) return false;
    this.announced.add(key); // set before any await: concurrent relays of the same key send once
    for (const conversation of this.conversations.values()) {
      this.lastMessage.set(conversation.id, text);
      void conversation.send(text).catch((e) => this.log(`send failed: ${(e as Error).name}`));
    }
    return true;
  }

  /** Backend event from /ws/events. */
  handleEvent(event: ServerEvent): void {
    if (event.type === "incident.updated") {
      const payload = event.payload as { incident: Incident; transition: string };
      if (payload.transition === "snapshot_attached") return;
      this.relay(payload.incident);
    } else if (event.type === "vision.obstacle") {
      const p = event.payload as { observation_id: string; announce: boolean; journey_paused: boolean };
      if (p.announce) this.announce(`obstacle:${p.observation_id}`, say.obstacleWarning(p.journey_paused));
    } else if (event.type === "journey.updated") {
      const j = (event.payload as { journey: { id: string; status: string; route_progress: number } }).journey;
      if (j.status === "ended" && j.route_progress >= 1) this.announce(`journey:${j.id}:arrived`, say.ARRIVED);
    }
  }

  /**
   * Called on every (re)connect to the backend event stream. The first call only records the
   * current state (no replay). Later calls announce a status change that happened while
   * disconnected, so an acceptance is never silently missed.
   */
  async resync(): Promise<void> {
    let snap: Snapshot;
    try { snap = await this.backend.snapshot(); } catch { return; }
    const last = snap.last_incident;
    if (!this.seeded) {
      this.seeded = true;
      if (last) {
        this.announced.add(`incident:${last.id}:${last.status}`);
        this.known.set(last.id, last.status);
      }
      return;
    }
    if (last && this.known.get(last.id) !== last.status) {
      this.relay({ id: last.id, status: last.status, request_source: last.request_source, dispatched_at: null });
    }
  }
}

/**
 * Hard cap on outgoing messages per conversation, whatever the cause: at most `burst` messages in
 * 10 seconds and `perMinute` in 60 seconds. Excess sends are dropped (and logged) instead of
 * risking a message loop with a real person.
 */
export class SendLimiter {
  private readonly sent = new Map<string, number[]>();
  private readonly burst: number;
  private readonly perMinute: number;
  private readonly now: () => number;

  constructor(burst = 4, perMinute = 15, now: () => number = Date.now) {
    this.burst = burst;
    this.perMinute = perMinute;
    this.now = now;
  }

  allow(conversationId: string): boolean {
    const t = this.now();
    const recent = (this.sent.get(conversationId) ?? []).filter((x) => t - x < 60_000);
    if (recent.filter((x) => t - x < 10_000).length >= this.burst || recent.length >= this.perMinute) {
      this.sent.set(conversationId, recent);
      return false;
    }
    recent.push(t);
    this.sent.set(conversationId, recent);
    return true;
  }
}
