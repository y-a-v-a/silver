import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCreditWatch, nextShift, readStatus, shiftInProgress } from '../src/admin/status.js';
import { computeStats, shiftCost, variantCost } from '../src/admin/stats.js';
import { applySettings } from '../src/admin/store.js';
import { buildAdminPlist, buildPlist, installAdminService, plistPath, scheduleStatus, uninstallAdminService, ADMIN_LABEL } from '../src/schedule.js';
import { readOverlay } from '../src/settings.js';
import { listSeries } from '../src/agents/series-data.js';
import { createFloor } from '../src/floor.js';
import { seedSeries, tmpFactory } from './helpers.js';
import shipped from '../silver.config.js';

const config = (f, extra = {}) => ({ ...f.config, shift: { at: '09:00', seriesPerShift: 2 }, ...extra });

test('nextShift is today until it has run or passed, then tomorrow', () => {
  const now = new Date('2026-11-04T08:00:00');
  assert.equal(nextShift('09:00', { now }).getDate(), 4);
  assert.equal(nextShift('09:00', { now, doneToday: true }).getDate(), 5);
  assert.equal(nextShift('07:00', { now }).getDate(), 5);
});

test('a shift on the floor holds the queue; a crashed one stops holding it after a while', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'silver-status-'));
  let date = new Date();
  const floor = createFloor({ dir, now: () => date });
  assert.equal(await shiftInProgress(floor), false);
  await floor.append({ type: 'shift.started', actor: 'orchestrator' });
  assert.equal(await shiftInProgress(floor, { now: date }), true);
  assert.equal(await shiftInProgress(floor, { now: new Date(date.getTime() + 3 * 3_600_000) }), false, 'a crash leaves no ending; it stops counting');
  await floor.append({ type: 'shift.ended', actor: 'orchestrator' });
  assert.equal(await shiftInProgress(floor, { now: date }), false);
});

test('the status names what is wrong: no key, no credit, failed calls, pause, schedule, record', async () => {
  const f = await tmpFactory();
  const texts = async (o = {}) => (await readStatus({ config: config(f, o.config), floor: f.floor, env: o.env ?? { OPENROUTER_API_KEY: 'k' }, schedule: o.schedule, credit: o.credit })).alerts.map((a) => a.text).join('\n');
  assert.equal(await texts(), '');
  assert.match(await texts({ env: {} }), /No OpenRouter key/);
  assert.match(await texts({ credit: { remaining: 1.25 } }), /Only \$1\.25 of OpenRouter credit left/);
  assert.equal(await texts({ credit: { remaining: 40 } }), '');
  assert.match(await texts({ config: { shift: { at: '09:00', seriesPerShift: 2, paused: true } } }), /is paused/);
  assert.match(await texts({ schedule: { installed: false } }), /not scheduled/);
  assert.match(await texts({ schedule: { installed: true, mine: true, at: '08:00' } }), /runs at 08:00, the settings say 09:00/);
  assert.equal(await texts({ schedule: { installed: true, mine: false, at: '08:00' } }), '', 'another checkout\'s schedule is none of our business');

  for (let i = 0; i < 5; i++) await f.floor.append({ type: 'llm.failed', actor: 'warhol', payload: { role: 'warhol', status: 500, error: 'boom' } });
  assert.match(await texts(), /5 model calls failed/);
  await f.floor.append({ type: 'llm.failed', actor: 'warhol', payload: { role: 'warhol', status: 402, error: 'no money' } });
  assert.match(await texts(), /refused 1 call in the last day for lack of credits/);
  await f.floor.append({ type: 'record.pushed', actor: 'archivist', payload: { error: 'denied' } });
  assert.match(await texts(), /last backup didn't push: denied/);
});

test('the status counts the day: series, thin ones, what is unseen, what comes next', async () => {
  const f = await tmpFactory();
  await seedSeries(f, { produced: ['v01'], failed: ['v02', 'v03', 'v04'] });
  await f.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'next' } });
  const st = await readStatus({ config: config(f), floor: f.floor, env: { OPENROUTER_API_KEY: 'k' } });
  assert.equal(st.pending.length, 1);
  assert.equal(st.unlisted.length, 1);
  assert.equal(st.todaySeries.length, 1);
  assert.deepEqual(st.next.map((s) => s.payload.title), ['next']);
  assert.ok(st.alerts.some((a) => /came out thin: 1\/4/.test(a.text)));
  assert.ok(st.alerts.some((a) => /Warhol hasn't looked at 1/.test(a.text)));
});

test('the credit watch prefers the account, falls back on the key, and asks at most every few minutes', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/credits')) return Response.json({ data: { total_credits: 10, total_usage: 7.5 } });
    return Response.json({ data: {} });
  };
  const watch = createCreditWatch({ apiKey: 'k', baseUrl: 'http://x', fetch });
  assert.deepEqual(await watch.get(), { remaining: 2.5, total: 10, source: 'account' });
  await watch.get();
  assert.equal(calls.length, 1, 'cached');

  const keyOnly = createCreditWatch({ apiKey: 'k', baseUrl: 'http://x', fetch: async (url) => (url.endsWith('/credits') ? new Response('', { status: 403 }) : Response.json({ data: { limit: 20, limit_remaining: 3 } })) });
  assert.deepEqual(await keyOnly.get(), { remaining: 3, total: 20, source: 'key' });

  assert.equal(await createCreditWatch({ apiKey: undefined, fetch }).get(), null, 'no key, no question');
  const down = createCreditWatch({ apiKey: 'k', baseUrl: 'http://x', fetch: async () => { throw new Error('offline'); } });
  assert.equal(await down.get(), null, 'offline is not an error on the page');
});

test('the stats keep a credit refusal out of a model\'s failure rate', async () => {
  const f = await tmpFactory();
  const { seriesId } = await seedSeries(f, { produced: ['v01', 'v02'], failed: ['v03'] });
  await f.floor.append({ type: 'variant.failed', actor: 'studio-assistant', ref: seriesId, payload: { seriesId, variant: 'v04', technique: 'halftone', requestedModel: 'test/text', temperature: 1, stage: 'llm', error: 'would exceed your available credits' } });
  await f.floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: seriesId, payload: { seriesId, picks: [{ variant: 'v01', note: '' }] } });
  await f.floor.append({ type: 'review.decision', actor: 'human', ref: seriesId, payload: { seriesId, variant: 'v01', verdict: 'approved' } });
  const stats = computeStats(await listSeries(f.floor));
  const m = stats.models.get('test/text');
  assert.deepEqual([m.made, m.failed, m.picked, m.approved], [2, 1, 1, 1]);
  assert.equal(computeStats(await listSeries(f.floor), { since: '2999-01-01' }).models.size, 0);
  assert.equal(variantCost(stats), null, 'no prices in the seed');
  assert.equal(shiftCost([{ type: 'shift.ended', payload: { spentUsd: 2 } }, { type: 'shift.ended', payload: { spentUsd: 4 } }, { type: 'shift.ended', payload: { spentUsd: 99, dryRun: true } }, { type: 'shift.ended', payload: { spentUsd: 99, stoppedReason: 'budget' } }]), 3);
  assert.equal(shiftCost([]), null);
});

test('applySettings writes only real differences, and refuses what would not validate', async () => {
  const f = await tmpFactory();
  const deps = { config: f.config, floor: f.floor, rawConfig: async () => shipped };
  assert.deepEqual(await applySettings(deps, { 'budget.dailyUsd': 5 }), { changed: [] }, 'the same as the file: no override, no event');
  assert.deepEqual(await readOverlay(f.config.root), {});
  assert.equal((await f.floor.read({ type: 'studio.changed' })).length, 0);
  assert.deepEqual(await applySettings(deps, { 'budget.dailyUsd': 3 }), { changed: ['budget.dailyUsd'] });
  await assert.rejects(applySettings(deps, { 'budget.dailyUsd': -1 }), /dailyUsd/);
  await assert.rejects(applySettings(deps, { 'paths.floor': 'x' }), /can't be set/);
  assert.deepEqual(await readOverlay(f.config.root), { budget: { dailyUsd: 3 } }, 'a refusal changes nothing');
});

test('the schedule status reads the plist, and knows whose it is', async () => {
  const home = await mkdtemp(join(tmpdir(), 'silver-home-'));
  const c = { root: '/repo', paths: { archive: '/repo/archive' }, shift: { at: '07:05' } };
  assert.deepEqual(await scheduleStatus(c, { home }), { installed: false, path: plistPath(home) });
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(plistPath(home), buildPlist({ node: '/n', cli: '/c', root: '/repo', at: '07:05', logDir: '/l' }));
  assert.deepEqual(await scheduleStatus(c, { home }), { installed: true, at: '07:05', root: '/repo', mine: true, path: plistPath(home) });
  assert.equal((await scheduleStatus({ ...c, root: '/sandbox' }, { home })).mine, false);
});

test('the admin service stays alive through launchd, on the same terms as the shift', async () => {
  const plist = buildAdminPlist({ node: '/n', cli: '/c', root: '/repo', logDir: '/l' });
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<string>admin<\/string>\s*<string>--no-open<\/string>/);
  const home = await mkdtemp(join(tmpdir(), 'silver-home-'));
  const ran = [];
  const run = async (...args) => void ran.push(args[1]);
  const r = await installAdminService({ config: { root: '/repo', paths: { archive: join(home, 'archive') } } }, { home, uid: 501, node: '/n', run });
  assert.match(await readFile(r.path, 'utf8'), new RegExp(ADMIN_LABEL));
  assert.deepEqual(ran.map((a) => a[0]), ['bootout', 'bootstrap']);
  assert.equal((await uninstallAdminService({ home, uid: 501, run })).removed, true);
  assert.equal((await uninstallAdminService({ home, uid: 501, run })).removed, false);
});
