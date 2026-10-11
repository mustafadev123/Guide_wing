const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const source = path.resolve(__dirname, '../src/analyticsMetrics.ts');
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = Module._nodeModulePaths(path.dirname(source));
loaded._compile(compiled, source);
const { summarizeIncidents, summaryMatches } = loaded.exports;
const asOf = Date.parse('2026-10-10T12:00:00Z');
function incident(overrides = {}) {
  return { created_at: '2026-10-10T10:00:00Z', status: 'resolved', is_test: false,
    dispatched_at: '2026-10-10T10:00:10Z', acknowledged_at: '2026-10-10T10:00:40Z',
    resolved_at: '2026-10-10T10:02:40Z', ...overrides };
}
test('range uses creation time, excludes future/invalid dates and tests by default', () => {
  const rows = [incident(), incident({is_test:true}), incident({created_at:'2026-10-08T12:00:00Z'}), incident({created_at:'2026-10-11T12:00:00Z'}), incident({created_at:'invalid'})];
  assert.equal(summarizeIncidents(rows, 'day', false, asOf).total, 1);
  assert.equal(summarizeIncidents(rows, 'week', false, asOf).total, 2);
  assert.equal(summarizeIncidents(rows, 'day', true, asOf).total, 2);
});
test('statuses partition the selection, including cancellation before dispatch', () => {
  const rows = ['pending','dispatched','acknowledged','resolved','cancelled'].map(status => incident({status}));
  const summary = summarizeIncidents(rows, 'loaded', false, asOf);
  assert.equal(summary.total, 5);
  assert.equal(Object.values(summary.counts).reduce((a,b)=>a+b,0), 5);
  assert.equal(summary.counts.cancelled, 1);
});
test('response times use dispatch and acceptance, skip missing or reversed timestamps', () => {
  const rows = [incident(), incident({status:'cancelled',dispatched_at:null,acknowledged_at:null,resolved_at:null}), incident({acknowledged_at:'2026-10-10T09:00:00Z',resolved_at:null})];
  const summary = summarizeIncidents(rows, 'loaded', false, asOf);
  assert.equal(summary.acceptedSeconds, 30);
  assert.equal(summary.acceptedSample, 1);
  assert.equal(summary.resolvedSeconds, 120);
  assert.equal(summary.resolvedSample, 1);
});
test('empty data produces zero counts and unavailable durations', () => {
  const summary = summarizeIncidents([], 'day', false, asOf);
  assert.equal(summary.total, 0);
  assert.equal(summary.acceptedSeconds, null);
  assert.equal(summary.resolvedSeconds, null);
});

test('generated snapshot stays current only while its recorded figures match', () => {
  const current = summarizeIncidents([incident()], 'day', false, asOf);
  const saved = { total: 1, counts: current.counts, accepted_seconds: 30,
    accepted_sample: 1, resolved_seconds: 120, resolved_sample: 1 };
  assert.equal(summaryMatches(current, saved), true);
  assert.equal(summaryMatches(current, {...saved, total: 2}), false);
  assert.equal(summaryMatches(current, {...saved, accepted_sample: 0}), false);
  assert.equal(summaryMatches(current, {...saved, counts: {...saved.counts, pending: 1}}), false);
});
