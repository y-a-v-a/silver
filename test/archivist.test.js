import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, completion, seedSeries, decide } from './helpers.js';
import { checkArtifacts, buildManifest, digest, writeDiary, archiveShift, longDate } from '../src/agents/archivist.js';

const ROLE = await readFile(new URL('../roles/archivist.md', import.meta.url), 'utf8');

async function day(replies = []) {
  const f = await tmpFactory({ roles: { 'archivist.md': ROLE }, replies });
  const s = await seedSeries(f);
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.viva', ref: s.subject.id, payload: { persona: 'viva', text: 'Soup again. How thrilling.' } });
  await f.floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: s.seriesId, payload: { seriesId: s.seriesId, picks: [{ variant: 'v02', note: 'Flat. Good.' }], rejects: 'Busy.' } });
  await decide(f, s.seriesId, [['v02', 'approved', 'yes'], ['v03', 'vetoed']]);
  await f.floor.append({ type: 'cost.recorded', actor: 'warhol', payload: { role: 'warhol', group: 'role', usd: 0.06 } });
  return { ...f, ...s };
}

test('checkArtifacts finds what the events point at, and what is missing', async () => {
  const f = await day();
  const events = await f.floor.read();
  const r = await checkArtifacts(f.config, events);
  assert.equal(r.checked, 7, '3 html + 3 png + the contact sheet');
  assert.deepEqual(r.missing.map((m) => [m.type, m.key]), [['series.completed', 'contactSheet']]);
  await writeFile(join(f.dir, 'index.html'), '<html></html>');
  assert.equal((await checkArtifacts(f.config, events)).missing.length, 0);
  assert.equal((await checkArtifacts(f.config, [{ id: 'x', type: 't', payload: { path: 'https://example.com/a' } }])).checked, 0, 'URLs are not files');
});

test('buildManifest counts the day: events, spend, series, decisions', async () => {
  const f = await day();
  const m = await buildManifest(f.config, f.floor, f.floor.today());
  assert.equal(m.byType['variant.produced'], 3);
  assert.equal(m.byActor.human, 2);
  assert.deepEqual(m.spend, { usd: 0.06, calls: 1, byRole: { warhol: 0.06 } });
  assert.deepEqual(m.series.map((x) => [x.subject, x.produced, x.failed, x.completed]), [['campbell soup', 3, 1, true]]);
  assert.deepEqual(m.decisions, { approved: 1, vetoed: 1 });
  assert.equal(m.artifacts.missing.length, 1);
});

test('digest tells the day in order, leaves dry runs out, and starts after the last entry', async () => {
  const f = await day();
  await f.floor.append({ type: 'series.started', actor: 'studio-assistant', ref: f.subject.id, payload: { subjectId: f.subject.id, variants: 2, techniques: ['halftone'], dryRun: true } });
  const events = await f.floor.read({ shift: 'all' });
  const d = digest(events);
  assert.match(d.text, /the Scout brings in: "campbell soup" \(why: The can\.\)/);
  assert.match(d.text, /viva on "campbell soup": Soup again\. How thrilling\./);
  assert.match(d.text, /series on "campbell soup" done: 3 made, 1 died \(uniform\)/);
  assert.match(d.text, /Andy picks v02 \("Flat\. Good\."\)/);
  assert.match(d.text, /the human approves v02 of "campbell soup": "yes"/);
  assert.match(d.text, /the human vetoes v03/);
  assert.match(d.text, /Money: \$0\.06 on 1 model calls\./);
  assert.doesNotMatch(d.text, /2 variants/, 'the dry-run series is not in the diary');
  const later = digest(events, { since: events.find((e) => e.type === 'shortlist.proposed').id });
  assert.doesNotMatch(later.text, /Scout brings in/);
  assert.match(later.text, /approves v02/);
});

test('writeDiary writes archive/diary/<day>.md once, from the notes, and records it', async () => {
  const f = await day([completion('# Thursday\n\nIt was soup again. Viva was bored. Spent $0.06 on the machines.')]);
  const shift = f.floor.today();
  const r = await writeDiary({ config: f.config, floor: f.floor, llm: f.llm }, { shift });
  assert.equal(r.path, `archive/diary/${shift}.md`);
  assert.match(await readFile(join(f.root, r.path), 'utf8'), /Viva was bored/);
  assert.equal(r.event.type, 'diary.written');
  assert.equal(r.event.payload.shift, shift);
  assert.ok(r.event.payload.covers > 5);
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, new RegExp(`entry is for \\*\\*${longDate(shift).replace(/,/g, ',')}\\*\\*`));
  assert.match(system, /Only what's in the notes/);
  assert.match(system, /viva on "campbell soup"/);
  assert.equal(f.fetch.requests[0].body.model, 'test/text');

  const again = await writeDiary({ config: f.config, floor: f.floor, llm: f.llm }, { shift });
  assert.equal(again.skipped, 'already written');
  assert.equal(f.fetch.requests.length, 1);
});

test('archiveShift: manifest always, diary only for real shifts, and a failed diary is only a problem', async () => {
  const f = await day([]); // no reply queued: the diary call fails
  const shift = f.floor.today();
  const dry = await archiveShift({ config: f.config, floor: f.floor, llm: f.llm }, { shift, dryRun: true });
  assert.deepEqual(dry.diary, { skipped: 'dry run' });
  assert.equal(dry.manifest, `archive/manifests/${shift}.json`);
  const manifest = JSON.parse(await readFile(join(f.root, dry.manifest), 'utf8'));
  assert.equal(manifest.shift, shift);

  const real = await archiveShift({ config: f.config, floor: f.floor, llm: f.llm }, { shift });
  assert.equal(real.diary, null);
  assert.match(real.problems.at(-1), /^diary: /);
  assert.equal(real.missing, 1);
  const archived = await f.floor.read({ type: 'shift.archived' });
  assert.equal(archived.length, 2);
  assert.equal(archived[1].payload.missing[0].key, 'contactSheet');
});

test('longDate spells the day out', () => {
  assert.equal(longDate('2026-09-25'), 'Friday, September 25, 2026');
});
