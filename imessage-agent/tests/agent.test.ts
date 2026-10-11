import assert from "node:assert/strict";
import { test } from "node:test";
import { GuideWingAgent, SendLimiter, maskSender, parseCommand, responderName } from "../src/agent.ts";
import type { Backend, Incident, ServerEvent } from "../src/guidewing.ts";
import * as say from "../src/messages.ts";

const A = "+15550001111";
const B = "+15550002222";

function inc(status: Incident["status"], over: Partial<Incident> = {}): Incident {
  return {
    id: "i1", journey_id: "j1", status, request_source: "button", created_at: "2026-10-11T07:00:00Z",
    dispatched_at: status === "pending" ? null : "2026-10-11T07:00:10Z", acknowledged_at: null, cancelled_at: null,
    resolved_at: null, location: { source: "simulated", landmark: "Library crossing" }, responder: null,
    snapshot_url: null, is_test: false, ...over,
  };
}

class FakeBackend implements Backend {
  list: Incident[] = [];
  calls: string[] = [];
  down = false;
  onCall: () => void = () => {};
  async incidents() { if (this.down) throw new TypeError("fetch failed"); return structuredClone(this.list); }
  async accept(id: string, responder: string) {
    this.calls.push(`accept:${id}:${responder}`);
    this.onCall();
    const cur = this.list.find((i) => i.id === id)!;
    if (cur.status !== "dispatched") return { incident: structuredClone(cur), changed: false };
    Object.assign(cur, { status: "acknowledged", responder, acknowledged_at: "2026-10-11T07:00:20Z" });
    return { incident: structuredClone(cur), changed: true };
  }
  async resolve(id: string) {
    this.calls.push(`resolve:${id}`);
    this.onCall();
    const cur = this.list.find((i) => i.id === id)!;
    Object.assign(cur, { status: "resolved", resolved_at: "2026-10-11T07:01:00Z" });
    return { incident: structuredClone(cur), changed: true };
  }
}

function responders(agent: GuideWingAgent) {
  const sent: Record<string, string[]> = { [A]: [], [B]: [] };
  const convo = (who: string) => ({ id: `space-${who}`, send: async (t: string) => { sent[who]!.push(t); } });
  const text = (who: string, t: string) => agent.handleText(who, convo(who), t);
  return { sent, text };
}

const event = (incident: Incident, transition: string = incident.status): ServerEvent =>
  ({ boot_id: "b", sequence: 1, type: "incident.updated", payload: { incident, transition } });
const tick = () => new Promise((r) => setImmediate(r));

test("parseCommand: responder keywords", () => {
  assert.equal(parseCommand("ACCEPT"), "accept");
  assert.equal(parseCommand("yes, on my way"), "accept");
  assert.equal(parseCommand("Resolved!"), "resolve");
  assert.equal(parseCommand("done"), "resolve");
  assert.equal(parseCommand("details?"), "details");
  assert.equal(parseCommand("list"), "list");
  assert.equal(parseCommand("status"), "list");
  assert.equal(parseCommand("hi there"), "menu");
});

test("unregistered senders are refused without touching the backend", async () => {
  const b = new FakeBackend();
  b.list = [inc("dispatched")];
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A]) });
  assert.equal(await agent.handleText("+19998887777", { id: "x", send: async () => {} }, "accept"), say.NOT_ALLOWED);
  assert.deepEqual(b.calls, []);
});

test("a dispatched request is pushed once to every registered responder; pending is not", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A, B]) });
  const { sent, text } = responders(agent);
  await text(A, "list");
  await text(B, "list");
  agent.handleEvent(event(inc("pending"), "created"));
  agent.handleEvent(event(inc("dispatched")));
  agent.handleEvent(event(inc("dispatched"), "snapshot_attached"));
  agent.handleEvent(event(inc("dispatched")));
  await tick();
  assert.deepEqual(sent[A], [say.newRequest(inc("dispatched"))]);
  assert.deepEqual(sent[B], [say.newRequest(inc("dispatched"))]);
  assert.match(sent[A]![0]!, /Library crossing \(simulated location\).*Help button.*Reply ACCEPT/);
});

test("accept: first responder wins, the other is told; the acceptor is not pushed their own action", async () => {
  const b = new FakeBackend();
  b.list = [inc("dispatched")];
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A, B]) });
  const { sent, text } = responders(agent);
  await text(A, "list");
  await text(B, "list");
  // the backend event arrives before the HTTP reply returns
  b.onCall = () => agent.handleEvent(event(inc("acknowledged", { responder: responderName(A) })));
  assert.match(await text(A, "accept"), /^You accepted the request near Library crossing.*Reply RESOLVED/);
  assert.deepEqual(b.calls, ["accept:i1:iMessage responder (…1111)"]);
  await tick();
  assert.deepEqual(sent[A], []);
  assert.deepEqual(sent[B], ["The request near Library crossing (simulated location) was accepted by iMessage responder (…1111). No action needed."]);
  assert.equal(await text(B, "accept"), "Already accepted by iMessage responder (…1111).");
  assert.match(await text(B, "resolved"), /accepted by iMessage responder \(…1111\), so they resolve it/);
  assert.match(await text(A, "accept"), /You already accepted/);
});

test("resolve: only your accepted request; others are told", async () => {
  const b = new FakeBackend();
  b.list = [inc("dispatched")];
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A, B]) });
  const { sent, text } = responders(agent);
  await text(B, "list");
  assert.match(await text(A, "resolved"), /Accept the request first/);
  await text(A, "accept");
  assert.equal(await text(A, "done"), say.youResolved(b.list[0]!));
  agent.handleEvent(event(b.list[0]!)); // late resolved event: not repeated to A
  await tick();
  assert.deepEqual(sent[A], []);
  assert.deepEqual(sent[B], [say.acceptedByOther(inc("acknowledged", { responder: responderName(A) })), say.resolvedByOther(b.list[0]!)]);
  assert.equal(await text(A, "resolved"), "You have no accepted request to resolve.");
});

test("accept during the cancellation window explains the wait; nothing open is said plainly", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A]) });
  const { text } = responders(agent);
  assert.equal(await text(A, "accept"), "There is no request waiting for a responder.");
  b.list = [inc("pending")];
  assert.match(await text(A, "accept"), /10-second cancellation window/);
  assert.deepEqual(b.calls, []);
});

test("user cancellation after dispatch is pushed; cancellation inside the window is not", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A]) });
  const { sent, text } = responders(agent);
  await text(A, "list");
  agent.handleEvent(event(inc("cancelled", { id: "i0", dispatched_at: null })));
  agent.handleEvent(event(inc("cancelled")));
  await tick();
  assert.deepEqual(sent[A], ["The user cancelled the request near Library crossing (simulated location). No action needed."]);
});

test("details and list show the recorded facts", async () => {
  const b = new FakeBackend();
  b.list = [inc("dispatched", { snapshot_url: "/api/incidents/i1/snapshot" })];
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A]) });
  const { text } = responders(agent);
  const d = await text(A, "details");
  assert.match(d, /Status: dispatched\. Requested with the Help button\./);
  assert.match(d, /Requested 07:00:00 UTC, dispatched 07:00:10 UTC/);
  assert.match(d, /blurred camera snapshot/);
  assert.match(await text(A, "list"), /1\) near Library crossing: waiting for acceptance/);
});

test("first resync only seeds; a later resync pushes a request missed while disconnected", async () => {
  const b = new FakeBackend();
  b.list = [inc("resolved", { id: "old" })];
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A]) });
  const { sent, text } = responders(agent);
  await text(A, "list");
  await agent.resync();
  b.list.unshift(inc("dispatched"));
  await agent.resync();
  await agent.resync();
  await tick();
  assert.deepEqual(sent[A], [say.newRequest(inc("dispatched"))]);
});

test("server unreachable is said plainly", async () => {
  const b = new FakeBackend();
  b.down = true;
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([A]) });
  assert.equal(await responders(agent).text(A, "accept"), say.SERVER_DOWN);
});

test("sender numbers are masked in logs and responder names", () => {
  assert.equal(maskSender("+15550001111"), "********1111");
  assert.equal(maskSender(undefined), "unknown");
  assert.equal(responderName("+15550001111"), "iMessage responder (…1111)");
});

test("send limiter caps bursts and per-minute volume per conversation (loop protection)", () => {
  let now = 0;
  const limiter = new SendLimiter(4, 15, () => now);
  const burst = Array.from({ length: 10 }, () => limiter.allow("c1"));
  assert.deepEqual(burst, [true, true, true, true, false, false, false, false, false, false]);
  assert.equal(limiter.allow("c2"), true); // other conversations are unaffected
  let allowed = 4;
  for (let s = 10; s < 60; s += 3) { now = s * 1000; if (limiter.allow("c1")) allowed++; }
  assert.equal(allowed, 15); // never more than 15 per minute, even with steady traffic
  now = 200_000;
  assert.equal(limiter.allow("c1"), true); // recovers after quiet time
});
