// Real-browser check of /user voice commands against a RUNNING, ISOLATED backend.
// Uses installed Microsoft Edge through playwright-core (tools\browsertest), like web_browser_check.cjs.
//
//   tools\node\node.exe scripts\voice_browser_check.cjs http://127.0.0.1:8011
//
// The browser's SpeechRecognition is replaced by a scripted mock and speechSynthesis by a stub that
// "speaks" for 600 ms. This proves the page routes recognized commands through the real backend
// lifecycle and pauses recognition while speaking. It does NOT prove real microphone recognition
// or audible playback; those remain manual checks on the demo device.

const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "tools", "browsertest", "node_modules", "playwright-core"));

const BASE = (process.argv[2] || "http://127.0.0.1:8011").replace(/\/$/, "");
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
const incidents = async () => (await api("GET", "/api/incidents?limit=500")).body;
async function until(fn, timeoutMs = 15000, stepMs = 200) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(stepMs); }
  return last;
}

// Runs in the page before any app script.
const MOCKS = ({ recognition, micDenied }) => {
  window.__spoken = [];
  window.__speaking = false;
  let current = null;
  const synth = {
    speak(u) {
      if (current) current.onend?.();
      current = u; window.__speaking = true; window.__spoken.push(u.text);
      setTimeout(() => { if (current === u) { current = null; window.__speaking = false; u.onend?.(); } }, 600);
    },
    cancel() { const u = current; current = null; window.__speaking = false; u?.onend?.(); },
    pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: () => micDenied ? Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })) : Promise.resolve({ getTracks: () => [{ stop() {} }] }),
  } });
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  if (!recognition) return;
  window.__rec = { starts: 0, aborts: 0, active: null };
  class MockRecognition {
    constructor() { this.continuous = false; this.interimResults = true; this.maxAlternatives = 1; this.lang = ""; }
    start() { if (window.__rec.active) throw new Error("InvalidStateError"); window.__rec.active = this; window.__rec.starts++; setTimeout(() => this.onstart?.(), 10); }
    stop() { this._end(); }
    abort() { window.__rec.aborts++; if (window.__rec.active === this) { this.onerror?.({ error: "aborted" }); this._end(); } }
    _end() { if (window.__rec.active !== this) return; window.__rec.active = null; setTimeout(() => this.onend?.(), 10); }
  }
  // Delivers a final result to whichever session is listening (or the last one, to model late results).
  window.__say = (transcript, confidence = 0.92, { end = true } = {}) => {
    const r = window.__rec.active ?? window.__rec.last;
    if (!r) return false;
    const result = Object.assign([{ transcript, confidence }], { isFinal: true });
    r.onresult?.({ resultIndex: 0, results: [result] });
    if (end && !r.continuous) r._end();
    return true;
  };
  window.SpeechRecognition = class extends MockRecognition { start() { super.start(); window.__rec.last = this; } };
};

async function openUser(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(MOCKS, opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/409|Conflict/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}/user`);
  await page.locator(".voice-section").waitFor({ timeout: 15000 });
  return { ctx, page, errors };
}
const spoken = (page) => page.evaluate(() => window.__spoken.slice());
const voiceText = (page) => page.locator(".voice-section").innerText();
async function startJourney(page) {
  await api("POST", "/api/dev/reset");
  await page.reload(); await page.locator(".voice-section").waitFor();
  await page.getByRole("button", { name: /^Start journey/ }).click();
  return until(async () => (await snap()).journey.status === "active");
}
async function enableVoice(page) {
  await page.getByRole("button", { name: "Enable voice" }).click();
  return until(async () => /Ready/.test(await voiceText(page)), 5000);
}
async function speak(page, transcript, opts, { key = false } = {}) {
  if (key) await page.keyboard.press("v");
  else await page.getByRole("button", { name: /Speak a command|Listening/ }).click();
  await until(() => page.evaluate(() => !!window.__rec.active), 3000, 50);
  return page.evaluate(([t, o]) => window.__say(t, o?.confidence, o), [transcript, opts]);
}
const quiet = (page) => until(() => page.evaluate(() => !window.__speaking), 5000, 50);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---- supported browser, granted microphone -----------------------------------------
  const { page, errors } = await openUser(browser, { recognition: true, micDenied: false });
  check("Voice is off until explicitly enabled", /Off/.test(await voiceText(page)) && (await page.evaluate(() => window.__rec.starts)) === 0);
  check("Journey starts", await startJourney(page));
  check("Enable voice -> Ready", await enableVoice(page));
  check("No recognition session before push-to-talk (continuous is opt-in)", (await page.evaluate(() => window.__rec.starts)) === 0);

  await quiet(page);
  const before = (await incidents()).length;
  await speak(page, "GuideWing, help", undefined, { key: true }); // V shortcut
  await page.evaluate(() => window.__say("GuideWing, help")); // duplicate final result
  const pending = await until(async () => (await snap()).active_incident?.status === "pending" && (await snap()).active_incident);
  await sleep(1200);
  const created = (await incidents()).slice(0, (await incidents()).length - before);
  check("One spoken Help creates exactly one request", created.length === 1, `${created.length} created`);
  check("Request is recorded with request_source=voice", created[0]?.request_source === "voice", created[0]?.request_source);
  check("Confirmation is spoken only after backend confirmation (pending)", (await spoken(page)).some((t) => /Voice command received\. Help request recorded/.test(t)) && !!pending);
  check("Last recognized command is shown", /Last heard: .GuideWing, help.*command: help/s.test(await voiceText(page)), await voiceText(page));
  check("/user shows which input triggered the request", /Requested with: Voice command/.test(await page.locator(".request-strip").innerText()));

  // Status and Repeat must not change lifecycle
  await quiet(page);
  const s0 = await snap(); const n0 = (await incidents()).length;
  const spokenBefore = (await spoken(page)).length;
  await speak(page, "guide wing status");
  await until(async () => (await spoken(page)).length > spokenBefore, 3000);
  await quiet(page); await sleep(800);
  await speak(page, "GuideWing repeat");
  await sleep(1200);
  const s1 = await snap();
  const said = (await spoken(page)).slice(spokenBefore);
  check("Status speaks journey and request state", said.some((t) => /Journey paused.*Help request: cancellation window/.test(t)), JSON.stringify(said));
  check("Repeat replays the latest announcement", said.length >= 2 && said[said.length - 1] === said[said.length - 2], JSON.stringify(said));
  check("Status and Repeat leave journey and request unchanged",
    s1.journey.version === s0.journey.version && s1.active_incident?.id === s0.active_incident?.id && (await incidents()).length === n0 && s1.active_incident?.status === s0.active_incident?.status);

  // Cancel within the window
  await quiet(page);
  await speak(page, "GuideWing, cancel");
  const cancelled = await until(async () => (await api("GET", `/api/incidents/${pending.id}`)).body.status === "cancelled", 5000);
  check("Voice Cancel inside the window -> backend cancelled", cancelled);
  await sleep(800);
  check("Cancellation is announced after server confirmation", (await spoken(page)).some((t) => /server confirmed your help request is canceled/i.test(t)));
  check("Journey is not auto-resumed after cancellation", (await snap()).journey.status !== "active", (await snap()).journey.status);

  // App speech must not trigger commands
  await page.getByRole("button", { name: /Resume journey/ }).click();
  await until(async () => (await snap()).journey.status === "active");
  await page.getByRole("checkbox", { name: /Keep listening/ }).check();
  await until(() => page.evaluate(() => !!window.__rec.active), 3000, 50);
  const aborts0 = await page.evaluate(() => window.__rec.aborts);
  const n1 = (await incidents()).length;
  await page.getByRole("button", { name: "Status" }).click(); // app starts speaking
  await sleep(100);
  check("Recognition is stopped while the app speaks", (await page.evaluate(() => window.__rec.aborts)) === aborts0 + 1 && /Paused while GuideWing speaks/.test(await voiceText(page)));
  await page.evaluate(() => window.__say("GuideWing help", 0.95, { end: false })); // heard during speech (late result)
  await sleep(1800);
  check("A command heard during app speech creates no request", (await incidents()).length === n1);
  check("Continuous listening resumes after speech", await until(() => page.evaluate(() => !!window.__rec.active), 3000, 50));
  await page.evaluate(() => window.__say("help"));
  await page.evaluate(() => window.__say("guidewing help", 0.2));
  await sleep(800);
  check("Unprefixed and low-confidence speech changes nothing", (await incidents()).length === n1 && /Nothing was changed/.test(await voiceText(page)));
  await page.getByRole("checkbox", { name: /Keep listening/ }).uncheck();

  // Concurrent voice + gesture
  await quiet(page);
  const n2 = (await incidents()).length;
  await page.getByRole("button", { name: /Speak a command/ }).click();
  await until(() => page.evaluate(() => !!window.__rec.active), 3000, 50);
  await Promise.all([api("POST", "/api/dev/vision/palm"), page.evaluate(() => window.__say("GuideWing, help"))]);
  await sleep(2000);
  const all = await incidents();
  check("Simultaneous voice and gesture create exactly one request", all.length - n2 === 1, `${all.length - n2} created`);
  const raced = all[0];
  // Either the voice result overlapped the gesture's announcement (and was discarded) or it was told the request exists;
  // it must never be reported as an uncertain delivery or a second request.
  check("Losing voice request is not reported as a failure", !(await spoken(page)).some((t) => /Server confirmation unavailable|may have reached/i.test(t)), JSON.stringify((await spoken(page)).slice(-3)));

  // Acknowledged request: voice Cancel refused by existing rules
  await until(async () => (await api("GET", `/api/incidents/${raced.id}`)).body.status === "dispatched", 15000);
  await api("POST", `/api/incidents/${raced.id}/accept`, { responder: "voice check" });
  await until(async () => (await snap()).active_incident?.status === "acknowledged");
  await quiet(page);
  await speak(page, "guidewing cancel");
  await sleep(1200);
  check("Voice Cancel after acceptance is refused and the request stays accepted",
    (await api("GET", `/api/incidents/${raced.id}`)).body.status === "acknowledged" && (await spoken(page)).some((t) => /Only the responder can now resolve/.test(t)),
    `${(await api("GET", `/api/incidents/${raced.id}`)).body.status} ${JSON.stringify((await spoken(page)).slice(-3))} ${await voiceText(page)}`);
  await api("POST", `/api/incidents/${raced.id}/resolve`);

  // Obstacle wording
  const s2 = await snap();
  if (s2.journey.status === "paused") await page.getByRole("button", { name: /Resume journey/ }).click();
  await until(async () => (await snap()).journey.status === "active");
  const sp0 = (await spoken(page)).length;
  await api("POST", "/api/dev/vision/obstruction");
  await until(async () => (await spoken(page)).length > sp0, 5000);
  const warn = (await spoken(page)).slice(sp0).join(" | ");
  check("Obstacle warning says 'Obstacle detected ahead. Please pause.'", /Obstacle detected ahead\. Please pause\./.test(warn), warn);
  check("No directional move-left/right guidance anywhere in speech", !(await spoken(page)).some((t) => /move (left|right)/i.test(t)));
  await api("POST", "/api/dev/vision/clear");
  check("No page errors in the voice session", errors.length === 0, errors.join(" / "));
  await page.context().close();

  // ---- unsupported browser ---------------------------------------------------------------
  const un = await openUser(browser, { recognition: false });
  await startJourney(un.page);
  check("Unsupported browser: voice shows Not supported, no Enable button",
    /Not supported/i.test(await voiceText(un.page)) && (await un.page.getByRole("button", { name: "Enable voice" }).count()) === 0,
    `${await voiceText(un.page)} ${await un.page.evaluate(() => typeof window.webkitSpeechRecognition + typeof window.SpeechRecognition)}`);
  await un.page.getByRole("button", { name: /^Help$/ }).click();
  check("Unsupported browser: Help button still creates a request", await until(async () => (await snap()).active_incident?.request_source === "button"));
  await until(async () => /Cancellation window/.test(await un.page.locator(".request-strip").innerText()), 5000);
  await un.page.keyboard.press("c");
  check("Unsupported browser: keyboard Cancel still works", await until(async () => (await snap()).last_incident?.status === "cancelled"));
  await un.ctx.close();

  // ---- denied microphone -------------------------------------------------------------------
  const dn = await openUser(browser, { recognition: true, micDenied: true });
  await startJourney(dn.page);
  await dn.page.getByRole("button", { name: "Enable voice" }).click();
  check("Denied microphone: clear error shown", await until(async () => /denied/i.test(await voiceText(dn.page)), 5000), await voiceText(dn.page));
  check("Denied microphone: no recognition session started", (await dn.page.evaluate(() => window.__rec.starts)) === 0);
  await dn.page.keyboard.press("h");
  check("Denied microphone: keyboard Help still creates a request", await until(async () => (await snap()).active_incident?.request_source === "button"));
  await dn.page.getByRole("button", { name: /^Cancel$/ }).click();
  check("Denied microphone: Cancel button still works", await until(async () => (await snap()).last_incident?.status === "cancelled"));

  // ---- narrow layout -----------------------------------------------------------------------
  await dn.page.setViewportSize({ width: 320, height: 700 });
  await sleep(300);
  check("320 px: no horizontal page overflow", await dn.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await dn.ctx.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} voice browser checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
