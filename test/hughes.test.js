import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, completion, seedSeries, decide, fakePrintRenderer } from './helpers.js';
import { printApproved } from '../src/agents/printer.js';
import { releaseEditions, describeWork, retitleEdition, RetitleError } from '../src/agents/hughes.js';
import { readCanon, posterOf } from '../src/canon.js';

const HUGHES_ROLE = await readFile(new URL('../roles/fred-hughes.md', import.meta.url), 'utf8');

async function signedWorks(replies, approvals = [['v01', 'approved'], ['v02', 'approved', 'Yes.']]) {
  const f = await tmpFactory({ roles: { 'fred-hughes.md': HUGHES_ROLE }, replies });
  const { seriesId } = await seedSeries(f, { subject: { url: 'https://www.bbc.co.uk/news/x', scoutWhy: 'Soup on every shelf.' } });
  await decide(f, seriesId, approvals);
  await printApproved({ config: f.config, floor: f.floor, llm: null, renderer: fakePrintRenderer() });
  return f;
}

test('describeWork gives only the facts: headline, source host, notes, technique, date', async () => {
  const text = describeWork(
    { subjectTitle: 'campbell soup', sourceUrl: 'https://www.bbc.co.uk/news/x', technique: 'halftone', warholNote: 'Flat.', humanNote: null, publishedAt: '2026-09-25T10:00:00Z' },
    { payload: { why: 'The can.', scoutWhy: null } },
  );
  assert.equal(text, 'Headline / subject: campbell soup\nSource: bbc.co.uk\nWhy it is a ready-made: The can.\nTechnique: halftone\nWarhol\'s note: Flat.\nSigned: 2026-09-25');
});

test('releaseEditions numbers works in signing order, with an English title and wall text', async () => {
  const f = await signedWorks([
    completion(JSON.stringify({ title: '"Campbell\'s Soup (Halftone)"', wallText: '  A can of soup.   Made in halftone.  ' })),
    completion(JSON.stringify({ title: 'Soup (Grid)', wallText: 'A grid of cans.' })),
  ]);
  const { released, failed } = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(failed, []);
  assert.deepEqual(released.map((e) => [e.payload.edition, e.payload.title]), [[1, "Campbell's Soup (Halftone)"], [2, 'Soup (Grid)']]);
  assert.equal(released[0].payload.wallText, 'A can of soup. Made in halftone.');
  assert.equal(released[0].actor, 'fred-hughes');

  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, /edition number \*\*1\*\*/);
  assert.match(system, /Source: bbc\.co\.uk/);
  assert.match(system, /Always in English/);
  assert.doesNotMatch(system, /\{\{/);

  const canon = await readCanon(f.floor);
  assert.deepEqual(canon.map((w) => [w.edition, w.title]), [[1, "Campbell's Soup (Halftone)"], [2, 'Soup (Grid)']]);
  const json = JSON.parse(await readFile(join(f.config.paths.canon, 'canon.json'), 'utf8'));
  assert.equal(json.works[1].wallText, 'A grid of cans.');
});

test('a failed title leaves the work unreleased for next time; numbering stays gap-free', async () => {
  const f = await signedWorks([
    completion('no json at all'),
    completion('still none'),
    completion(JSON.stringify({ title: 'Second', wallText: 'Two.' })),
    completion(JSON.stringify({ title: 'First, later', wallText: 'One.' })),
  ]);
  const first = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.equal(first.failed.length, 1);
  assert.deepEqual(first.released.map((e) => [e.payload.edition, e.payload.title]), [[1, 'Second']]);

  const second = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(second.released.map((e) => [e.payload.edition, e.payload.title]), [[2, 'First, later']]);
  assert.deepEqual((await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm })).released, [], 'nothing left');
});

test('a reply without a wall text is a failure, not a half edition', async () => {
  const f = await signedWorks([completion(JSON.stringify({ title: 'Only a title' }))], [['v01', 'approved']]);
  const { released, failed } = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(released, []);
  assert.match(failed[0].error, /missing a title or wall text/);
});

test('Fred Hughes sees the titles already used for the subject, including earlier in the same run', async () => {
  const f = await signedWorks([
    completion(JSON.stringify({ title: 'Soup (Disaster)', wallText: 'A can.' })),
    completion(JSON.stringify({ title: 'Soup (Disaster) II', wallText: 'Another can.' })),
  ]);
  await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  const [first, second] = f.fetch.requests.map((r) => r.body.messages[0].content);
  assert.match(first, /Titles already on the wall for this subject\n\n\(none yet\)/);
  assert.match(second, /- Soup \(Disaster\) \(No\. 001\)/);
  assert.match(second, /number it deliberately/);
});

test('retitle: a correction keeps the number, the canon shows the latest label, the old one stays on the floor', async () => {
  const f = await signedWorks([
    completion(JSON.stringify({ title: 'One Million Coffees', wallText: 'One million cups.' })),
    completion(JSON.stringify({ title: 'Soup (Grid)', wallText: 'A grid.' })),
    completion(JSON.stringify({ title: 'Free Coffee (Refill)', wallText: 'A free refill, repeated.' })),
  ]);
  const { released } = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });

  // By hand: only the wall text changes.
  const byHand = await retitleEdition({ config: f.config, floor: f.floor, llm: null }, { edition: 1, wallText: 'Cups.' });
  assert.equal(byHand.actor, 'human');
  assert.deepEqual([byHand.payload.edition, byHand.payload.title, byHand.payload.correction, byHand.payload.replaces], [1, 'One Million Coffees', true, released[0].id]);

  // By Fred Hughes, told what was wrong.
  const fixed = await retitleEdition({ config: f.config, floor: f.floor, llm: f.llm }, { edition: 1, note: 'The million cups was invented.' });
  assert.equal(fixed.actor, 'fred-hughes');
  assert.equal(fixed.payload.replaces, byHand.id);
  const prompt = f.fetch.requests[2].body.messages.at(-1).content;
  assert.match(prompt, /Current title: One Million Coffees/);
  assert.match(prompt, /What is wrong with it, from the human: The million cups was invented\./);

  const canon = await readCanon(f.floor);
  const w = canon.find((x) => x.edition === 1);
  assert.deepEqual([w.title, w.wallText, w.releasedAt, Boolean(w.revisedAt)], ['Free Coffee (Refill)', 'A free refill, repeated.', released[0].ts, true]);
  assert.equal(Math.max(...canon.map((x) => x.edition)), 2, 'no new number');
  assert.equal((await f.floor.read({ type: 'edition.released' })).length, 4);

  await assert.rejects(retitleEdition({ config: f.config, floor: f.floor, llm: null }, { edition: 9, title: 'x' }), RetitleError);
  await assert.rejects(retitleEdition({ config: f.config, floor: f.floor, llm: null }, { edition: 1 }), /--title and\/or --wall/);
  await assert.rejects(retitleEdition({ config: f.config, floor: f.floor, llm: null }, { edition: 1, title: 'Free Coffee (Refill)' }), /nothing to change/);
});

test('posterOf: the later frame, unless the hold went wrong', () => {
  assert.equal(posterOf({ poster: 'p.png', later: 'l.png', printCheck: { hold: { ok: true } } }), 'l.png');
  assert.equal(posterOf({ poster: 'p.png', later: 'l.png', printCheck: { hold: { ok: false } } }), 'p.png');
  assert.equal(posterOf({ poster: 'p.png', later: null, printCheck: { hold: null } }), 'p.png');
});
