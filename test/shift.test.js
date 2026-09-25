import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpFactory, completion, routeFetch } from './helpers.js';
import { runShift, pickSubjects } from '../src/shift.js';
import { postCommission } from '../src/agents/commissions.js';
import { retireSubject } from '../src/agents/retire.js';
import { trendsUrl } from '../src/sources/google-trends.js';
import { notify, appleString } from '../src/lib/notify.js';

const role = (name) => readFile(new URL(`../roles/${name}.md`, import.meta.url), 'utf8');
const ROLES = { 'scout.md': await role('scout'), 'studio-assistant.md': await role('studio-assistant'), 'warhol.md': await role('warhol') };
const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Answers by role: the Scout picks, assistants sketch, Warhol shortlists. */
function replyFor(body) {
  const system = body.messages[0].content;
  if (system.startsWith('You are the Scout')) return completion(JSON.stringify({ picks: [{ n: 1, why: 'The can.' }, { n: 2, why: 'Glasses.' }] }), { cost: 0.001 });
  if (system.startsWith('You are a Studio assistant')) return completion('```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\n```', { cost: 0.002 });
  if (system.startsWith('You are Andy Warhol')) return completion(JSON.stringify({ picks: [{ variant: 'v01', note: 'Flat.' }], rejects: 'Busy.' }), { cost: 0.01, model: 'test/vision' });
  throw new Error(`unexpected role: ${system.slice(0, 40)}`);
}

function fakeRenderer() {
  let opened = 0;
  let closed = 0;
  const create = async () => {
    opened++;
    return {
      render: async (path) => {
        const png = path.replace('.html', '.png');
        await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // Warhol loads it as an image
        return { ok: true, reason: null, shots: [{ seed: 1, png, blank: false, colors: 30 }], errors: [], blocked: [], readySignal: true, ms: 1 };
      },
      close: async () => void closed++,
    };
  };
  create.stats = () => ({ opened, closed });
  return create;
}

async function shiftSetup({ dailyUsd = 5 } = {}) {
  const f = await tmpFactory({ roles: ROLES, replies: [], dailyUsd });
  f.fetch.queue.push(...Array.from({ length: 200 }, () => (body) => replyFor(body)));
  const config = {
    ...f.config,
    shift: { subjectsPerShift: 2, seriesPerShift: 2, maxArchiveSubjectsPerShift: 1 },
    series: { variants: 2, modelsPerSeries: 1, temperatures: [0.7], techniquesPerSeries: 2, concurrency: 2 },
    techniques: { halftone: 'Dots.', 'grid-repeat': 'Grid.' },
    sources: { rss: [], trending: { googleTrendsGeo: 'US', hackernews: false, reddit: false }, itemsPerSource: 20, repeatAfterDays: 7 },
  };
  const sourcesFetch = routeFetch({ [trendsUrl('US')]: await fixture('trends.xml') });
  const notes = [];
  const createRenderer = fakeRenderer();
  const deps = {
    config,
    floor: f.floor,
    llm: f.llm,
    budget: f.budget,
    fetch: sourcesFetch,
    createRenderer,
    reconcile: async () => ({ day: { ledger: 0.05, billed: 0.05, gap: 0 } }),
    notify: async (title, message) => void notes.push({ title, message }),
  };
  return { ...f, config, deps, notes, createRenderer };
}

test('a full shift: scouts, series (commissions first), shortlists, shift.ended and a notification', async () => {
  const s = await shiftSetup();
  const { event: commission } = await postCommission({ floor: s.floor }, 'Twelve identical parking tickets');

  const r = await runShift(s.deps);
  assert.equal(r.status, 'done');
  assert.deepEqual(r.steps.map((x) => [x.step, x.status]), [['scouts', 'done'], ['superstars', 'skipped'], ['series', 'done'], ['shortlist', 'done'], ['archivist', 'skipped']]);
  assert.equal(r.series.length, 2);
  assert.equal(r.series[0].subjectId, commission.id, 'the commission gets the first slot');
  assert.equal(r.series[0].origin, 'commission');
  assert.equal(r.series[1].origin, 'scouted');
  assert.equal(r.shortlisted.length, 2);
  assert.equal(r.waiting, 2);
  assert.deepEqual(s.createRenderer.stats(), { opened: 1, closed: 1 }, 'one renderer for the whole shift, always closed');

  const [started] = await s.floor.read({ type: 'shift.started' });
  const [ended] = await s.floor.read({ type: 'shift.ended' });
  assert.equal(ended.ref, started.id);
  assert.equal(ended.payload.waitingForReview, 2);
  assert.ok(ended.payload.spentUsd > 0);
  assert.deepEqual(ended.payload.reconcile, { day: { ledger: 0.05, billed: 0.05, gap: 0 } });
  assert.deepEqual(s.notes, [{ title: 'Silver Factory', message: '2 new series, 2 waiting for review.' }]);
});

test('a second run the same day does nothing; --again adds a round without redoing work', async () => {
  const s = await shiftSetup();
  await runShift(s.deps);
  const callsAfterFirst = s.fetch.requests.length;

  const again = await runShift(s.deps);
  assert.equal(again.status, 'already-done');
  assert.equal(s.fetch.requests.length, callsAfterFirst);

  const round2 = await runShift(s.deps, { again: true });
  assert.equal(round2.status, 'done');
  const byStep = Object.fromEntries(round2.steps.map((x) => [x.step, x]));
  assert.equal(byStep.scouts.status, 'skipped');
  assert.equal(byStep.series.status, 'skipped');
  assert.match(byStep.series.reason, /2 series already started today/);
  assert.equal(byStep.shortlist.status, 'skipped');
  assert.equal(s.fetch.requests.length, callsAfterFirst, 'no new model calls');
  assert.equal((await s.floor.read({ type: 'shift.started' }))[1].payload.again, true);
});

test('a shift that was interrupted resumes: the scouts are not run twice', async () => {
  const s = await shiftSetup();
  await s.floor.append({ type: 'shift.started', actor: 'orchestrator', payload: {} });
  await s.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'Already scouted this morning' } });
  const r = await runShift(s.deps);
  assert.equal(r.started.payload.resumed, true);
  assert.equal(r.steps[0].status, 'skipped');
  assert.equal(r.series.length, 1);
  assert.ok(!s.fetch.requests.some((q) => q.body.messages[0].content.startsWith('You are the Scout')));
});

test('a spent budget ends the shift cleanly, with the reason recorded and notified', async () => {
  const s = await shiftSetup({ dailyUsd: 0.0001 });
  await s.floor.append({ type: 'cost.recorded', actor: 'scout', payload: { role: 'scout', group: 'role', usd: 0.0001 } });
  const r = await runShift(s.deps);
  assert.equal(r.status, 'stopped');
  const byStep = Object.fromEntries(r.steps.map((x) => [x.step, x]));
  assert.equal(byStep.scouts.status, 'failed');
  assert.equal(byStep.stopped.status, 'budget');
  assert.equal(byStep.series, undefined, 'no series attempted after the stop');
  const [ended] = await s.floor.read({ type: 'shift.ended' });
  assert.match(ended.payload.stoppedReason, /daily budget exhausted/);
  assert.match(s.notes[0].message, /^Stopped early: budget\./);
  assert.equal(s.fetch.requests.length, 0);
});

test('pickSubjects: commissions oldest first, then today\'s scouted; retired and claimed never', async () => {
  const s = await shiftSetup();
  const shift = s.floor.today();
  const { event: c1 } = await postCommission({ floor: s.floor }, 'First commission here');
  const { event: c2 } = await postCommission({ floor: s.floor }, 'Second commission here');
  const scouted = await s.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'A scouted subject' } });
  const retired = await s.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'A retired subject' } });
  await retireSubject(s.floor, retired);
  await s.floor.append({ type: 'series.started', actor: 'studio-assistant', payload: { subjectId: c2.id } });

  assert.deepEqual((await pickSubjects(s.floor, shift, 5)).map((e) => e.id), [c1.id, scouted.id]);
  assert.deepEqual((await pickSubjects(s.floor, shift, 1)).map((e) => e.id), [c1.id]);
  assert.deepEqual(await pickSubjects(s.floor, shift, 0), []);
});

test('notify uses osascript on macOS only, with quotes escaped', async () => {
  assert.equal(appleString('say "hi" \\ there'), '"say \\"hi\\" \\\\ there"');
  const calls = [];
  const run = (cmd, args, cb) => {
    calls.push([cmd, args]);
    cb(null);
  };
  assert.equal(await notify('T', 'M "q"', { platform: 'darwin', run }), true);
  assert.deepEqual(calls, [['osascript', ['-e', 'display notification "M \\"q\\"" with title "T"']]]);
  assert.equal(await notify('T', 'M', { platform: 'linux', run }), false);
  assert.equal(await notify('T', 'M', { platform: 'darwin', run: (c, a, cb) => cb(new Error('no')) }), false);
});

test('a dry run never stands in for the real shift: no ended day, no slots, no claims', async () => {
  const s = await shiftSetup();
  const { event: commission } = await postCommission({ floor: s.floor }, 'A commission for later');
  const dry = await runShift(s.deps, { dryRun: true });
  assert.equal(dry.status, 'done');
  assert.equal(dry.series.length, 2);

  const real = await runShift(s.deps);
  assert.equal(real.status, 'done', 'the dry run did not end the real day');
  const byStep = Object.fromEntries(real.steps.map((x) => [x.step, x]));
  assert.equal(byStep.scouts.status, 'done', 'a dry run\'s scouting does not count for the real shift (decision 2026-09-25)');
  assert.equal(real.series.length, 2, "dry-run series don't use up the real slots");
  assert.equal(real.series[0].subjectId, commission.id, 'a dry-run series does not consume a commission');
  assert.equal(real.shortlisted.length, 2, 'only the real series are shortlisted');
});

test('the series step says when slots are free but no subject is waiting', async () => {
  const s = await shiftSetup({});
  s.deps.fetch = routeFetch({}); // every source fails: nothing scouted
  const r = await runShift(s.deps);
  const series = r.steps.find((x) => x.step === 'series');
  assert.equal(series.status, 'empty');
  assert.equal(series.reason, 'no subjects waiting (2 slots free)');
});

test('dry-run subjects are marked; the real shift scouts anyway and never picks them', async () => {
  const s = await shiftSetup();
  const dry = await runShift({ ...s.deps, notify: null }, { dryRun: true });
  assert.equal(dry.steps.find((x) => x.step === 'scouts').status, 'done');
  const dryPosted = await s.floor.read({ type: 'subject.posted' });
  assert.ok(dryPosted.length && dryPosted.every((e) => e.payload.dryRun === true));

  const real = await runShift(s.deps);
  assert.equal(real.steps.find((x) => x.step === 'scouts').status, 'done', 'a dry run does not count as scouting today');
  const realPosted = (await s.floor.read({ type: 'subject.posted' })).filter((e) => !e.payload.dryRun);
  assert.ok(realPosted.length, 'the real Scout may pick the same headlines again');
  const dryIds = new Set(dryPosted.map((e) => e.id));
  assert.ok(real.series.length && real.series.every((x) => !dryIds.has(x.subjectId)));
  assert.deepEqual((await pickSubjects(s.floor, s.floor.today(), 5)).filter((e) => dryIds.has(e.id)), []);
});
