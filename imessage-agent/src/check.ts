// Connection check: authenticate with Photon Spectrum using imessage-agent/.env, then disconnect.
// Sends no messages and never prints the secret.   Run: node src/check.ts

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Spectrum } from "spectrum-ts";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const projectId = process.env.SPECTRUM_PROJECT_ID;
const projectSecret = process.env.SPECTRUM_PROJECT_SECRET;
if (!projectId || !projectSecret) {
  console.log("FAIL: SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET missing in imessage-agent/.env");
  process.exit(2);
}
const allowed = (process.env.GUIDEWING_IMESSAGE_ALLOWED ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const started = Date.now();
try {
  const { imessage } = await import("spectrum-ts/providers/imessage");
  const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
  console.log(`OK: authenticated with Photon Spectrum in ${Date.now() - started} ms`);
  console.log(`    project config fields: ${Object.keys(app.config).join(", ")}`);
  console.log(`    allowlist: ${allowed.length ? `${allowed.length} number(s)` : "EMPTY - set GUIDEWING_IMESSAGE_ALLOWED before starting the agent"}`);
  await app.stop();
  process.exit(0);
} catch (e) {
  const err = e as Error & { code?: unknown; status?: unknown };
  const msg = String(err.message ?? "").replaceAll(projectSecret, "<secret>");
  console.log(`FAIL after ${Date.now() - started} ms: ${err.name}${err.code ? ` (${String(err.code)})` : ""}${err.status ? ` HTTP ${String(err.status)}` : ""}: ${msg.slice(0, 300)}`);
  process.exit(1);
}
