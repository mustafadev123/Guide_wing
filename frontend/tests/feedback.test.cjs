// Checkpoint, readiness and speech-priority logic: deterministic, no browser.
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
const { CheckpointTracker } = load('checkpoints.ts');
const { StableSignal, cameraSignal, cameraHold, cameraMessage, serverHold, CAMERA_HOLD_MS, SERVER_HOLD_MS } = load('readiness.ts');
const { Announcer } = load('speech.ts');

const NAMES = ['North entrance', 'Library crossing', 'Fountain plaza', 'Bus stop'];
const j = (over = {}) => ({ id: 'j1', status: 'active', waypoint_index: 0, route_progress: 0.1, ...over });

// ---- checkpoints -------------------------------------------------------------------------

test('a checkpoint is announced once when the backend waypoint index crosses its boundary', () => {
  const t = new CheckpointTracker(() => NAMES);
  assert.equal(t.observe(j()), null); // first sight: record only
  assert.equal(t.observe(j({ route_progress: 0.3 })), null);
  const cp = t.observe(j({ waypoint_index: 1, route_progress: 0.35 }));
  assert.deepEqual(cp, { key: 'checkpoint:j1:1', text: "You've reached Library crossing on the simulated route." });
  assert.equal(t.observe(j({ waypoint_index: 1, route_progress: 0.4 })), null); // once per journey
});

test('a poll that skips a boundary names both checkpoints in one announcement', () => {
  const t = new CheckpointTracker(() => NAMES);
  t.observe(j());
  const cp = t.observe(j({ waypoint_index: 2, route_progress: 0.7 }));
  assert.equal(cp.text, "You've passed Library crossing and reached Fountain plaza on the simulated route.");
  assert.equal(cp.key, 'checkpoint:j1:2');
});

test('refresh/reconnect mid-journey does not replay old checkpoints', () => {
  const t = new CheckpointTracker(() => NAMES); // a new page
  assert.equal(t.observe(j({ waypoint_index: 2, route_progress: 0.8 })), null);
  assert.equal(t.observe(j({ waypoint_index: 2, route_progress: 0.9 })), null);
});

test('paused or ended journeys do not speak a crossing, and the final waypoint is left to the end message', () => {
  const t = new CheckpointTracker(() => NAMES);
  t.observe(j());
  assert.equal(t.observe(j({ status: 'paused', waypoint_index: 1 })), null);
  assert.equal(t.observe(j({ status: 'active', waypoint_index: 1 })), null); // not replayed after resume
  assert.equal(t.observe(j({ status: 'ended', waypoint_index: 3, route_progress: 1 })), null);
  const u = new CheckpointTracker(() => NAMES);
  u.observe(j({ waypoint_index: 2, route_progress: 0.9 }));
  assert.equal(u.observe(j({ waypoint_index: 3, route_progress: 1 })), null);
});

test('a new journey UUID resets tracking without announcing', () => {
  const t = new CheckpointTracker(() => NAMES);
  t.observe(j());
  t.observe(j({ waypoint_index: 1 }));
  assert.equal(t.observe(j({ id: 'j2', status: 'idle', waypoint_index: 0, route_progress: 0 })), null);
  const cp = t.observe(j({ id: 'j2', waypoint_index: 1 }));
  assert.equal(cp.key, 'checkpoint:j2:1');
});

test('route names not loaded yet: falls back to the backend waypoint name for the reached checkpoint', () => {
  const t = new CheckpointTracker(() => []);
  t.observe(j());
  assert.equal(t.observe(j({ waypoint_index: 1 }), 'Library crossing').text, "You've reached Library crossing on the simulated route.");
});

// ---- readiness ---------------------------------------------------------------------------

test('camera signal: ready needs backend readiness; starting is silent; modes are labeled distinctly', () => {
  assert.equal(cameraSignal({ input_mode: 'live', ready: true, error: null }), 'ready-live');
  assert.equal(cameraSignal({ input_mode: 'replay', ready: true, error: null }), 'ready-replay');
  assert.equal(cameraSignal({ input_mode: 'test', ready: true, error: null }), 'ready-test');
  assert.equal(cameraSignal({ input_mode: 'live', ready: false, error: null }), 'starting');
  assert.equal(cameraSignal({ input_mode: 'live', ready: false, error: 'no fresh frame for 3.1s' }), 'unavailable');
  assert.equal(cameraSignal({ input_mode: 'unavailable', ready: false, error: 'capture failed' }), 'unavailable');
  assert.match(cameraMessage({ from: null, to: 'ready-live' }), /^Camera ready\. Live chair and open-palm recognition is running\.$/);
  assert.match(cameraMessage({ from: null, to: 'ready-replay' }), /recorded video, not a live camera/);
  assert.match(cameraMessage({ from: null, to: 'ready-test' }), /No camera is connected/);
  assert.equal(cameraMessage({ from: 'ready-live', to: 'unavailable' }), 'Camera unavailable. You can still request help.');
  assert.match(cameraMessage({ from: 'unavailable', to: 'ready-live' }), /^Camera ready again\./);
  assert.equal(cameraMessage({ from: null, to: 'starting' }), null);
  for (const to of ['ready-live', 'ready-replay', 'ready-test', 'unavailable']) assert.doesNotMatch(cameraMessage({ from: null, to }), /safe|clear path|move (left|right)/i);
});

test('camera failure and recovery are announced once each, after holding steady (no chatter)', () => {
  const s = new StableSignal(cameraHold);
  const seen = [];
  const feed = (raw, from, to, step = 250) => { for (let t = from; t <= to; t += step) { const x = s.update(raw, t); if (x) seen.push([t, x.from, x.to]); } };
  feed('ready-live', 0, 2000);
  // brief flicker shorter than the failure hold: nothing announced
  feed('unavailable', 2250, 2250 + CAMERA_HOLD_MS.failure - 500);
  feed('ready-live', 5000, 6000);
  feed('unavailable', 6250, 6250 + CAMERA_HOLD_MS.failure + 1000);
  feed('ready-live', 11000, 11000 + CAMERA_HOLD_MS.recovery + 500);
  assert.deepEqual(seen.map(x => x.slice(1)), [[null, 'ready-live'], ['ready-live', 'unavailable'], ['unavailable', 'ready-live']]);
  assert.equal(seen[1][0] - 6250, CAMERA_HOLD_MS.failure);
});

test('server loss is immediate-ish but recovery needs a steady connection', () => {
  const s = new StableSignal(serverHold);
  assert.deepEqual(s.update('up', 0), { from: null, to: 'up' });
  assert.equal(s.update('down', 1000), null);
  assert.equal(s.update('up', 1500), null); // flicker
  assert.equal(s.update('down', 2000), null);
  assert.deepEqual(s.update('down', 2000 + SERVER_HOLD_MS.down), { from: 'up', to: 'down' });
  assert.equal(s.update('up', 5000), null);
  assert.equal(s.update('down', 6000), null); // drops again before the recovery hold
  assert.equal(s.update('up', 6500), null);
  assert.deepEqual(s.update('up', 6500 + SERVER_HOLD_MS.up), { from: 'down', to: 'up' });
  assert.equal(s.update('up', 20000), null);
});

// ---- speech priority -----------------------------------------------------------------------

test('checkpoint/readiness narration never interrupts assistance or obstacle speech', () => {
  const p = { name: 'fake', spoken: [], available: () => true, speak(t) { this.spoken.push(t); this.onActivity?.(true); }, stop() { this.onActivity?.(false); } };
  const shown = [];
  const a = new Announcer(p, t => shown.push(t));
  a.enable();
  a.say('Your responder says they are on the way.'); // normal
  assert.equal(a.announce('checkpoint:j1:1', "You've reached Library crossing on the simulated route.", 'optional'), true); // key consumed
  assert.deepEqual(p.spoken, ['Your responder says they are on the way.']);
  assert.equal(a.lastMessage, 'Your responder says they are on the way.'); // Repeat still replays the assistance update
  assert.equal(a.announce('checkpoint:j1:1', 'again', 'optional'), false); // dropped, not queued for later
  p.onActivity(false);
  a.say('Camera ready.', 'optional');
  a.say('Obstacle detected ahead. Please pause.', 'urgent'); // urgent interrupts narration
  assert.deepEqual(p.spoken.slice(-2), ['Camera ready.', 'Obstacle detected ahead. Please pause.']);
});

test('no new announcement can be heard as a voice command', () => {
  const { parseCommand } = load('voice.ts');
  const { SERVER_DOWN_MESSAGE } = load('readiness.ts');
  const t = new CheckpointTracker(() => NAMES);
  t.observe(j());
  const texts = [
    SERVER_DOWN_MESSAGE, 'Your responder says they are on the way.',
    'Voice commands on. Microphone access granted. Press Speak a command, or the V key, before each command.',
    t.observe(j({ waypoint_index: 2 })).text,
    ...['ready-live', 'ready-replay', 'ready-test', 'unavailable'].flatMap(to => [cameraMessage({ from: null, to }), cameraMessage({ from: 'unavailable', to })]),
  ];
  for (const text of texts) {
    assert.equal(parseCommand(text), null, text);
    for (const sentence of text.split(/(?<=\.)\s+/)) assert.equal(parseCommand(sentence), null, sentence);
  }
});
