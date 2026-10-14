// Real-browser check of simulated-route checkpoints, "On my way" and readiness/failure feedback
// against a RUNNING, ISOLATED backend started with a short route, e.g.:
//
//   GUIDEWING_ROUTE_DURATION_S=24 GUIDEWING_VISION_SOURCE="" GUIDEWING_DB_PATH=<temp> uvicorn ... --port 8012
//   tools\node\node.exe scripts\feedback_browser_check.cjs http://127.0.0.1:8012
//
// Speech is a stub that "speaks" for 600 ms; camera states and server loss are produced by intercepting
// the page's own requests. Proves what the page asks to say and when, not audible output.

const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "tools", "browsertest", "node_modules", "playwright-core"));

const BASE = (process.argv[2] || "http://127.0.0.1:8012").replace(/\/$/, "");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -- ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const snap = async () => (await api("GET", "/api/simulation/state?journey_id=current")).body;
async function until(fn, timeoutMs = 15000, stepMs = 200) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(stepMs); }
  return last;
}

const SPEECH_STUB = () => {
  window.__spoken = [];
  let current = null;
  const synth = {
    speak(u) { if (current) current.onend?.(); current = u; window.__spoken.push(u.text); setTimeout(() => { if (current === u) { current = null; u.onend?.(); } }, 600); },
    cancel() { const u = current; current = null; u?.onend?.(); },
    pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
};

const vision = (mode, ready, error = null) => ({
  input_mode: mode, ready, source_label: mode, error, last_observed_at: null, frame_age_s: ready ? 0.1 : error ? 3.2 : null,
  fps: ready ? 12 : null, inference_ms: null, obstruction_active: false, obstruction_source: null, gesture_armed: true, gesture_hold_progress: 0,
});

async function userPage(browser, { fakeVision } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(SPEECH_STUB);
  const state = { vision: fakeVision ?? null, serverDown: false };
  if (fakeVision) await ctx.route("**/api/vision/status", (route) => route.fulfill({ json: state.vision }));
  await ctx.route("**/api/simulation/state*", (route) => state.serverDown ? route.abort() : route.continue());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/user`);
  await page.locator(".voice-section").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Status" }).click(); // user gesture: enables speech
  return { ctx, page, state, errors };
}
const spoken = (page) => page.evaluate(() => window.__spoken.slice());
const count = async (page, re) => (await spoken(page)).filter((t) => re.test(t)).length;

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const route = (await api("GET", "/api/simulation/route")).body;
  check("Route waypoints come from the backend definition", route.waypoints.length === 4 && route.waypoints[1].name === "Library crossing", JSON.stringify(route.waypoints.map((w) => w.name)));

  // ---- checkpoints --------------------------------------------------------------------------
  await api("POST", "/api/dev/reset");
  const u = await userPage(browser);
  const camOff = /^Camera unavailable\. You can still request help\.$/;
  check("No camera configured: 'Camera unavailable. You can still request help.' once", await until(() => count(u.page, camOff), 5000) && (await sleep(1500), (await count(u.page, camOff)) === 1),
    JSON.stringify(await spoken(u.page)));
  await u.page.getByRole("button", { name: /^Start journey/ }).click();
  await until(async () => (await snap()).journey.waypoint_index >= 1, 20000);
  const lib = /^You've reached Library crossing on the simulated route\.$/;
  check("Crossing a waypoint boundary announces the checkpoint", await until(() => count(u.page, lib), 4000), JSON.stringify(await spoken(u.page)));
  await sleep(1500);
  check("The checkpoint is announced once", (await count(u.page, lib)) === 1);
  check("Checkpoint is labeled as the simulated route", (await spoken(u.page)).some((t) => /simulated route/.test(t)));

  // refresh mid-journey: no replay of the old checkpoint
  await u.page.reload(); await u.page.locator(".voice-section").waitFor();
  await u.page.getByRole("button", { name: "Status" }).click();
  await sleep(2500);
  check("Refresh does not replay an earlier checkpoint", (await count(u.page, /You've reached Library crossing/)) === 0, JSON.stringify(await spoken(u.page)));

  // pause: no checkpoint while paused; progress is frozen by the backend
  await u.page.keyboard.press("p");
  await until(async () => (await snap()).journey.status === "paused");
  const idxPaused = (await snap()).journey.waypoint_index;
  await sleep(3000);
  check("Paused journey: no checkpoint speech and no progress", (await snap()).journey.waypoint_index === idxPaused && (await count(u.page, /on the simulated route/)) === 0);
  await u.page.getByRole("button", { name: /Resume journey/ }).click();
  await until(async () => (await snap()).journey.waypoint_index >= 2, 20000);
  check("Next checkpoint after resume is announced", await until(() => count(u.page, /^You've reached Fountain plaza on the simulated route\.$/), 4000), JSON.stringify(await spoken(u.page)));
  await until(async () => (await snap()).journey.status === "ended", 20000);
  await sleep(1500);
  const said = await spoken(u.page);
  check("Route end uses the end message, not a final checkpoint", said.some((t) => /end of the demo route/.test(t)) && !said.some((t) => /Bus stop on the simulated route/.test(t)), JSON.stringify(said));

  // new journey: tracking resets by UUID
  await u.page.getByRole("button", { name: /Start a new journey/ }).click();
  await until(async () => (await snap()).journey.waypoint_index >= 1, 20000);
  check("A new journey announces its own checkpoints", await until(() => count(u.page, lib), 4000));

  // ---- on my way -----------------------------------------------------------------------------
  const before = (await spoken(u.page)).length;
  await u.page.getByRole("button", { name: /^Help$/ }).click();
  const inc = await until(async () => (await snap()).active_incident, 5000);
  await until(async () => (await snap()).active_incident?.status === "dispatched", 15000);
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desk = await rctx.newPage();
  await desk.goto(`${BASE}/responder`);
  await desk.getByRole("button", { name: "Accept request" }).click();
  await until(async () => (await snap()).active_incident?.status === "acknowledged");
  const omwBtn = desk.getByRole("button", { name: "On my way" });
  check("Accepting desk shows the On my way action", await until(() => omwBtn.isVisible().catch(() => false), 5000));
  const other = await (await browser.newContext()).newPage(); // a different desk that did not accept
  await other.goto(`${BASE}/responder`);
  await other.waitForTimeout(2500);
  check("A desk that did not accept gets no On my way button and an explanation",
    (await other.getByRole("button", { name: "On my way" }).count()) === 0 && /can be sent only by the responder who accepted/.test(await other.locator("body").innerText()));
  const forged = await api("POST", `/api/incidents/${inc.id}/on-my-way`, { responder_token: "f".repeat(32) });
  check("Forged token is rejected server-side (403)", forged.status === 403 && !(await snap()).active_incident.on_my_way_at);
  await omwBtn.click();
  const omwRe = /^Your responder says they are on the way\.$/;
  check("User hears 'Your responder says they are on the way.'", await until(() => count(u.page, omwRe), 6000), JSON.stringify((await spoken(u.page)).slice(before)));
  const s1 = await snap();
  check("Status stays acknowledged; on_my_way_at is a separate field", s1.active_incident.status === "acknowledged" && !!s1.active_incident.on_my_way_at);
  check("Dashboard shows the On my way update without an ETA", await until(async () => /On my way.*no arrival time/s.test(await desk.locator(".request-detail").innerText()), 5000));
  const token = await desk.evaluate((id) => JSON.parse(sessionStorage.getItem("guidewing.responderTokens"))[id], inc.id);
  const repeat = await api("POST", `/api/incidents/${inc.id}/on-my-way`, { responder_token: token });
  check("Repeated On my way is a no-op (changed=false)", repeat.status === 200 && repeat.body.changed === false);
  await sleep(1500);
  check("No duplicate On my way speech", (await count(u.page, omwRe)) === 1);
  check("No ETA or arrival claim in user speech", !(await spoken(u.page)).some((t) => /arriv|minutes away|ETA/i.test(t)));
  await u.page.reload(); await u.page.locator(".voice-section").waitFor();
  await u.page.getByRole("button", { name: "Status" }).click();
  await sleep(2500);
  const afterReload = await spoken(u.page);
  check("Refresh does not repeat On my way (Status still reports it)", afterReload.filter((t) => omwRe.test(t)).length === 0 && afterReload.some((t) => /Help request: accepted by a responder\. Your responder says they are on the way\./.test(t)), JSON.stringify(afterReload));
  await api("POST", `/api/incidents/${inc.id}/resolve`);
  const late = await api("POST", `/api/incidents/${inc.id}/on-my-way`, { responder_token: token });
  check("On my way after resolution is rejected (409)", late.status === 409);
  await rctx.close(); await other.context().close();

  // ---- readiness: real isolated server has no camera ---------------------------------------
  check("Camera message is not repeated after refreshes in the same tab", (await count(u.page, camOff)) === 0);
  check("Readiness speech never claims a safe path", !(await spoken(u.page)).some((t) => /\bsafe\b|clear path|move (left|right)/i.test(t)));
  await u.ctx.close();

  // ---- readiness: faked live camera, stale frames, recovery -----------------------------------
  const live = await userPage(browser, { fakeVision: vision("live", false) }); // starting: silent
  await sleep(2500);
  check("Camera starting (no first frame yet) is not announced as a failure", (await count(live.page, /Camera/)) === 0, JSON.stringify(await spoken(live.page)));
  live.state.vision = vision("live", true);
  check("Live camera readiness announced after fresh frames", await until(() => count(live.page, /^Camera ready\. Live chair and open-palm recognition is running\.$/), 6000));
  live.state.vision = vision("live", false, "no fresh frame for 3.2s"); await sleep(1500);
  live.state.vision = vision("live", true); await sleep(4000);
  check("A short stale-frame flicker is not announced", (await count(live.page, camOff)) === 0);
  live.state.vision = vision("live", false, "no fresh frame for 3.2s");
  check("Sustained stale frames: 'Camera unavailable…' once", await until(() => count(live.page, camOff), 7000) && (await sleep(2500), (await count(live.page, camOff)) === 1));
  live.state.vision = vision("live", true);
  check("Recovery announced once", await until(() => count(live.page, /^Camera ready again\./), 7000) && (await sleep(2500), (await count(live.page, /^Camera ready/)) === 2));
  await live.page.getByRole("button", { name: "Status" }).click(); // rerender + interaction
  await sleep(2500);
  check("Routine rerenders do not repeat readiness messages", (await count(live.page, /^Camera ready/)) === 2);

  // ---- server loss and recovery ---------------------------------------------------------------
  await api("POST", "/api/dev/reset");
  await live.page.reload(); await live.page.locator(".voice-section").waitFor();
  await live.page.getByRole("button", { name: /^Start journey/ }).click();
  await until(async () => (await snap()).journey.status === "active");
  live.state.serverDown = true;
  const downRe = /^Connection to the GuideWing server lost\. Help requests and cancellations cannot be confirmed right now\./;
  check("Server loss: help cannot be confirmed (announced)", await until(() => count(live.page, downRe), 12000), JSON.stringify((await spoken(live.page)).slice(-3)));
  const n0 = (await api("GET", "/api/incidents?limit=500")).body.length;
  await live.page.getByRole("button", { name: /^Help$/ }).click({ force: true }); // aria-disabled but still explains
  await sleep(800);
  check("Help during loss does not claim delivery", (await api("GET", "/api/incidents?limit=500")).body.length === n0 && !(await spoken(live.page)).slice(-2).some((t) => /recorded|reached/.test(t)) && (await spoken(live.page)).slice(-1)[0] === "Reconnect to the server before requesting help.");
  live.state.serverDown = false;
  check("Recovery announced once after a steady connection", await until(() => count(live.page, /^Connection restored\./), 12000) && (await sleep(3000), (await count(live.page, /^Connection restored\./)) === 1));
  check("Loss announced once", (await count(live.page, downRe)) === 1);
  check("No page errors", live.errors.length === 0, live.errors.join(" / "));
  await live.ctx.close();

  // ---- replay label ------------------------------------------------------------------------------
  const rp = await userPage(browser, { fakeVision: vision("replay", true) });
  check("Replay input is labeled as recorded video", await until(() => count(rp.page, /^Replay input ready\. Recognition is running on recorded video, not a live camera\.$/), 6000));
  await rp.ctx.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} feedback browser checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
