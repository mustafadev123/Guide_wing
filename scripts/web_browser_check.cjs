// Real-browser end-to-end check of /user, /sim and /responder against a RUNNING backend.
// Uses the installed Microsoft Edge through playwright-core (project-local: tools\browsertest).
//
//   tools\node\node.exe scripts\web_browser_check.cjs http://127.0.0.1:8010
//
// Run it against an ISOLATED test server (separate GUIDEWING_DB_PATH): it starts/ends journeys
// and creates help requests. Speech is observed by intercepting speechSynthesis.speak, which
// proves the page asked to speak, NOT that audio was audible.

const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "tools", "browsertest", "node_modules", "playwright-core"));

const BASE = (process.argv[2] || "http://127.0.0.1:8010").replace(/\/$/, "");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -- ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const snap = async () => (await api("GET", "/api/simulation/state?journey_id=current")).body;
async function until(fn, timeoutMs = 15000, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(stepMs); }
  return last;
}

const SPEECH_STUB = () => {
  window.__spoken = [];
  const synth = {
    speak: (u) => window.__spoken.push({ text: u.text, t: Date.now() }),
    cancel: () => {}, pause: () => {}, resume: () => {}, getVoices: () => [],
    speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
};

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(SPEECH_STUB);
  const consoleErrors = [];
  const watch = (page, label) => {
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${label}: ${m.text()}`); });
    page.on("pageerror", (e) => consoleErrors.push(`${label}: ${e.message}`));
    page.on("response", (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) consoleErrors.push(`${label}: HTTP ${r.status()} ${r.url()}`); });
  };

  // ---- fresh journey ---------------------------------------------------------------
  await api("POST", "/api/dev/reset");
  const user = await ctx.newPage(); watch(user, "user");
  await user.goto(`${BASE}/user`);
  const startBtn = user.getByRole("button", { name: /^Start journey/ });
  await startBtn.waitFor({ timeout: 15000 });
  check("/user loads with Start journey for an idle journey", await startBtn.isVisible());
  const spoken = () => user.evaluate(() => window.__spoken.map((s) => s.text));

  await startBtn.click();
  const active = await until(async () => (await snap()).journey.status === "active");
  check("Start journey -> backend status active", active);

  const sim = await ctx.newPage(); watch(sim, "sim");
  await sim.goto(`${BASE}/sim`);
  await sim.waitForTimeout(1500);
  const p1 = (await snap()).journey.route_progress;
  const simText1 = await sim.locator("body").innerText();
  await sim.waitForTimeout(3000);
  const p2 = (await snap()).journey.route_progress;
  const simText2 = await sim.locator("body").innerText();
  check("Backend advances progress while active", p2 > p1, `${p1} -> ${p2}`);
  check("/sim shows the journey as active and updates", /active/i.test(simText2) && simText1 !== simText2);
  check("/sim labels the journey and location as simulated", /simulated/i.test(simText2));

  // ---- pause / resume, consistent across pages ------------------------------------
  await user.bringToFront();
  await user.keyboard.press("p");
  const paused = await until(async () => (await snap()).journey.status === "paused");
  check("Shortcut P pauses (backend paused)", paused);
  const pp1 = (await snap()).journey.route_progress; await sleep(1500);
  const pp2 = (await snap()).journey.route_progress;
  check("Progress frozen while paused", pp1 === pp2, `${pp1} vs ${pp2}`);
  await sim.waitForTimeout(1200);
  check("/sim shows paused", /paused/i.test(await sim.locator("body").innerText()));
  check("/user shows paused", /paused/i.test(await user.locator(".journey-section").innerText()));
  await user.getByRole("button", { name: /Resume journey/ }).click();
  check("Resume button -> active", await until(async () => (await snap()).journey.status === "active"));

  // ---- labels ---------------------------------------------------------------------
  const userText = await user.locator("body").innerText();
  check("/user labels location simulated", /simulated location/i.test(userText), userText.match(/.{0,40}location.{0,40}/i)?.[0]);

  // ---- help -> cancel before dispatch -----------------------------------------------
  const helpBtn = user.getByRole("button", { name: /^Help$/ });
  const before = (await api("GET", "/api/incidents?limit=500")).body.length;
  await helpBtn.dblclick(); // duplicate submission attempt
  const pending = await until(async () => (await snap()).active_incident?.status === "pending" && (await snap()).active_incident);
  check("Help -> backend pending", !!pending);
  await sleep(1000);
  const after = (await api("GET", "/api/incidents?limit=500")).body.length;
  check("Double-click Help creates exactly one request", after - before === 1, `${after - before} created`);
  const inc = (await api("GET", `/api/incidents/${pending.id}`)).body;
  const windowS = (Date.parse(inc.dispatch_at) - Date.parse(inc.created_at)) / 1000;
  check("Backend-owned 10 s deadline (dispatch_at - created_at)", windowS === 10, `${windowS}s`);
  check("/user shows a server-based countdown", /seconds left to cancel/i.test(await user.locator(".request-strip").innerText()));
  check("Help is aria-disabled with explanation while a request is active",
    (await helpBtn.getAttribute("aria-disabled")) === "true" && /already active/i.test(await user.locator("#help-hint").innerText().catch(() => "")),
    await user.locator("#help-hint").innerText().catch(() => "no #help-hint"));

  const resp1 = await ctx.newPage(); watch(resp1, "responder1");
  await resp1.goto(`${BASE}/responder`);
  await resp1.waitForTimeout(2500);
  check("Pending request is not acceptable on /responder", (await resp1.getByRole("button", { name: "Accept request" }).count()) === 0);

  await user.bringToFront();
  await user.keyboard.press("c");
  check("Shortcut C cancels before dispatch", await until(async () => (await api("GET", `/api/incidents/${pending.id}`)).body.status === "cancelled"));
  await sleep(11000);
  const cancelled = (await api("GET", `/api/incidents/${pending.id}`)).body;
  check("Cancelled request stays cancelled after the deadline", cancelled.status === "cancelled" && cancelled.dispatched_at === null);
  check("/user shows the cancellation", /cancel/i.test(await user.locator(".request-strip").innerText()));

  // ---- second request dispatches, two responders accept ----------------------------
  await user.getByRole("button", { name: /Resume journey/ }).click().catch(() => {});
  await until(async () => (await snap()).journey.status === "active", 5000);
  await helpBtn.click();
  const second = await until(async () => (await snap()).active_incident);
  const dispatched = await until(async () => (await snap()).active_incident?.status === "dispatched", 16000);
  check("Second request dispatches after 10 s", dispatched);
  const resp2 = await ctx.newPage(); watch(resp2, "responder2");
  await resp2.goto(`${BASE}/responder`);
  await resp1.bringToFront();
  const a1 = resp1.getByRole("button", { name: "Accept request" });
  const a2 = resp2.getByRole("button", { name: "Accept request" });
  await Promise.all([a1.waitFor({ timeout: 10000 }), a2.waitFor({ timeout: 10000 })]);
  await Promise.all([a1.click(), a2.click()]);
  const ack = await until(async () => (await api("GET", `/api/incidents/${second.id}`)).body.status === "acknowledged");
  check("Two responders accepting -> one acknowledged state", ack);
  const timeline = (await api("GET", `/api/incidents/${second.id}`)).body.timeline.map((e) => e.type);
  check("Timeline records exactly one acknowledgment", timeline.filter((t) => t === "acknowledged").length === 1, timeline.join(","));
  await resp1.waitForTimeout(800); await resp2.waitForTimeout(800);
  const notices = [await resp1.locator(".desk-notice").innerText(), await resp2.locator(".desk-notice").innerText()];
  check("Responders see 'Server confirmed' once and 'Already handled' once",
    notices.filter((n) => /server confirmed/i.test(n)).length === 1 && notices.filter((n) => /already handled/i.test(n)).length === 1, notices.join(" | "));

  await user.bringToFront();
  await user.waitForTimeout(2500);
  const ackSpoken = (await spoken()).filter((t) => /accepted/i.test(t));
  check("/user asked to speak the acknowledgment exactly once", ackSpoken.length === 1, JSON.stringify(ackSpoken));
  check("/user shows accepted state", /accepted by a responder/i.test(await user.locator(".request-strip").innerText()));
  check("Cancel is aria-disabled after acceptance", (await user.getByRole("button", { name: /^Cancel$/ }).getAttribute("aria-disabled")) === "true");

  // refresh: no replayed speech, no new request
  const countBefore = (await api("GET", "/api/incidents?limit=500")).body.length;
  await user.reload(); await user.waitForTimeout(3000);
  const afterReload = await spoken();
  check("Refresh does not replay acknowledgment speech", !afterReload.some((t) => /accepted/i.test(t)), JSON.stringify(afterReload));
  check("Refresh creates no request", (await api("GET", "/api/incidents?limit=500")).body.length === countBefore);
  await user.getByRole("button", { name: /Repeat last message/ }).click();
  await user.waitForTimeout(400);
  check("Repeat speaks the last message on demand", (await spoken()).length >= 1, JSON.stringify(await spoken()));

  // resolve -> Help available again
  await resp1.bringToFront();
  await resp1.reload(); await resp1.waitForTimeout(2000);
  const resolveBtn = resp1.getByRole("button", { name: "Mark resolved" });
  if (await resolveBtn.count() === 0) await resp1.getByRole("button", { name: /Near/ }).first().click().catch(() => {});
  await resp1.getByRole("button", { name: "Mark resolved" }).click();
  check("Resolve -> backend resolved", await until(async () => (await api("GET", `/api/incidents/${second.id}`)).body.status === "resolved"));
  await user.bringToFront();
  check("Help becomes available after resolution", await until(async () => (await helpBtn.getAttribute("aria-disabled")) === "false", 8000));

  // ---- keyboard focus visible, accessible names --------------------------------------
  await user.keyboard.press("Tab"); await user.keyboard.press("Tab");
  const focus = await user.evaluate(() => {
    const el = document.activeElement; const cs = getComputedStyle(el);
    return { tag: el.tagName, name: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 40), outline: cs.outlineStyle + " " + cs.outlineWidth, shadow: cs.boxShadow };
  });
  check("Keyboard focus is visible (outline or focus ring)", (focus.outline && !/^none/.test(focus.outline)) || (focus.shadow && focus.shadow !== "none"), JSON.stringify(focus));
  const unnamed = await user.evaluate(() => [...document.querySelectorAll("button")].filter((b) => !(b.getAttribute("aria-label") || b.textContent.trim())).length);
  check("All /user buttons have accessible names", unnamed === 0, `${unnamed} unnamed`);

  // ---- ended journey -> Start a new journey ------------------------------------------
  const jid = (await snap()).journey.id;
  await api("POST", `/api/journeys/${jid}/end`);
  const newBtn = user.getByRole("button", { name: /Start a new journey/ });
  check("Ended journey offers Start a new journey", await until(async () => await newBtn.isVisible().catch(() => false), 8000));
  await newBtn.click();
  check("Start a new journey -> new active journey", await until(async () => { const s = await snap(); return s.journey.id !== jid && s.journey.status === "active"; }));

  // ---- unavailable location is never shown as coordinates ---------------------------
  const nj = (await snap()).journey.id;
  await api("POST", `/api/journeys/${nj}/location`, { source: "unavailable" });
  await user.waitForTimeout(2500);
  const locText = await user.locator(".journey-section").innerText();
  check("Unavailable location shown as unavailable, without coordinates", /unavailable/i.test(locText) && !/\(\s*-?\d+\.\d+,\s*-?\d+\.\d+\s*\)/.test(locText), locText.replace(/\s+/g, " ").slice(0, 160));

  // ---- connection loss ----------------------------------------------------------------
  await user.route("**/api/**", (r) => r.abort());
  await user.route("**/ws/**", (r) => r.abort());
  const lost = await until(async () => /unreachable|stale|reconnect|unavailable/i.test(await user.locator(".connection-row").innerText().catch(() => "")), 12000);
  check("/user shows connection loss when the API is unreachable", lost, await user.locator(".connection-row").innerText().catch(() => ""));
  await user.unroute("**/api/**"); await user.unroute("**/ws/**");
  check("/user recovers when the API returns", await until(async () => !/unreachable|stale/i.test(await user.locator(".connection-row").innerText().catch(() => "x")), 12000));

  // ---- analytics vs API -----------------------------------------------------------------
  await resp1.bringToFront();
  await resp1.getByRole("button", { name: "Analytics" }).click();
  await resp1.waitForTimeout(2000);
  const analyticsText = await resp1.locator("main").innerText();
  const all = (await api("GET", "/api/incidents?limit=500")).body.filter((i) => !i.is_test);
  const counts = all.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {});
  console.log("      API (non-test) counts:", JSON.stringify(counts), "total", all.length);
  console.log("      Analytics panel text:", analyticsText.replace(/\s+/g, " ").slice(0, 600));
  // Summary: an instant summary written from the recorded figures appears immediately, with or without
  // Gemini; provider problems never surface as errors in this panel.
  const gen = resp1.getByRole("button", { name: /Generate summary/ });
  await gen.click();
  const summaryText = await until(async () => {
    const t = await resp1.locator(".ai-summary").innerText();
    return /Queue outcomes/.test(t) && /Response times/.test(t) && t;
  }, 8000);
  check("Generate summary shows a summary within seconds (instant or Gemini)", !!summaryText, summaryText || "");
  await resp1.waitForTimeout(3000);
  const later = await resp1.locator(".ai-summary").innerText();
  check("Summary panel shows no failure, retry or setup text", !/fail|error|retry|not configured|unavailable|gemini/i.test(later), later.replace(/\s+/g, " ").slice(0, 300));
  const sumResp = await api("POST", "/api/analytics/summary", { range: "loaded", include_tests: false });
  const m = sumResp.body?.metrics;
  check("Server analytics metrics match API records", m && m.total === all.length && (m.counts.resolved || 0) === (counts.resolved || 0) && (m.counts.cancelled || 0) === (counts.cancelled || 0),
    JSON.stringify({ metrics: m, counts }));

  // ---- page text sanity: stray '?' replacement characters ------------------------------
  const texts = { user: await user.locator("body").innerText(), responder: await resp1.locator("body").innerText(), sim: await sim.locator("body").innerText() };
  for (const [k, t] of Object.entries(texts)) {
    const bad = t.match(/[A-Za-z0-9)] \? [A-Za-z0-9(]|[a-z]\?$|�/m);
    check(`/${k} has no stray '?' placeholder characters`, !bad, bad?.[0]);
  }
  // The browser's automatic /favicon.ico 404 and our deliberate outage (net::ERR_FAILED) are excluded.
  const real = consoleErrors.filter((e) => !/net::ERR_FAILED|status of 404 \(Not Found\)$/.test(e));
  check("No unexpected console errors or failed requests (favicon 404 and simulated outage excluded)", real.length === 0, real.slice(0, 5).join(" || "));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULT: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });
