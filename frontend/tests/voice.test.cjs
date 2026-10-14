// Deterministic voice-command tests: a mock recognizer and manual timers, no microphone or browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(file) {
  const source = path.resolve(__dirname, '../src', file);
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(source, module);
  loaded.filename = source;
  loaded.paths = Module._nodeModulePaths(path.dirname(source));
  loaded._compile(compiled, source);
  return loaded.exports;
}
const { parseCommand, pickCommand, VoiceController, createBrowserRecognizer, SPEECH_TAIL_MS, DUPLICATE_WINDOW_MS } = load('voice.ts');
const { Announcer } = load('speech.ts');

class MockRecognizer {
  constructor() { this.continuous = false; this.starts = 0; this.aborts = 0; this.stops = 0; this.active = false; this.onstart = this.onresult = this.onerror = this.onend = null; }
  start() { if (this.active) throw new Error('InvalidStateError'); this.active = true; this.starts++; this.onstart?.(); }
  stop() { this.stops++; this.end(); }
  abort() { this.aborts++; if (this.active) { this.onerror?.('aborted'); this.end(); } }
  end() { if (!this.active) return; this.active = false; this.onend?.(); }
  say(transcript, confidence = 0.9) { this.onresult?.([{ transcript, confidence }]); }
  fail(code) { this.onerror?.(code); this.end(); }
}

function harness({ supported = true, mic = async () => {}, handler } = {}) {
  let t = 1_000_000;
  const timers = [];
  const rec = supported ? new MockRecognizer() : null;
  const commands = [];
  const snaps = [];
  const ctl = new VoiceController({
    createRecognizer: () => rec,
    requestMicrophone: mic,
    onCommand: (c, transcript) => { commands.push(c); return handler?.(c, transcript); },
    onChange: s => snaps.push(s),
    now: () => t,
    setTimer: (fn, ms) => { const id = { at: t + ms, fn }; timers.push(id); return id; },
    clearTimer: id => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = ms => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift(); t = next.at; next.fn();
    }
    t = end;
  };
  return { ctl, rec, commands, snaps, advance, flush: () => new Promise(r => setImmediate(r)), get state() { return ctl.snapshot.state; } };
}

// ---- grammar ---------------------------------------------------------------------------

test('grammar requires the GuideWing prefix and one command word', () => {
  for (const [said, cmd] of [['GuideWing, help', 'help'], ['guide wing help', 'help'], ['Guide-Wing cancel.', 'cancel'], ['Hey GuideWing, status', 'status'],
    ['guidewing repeat please', 'repeat'], ['Guide wings help', 'help'], ['  GUIDEWING  HELP ', 'help'], ['um guide wing cancel', 'cancel']]) {
    assert.equal(parseCommand(said), cmd, said);
  }
  for (const said of ['help', 'cancel', 'please help', 'guidewing', 'guidewing help me find the exit', 'guiding help', 'the guidewing help',
    'guidewing cancel help', 'guidewing resume', 'obstacle detected ahead please pause', 'journey paused resume when ready', '']) {
    assert.equal(parseCommand(said), null, said);
  }
});

test('low reported confidence never yields a command; unreported (0) confidence relies on the strict grammar', () => {
  assert.equal(pickCommand([{ transcript: 'guidewing help', confidence: 0.3 }]).command, null);
  assert.equal(pickCommand([{ transcript: 'guidewing help', confidence: 0.3 }]).reason, 'low-confidence');
  assert.equal(pickCommand([{ transcript: 'guidewing help', confidence: 0 }]).command, 'help');
  assert.equal(pickCommand([{ transcript: 'guide wing hell', confidence: 0.9 }, { transcript: 'guide wing help', confidence: 0.7 }]).command, 'help');
  assert.equal(pickCommand([{ transcript: 'nice weather', confidence: 0.95 }]).reason, 'not-a-command');
});

test('browser adapter forwards only final results and is absent without the API', () => {
  assert.equal(createBrowserRecognizer({}), null);
  let native;
  class Fake { constructor() { native = this; } start() {} stop() {} abort() {} }
  const r = createBrowserRecognizer({ webkitSpeechRecognition: Fake });
  assert.equal(native.interimResults, false);
  const got = [];
  r.onresult = alts => got.push(alts[0].transcript);
  const result = (text, isFinal) => Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal });
  native.onresult({ resultIndex: 0, results: [result('guidewing he', false), result('guidewing help', true)] });
  assert.deepEqual(got, ['guidewing help']);
});

// ---- controller ------------------------------------------------------------------------

test('one spoken Help runs the command once; duplicate final results are ignored', async () => {
  let requests = 0;
  const h = harness({ handler: async c => { if (c === 'help') requests++; } });
  await h.ctl.enable();
  assert.equal(h.state, 'ready');
  h.ctl.pushToTalk(); h.advance(300);
  assert.equal(h.rec.starts, 1);
  assert.equal(h.state, 'listening');
  h.rec.say('GuideWing, help');
  h.rec.say('GuideWing, help'); // Chromium can deliver the same final result twice
  await h.flush();
  h.rec.say('guide wing help');
  h.advance(DUPLICATE_WINDOW_MS - 1); h.rec.say('GuideWing help');
  await h.flush();
  assert.deepEqual(h.commands, ['help']);
  assert.equal(requests, 1);
  assert.equal(h.ctl.snapshot.lastHeard.transcript, 'GuideWing, help');
});

test('a second command while one is processing does not run', async () => {
  let release;
  const h = harness({ handler: () => new Promise(r => { release = r; }) });
  await h.ctl.enable(); h.ctl.setContinuous(true); h.advance(1);
  h.rec.say('guidewing help');
  assert.equal(h.state, 'processing');
  h.rec.say('guidewing cancel');
  await h.flush();
  assert.deepEqual(h.commands, ['help']);
  release(); await h.flush();
  assert.notEqual(h.state, 'processing');
  h.rec.say('guidewing cancel');
  await h.flush();
  assert.deepEqual(h.commands, ['help', 'cancel']);
});

test('unknown and low-confidence speech changes nothing', async () => {
  const h = harness();
  await h.ctl.enable(); h.ctl.setContinuous(true); h.advance(1);
  h.rec.say('help'); h.rec.say('cancel that'); h.rec.say('guidewing help', 0.2); h.rec.say('guidewing open the door');
  await h.flush();
  assert.deepEqual(h.commands, []);
  assert.match(h.ctl.snapshot.message, /Nothing was changed/);
});

test('app speech pauses recognition, discards overlapping results, and resumes once after the tail', async () => {
  const h = harness();
  await h.ctl.enable(); h.ctl.setContinuous(true); h.advance(1);
  assert.equal(h.rec.starts, 1);
  h.ctl.setSpeaking(true);
  assert.equal(h.rec.aborts, 1);
  assert.equal(h.state, 'speaking');
  h.rec.say('guidewing help'); // late result from the aborted session, or the app's own voice
  h.advance(5000);
  assert.equal(h.rec.starts, 1, 'no restart while speaking');
  h.ctl.setSpeaking(false);
  h.rec.say('guidewing help'); // late result with no session open
  h.advance(SPEECH_TAIL_MS - 1);
  assert.equal(h.rec.starts, 1);
  h.advance(1);
  assert.equal(h.rec.starts, 2);
  h.ctl.setSpeaking(true); h.ctl.setSpeaking(false); h.ctl.setSpeaking(true);
  assert.equal(h.rec.aborts, 2, 'one abort per speech start on an active session');
  await h.flush();
  assert.deepEqual(h.commands, []);
});

test('push-to-talk after barge-in waits briefly, then listens', async () => {
  const h = harness();
  await h.ctl.enable();
  h.ctl.setSpeaking(true); h.ctl.setSpeaking(false); // page silenced the announcer
  h.ctl.pushToTalk();
  h.advance(200); assert.equal(h.rec.starts, 0);
  h.advance(100); assert.equal(h.rec.starts, 1);
  h.advance(SPEECH_TAIL_MS);
  h.rec.say('guidewing cancel');
  await h.flush();
  assert.deepEqual(h.commands, ['cancel']);
});

test('push-to-talk pressed while a session is closing starts a fresh session after it ends', async () => {
  const h = harness();
  await h.ctl.enable(); h.ctl.setContinuous(true); h.advance(1);
  h.rec.end = function () { if (!this.active) return; this.active = false; this.pendingEnd = true; }; // onend arrives later
  h.ctl.setContinuous(false); // asks the continuous session to stop
  assert.equal(h.rec.stops, 1);
  h.ctl.pushToTalk();
  h.rec.pendingEnd = false; h.rec.onend();
  h.advance(250);
  assert.equal(h.rec.starts, 2);
  assert.equal(h.rec.continuous, false);
  h.rec.say('guidewing status');
  await h.flush();
  assert.deepEqual(h.commands, ['status']);
});

test('push-to-talk with no speech does not restart by itself', async () => {
  const h = harness();
  await h.ctl.enable();
  h.ctl.pushToTalk(); h.advance(300);
  h.rec.fail('no-speech');
  h.advance(60_000);
  assert.equal(h.rec.starts, 1);
  assert.equal(h.state, 'ready');
});

test('continuous listening backs off and stops instead of looping when sessions end immediately', async () => {
  const h = harness();
  await h.ctl.enable(); h.ctl.setContinuous(true);
  h.rec.start = function () { this.starts++; this.active = true; this.onstart?.(); this.end(); };
  h.advance(120_000);
  assert.ok(h.rec.starts <= 7, `${h.rec.starts} starts`);
  assert.equal(h.state, 'error');
  assert.equal(h.ctl.snapshot.continuous, false);
});

test('denied microphone and unsupported browsers leave voice disabled', async () => {
  const denied = harness({ mic: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } });
  await denied.ctl.enable();
  assert.equal(denied.state, 'error');
  assert.equal(denied.ctl.snapshot.enabled, false);
  assert.match(denied.ctl.snapshot.message, /denied/);
  assert.equal(denied.ctl.pushToTalk(), false);
  const none = harness({ supported: false });
  assert.equal(none.ctl.supported, false);
  assert.equal(none.state, 'unsupported');
  await none.ctl.enable();
  assert.equal(none.state, 'unsupported');
  const revoked = harness();
  await revoked.ctl.enable(); revoked.ctl.setContinuous(true); revoked.advance(1);
  revoked.rec.fail('not-allowed');
  revoked.advance(60_000);
  assert.equal(revoked.rec.starts, 1);
  assert.equal(revoked.state, 'error');
});

test('network errors stop continuous listening; hidden tabs pause and resume', async () => {
  const h = harness();
  await h.ctl.enable(); h.ctl.setContinuous(true); h.advance(1);
  h.rec.fail('network'); h.advance(60_000);
  assert.equal(h.rec.starts, 1);
  assert.match(h.ctl.snapshot.message, /network/);
  const b = harness();
  await b.ctl.enable(); b.ctl.setContinuous(true); b.advance(1);
  b.ctl.setHidden(true);
  assert.equal(b.rec.aborts, 1);
  b.advance(60_000); assert.equal(b.rec.starts, 1);
  b.ctl.setHidden(false); b.advance(SPEECH_TAIL_MS);
  assert.equal(b.rec.starts, 2);
});

test('disable stops listening and ignores later results', async () => {
  const h = harness();
  await h.ctl.enable(); h.ctl.setContinuous(true); h.advance(1);
  h.ctl.disable();
  h.rec.say('guidewing help');
  h.advance(60_000);
  assert.deepEqual(h.commands, []);
  assert.equal(h.rec.starts, 1);
  assert.equal(h.state, 'off');
});

// ---- announcer ---------------------------------------------------------------------------

function fakeProvider() {
  const p = { name: 'fake', spoken: [], available: () => true, onActivity: undefined,
    speak(text) { this.spoken.push(text); this.onActivity?.(true); }, stop() { this.onActivity?.(false); }, finish() { this.onActivity?.(false); } };
  return p;
}

test('announcer reports speaking and optional narration never interrupts an urgent warning', () => {
  const p = fakeProvider();
  const shown = [];
  const a = new Announcer(p, t => shown.push(t));
  const events = [];
  a.onSpeaking(on => events.push(on));
  a.enable();
  a.say('Obstacle detected ahead. Please pause.', 'urgent');
  assert.equal(a.say('Journey active.', 'optional'), false);
  assert.deepEqual(p.spoken, ['Obstacle detected ahead. Please pause.']);
  assert.equal(a.lastMessage, 'Obstacle detected ahead. Please pause.');
  p.finish();
  assert.equal(a.say('Journey active.', 'optional'), true);
  a.say('Help request recorded.'); // normal messages still replace narration
  assert.deepEqual(p.spoken, ['Obstacle detected ahead. Please pause.', 'Journey active.', 'Help request recorded.']);
  assert.deepEqual(events, [true, false, true]);
  a.silence();
  assert.equal(a.speaking, false);
  assert.equal(a.enabled, true);
});
