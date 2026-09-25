import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, completion, seedSeries, decide, fakePrintRenderer } from './helpers.js';
import { printApproved } from '../src/agents/printer.js';
import { releaseEditions, describeWork } from '../src/agents/hughes.js';
import { readCanon } from '../src/canon.js';

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
