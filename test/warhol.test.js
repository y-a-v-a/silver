import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpFactory, completion, seedSeries } from './helpers.js';
import { listSeries, findSeries, isPendingReview, SeriesNotFound } from '../src/agents/series-data.js';
import { shortlistSeries, validateShortlist, describeVariants, ShortlistError } from '../src/agents/warhol.js';
import { appendTaste } from '../src/lib/taste.js';

const WARHOL_ROLE = await readFile(new URL('../roles/warhol.md', import.meta.url), 'utf8');

// ---------- series views ----------

test('listSeries assembles subject, variants (ok and failed), shortlist and decisions', async () => {
  const f = await tmpFactory();
  const { seriesId, subject } = await seedSeries(f);
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.viva', ref: subject.id, payload: { text: 'Soup again.' } });
  const [s] = await listSeries(f.floor);
  assert.equal(s.seriesId, seriesId);
  assert.equal(s.subject.id, subject.id);
  assert.equal(s.chatter.length, 1);
  assert.deepEqual(s.variants.map((v) => [v.variant, v.ok, v.reason]), [['v01', true, null], ['v02', true, null], ['v03', true, null], ['v04', false, 'blank']]);
  assert.equal(s.variants[0].png, `archive/variants/${seriesId}/v01.png`);
  assert.ok(isPendingReview(s));

  await f.floor.append({ type: 'review.decision', actor: 'human', ref: seriesId, payload: { seriesId, variant: 'v01', verdict: 'vetoed' } });
  await f.floor.append({ type: 'review.decision', actor: 'human', ref: seriesId, payload: { seriesId, variant: 'v01', verdict: 'approved' } });
  await f.floor.append({ type: 'review.decision', actor: 'human', ref: seriesId, payload: { seriesId, variant: null, verdict: 'closed' } });
  const [after] = await listSeries(f.floor);
  assert.equal(after.decisions.get('v01').payload.verdict, 'approved', 'the latest decision wins');
  assert.ok(!isPendingReview(after));
});

test('findSeries: id, suffix, latest, unlisted, and errors', async () => {
  const f = await tmpFactory();
  const a = await seedSeries(f);
  const b = await seedSeries(f);
  assert.equal((await findSeries(f.floor, a.seriesId)).seriesId, a.seriesId);
  assert.equal((await findSeries(f.floor, a.seriesId.slice(-8).toLowerCase())).seriesId, a.seriesId);
  assert.equal((await findSeries(f.floor, 'latest')).seriesId, b.seriesId);
  await f.floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: b.seriesId, payload: { seriesId: b.seriesId, picks: [] } });
  assert.equal((await findSeries(f.floor, 'unlisted')).seriesId, a.seriesId);
  await assert.rejects(findSeries(f.floor, 'ZZZZZZZZ'), SeriesNotFound);
});

// ---------- Warhol ----------

test('describeVariants numbers images in order, without model names', () => {
  const text = describeVariants([{ variant: 'v01', technique: 'halftone', temperature: 0.7, model: 'secret/model' }]);
  assert.equal(text, 'Image 1 = v01 · technique: halftone · temperature 0.7');
});

test('validateShortlist keeps valid, unique picks up to 3', () => {
  const shown = ['v01', 'v02', 'v03', 'v05', 'v06'].map((variant) => ({ variant }));
  const { picks, rejects, problems } = validateShortlist(
    { picks: [{ variant: 'V02', note: ' flat ', offTechnique: true }, { variant: 'v02', note: 'x' }, { variant: 'v09', note: 'x' }, { variant: 'v01' }, { variant: 'v03' }, { variant: 'v05' }], rejects: ' too pretty ' },
    shown,
  );
  assert.deepEqual(picks, [
    { variant: 'v02', note: 'flat', offTechnique: true },
    { variant: 'v01', note: '', offTechnique: false },
    { variant: 'v03', note: '', offTechnique: false },
  ]);
  assert.equal(rejects, 'too pretty');
  assert.equal(problems.length, 3);
  assert.deepEqual(validateShortlist({}, shown).problems, ['reply has no "picks" array']);
});

test('shortlistSeries sends one image per produced variant, with taste, and posts shortlist.proposed', async () => {
  const reply = JSON.stringify({ picks: [{ variant: 'v02', note: 'It looks like a can. Gee.', offTechnique: false }, { variant: 'v03', note: 'Flat.', offTechnique: true }], rejects: 'Too busy.' });
  const f = await tmpFactory({ roles: { 'warhol.md': WARHOL_ROLE }, replies: [completion(reply, { model: 'test/vision' })] });
  const { seriesId, subject } = await seedSeries(f);
  await writeFile(f.config.paths.taste, '# Taste\n\n- Likes: soup\n\n## Decisions\n\n');
  await appendTaste(f.config.paths.taste, { date: '2026-09-24', verdict: 'vetoed', variant: 'v01', subject: 'x', note: 'swirls' });

  const { event, problems } = await shortlistSeries({ config: f.config, floor: f.floor, llm: f.llm }, 'unlisted');
  assert.deepEqual(problems, []);
  assert.equal(event.type, 'shortlist.proposed');
  assert.equal(event.actor, 'warhol');
  assert.equal(event.ref, seriesId);
  assert.deepEqual(event.payload.picks.map((p) => [p.variant, p.offTechnique]), [['v02', false], ['v03', true]]);
  assert.equal(event.payload.rejects, 'Too busy.');
  assert.deepEqual(event.payload.shown, ['v01', 'v02', 'v03']);
  assert.equal(event.payload.subjectId, subject.id);

  const body = f.fetch.requests[0].body;
  assert.equal(body.model, 'test/vision');
  const user = body.messages[1].content;
  assert.equal(user.filter((c) => c.type === 'image_url').length, 3, 'one image per produced variant; failed ones are not shown');
  const system = body.messages[0].content;
  assert.doesNotMatch(system, /\{\{|\[(subject|chatter|taste|variants|max_picks)\]/);
  assert.match(system, /- Likes: soup/);
  assert.match(system, /vetoed · v01 · "x": swirls/);
  assert.match(system, /Image 1 = v01 · technique: halftone/);
  assert.doesNotMatch(system, /test\/text/, 'no model names');
  assert.match(system, /Why it is a ready-made: The can\./);

  await assert.rejects(shortlistSeries({ config: f.config, floor: f.floor, llm: f.llm }, seriesId), (e) => e instanceof ShortlistError && /already has a shortlist/.test(e.message));
});

test('a series with nothing rendered gets an empty shortlist without a model call', async () => {
  const f = await tmpFactory({ roles: { 'warhol.md': WARHOL_ROLE } });
  await seedSeries(f, { produced: [], failed: ['v01', 'v02'] });
  const { event, problems } = await shortlistSeries({ config: f.config, floor: f.floor, llm: f.llm }, 'latest');
  assert.deepEqual(event.payload.picks, []);
  assert.match(problems[0], /no rendered variants/);
  assert.equal(f.fetch.requests.length, 0);
});
