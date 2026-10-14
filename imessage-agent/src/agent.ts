// GuideWing responder agent: platform-independent core.
// main.ts connects it to Photon Spectrum (iMessage) or the Spectrum terminal provider.
//
// Registered responders get new help requests in iMessage and can accept and resolve them there.
// Rules:
// - The GuideWing backend owns every decision (cancellation window, dispatch, who accepted first).
//   The agent only calls the same endpoints as the /responder desk and relays updates.
// - Every update is sent once, keyed by incident id + status, whether the change came from
//   iMessage, the web desk or the user. A responder is not told about their own action twice.
// - Only allowlisted senders may act as responders (when an allowlist is configured).

import { BackendError, type Backend, type Incident, type ServerEvent } from "./guidewing.ts";
import * as say from "./messages.ts";

export type Command = "accept" | "on_my_way" | "resolve" | "details" | "list" | "menu";

export function parseCommand(text: string): Command {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = new Set(normalized.split(" ").filter(Boolean));
  const has = (...w: string[]) => w.some((x) => words.has(x));
  if (has("resolve", "resolved", "done", "complete", "completed", "handled")) return "resolve";
  // An explicit accept word wins ("yes, on my way" still accepts, as before); plain "on my way" is the
  // progress update. The older accept aliases "omw" and "coming" are unchanged.
  if (has("accept", "accepted", "yes")) return "accept";
  if (/(^| )on my way( |$)/.test(normalized) || has("onmyway")) return "on_my_way";
  if (has("omw", "coming")) return "accept";
  if (has("details", "detail", "info", "where", "more")) return "details";
  if (has("list", "status", "open", "requests")) return "list";
  return "menu";
}

export interface Conversation {
  readonly id: string;
  send(text: string): Promise<unknown>;
}

export interface AgentOptions {
  /** E.164 numbers allowed to act as responders; null = allow everyone (terminal dev only). */
  allowedSenders: Set<string> | null;
  log?: (message: string) => void;
}

export function maskSender(id: string | undefined): string {
  if (!id) return "unknown";
  return id.length <= 4 ? "****" : `${"*".repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

/** Name recorded on the incident (shown on /user and /responder). Never the full number. */
export function responderName(senderId: string | undefined): string {
  return senderId && senderId.length > 4 ? `iMessage responder (…${senderId.slice(-4)})` : "iMessage responder";
}

const OPEN = new Set(["pending", "dispatched", "acknowledged"]);
const signature = (i: Incident) => `${i.status}${i.on_my_way_at ? "+on_my_way" : ""}`;
const byAge = (a: Incident, b: Incident) => Date.parse(a.created_at) - Date.parse(b.created_at);

export class GuideWingAgent {
  private readonly conversations = new Map<string, Conversation>(); // sender id -> latest conversation
  private readonly announced = new Set<string>(); // incident:id:status already pushed
  private readonly ownActions = new Map<string, string>(); // incident:id:status -> sender who did it here
  private readonly known = new Map<string, string>(); // incident id -> last status (+on my way) seen
  // incident id -> token from a successful accept made here; proves to the backend who accepted.
  // Memory only: after an agent restart On my way is refused (the user is still told it was accepted).
  private readonly tokens = new Map<string, { who: string; token: string }>();
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

  /** Handle one inbound text from a responder. Returns the direct reply. */
  async handleText(senderId: string | undefined, conversation: Conversation, text: string): Promise<string> {
    if (!this.isAllowed(senderId)) {
      this.log(`refused message from ${maskSender(senderId)}`);
      return say.NOT_ALLOWED;
    }
    const who = senderId ?? conversation.id;
    this.conversations.set(who, conversation);
    const command = parseCommand(text);
    this.log(`command ${command} from ${maskSender(senderId)}`);
    try {
      return await this.run(command, who);
    } catch (e) {
      if (e instanceof BackendError) return `${e.message.replace(/\.$/, "")}. Reply LIST to see open requests.`;
      this.log(`backend unreachable: ${(e as Error).name}`);
      return say.SERVER_DOWN;
    }
  }

  private async run(command: Command, who: string): Promise<string> {
    if (command === "menu") return say.MENU;
    const me = responderName(who);
    const open = (await this.backend.incidents()).filter((i) => OPEN.has(i.status)).sort(byAge);
    const mine = open.filter((i) => i.status === "acknowledged" && i.responder === me);
    const waiting = open.filter((i) => i.status === "dispatched");
    switch (command) {
      case "list":
        return say.list(open);
      case "details": {
        const focus = mine[0] ?? waiting[0] ?? open[0] ?? (await this.backend.incidents())[0];
        return focus ? say.details(focus) : "There are no help requests yet.";
      }
      case "accept": {
        const target = waiting[0];
        if (!target) {
          if (mine[0]) return `You already accepted the request near ${say.where(mine[0])}. Reply RESOLVED when it is handled.`;
          const pending = open.find((i) => i.status === "pending");
          if (pending) return say.pendingNote(pending);
          const taken = open.find((i) => i.status === "acknowledged");
          return taken ? say.alreadyAccepted(taken) : "There is no request waiting for a responder.";
        }
        return this.act(who, target, "acknowledged", async () => {
          const result = await this.backend.accept(target.id, me);
          if (result.changed && result.responder_token) this.tokens.set(target.id, { who, token: result.responder_token });
          return result;
        }, say.youAccepted, say.alreadyAccepted);
      }
      case "on_my_way": {
        const target = mine[0];
        if (!target) {
          if (waiting[0]) return `Accept the request first: reply ACCEPT. ${say.where(waiting[0])} is waiting.`;
          const taken = open.find((i) => i.status === "acknowledged");
          return taken ? `That request was accepted by ${taken.responder ?? "another responder"}, so only they can send On my way.` : "You have no accepted request.";
        }
        if (target.on_my_way_at) return say.alreadyOnMyWay();
        const held = this.tokens.get(target.id);
        if (!held || held.who !== who) return say.onMyWayUnverified(target);
        return this.act(who, target, "on_my_way", () => this.backend.onMyWay(target.id, held.token), say.youOnMyWay, say.alreadyOnMyWay);
      }
      case "resolve": {
        const target = mine[0];
        if (!target) {
          if (waiting[0]) return `Accept the request first: reply ACCEPT. ${say.where(waiting[0])} is waiting.`;
          const taken = open.find((i) => i.status === "acknowledged");
          return taken ? `That request was accepted by ${taken.responder ?? "another responder"}, so they resolve it.` : "You have no accepted request to resolve.";
        }
        return this.act(who, target, "resolved", () => this.backend.resolve(target.id), say.youResolved,
          (i) => `That request is already ${i.status}.`);
      }
    }
  }

  /**
   * Perform a responder action. The actor is recorded before the call so the backend event,
   * which can arrive before the HTTP reply, is not pushed back to the same person.
   */
  private async act(who: string, target: Incident, status: string,
    call: () => Promise<{ incident: Incident; changed: boolean }>,
    done: (i: Incident) => string, lost: (i: Incident) => string): Promise<string> {
    const key = `incident:${target.id}:${status}`;
    this.ownActions.set(key, who);
    try {
      const { incident, changed } = await call();
      if (!changed) { this.ownActions.delete(key); return lost(incident); }
      this.relay(incident);
      return done(incident);
    } catch (e) {
      this.ownActions.delete(key);
      throw e;
    }
  }

  /** Push an incident status (or the On my way update) to every responder once. Returns true if sent now. */
  private relay(incident: Incident, kind: string = incident.status): boolean {
    this.known.set(incident.id, signature(incident));
    const text = kind === "on_my_way" ? say.onMyWayByOther(incident) : this.pushText(incident);
    if (!text) return false;
    const key = `incident:${incident.id}:${kind}`;
    if (this.announced.has(key)) return false;
    this.announced.add(key); // set before any await: concurrent relays of the same key send once
    const actor = this.ownActions.get(key);
    for (const [who, conversation] of this.conversations) {
      if (who === actor) continue; // they already got the direct reply
      void conversation.send(text).catch((e) => this.log(`send failed: ${(e as Error).name}`));
    }
    return true;
  }

  private pushText(i: Incident): string | null {
    switch (i.status) {
      case "dispatched": return say.newRequest(i);
      case "acknowledged": return say.acceptedByOther(i);
      case "resolved": return say.resolvedByOther(i);
      case "cancelled": return i.dispatched_at ? say.cancelledByUser(i) : null; // never reached responders
      default: return null; // pending: still in the user's cancellation window
    }
  }

  /** Backend event from /ws/events. */
  handleEvent(event: ServerEvent): void {
    if (event.type !== "incident.updated") return;
    const payload = event.payload as { incident: Incident; transition: string };
    if (payload.transition === "snapshot_attached") return;
    this.relay(payload.incident, payload.transition === "on_my_way" ? "on_my_way" : payload.incident.status);
  }

  /**
   * Called on every (re)connect to the backend event stream. The first call only records the
   * current state (no replay; LIST shows what is open). Later calls push changes that happened
   * while disconnected, so a new request is never silently missed.
   */
  async resync(): Promise<void> {
    let recent: Incident[];
    try { recent = await this.backend.incidents(); } catch { return; }
    if (!this.seeded) {
      this.seeded = true;
      for (const i of recent) {
        this.known.set(i.id, signature(i));
        this.announced.add(`incident:${i.id}:${i.status}`);
        if (i.on_my_way_at) this.announced.add(`incident:${i.id}:on_my_way`);
      }
      return;
    }
    for (const i of recent.sort(byAge)) {
      const before = this.known.get(i.id);
      if (before === signature(i)) continue;
      if (before?.split("+")[0] !== i.status) this.relay(i);
      if (i.on_my_way_at && i.status === "acknowledged") this.relay(i, "on_my_way");
      this.known.set(i.id, signature(i));
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
