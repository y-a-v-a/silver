// How the human steers the making: pins for one series, the technique bench, direction.md,
// a line said on the floor, a pin on a subject, a note on a second pull, a paused shift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMatrix, drawTechniques, dealBriefs, formatBrief, HUMAN_PERSONA, sketchVars, weightedSample } from '../src/agents/studio.js';
import { runSeries, SeriesError } from '../src/agents/assistants.js';
import { chatterPrompt, ChatterError, HOUSE_RULES, runSuperstars, sayOnFloor } from '../src/agents/superstars.js';
import { pinnedSubjects, pinSubject, retireSubject } from '../src/agents/retire.js';
import { secondPull } from '../src/agents/pull.js';
import { shortlistSeries } from '../src/agents/warhol.js';
import { digest } from '../src/agents/archivist.js';
import { pickSubjects, runShift } from '../src/shift.js';
import { postCommission } from '../src/agents/commissions.js';
import { mergeOverlay } from '../src/settings.js';
import { writeDirection } from '../src/lib/direction.js';
import { completion, seedSeries, tmpFactory } from './helpers.js';
import shipped from '../silver.config.js';

const role = (name) => readFile(new URL(`../roles/${name}.md`, import.meta.url), 'utf8');
const SKETCH = '```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\n```';

async function studio({ replies = 4 } = {}) {
  const f = await tmpFactory({ roles: { 'studio-assistant.md': await role('studio-assistant'), 'warhol.md': await role('warhol'), 'second-pull.md': await role('second-pull') }, replies: Array.from({ length: replies }, () => completion(SKETCH)) });
  f.config = { ...f.config, series: { variants: 2, modelsPerSeries: 1, temperatures: [0.7], techniquesPerSeries: 1, concurrency: 1 }, techniques: { halftone: 'Dots.', ledger: 'Rows.' } };
  return f;
}

const subject = (f, title = 'a can') => f.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title, why: 'The can.', snapshot: {} } });

// ---------- the matrix ----------

test('pins replace what would have been dealt, and only that', () => {
  const m = buildMatrix(shipped, { steer: { techniques: ['rorschach'], models: ['a/b'], temperatures: [1.5] } });
  assert.deepEqual(m.techniques, ['rorschach']);
  assert.deepEqual(m.models, ['a/b']);
  assert.deepEqual(m.temperatures, [1.5]);
  assert.equal(m.cells.length, 12, 'the series keeps its size: the one combination repeats');
  assert.ok(m.cells.every((c) => c.technique === 'rorschach' && c.model === 'a/b' && c.temperature === 1.5));
  assert.equal(new Set(m.cells.map((c) => c.dare)).size, 12, 'the deck is still dealt');
  assert.ok(buildMatrix(shipped, { steer: { dare: 'Make it tender.' } }).cells.every((c) => c.dare === 'Make it tender.'));
  assert.ok(buildMatrix(shipped, { dryRun: true, steer: { models: ['a/b'] } }).cells.every((c) => c.model === shipped.models.dryRun), 'a dry run stays cheap whatever was pinned');
});

test('a benched technique is never drawn; favoured ones come up more often', () => {
  const benched = mergeOverlay(shipped, { steering: { techniques: Object.fromEntries(Object.keys(shipped.techniques).filter((t) => !['rorschach', 'seismograph', 'x-ray'].includes(t)).map((t) => [t, 0])) } });
  for (let i = 0; i < 40; i++) {
    for (const t of drawTechniques(benched, 2)) assert.ok(['rorschach', 'seismograph', 'x-ray'].includes(t));
  }
  const favoured = { techniques: { a: 'x', b: 'y' }, steering: { techniques: { a: 3 } } };
  let a = 0;
  let i = 0;
  const rng = () => (i++ % 100) / 100;
  for (let n = 0; n < 100; n++) if (drawTechniques(favoured, 1, rng)[0] === 'a') a++;
  assert.equal(a, 75, 'three times as often as the other one');
  assert.equal(weightedSample(['a', 'b', 'c'], () => 1, 3).length, 3);
  assert.equal(new Set(weightedSample(['a', 'b', 'c'], () => 1, 3)).size, 3, 'without replacement');
});

// ---------- a series ----------

test('a pinned series records its steer; every assistant reads the human\'s note and the standing direction', async () => {
  const f = await studio();
  await writeDirection(f.config.root, { studio: 'No text anywhere.' });
  const s = await subject(f);
  const r = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.id, { steer: { techniques: ['ledger'], note: 'Think of rain.' } });
  assert.deepEqual(r.matrix.techniques, ['ledger']);
  const [started] = await f.floor.read({ type: 'series.started' });
  assert.deepEqual(started.payload.steer, { techniques: ['ledger'], note: 'Think of rain.' });
  assert.equal(started.payload.direction, 'No text anywhere.\n\nThink of rain.');
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, /## From the human\n\nNo text anywhere\.\n\nThink of rain\./);
  assert.match(system, /## Your procedure: ledger/);
});

test('with no direction the prompt says so, and the series records nothing about it', async () => {
  const f = await studio();
  const s = await subject(f);
  await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.id);
  const [started] = await f.floor.read({ type: 'series.started' });
  assert.equal('direction' in started.payload, false);
  assert.equal('steer' in started.payload, false);
  assert.match(f.fetch.requests[0].body.messages[0].content, /## From the human\n\n\(nothing from the human today\)/);
});

test('a pin that names nothing real is refused before any money is spent', async () => {
  const f = await studio();
  const s = await subject(f);
  const run = (steer) => runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.id, { steer });
  await assert.rejects(run({ techniques: ['nope'] }), (e) => e instanceof SeriesError && /no technique "nope"/.test(e.message));
  await assert.rejects(run({ models: ['not a slug'] }), /not an OpenRouter model id/);
  await assert.rejects(run({ temperatures: [9] }), /between 0 and 2/);
  assert.equal(f.fetch.requests.length, 0);
  assert.equal((await f.floor.read({ type: 'series.started' })).length, 0);
});

// ---------- the floor ----------

test('a line the human says on the floor is dealt as a brief like anyone\'s', async () => {
  const f = await studio();
  const s = await subject(f);
  const e = await sayOnFloor(f.floor, s, '  It smells   of rain. ');
  assert.equal(e.actor, 'human');
  assert.equal(e.payload.text, 'It smells of rain.');
  await assert.rejects(sayOnFloor(f.floor, s, '   '), ChatterError);
  await assert.rejects(sayOnFloor(f.floor, s, 'x'.repeat(281)), /at most 280/);

  const [cell] = dealBriefs([{ variant: 'v01' }], [e]);
  assert.equal(cell.brief.from, HUMAN_PERSONA);
  assert.equal(formatBrief(cell.brief, s), 'The human said it on the floor: “It smells of rain.”');
  assert.match(sketchVars({ subject: s, chatter: [e], cell, techniques: { t: 'g' } }).floor_excerpt, /- human: It smells of rain\./);
  await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.id);
  assert.match(f.fetch.requests[0].body.messages[0].content, /The human said it on the floor: “It smells of rain\.”/);
});

test('the superstars hear the human\'s standing note in their prompt, and it stays out when empty', async () => {
  assert.equal(chatterPrompt('').includes('walked through'), false);
  assert.ok(chatterPrompt('').startsWith(HOUSE_RULES));
  assert.match(chatterPrompt('Be crueller.'), /The human walked through and said this to the floor\. Do what you like with it:\nBe crueller\./);

  const f = await tmpFactory({ roles: { 'superstars/viva.md': await role('superstars/viva') }, replies: [completion(JSON.stringify({ lines: [{ subject: 1, text: 'Boring.' }] }))] });
  await writeDirection(f.config.root, { superstars: 'Talk about the weather.' });
  const s = await subject(f);
  await runSuperstars({ config: f.config, floor: f.floor, llm: f.llm }, { subjects: [s], rng: () => 0.9 });
  assert.match(f.fetch.requests[0].body.messages.at(-1).content, /Talk about the weather\./);
});

test('Warhol reads what the human is after right now', async () => {
  const f = await studio({ replies: 0 });
  await writeDirection(f.config.root, { warhol: 'Pick the ugly one.' });
  const { seriesId } = await seedSeries(f, { produced: ['v01'], failed: [] });
  f.fetch.queue.push(completion(JSON.stringify({ picks: [{ variant: 'v01', note: 'Gee.' }], rejects: null }), { model: 'test/vision' }));
  await shortlistSeries({ config: f.config, floor: f.floor, llm: f.llm }, seriesId);
  assert.match(f.fetch.requests.at(-1).body.messages[0].content, /what they're after right now:\n\nPick the ugly one\./);
});

// ---------- the queue ----------

test('a pinned subject from any day goes first; unpinned, it waits again; claimed or retired ones never go', async () => {
  const f = await tmpFactory();
  let date = new Date('2026-01-01T09:00:00');
  const floor = (await import('../src/floor.js')).createFloor({ dir: f.config.paths.floor, now: () => date });
  const old = await floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'old news' } });
  date = new Date('2026-01-03T09:00:00');
  const today = await floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'today' } });
  const { event: commission } = await postCommission({ floor, fetch: async () => new Response('x') }, 'my own');
  const ids = async () => (await pickSubjects(floor, '2026-01-03', 5)).map((s) => s.id);

  assert.deepEqual(await ids(), [commission.id, today.id], 'yesterday\'s scouted news is not picked by itself');
  await pinSubject(floor, old);
  assert.deepEqual(await ids(), [old.id, commission.id, today.id]);
  assert.ok((await pinnedSubjects(floor)).has(old.id));
  await pinSubject(floor, today);
  assert.deepEqual(await ids(), [old.id, today.id, commission.id], 'no subject twice, pins in the order they were made');
  await pinSubject(floor, old, false);
  assert.deepEqual(await ids(), [today.id, commission.id]);
  await retireSubject(floor, today);
  assert.deepEqual(await ids(), [commission.id], 'a retired subject loses its pin too');
});

// ---------- the second pull ----------

test('the human can send any variant back with a note, and again after it already came back', async () => {
  const f = await studio();
  f.config = { ...f.config, techniques: { ledger: 'Rows.' } }; // seedSeries' halftone has left the menu
  const { seriesId } = await seedSeries(f, { produced: ['v01', 'v02'], failed: [] });
  await writeFile(join(f.config.root, 'archive', 'variants', seriesId, 'v01.html'), `<html><script>\n// SKETCH: x\nfunction setup(){}\n</script>\n</body>`);
  const deps = { config: f.config, floor: f.floor, llm: f.llm, renderer: null };
  const r = await secondPull(deps, seriesId, { variant: 'v01', note: 'Bigger, and no red.' });
  assert.equal(r.ok, true);
  assert.equal(r.event.payload.humanNote, 'Bigger, and no red.');
  const system = f.fetch.requests.at(-1).body.messages[0].content;
  assert.match(system, /## What the human said about it\n\nBigger, and no red\./);
  assert.match(system, /\(this procedure has left the menu/, 'an old variant whose procedure was retired can still be pulled');

  await assert.rejects(secondPull(deps, seriesId, { variant: 'v01' }), /already has a second pull/);
  const again = await secondPull(deps, seriesId, { variant: 'v01', note: 'Once more.', again: true });
  assert.equal(again.variant, 'v04');
});

// ---------- the shift ----------

test('a paused shift does nothing and spends nothing, unless it is forced or a dry run', async () => {
  const f = await tmpFactory();
  const config = { ...f.config, series: { secondPulls: 0 }, shift: { paused: true, subjectsPerShift: 1, seriesPerShift: 1, maxArchiveSubjectsPerShift: 0 } };
  const deps = { config, floor: f.floor, llm: f.llm, budget: f.budget, createRenderer: async () => null };
  assert.deepEqual(await runShift(deps), { shift: f.floor.today(), status: 'paused' });
  assert.equal((await f.floor.read()).length, 0);
  const forced = await runShift({ ...deps, config: { ...config, sources: { rss: [], trending: { googleTrendsGeo: 'US', hackernews: false, reddit: false }, itemsPerSource: 1, repeatAfterDays: 1 } }, fetch: async () => new Response('', { status: 500 }) }, { force: true });
  assert.notEqual(forced.status, 'paused');
});

// ---------- the record ----------

test('the diary hears about the human\'s steering', () => {
  const at = (type, payload, extra = {}) => ({ id: `0${type}`, ts: '2026-11-04T09:00:00Z', shift: '2026-11-04', type, actor: 'human', ref: null, payload, ...extra });
  const { text } = digest([
    at('subject.posted', { title: 'a can', origin: 'scouted' }, { id: 'S' }),
    at('subject.pinned', { subjectId: 'S', pinned: true }),
    at('studio.changed', { what: 'role', target: 'viva', summary: "Viva's soul" }),
    at('series.started', { subjectId: 'S', variants: 2, techniques: ['x'], steer: { note: 'Rain.' } }, { id: 'T' }),
    at('variant.produced', { seriesId: 'T', variant: 'v03', pullOf: 'v01', humanNote: 'Bigger.' }),
  ]);
  assert.match(text, /the human pins "a can" to the front of the queue/);
  assert.match(text, /the human changes Viva's soul/);
  assert.match(text, /The human told them: "Rain\."/);
  assert.match(text, /the human sends v01 of "a can" back \("Bigger\."\)/);
});

// ---------- the shift and what the admin does around it ----------

const shiftSetup = async (replies = []) => {
  const f = await tmpFactory({ roles: { 'superstars/viva.md': await role('superstars/viva'), 'studio-assistant.md': await role('studio-assistant'), 'scout.md': await role('scout') }, replies });
  const config = { ...f.config, series: { variants: 1, modelsPerSeries: 1, temperatures: [0.7], techniquesPerSeries: 1, concurrency: 1, secondPulls: 0 }, techniques: { halftone: 'Dots.' }, shift: { subjectsPerShift: 1, seriesPerShift: 1, maxArchiveSubjectsPerShift: 0 }, sources: { rss: [], trending: { googleTrendsGeo: 'US', hackernews: false, reddit: false }, itemsPerSource: 1, repeatAfterDays: 1 } };
  const renderer = { render: async (path) => { const png = path.replace('.html', '.png'); await writeFile(png, Buffer.from([1])); return { ok: true, reason: null, shots: [{ seed: 1, png, colors: 9 }], errors: [], blocked: [], readySignal: true, ms: 1 }; }, close: async () => {} };
  return { ...f, config, deps: { config, floor: f.floor, llm: f.llm, budget: f.budget, createRenderer: async () => renderer, fetch: async () => new Response('', { status: 500 }) } };
};

test('only one shift runs at a time: a second process steps aside, and a dead one\'s lock is taken over', async () => {
  const { shiftLockPath } = await import('../src/shift.js');
  const { mkdir } = await import('node:fs/promises');
  const f = await shiftSetup();
  await mkdir(f.config.paths.archive, { recursive: true });
  await writeFile(shiftLockPath(f.config), String(process.ppid));
  assert.deepEqual(await runShift(f.deps), { shift: f.floor.today(), status: 'busy', pid: process.ppid });
  assert.equal((await f.floor.read()).length, 0, 'it did nothing at all');
  await writeFile(shiftLockPath(f.config), '999999');
  assert.notEqual((await runShift(f.deps)).status, 'busy');
  await assert.rejects(readFile(shiftLockPath(f.config)), /ENOENT/, 'and it let go at the end');
});

test('a series made by hand doesn\'t take the day\'s slot, and talk from before the Scout doesn\'t stop the shift\'s', async () => {
  const f = await shiftSetup();
  const early = await subject(f, 'an early commission');
  f.fetch.queue.push(completion(SKETCH));
  await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, early.id, { byHand: true });
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.viva', ref: early.id, payload: { persona: 'viva', text: 'At eight in the morning.' } });
  // The Scout brings in today's subject, then the superstars talk about it, then the series.
  f.deps.fetch = async () => new Response('', { status: 500 });
  const scouted = await f.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'the morning news', snapshot: {} } });
  f.fetch.queue.push(completion(JSON.stringify({ lines: [{ subject: 1, text: 'Boring.' }] })), completion(SKETCH));
  const r = await runShift(f.deps);
  const byStep = Object.fromEntries(r.steps.map((s) => [s.step, s]));
  assert.equal(byStep.superstars.status, 'done', byStep.superstars.reason);
  assert.equal(byStep.series.status, 'done', byStep.series.reason);
  assert.deepEqual(r.series.map((s) => s.subjectId), [scouted.id]);
});

