// Entry point: connect the GuideWing responder agent to Photon Spectrum.
//
//   node src/main.ts             iMessage via Photon Spectrum Cloud (needs SPECTRUM_PROJECT_ID/SECRET)
//   node src/main.ts --terminal  Spectrum's local terminal chat, no Photon account (development)
//
// Configuration (imessage-agent/.env, git-ignored; see .env.example):
//   SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET   from app.photon.codes
//   GUIDEWING_IMESSAGE_ALLOWED                     comma-separated E.164 responder numbers allowed to use the agent
//   GUIDEWING_URL                                  backend URL (default http://127.0.0.1:8000)

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Spectrum } from "spectrum-ts";
import { GuideWingAgent, SendLimiter, maskSender } from "./agent.ts";
import { GuideWingClient } from "./guidewing.ts";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const terminalMode = process.argv.includes("--terminal");
const log = (msg: string) => console.error(`${new Date().toISOString().slice(11, 19)} [imessage-agent] ${msg}`);

const allowed = (process.env.GUIDEWING_IMESSAGE_ALLOWED ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!terminalMode && allowed.length === 0) {
  log("GUIDEWING_IMESSAGE_ALLOWED is empty: set the registered responder number(s), e.g. +15551234567. Refusing to start.");
  process.exit(2);
}

const client = new GuideWingClient(process.env.GUIDEWING_URL ?? "http://127.0.0.1:8000");
const agent = new GuideWingAgent(client, { allowedSenders: terminalMode ? null : new Set(allowed), log });
const limiter = new SendLimiter();

async function createApp() {
  if (terminalMode) {
    const { terminal } = await import("spectrum-ts/providers/terminal");
    return Spectrum({ providers: [terminal.config()] });
  }
  const projectId = process.env.SPECTRUM_PROJECT_ID;
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    log("SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET missing in imessage-agent/.env. Refusing to start.");
    process.exit(2);
  }
  const { imessage } = await import("spectrum-ts/providers/imessage");
  return Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
}

const unsubscribe = client.subscribe((e) => agent.handleEvent(e), () => { void agent.resync(); }, log);
const app = await createApp();
log(`connected (${terminalMode ? "terminal" : "iMessage via Photon Spectrum"}); responders: ${terminalMode ? "all (terminal)" : allowed.map(maskSender).join(", ")}`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  log("shutting down");
  unsubscribe();
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for await (const [space, message] of app.messages) {
  // Never answer our own messages or non-text events (receipts, reactions, typing, system events):
  // replying to those can create a message loop. Only the event type is logged, never content.
  if (message.direction === "outbound" || message.sender?.kind === "agent") continue;
  if (message.content.type !== "text") {
    log(`ignored ${message.content.type} event from ${maskSender(message.sender?.id)}`);
    continue;
  }
  const text = message.content.text;
  try {
    // Every outgoing message (direct reply or pushed update) passes the per-conversation cap.
    const send = (t: string) => {
      if (!limiter.allow(space.id)) { log(`send suppressed by rate limit for ${maskSender(message.sender?.id)}`); return Promise.resolve(); }
      return space.send(t);
    };
    const conversation = { id: space.id, send };
    const reply = await space.responding(() => agent.handleText(message.sender?.id, conversation, text));
    if (reply) await send(reply);
  } catch (e) {
    log(`message handling failed: ${(e as Error).name}`);
  }
}
log("message stream ended");
await shutdown();
