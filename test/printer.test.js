import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, completion, seedSeries, decide, fakePrintRenderer } from './helpers.js';
import { signature, canonIdFor, approvalsToPrint, buildCanon } from '../src/canon.js';
import { printApproved } from '../src/agents/printer.js';
import { listSeries } from '../src/agents/series-data.js';

const PRINTER_ROLE = await readFile(new URL('../roles/printer.md', import.meta.url), 'utf8');

// ---------- canon ----------

test('signature covers the sketch, Warhol\'s note and the approval', () => {
  const base = { sketch: '<html>a</html>', warholNote: 'Flat.', approvalId: 'A1' };
  const sig = signature(base);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(signature({ ...base }), sig);
  for (const change of [{ sketch: '<html>b</html>' }, { warholNote: null }, { approvalId: 'A2' }]) assert.notEqual(signature({ ...base, ...change }), sig);
});

test('canonIdFor is readable, stable and unique per series and variant', () => {
  assert.equal(canonIdFor({ subjectTitle: 'Café Soup: “Twelve” Cans!', variant: 'v03', seriesId: '01M3AGEEMAFBXZ7K9P0YYN2PSY' }), 'cafe-soup-twelve-cans-v03-yn2psy');
  assert.equal(canonIdFor({ subjectTitle: '???', variant: 'v01', seriesId: 'ABCDEF' }), 'untitled-v01-abcdef');
  assert.ok(canonIdFor({ subjectTitle: 'x'.repeat(200), variant: 'v01', seriesId: 'ABCDEF' }).length < 60);
});

test('approvalsToPrint: latest decision wins, failed and already-printed variants are skipped', async () => {
  const f = await tmpFactory();
  const { seriesId } = await seedSeries(f);
  await decide(f, seriesId, [['v01', 'approved'], ['v02', 'approved'], ['v02', 'vetoed'], ['v03', 'vetoed'], ['v03', 'approved']]);
  const views = await listSeries(f.floor);
  assert.deepEqual(approvalsToPrint(views, []).map((t) => t.variant.variant), ['v01', 'v03']);
  const published = [{ payload: { seriesId, variant: 'v01' } }];
  assert.deepEqual(approvalsToPrint(views, published).map((t) => t.variant.variant), ['v03']);
});

test('buildCanon joins works with their editions, ordered by edition', () => {
  const canon = buildCanon([
    { type: 'work.published', id: 'W1', ts: '2026-09-25T10:00:00Z', payload: { canonId: 'a' } },
    { type: 'work.published', id: 'W2', ts: '2026-09-25T10:01:00Z', payload: { canonId: 'b' } },
    { type: 'edition.released', ts: '2026-09-25T10:02:00Z', payload: { canonId: 'b', edition: 1, title: 'B', wallText: 'wb' } },
    { type: 'edition.released', ts: '2026-09-25T10:03:00Z', payload: { canonId: 'a', edition: 2, title: 'A', wallText: 'wa' } },
  ]);
  assert.deepEqual(canon.map((w) => [w.canonId, w.edition, w.title]), [['b', 1, 'B'], ['a', 2, 'A']]);
});

// ---------- the Printer ----------

async function printerSetup(replies = []) {
  const f = await tmpFactory({ roles: { 'printer.md': PRINTER_ROLE }, replies });
  const { seriesId, subject } = await seedSeries(f);
  await f.floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: seriesId, payload: { seriesId, picks: [{ variant: 'v02', note: 'Flat.' }] } });
  return { ...f, seriesId, subject };
}

test('printApproved signs each approved variant into the canon, with poster, later look and print check', async () => {
  const s = await printerSetup([completion(JSON.stringify({ verdict: 'ok', note: 'Holds up.' }), { model: 'test/vision' })]);
  const [approval] = await decide(s, s.seriesId, [['v02', 'approved', 'Yes.'], ['v01', 'vetoed']]);
  const renderer = fakePrintRenderer();

  const [work] = await printApproved({ config: s.config, floor: s.floor, llm: s.llm, renderer });
  const p = work.payload;
  assert.equal(work.type, 'work.published');
  assert.equal(work.actor, 'printer');
  assert.equal(work.ref, approval.id);
  assert.equal(p.canonId, canonIdFor({ subjectTitle: 'campbell soup', variant: 'v02', seriesId: s.seriesId }));
  assert.equal(p.warholNote, 'Flat.');
  assert.equal(p.humanNote, 'Yes.');
  assert.deepEqual({ verdict: p.printCheck.verdict, note: p.printCheck.note }, { verdict: 'ok', note: 'Holds up.' });

  const sketch = await readFile(join(s.root, p.sketch), 'utf8');
  assert.equal(sketch, '<html>v02</html>', 'the sketch is copied as built');
  assert.equal(p.signature, signature({ sketch, warholNote: 'Flat.', approvalId: approval.id }));
  await access(join(s.root, p.poster));
  await access(join(s.root, p.later));
  assert.deepEqual(renderer.calls.map((c) => c[0]), ['render', 'hold']);
  assert.equal(renderer.calls[1][2], 1000, 'holdSeconds from the config');

  const req = s.fetch.requests[0].body;
  assert.equal(req.messages[1].content.filter((c) => c.type === 'image_url').length, 2, 'poster and later');
  assert.match(req.messages[0].content, /campbell soup \(v02, grid-repeat\)\nWarhol said: Flat\.\nThe human said: Yes\./);

  const canon = JSON.parse(await readFile(join(s.config.paths.canon, 'canon.json'), 'utf8'));
  assert.deepEqual(canon.works.map((w) => w.canonId), [p.canonId]);

  assert.deepEqual(await printApproved({ config: s.config, floor: s.floor, llm: s.llm, renderer }), [], 'nothing is printed twice');
});

test('a work that breaks while running is signed anyway, with a concern that the model cannot overrule', async () => {
  const s = await printerSetup([completion(JSON.stringify({ verdict: 'ok', note: 'Looks fine.' }))]);
  await decide(s, s.seriesId, [['v01', 'approved']]);
  const [work] = await printApproved({ config: s.config, floor: s.floor, llm: s.llm, renderer: fakePrintRenderer({ failHold: 'error' }) });
  assert.equal(work.payload.printCheck.verdict, 'concern');
  assert.match(work.payload.printCheck.note, /^the piece threw an error while running; Looks fine\.$/);
  assert.match(work.payload.printCheck.hold.errors[0], /later is not defined/);
});

test('without a model, or when the check fails, the work is still printed and marked', async () => {
  const s = await printerSetup([{ status: 400, body: { error: { code: 400, message: 'no' } } }]);
  await decide(s, s.seriesId, [['v01', 'approved'], ['v03', 'approved']]);
  const [a] = await printApproved({ config: s.config, floor: s.floor, llm: s.llm, renderer: fakePrintRenderer() }, { limit: 1 });
  assert.equal(a.payload.printCheck.verdict, 'unchecked');
  assert.match(a.payload.printCheck.note, /print check failed/);
  const [b] = await printApproved({ config: s.config, floor: s.floor, llm: null, renderer: fakePrintRenderer({ failHold: 'blank' }) });
  assert.deepEqual({ v: b.payload.printCheck.verdict, n: b.payload.printCheck.note }, { v: 'concern', n: 'the piece went blank while running' });
});
