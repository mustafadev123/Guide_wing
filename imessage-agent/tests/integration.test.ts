// End-to-end against the REAL GuideWing backend: starts uvicorn from the project .venv on a free
// port with a temporary database (2-second cancellation window for speed), then drives a full
// conversation through the agent core and the live /ws/events stream. No Photon account needed.

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
const ME = "+15550002222";
let server: ChildProcess;
let unsubscribe = () => {};

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
  unsubscribe();
  if (server?.pid) {
    // the venv launcher starts a child python; end the whole tree
    if (process.platform === "win32") execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
});

test("full conversation against the real backend", async () => {
  const client = new GuideWingClient(BASE);
  const agent = new GuideWingAgent(client, { allowedSenders: new Set([ME]) });
  const sent: string[] = [];
  const convo = { id: "space-it", send: async (t: string) => { sent.push(t); } };
  let ready = false;
  unsubscribe = client.subscribe((e) => agent.handleEvent(e), () => { void agent.resync(); ready = true; }, () => {});
  await until(() => ready);

  assert.match((await agent.handleText(ME, convo, "start", "m1"))!, /Journey started/);
  assert.equal((await api("GET", "/api/simulation/state?journey_id=current")).journey.status, "active");

  assert.equal(await agent.handleText(ME, convo, "help", "m2"), null);
  await until(() => sent.some((t) => t.startsWith("Help request started")));
  const incidents = await api("GET", "/api/incidents");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].request_source, "imessage");
  assert.equal(incidents[0].request_key, "imessage-m2");

  // same message delivered twice -> still one request
  await agent.handleText(ME, convo, "help", "m2");
  assert.equal((await api("GET", "/api/incidents")).length, 1);

  await until(() => sent.includes("Your help request was sent to the responder. Waiting for acceptance."), 8000);
  assert.ok(sent.includes("Your help request was sent to the responder. Waiting for acceptance."), JSON.stringify(sent));

  await api("POST", `/api/incidents/${incidents[0].id}/accept`, { responder: "Integration test" });
  await until(() => sent.includes("A responder accepted your request."));
  assert.match((await agent.handleText(ME, convo, "cancel", "m3"))!, /already accepted/);

  await api("POST", `/api/incidents/${incidents[0].id}/resolve`);
  await until(() => sent.includes("The responder marked your request as resolved."));

  assert.match((await agent.handleText(ME, convo, "status", "m4"))!, /simulated location near .*Help: no active request/);
  assert.equal(await agent.handleText("+19990000000", convo, "help", "m5"), "This GuideWing demo line only responds to registered numbers.");

  // every update was texted exactly once, in order
  assert.deepEqual(sent, [
    "Help request started. It will be sent to a responder in 10 seconds. Reply CANCEL to stop it.",
    "Your help request was sent to the responder. Waiting for acceptance.",
    "A responder accepted your request.",
    "The responder marked your request as resolved.",
  ]);
});

test("cancel inside the window over the real backend", async () => {
  const client = new GuideWingClient(BASE);
  const agent = new GuideWingAgent(client, { allowedSenders: new Set([ME]) });
  const sent: string[] = [];
  const convo = { id: "space-it2", send: async (t: string) => { sent.push(t); } };
  await agent.resync();
  await agent.handleText(ME, convo, "resume", "c0"); // journey paused by the previous request
  await agent.handleText(ME, convo, "help", "c1");
  assert.equal(await agent.handleText(ME, convo, "cancel", "c2"), null);
  await sleep(2500); // past the 2 s window: must stay cancelled
  const latest = (await api("GET", "/api/incidents"))[0];
  assert.equal(latest.status, "cancelled");
  assert.equal(latest.dispatched_at, null);
  assert.equal(sent.at(-1), "Help request cancelled. Nothing was sent.");
});
