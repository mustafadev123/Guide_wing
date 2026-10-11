import assert from "node:assert/strict";
import { test } from "node:test";
import { GuideWingAgent, SendLimiter, maskSender, parseCommand } from "../src/agent.ts";
import type { Backend, Incident, Journey, ServerEvent, Snapshot } from "../src/guidewing.ts";
import * as say from "../src/messages.ts";

const ME = "+15550001111";

function journey(over: Partial<Journey> = {}): Journey {
  return { id: "j1", status: "active", armed: true, pause_reason: null, route_progress: 0.2,
    location: { source: "simulated", landmark: "Library crossing" }, ...over };
}

class FakeBackend implements Backend {
  snap: Snapshot = { boot_id: "b", journey: journey(), active_incident: null, last_incident: null, vision: { obstruction_active: false } };
  calls: string[] = [];
  down = false;
  async snapshot() { if (this.down) throw new TypeError("fetch failed"); this.calls.push("snapshot"); return structuredClone(this.snap); }
  async createJourney() { this.calls.push("createJourney"); return journey({ id: "j2", status: "idle", armed: false }); }
  async journeyAction(id: string, action: string) { this.calls.push(`${action}:${id}`); return journey({ id }); }
  async requestHelp(journeyId: string, key: string) {
    this.calls.push(`help:${journeyId}:${key}`);
    return { incident: inc("pending"), created: true };
  }
  async cancel(id: string) { this.calls.push(`cancel:${id}`); return { incident: inc("cancelled", this.snap.active_incident?.status === "dispatched"), changed: true }; }
}

function inc(status: Incident["status"], wasDispatched = false): Incident {
  return { id: "i1", journey_id: "j1", status, request_source: "imessage", dispatched_at: wasDispatched || status === "dispatched" ? "t" : null };
}

function conversation() {
  const sent: string[] = [];
  return { sent, convo: { id: "space-1", send: async (t: string) => { sent.push(t); } } };
}

const event = (type: string, payload: Record<string, unknown>): ServerEvent => ({ boot_id: "b", sequence: 1, type, payload });

test("parseCommand: deliberate keywords; cancel wins over help", () => {
  assert.equal(parseCommand("HELP"), "help");
  assert.equal(parseCommand("I need help please!"), "help");
  assert.equal(parseCommand("sos"), "help");
  assert.equal(parseCommand("cancel help"), "cancel");
  assert.equal(parseCommand("Stop"), "cancel");
  assert.equal(parseCommand("status?"), "status");
  assert.equal(parseCommand("start"), "start");
  assert.equal(parseCommand("resume"), "resume");
  assert.equal(parseCommand("hi there"), "menu");
  assert.equal(parseCommand("?"), "menu");
});

test("unregistered senders are refused without touching the backend", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { convo } = conversation();
  assert.equal(await agent.handleText("+19998887777", convo, "help", "m1"), say.NOT_ALLOWED);
  assert.deepEqual(b.calls, []);
});

test("help needs a started journey", async () => {
  const b = new FakeBackend();
  b.snap.journey = journey({ status: "idle", armed: false });
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { convo } = conversation();
  assert.match((await agent.handleText(ME, convo, "help", "m1"))!, /reply START/i);
});

test("help creates one imessage request keyed by message id; update sent once despite the event race", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { sent, convo } = conversation();
  // backend event arrives before the HTTP reply returns
  b.requestHelp = async (journeyId, key) => {
    b.calls.push(`help:${journeyId}:${key}`);
    agent.handleEvent(event("incident.updated", { incident: inc("pending"), transition: "created" }));
    return { incident: inc("pending"), created: true };
  };
  agent["conversations"].set(ME, convo); // already registered conversation
  assert.equal(await agent.handleText(ME, convo, "help", "msg-42"), null);
  assert.ok(b.calls.includes("help:j1:imessage-msg-42"));
  agent.handleEvent(event("incident.updated", { incident: inc("pending"), transition: "created" })); // duplicate event
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [say.incidentUpdate("pending", "imessage", false)]);
});

test("dispatch and acceptance are pushed once each; snapshot attachments are ignored", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { sent, convo } = conversation();
  await agent.handleText(ME, convo, "status", "m1"); // registers the conversation
  for (const transition of ["dispatched", "snapshot_attached", "dispatched"]) {
    agent.handleEvent(event("incident.updated", { incident: inc("dispatched"), transition }));
  }
  agent.handleEvent(event("incident.updated", { incident: inc("acknowledged", true), transition: "acknowledged" }));
  agent.handleEvent(event("incident.updated", { incident: inc("acknowledged", true), transition: "acknowledged" }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, ["Your help request was sent to the responder. Waiting for acceptance.", "A responder accepted your request."]);
  assert.equal(await agent.handleText(ME, convo, "repeat", "m2"), "A responder accepted your request.");
});

test("cancel rules follow the backend lifecycle", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { sent, convo } = conversation();
  assert.equal(await agent.handleText(ME, convo, "cancel", "m1"), "There is no help request to cancel.");
  b.snap.active_incident = { id: "i1", status: "acknowledged", request_source: "imessage", seconds_until_dispatch: null };
  assert.match((await agent.handleText(ME, convo, "cancel", "m2"))!, /already accepted/);
  b.snap.active_incident = { id: "i1", status: "dispatched", request_source: "imessage", seconds_until_dispatch: null };
  assert.equal(await agent.handleText(ME, convo, "cancel", "m3"), null);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, ["Help request cancelled. The responder was notified."]);
});

test("obstacle warnings only when the backend says to announce", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { sent, convo } = conversation();
  await agent.handleText(ME, convo, "status", "m1");
  agent.handleEvent(event("vision.obstacle", { observation_id: "o1", announce: false, journey_paused: false }));
  agent.handleEvent(event("vision.obstacle", { observation_id: "o2", announce: true, journey_paused: true }));
  agent.handleEvent(event("vision.obstacle", { observation_id: "o2", announce: true, journey_paused: true }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [say.obstacleWarning(true)]);
});

test("first resync only seeds; a later resync announces a change missed while disconnected", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { sent, convo } = conversation();
  await agent.handleText(ME, convo, "status", "m1");
  b.snap.last_incident = { id: "i9", status: "dispatched", request_source: "button", seconds_until_dispatch: null };
  await agent.resync();
  b.snap.last_incident = { id: "i9", status: "acknowledged", request_source: "button", seconds_until_dispatch: null };
  await agent.resync();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, ["A responder accepted your request."]);
});

test("server unreachable is said plainly; status labels the simulated location", async () => {
  const b = new FakeBackend();
  const agent = new GuideWingAgent(b, { allowedSenders: new Set([ME]) });
  const { convo } = conversation();
  assert.match((await agent.handleText(ME, convo, "status", "m1"))!, /simulated location near Library crossing/);
  b.down = true;
  assert.equal(await agent.handleText(ME, convo, "help", "m2"), say.SERVER_DOWN);
});

test("sender numbers are masked in logs", () => {
  assert.equal(maskSender("+15550001111"), "********1111");
  assert.equal(maskSender(undefined), "unknown");
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
