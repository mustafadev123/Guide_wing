// End-to-end against the REAL GuideWing backend: starts uvicorn from the project .venv on a free
// port with a temporary database (2-second cancellation window for speed). A simulated user requests
// help through the API; two responders accept and resolve through the agent core and the live
// /ws/events stream. No Photon account needed.

import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { GuideWingAgent } from "../src/agent.ts";
import { GuideWingClient } from "../src/guidewing.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PYTHON = join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const PORT = 8030 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const A = "+15550001111";
const B = "+15550002222";
let server: ChildProcess;
const unsubscribers: (() => void)[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(100);
  }
}
const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(BASE + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })).json();

before(async () => {
  const db = join(mkdtempSync(join(tmpdir(), "gw-imsg-")), "test.sqlite3");
  server = spawn(PYTHON, ["-m", "uvicorn", "backend.app.main:create_default_app", "--factory", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, GUIDEWING_DB_PATH: db, GUIDEWING_VISION_SOURCE: "", GUIDEWING_CANCEL_WINDOW_S: "2", GEMINI_API_KEY: "", ELEVENLABS_API_KEY: "" },
  });
  const up = await until(async () => { try { return (await fetch(BASE + "/api/health")).ok; } catch { return false; } }, 30000);
  assert.ok(up, "backend did not start");
});

after(() => {
  for (const stop of unsubscribers) stop();
  if (server?.pid) {
    // the venv launcher starts a child python; end the whole tree
    if (process.platform === "win32") execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
});

/** The simulated user presses Help (same endpoint as the /user page). */
async function userRequest(key: string, source: "button" | "voice" = "button") {
  const journey = (await api("GET", "/api/simulation/state?journey_id=current")).journey;
  if (journey.status === "idle") await api("POST", `/api/journeys/${journey.id}/start`);
  if (journey.status === "paused") await api("POST", `/api/journeys/${journey.id}/resume`);
  return (await api("POST", "/api/incidents", { journey_id: journey.id, request_key: key, request_source: source })).incident;
}

async function setup() {
  const client = new GuideWingClient(BASE);
  const agent = new GuideWingAgent(client, { allowedSenders: new Set([A, B]) });
  const sent: Record<string, string[]> = { [A]: [], [B]: [] };
  const text = (who: string, t: string) => agent.handleText(who, { id: `space-${who}`, send: async (m: string) => { sent[who]!.push(m); } }, t);
  let ready = false;
  unsubscribers.push(client.subscribe((e) => agent.handleEvent(e), () => { void agent.resync(); ready = true; }, () => {}));
  await until(() => ready);
  return { sent, text };
}

test("responders accept and resolve a user's request over the real backend", async () => {
  const { sent, text } = await setup();
  assert.equal(await text(A, "list"), "No open requests.");
  await text(B, "list");

  const incident = await userRequest("it-user-request-1");
  assert.match(await text(A, "accept"), /cancellation window/); // not dispatched yet
  await until(() => sent[A]!.length && sent[B]!.length, 8000);
  assert.match(sent[A]![0]!, /^New help request near .*\(simulated location\), requested with the Help button\. Reply ACCEPT/);
  assert.deepEqual(sent[B], sent[A]);

  assert.match(await text(A, "ACCEPT"), /^You accepted the request/);
  const accepted = await api("GET", `/api/incidents/${incident.id}`);
  assert.equal(accepted.status, "acknowledged");
  assert.equal(accepted.responder, "iMessage responder (…1111)");
  await until(() => sent[B]!.length === 2);
  assert.match(sent[B]![1]!, /accepted by iMessage responder \(…1111\)\. No action needed\./);
  assert.equal(await text(B, "accept"), "Already accepted by iMessage responder (…1111).");

  assert.match(await text(A, "details"), /Status: acknowledged/);
  assert.match(await text(A, "resolved"), /marked resolved\. Thank you\./);
  assert.equal((await api("GET", `/api/incidents/${incident.id}`)).status, "resolved");
  await until(() => sent[B]!.length === 3);
  await sleep(300);
  assert.equal(sent[A]!.length, 1, JSON.stringify(sent[A])); // only the new-request push
  assert.match(sent[B]![2]!, /was marked resolved \(accepted by iMessage responder \(…1111\)\)/);
  assert.equal(await text("+19990000000", "accept"), "This GuideWing responder line only responds to registered responder numbers.");
});

test("user cancellations: silent inside the window, pushed after dispatch", async () => {
  const { sent, text } = await setup();
  await text(A, "list");
  const early = await userRequest("it-user-request-2");
  await api("POST", `/api/incidents/${early.id}/cancel`);
  await sleep(2500); // past the 2 s window: stays cancelled, nobody is told
  assert.deepEqual(sent[A], []);

  const late = await userRequest("it-user-request-3");
  await until(() => sent[A]!.length === 1, 8000);
  await api("POST", `/api/incidents/${late.id}/cancel`);
  await until(() => sent[A]!.length === 2);
  assert.match(sent[A]![1]!, /^The user cancelled the request near .*No action needed\.$/);
});

test("a voice-command request reaches responders and is accepted and resolved through the same backend", async () => {
  const { sent, text } = await setup();
  await text(A, "list");
  const incident = await userRequest("voice-it-request-4", "voice");
  assert.equal(incident.request_source, "voice");
  await until(() => sent[A]!.length === 1, 8000);
  assert.match(sent[A]![0]!, /^New help request near .*, requested with a spoken voice command\. Reply ACCEPT/);
  assert.match(await text(A, "accept"), /^You accepted the request/);
  assert.equal((await api("GET", `/api/incidents/${incident.id}`)).status, "acknowledged");
  assert.match(await text(A, "details"), /Requested with a spoken voice command\./);
  assert.match(await text(A, "resolved"), /marked resolved/);
  assert.equal((await api("GET", `/api/incidents/${incident.id}`)).status, "resolved");
});
