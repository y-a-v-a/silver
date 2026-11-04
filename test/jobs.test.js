import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createJobs, JOB_KINDS, JobError } from '../src/admin/jobs.js';

/** A stand-in for the CLI: `say <text>` prints, `fail` exits 3, `wait <file>` holds until the file exists. */
const STUB = `
import { existsSync } from 'node:fs';
const [cmd, arg] = process.argv.slice(2);
console.log('ran', process.argv.slice(2).join(' '));
if (cmd === 'fail') process.exit(3);
if (cmd === 'wait') { while (!existsSync(arg)) await new Promise((r) => setTimeout(r, 20)); }
`;

async function setup(opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'silver-jobs-'));
  await mkdir(join(root, 'archive'), { recursive: true });
  const cli = join(root, 'stub.mjs');
  await writeFile(cli, STUB);
  const config = { root, paths: { archive: join(root, 'archive') } };
  const jobs = createJobs({ config, cli, ...opts });
  return { root, jobs, config };
}

/** Poll until `check(job)` holds. */
async function until(jobs, id, check, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const job = await jobs.read(id);
    if (check(job)) return job;
    if (Date.now() > end) throw new Error(`timed out waiting on job ${id}: ${JSON.stringify(job)}`);
    await sleep(25);
  }
}
const ended = (j) => !['queued', 'running'].includes(j.status);

test('the CLI arguments are built as separate entries, whatever the text holds', () => {
  assert.deepEqual(JOB_KINDS.commission.args({ text: '--force; rm -rf /', why: 'why', now: true }), ['commission', '--why', 'why', '--now', '--', '--force; rm -rf /']);
  assert.deepEqual(JOB_KINDS.series.args({ subject: 'S1', techniques: ['a', 'b'], models: ['m/n'], temperatures: [0.7], dare: 'Make it tender.', note: 'Rain.', variants: 4, noChatter: true }), ['series', 'S1', '--technique', 'a', 'b', '--model', 'm/n', '--temperature', '0.7', '--dare', 'Make it tender.', '--note', 'Rain.', '--variants', '4', '--no-chatter']);
  assert.deepEqual(JOB_KINDS.series.args({ subject: 'S1' }), ['series', 'S1']);
  assert.deepEqual(JOB_KINDS.shift.args({ force: true }), ['shift', '--no-notify', '--force']);
  assert.deepEqual(JOB_KINDS.pull.args({ series: 'S', variant: 'v02', note: 'Bigger.', again: true }), ['pull', 'S', '--variant', 'v02', '--note', 'Bigger.', '--again']);
  assert.deepEqual(JOB_KINDS.retitle.args({ edition: 3, note: 'Wrong year.' }), ['retitle', '3', '--note', 'Wrong year.']);
});

test('a job runs as its own process, logs its output and records how it ended', async () => {
  const { jobs } = await setup();
  const job = await jobs.enqueue('commission', { text: 'hello there', why: 'because' });
  const done = await until(jobs, job.id, ended);
  assert.equal(done.status, 'done');
  assert.equal(done.exitCode, 0);
  assert.ok(done.startedAt && done.finishedAt);
  assert.equal(done.title, 'Commission: hello there');
  assert.match((await jobs.logOf(done)).text, /ran commission --why because -- hello there/);
});

test('a failing job says so', async () => {
  const { jobs, config } = await setup();
  const failing = createJobs({ config, cli: join(config.root, 'fail.mjs') });
  await writeFile(join(config.root, 'fail.mjs'), 'console.error("nope"); process.exit(3);');
  const done = await until(failing, (await failing.enqueue('scout')).id, ended);
  assert.equal(done.status, 'failed');
  assert.equal(done.exitCode, 3);
  assert.match((await jobs.logOf(done)).text, /nope/);
});

test('one job at a time per lane, in order; the print lane runs alongside the studio', async () => {
  const { jobs, config, root } = await setup();
  const gate = join(root, 'go');
  const holding = createJobs({ config, cli: join(root, 'hold.mjs') });
  await writeFile(join(root, 'hold.mjs'), `import { existsSync } from 'node:fs'; while (!existsSync(${JSON.stringify(gate)})) await new Promise((r) => setTimeout(r, 20)); console.log('ran', process.argv.slice(2).join(' '));`);
  const first = await holding.enqueue('scout');
  const second = await holding.enqueue('chatter');
  const print = await holding.enqueue('publish');
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'queued');
  assert.equal(print.status, 'running', 'an approval does not wait for a shift');
  assert.deepEqual((await holding.open()).map((j) => j.id), [first.id, second.id, print.id]);

  await writeFile(gate, '');
  await until(holding, first.id, ended);
  await until(holding, print.id, ended);
  await holding.pump();
  const secondDone = await until(holding, second.id, ended);
  assert.equal(secondDone.status, 'done');
  assert.ok(secondDone.startedAt >= (await jobs.read(first.id)).finishedAt.slice(0, 19), 'it started after the first ended');
});

test('a waiting job can be coalesced into, so a burst of approvals prints once more, not ten times', async () => {
  const { config, root } = await setup();
  const gate = join(root, 'go');
  const holding = createJobs({ config, cli: join(root, 'hold.mjs') });
  await writeFile(join(root, 'hold.mjs'), `import { existsSync } from 'node:fs'; while (!existsSync(${JSON.stringify(gate)})) await new Promise((r) => setTimeout(r, 20));`);
  const running = await holding.enqueue('publish', {}, { coalesce: true });
  const waiting = await holding.enqueue('publish', {}, { coalesce: true });
  const same = await holding.enqueue('publish', {}, { coalesce: true });
  assert.equal(running.status, 'running');
  assert.equal(waiting.status, 'queued');
  assert.equal(same.id, waiting.id);
  await writeFile(gate, '');
  await until(holding, running.id, ended);
  await holding.pump();
  await until(holding, waiting.id, ended);
});

test('queued studio work waits while a shift from launchd is on the floor; printing does not', async () => {
  let held = true;
  const { jobs } = await setup({ externalShift: async () => held });
  const studio = await jobs.enqueue('scout');
  const print = await jobs.enqueue('publish');
  assert.equal(studio.status, 'queued');
  assert.notEqual(print.status, 'queued');
  held = false;
  await jobs.pump();
  assert.equal((await until(jobs, studio.id, ended)).status, 'done');
});

test('a queued job can be cancelled and a running one stopped; an ended one is left alone', async () => {
  const { config, root } = await setup();
  const holding = createJobs({ config, cli: join(root, 'hold.mjs') });
  await writeFile(join(root, 'hold.mjs'), `await new Promise((r) => setTimeout(r, 30000));`);
  const running = await holding.enqueue('scout');
  const queued = await holding.enqueue('chatter');
  assert.equal((await holding.cancel(queued.id)).status, 'cancelled');
  await holding.cancel(running.id);
  const stopped = await until(holding, running.id, ended);
  assert.equal(stopped.status, 'cancelled');
  await assert.rejects(holding.cancel(running.id), (e) => e instanceof JobError && e.status === 409);
  await assert.rejects(holding.cancel('01ARZ3NDEKTSV4RRFFQ69G5FAV'), (e) => e.status === 404);
});

test('a job whose runner vanished is reported as lost, not as running forever', async () => {
  const { jobs, config } = await setup();
  const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  await mkdir(join(config.paths.archive, 'jobs'), { recursive: true });
  await writeFile(join(config.paths.archive, 'jobs', `${id}.json`), JSON.stringify({ id, kind: 'shift', lane: 'studio', title: 't', status: 'running', pid: 999999, startedAt: new Date().toISOString(), log: join(config.paths.archive, 'jobs', `${id}.log`) }));
  assert.equal((await jobs.read(id)).status, 'lost');
  assert.equal(JSON.parse(await readFile(join(config.paths.archive, 'jobs', `${id}.json`), 'utf8')).status, 'lost');
  assert.deepEqual(await jobs.open(), []);
});

test('a job whose runner never got as far as writing its pid is lost after a grace period, not at once', async () => {
  const { jobs, config } = await setup();
  const write = async (id, startedAt) => {
    await mkdir(join(config.paths.archive, 'jobs'), { recursive: true });
    await writeFile(join(config.paths.archive, 'jobs', `${id}.json`), JSON.stringify({ id, kind: 'shift', lane: 'studio', title: 't', status: 'running', pid: null, startedAt, log: 'x' }));
  };
  await write('01ARZ3NDEKTSV4RRFFQ69G5FAV', new Date().toISOString());
  assert.equal((await jobs.read('01ARZ3NDEKTSV4RRFFQ69G5FAV')).status, 'running');
  await write('01ARZ3NDEKTSV4RRFFQ69G5FAW', new Date(Date.now() - 60_000).toISOString());
  assert.equal((await jobs.read('01ARZ3NDEKTSV4RRFFQ69G5FAW')).status, 'lost');
});

test('jobs are listed newest first, an unknown kind or a bad id is refused', async () => {
  const { jobs } = await setup();
  const a = await jobs.enqueue('scout');
  await until(jobs, a.id, ended);
  const b = await jobs.enqueue('scout');
  await until(jobs, b.id, ended);
  assert.deepEqual((await jobs.list()).map((j) => j.id), [b.id, a.id]);
  await assert.rejects(jobs.enqueue('nonsense'), /no job of kind/);
  assert.equal(await jobs.read('../../etc'), null);
});

test('a log can be followed from an offset', async () => {
  const { jobs } = await setup();
  const done = await until(jobs, (await jobs.enqueue('scout')).id, ended);
  const whole = await jobs.logOf(done);
  assert.equal((await jobs.logOf(done, { offset: whole.size })).text, '');
  assert.equal((await jobs.logOf(done, { offset: 4 })).text, whole.text.slice(4));
  assert.equal((await jobs.logOf(done, { max: 3 })).truncated, true);
});
