import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, completion, seedSeries, decide } from './helpers.js';
import { createFloor } from '../src/floor.js';
import { archiveCandidates, diaryLines } from '../src/sources/archive.js';
import { runScouts } from '../src/agents/scouts.js';

const SCOUT = await readFile(new URL('../roles/scout.md', import.meta.url), 'utf8');

/** A day with a reviewed series and a diary entry, seen from the next morning. */
async function yesterday(replies = []) {
  const f = await tmpFactory({ roles: { 'scout.md': SCOUT }, replies });
  f.config.shift = { subjectsPerShift: 3, seriesPerShift: 2, maxArchiveSubjectsPerShift: 1 };
  f.config.sources = { rss: [], trending: { googleTrendsGeo: 'US', hackernews: false, reddit: false }, itemsPerSource: 5, repeatAfterDays: 7 };
  const s = await seedSeries(f, { subject: { url: 'https://example.com/soup' } });
  await f.floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: s.seriesId, payload: { seriesId: s.seriesId, picks: [{ variant: 'v02', note: 'Flat.' }], rejects: 'Too busy.' } });
  await decide(f, s.seriesId, [['v02', 'approved'], ['v03', 'vetoed', 'too pretty']]);
  const day = f.floor.today();
  await mkdir(join(f.root, 'archive', 'diary'), { recursive: true });
  await writeFile(join(f.root, 'archive', 'diary', `${day}.md`), `# ${day}\n\nIt was soup again. Viva said the soup was the most boring thing she had heard all week. Spent $0.06 on the machines.\n`);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const next = createFloor({ dir: f.config.paths.floor, now: () => tomorrow });
  return { ...f, ...s, next, tomorrow };
}

test('diaryLines keeps quotable sentences, never the heading or the money', () => {
  assert.deepEqual(diaryLines('# Friday\n\nShort. Viva said the soup was the most boring thing she had heard all week. Spent $0.06 on the machines, which is a lot for soup.'), [
    'Viva said the soup was the most boring thing she had heard all week.',
  ]);
});

test('archiveCandidates offers the vetoed and the passed-over, never the approved or today\'s, and diary lines', async () => {
  const f = await yesterday();
  assert.deepEqual(await archiveCandidates({ config: f.config, floor: f.floor }), [], 'nothing from today');

  const c = await archiveCandidates({ config: f.config, floor: f.next }, { now: f.tomorrow, rng: () => 0 });
  const rejects = c.filter((x) => x.meta.kind === 'reject');
  assert.deepEqual(rejects.map((x) => [x.meta.variant, x.meta.verdict]).sort(), [['v01', 'passed-over'], ['v03', 'vetoed']]);
  const vetoed = rejects.find((x) => x.meta.variant === 'v03');
  assert.equal(vetoed.source, 'archive');
  assert.match(vetoed.title, /^The reject pile: "campbell soup", v03 \((halftone|grid-repeat)\)$/);
  assert.match(vetoed.snippet, /Vetoed by the human: "too pretty"\. Warhol on the rejects: "Too busy\."/);
  assert.equal(vetoed.meta.png, `archive/variants/${f.seriesId}/v03.png`);
  const [line] = c.filter((x) => x.meta.kind === 'diary');
  assert.match(line.title, /^From the diary, \d{4}-\d{2}-\d{2}: "Viva said the soup was/);
});

test('the Scout may post one archive subject a shift; it is marked, and never offered again', async () => {
  const pickAll = JSON.stringify({ picks: [{ n: 1, why: 'The reject is the ready-made now.' }, { n: 2, why: 'Another.' }, { n: 3, why: 'And the diary.' }] });
  const f = await yesterday([completion(pickAll), completion(JSON.stringify({ picks: [] }))]);
  const r = await runScouts({ config: f.config, floor: f.next, llm: f.llm }, { only: ['archive'], snapshot: false, now: f.tomorrow, rng: () => 0 });
  assert.equal(r.posted.length, 1);
  const [p] = r.posted;
  assert.equal(p.payload.origin, 'archive');
  assert.equal(p.payload.source, 'archive');
  assert.ok(['reject', 'diary'].includes(p.payload.archive.kind));
  assert.equal(p.payload.snapshot.page, null, 'no page snapshot for the archive');
  assert.deepEqual(r.problems, ['candidate 2: more than 1 from the archive, dropped', 'candidate 3: more than 1 from the archive, dropped']);
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, /You may pick at most 1 of them today/);
  assert.match(system, /\[1\] \(archive\) /);
  assert.deepEqual(r.report, [{ source: 'archive', ok: true, count: 3 }]);

  const again = await archiveCandidates({ config: f.config, floor: f.next }, { now: f.tomorrow });
  const key = (x) => x.meta.kind === 'reject' ? `${x.meta.seriesId}/${x.meta.variant}` : x.meta.line;
  assert.ok(!again.map(key).includes(key({ meta: p.payload.archive })), 'a used candidate is not offered again');
});
