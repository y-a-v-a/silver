// Jobs: the admin never does the Factory's work inside its own process. Each job is a fresh
// `silver ...` process, so it always runs the code, config and role files as they are now, and
// a restart of the admin doesn't touch it. A job is a JSON file and a log in archive/jobs/, so
// the list survives restarts and belongs to the record.
//
// One job at a time per lane: the budget's reservations live inside a process, so two
// spending processes side by side could overshoot the cap. Printing has its own lane, because
// an approval shouldn't wait for a whole shift.
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { monotonicFactory } from 'ulid';
import { writeFileAtomic } from '../lib/atomic.js';

const nextId = monotonicFactory();
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const RUNNER = fileURLToPath(new URL('./run-job.js', import.meta.url));
const STARTUP_GRACE_MS = 15_000;

export class JobError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'JobError';
    this.status = status;
  }
}

/**
 * What the admin can ask for. Each builds the CLI arguments, so user text only ever reaches a
 * process as one argv entry, never through a shell.
 */
export const JOB_KINDS = Object.freeze({
  shift: { lane: 'studio', title: (o) => `${o.dryRun ? 'Dry run of the shift' : o.again ? 'Another round of the shift' : 'The shift'}`, args: (o) => ['shift', '--no-notify', ...(o.dryRun ? ['--dry-run'] : []), ...(o.again ? ['--again'] : []), ...(o.force ? ['--force'] : [])] },
  scout: { lane: 'studio', title: () => 'The Scout goes out', args: (o) => ['scout', ...(o.dryRun ? ['--dry-run'] : [])] },
  sources: { lane: 'studio', title: () => 'Looking through the sources', args: () => ['scout', '--list'] },
  chatter: { lane: 'studio', title: (o) => (o.subject ? `The superstars talk about "${o.subjectTitle ?? o.subject}"` : 'The superstars talk'), args: (o) => ['chatter', ...(o.subject ? [o.subject] : [])] },
  audition: { lane: 'studio', title: (o) => `${o.role} auditions`, args: (o) => ['audition', o.role, ...(o.subject ? [o.subject] : [])] },
  commission: {
    lane: 'studio',
    title: (o) => `Commission: ${String(o.text).slice(0, 60)}`,
    args: (o) => ['commission', ...(o.why ? ['--why', o.why] : []), ...(o.now ? ['--now'] : []), '--', o.text],
  },
  series: {
    lane: 'studio',
    title: (o) => `A series on "${o.subjectTitle ?? o.subject}"`,
    args: (o) => [
      'series',
      o.subject,
      ...(o.techniques?.length ? ['--technique', ...o.techniques] : []),
      ...(o.models?.length ? ['--model', ...o.models] : []),
      ...(o.temperatures?.length ? ['--temperature', ...o.temperatures.map(String)] : []),
      ...(o.dare ? ['--dare', o.dare] : []),
      ...(o.note ? ['--note', o.note] : []),
      ...(o.variants ? ['--variants', String(o.variants)] : []),
      ...(o.noChatter ? ['--no-chatter'] : []),
      ...(o.dryRun ? ['--dry-run'] : []),
    ],
  },
  shortlist: { lane: 'studio', title: (o) => `Warhol looks at "${o.subjectTitle ?? o.series}"`, args: (o) => ['shortlist', o.series, ...(o.force ? ['--force'] : [])] },
  pull: {
    lane: 'studio',
    title: (o) => `Second pull of ${o.variant ?? "Warhol's pick"} of "${o.subjectTitle ?? o.series}"`,
    args: (o) => ['pull', o.series, ...(o.variant ? ['--variant', o.variant] : []), ...(o.note ? ['--note', o.note] : []), ...(o.again ? ['--again'] : [])],
  },
  diary: { lane: 'studio', title: () => "The Archivist types up today's diary", args: (o) => ['diary', ...(o.date ? [o.date] : []), '--write', ...(o.force ? ['--force'] : [])] },
  publish: { lane: 'print', title: (o) => (o.redeploy ? 'Printing and redeploying the gallery' : 'Printing and publishing'), args: (o) => ['publish', ...(o.noDeploy ? ['--no-deploy'] : []), ...(o.redeploy ? ['--redeploy'] : [])] },
  retitle: {
    lane: 'print',
    title: (o) => `A new label for No. ${String(o.edition).padStart(3, '0')}`,
    args: (o) => ['retitle', String(o.edition), ...(o.title ? ['--title', o.title] : []), ...(o.wall ? ['--wall', o.wall] : []), ...(o.note ? ['--note', o.note] : [])],
  },
});

const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * @param {{config: {root: string, paths: {archive: string}}, env?: NodeJS.ProcessEnv, cli?: string, externalShift?: () => Promise<boolean>}} deps
 *   cli: the script a job runs (tests point it at a stub). externalShift: true while a shift
 *   started by launchd is on the floor, so queued work waits for it.
 */
export function createJobs({ config, env = process.env, cli = CLI, externalShift = async () => false }) {
  const dir = join(config.paths.archive, 'jobs');
  const fileOf = (id) => join(dir, `${id}.json`);
  let pumping = Promise.resolve();

  async function read(id) {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return null;
    try {
      return settle(JSON.parse(await readFile(fileOf(id), 'utf8')));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** A job whose runner died without writing its ending ended somehow; say so rather than show it running forever. */
  async function settle(job) {
    if (job.status !== 'running' || alive(job.pid)) return job;
    // No pid yet: the runner is still starting up.
    if (!job.pid && Date.now() - Date.parse(job.startedAt) < STARTUP_GRACE_MS) return job;
    const ended = { ...job, status: 'lost', finishedAt: job.finishedAt ?? new Date().toISOString() };
    await writeFileAtomic(fileOf(job.id), `${JSON.stringify(ended, null, 2)}\n`);
    return ended;
  }

  /** Newest first. */
  async function list({ limit = 50 } = {}) {
    let names;
    try {
      names = await readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort().reverse();
    const jobs = [];
    for (const id of ids.slice(0, limit)) {
      const job = await read(id);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  /** Every job that has not ended, oldest first (the ids sort by time). */
  async function open() {
    return (await list({ limit: 200 })).filter((j) => j.status === 'queued' || j.status === 'running').reverse();
  }

  function start(job) {
    const child = spawn(process.execPath, [RUNNER, fileOf(job.id), cli], { cwd: config.root, env, detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid;
  }

  /** Start whatever can start: the oldest queued job of each lane that has nothing running. */
  function pump() {
    pumping = pumping.then(async () => {
      const jobs = await open();
      const busy = new Set(jobs.filter((j) => j.status === 'running').map((j) => j.lane));
      const held = await externalShift();
      const started = [];
      for (const job of jobs) {
        if (job.status !== 'queued' || busy.has(job.lane)) continue;
        if (job.lane === 'studio' && held) continue;
        busy.add(job.lane);
        // From here on the file is the runner's: it adds its own pid and writes the ending.
        const running = { ...job, status: 'running', startedAt: new Date().toISOString() };
        await writeFileAtomic(fileOf(job.id), `${JSON.stringify(running, null, 2)}\n`);
        start(running);
        started.push(running);
      }
      return started;
    });
    const result = pumping;
    pumping = pumping.catch(() => {});
    return result;
  }

  /**
   * Queue a job and start it if its lane is free.
   * @param {keyof typeof JOB_KINDS} kind
   * @param {object} [options]
   * @param {{coalesce?: boolean}} [opts]  coalesce: a job of this kind still waiting to start is enough
   */
  async function enqueue(kind, options = {}, { coalesce = false } = {}) {
    const spec = JOB_KINDS[kind];
    if (!spec) throw new JobError(`no job of kind "${kind}"`);
    if (coalesce) {
      const waiting = (await open()).find((j) => j.kind === kind && j.status === 'queued');
      if (waiting) return waiting;
    }
    const id = nextId();
    const job = {
      id,
      kind,
      lane: spec.lane,
      title: spec.title(options),
      args: spec.args(options),
      options,
      cwd: config.root,
      log: join(dir, `${id}.log`),
      status: 'queued',
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      pid: null,
    };
    await writeFileAtomic(fileOf(id), `${JSON.stringify(job, null, 2)}\n`);
    await writeFileAtomic(job.log, '');
    await pump();
    return (await read(id)) ?? job;
  }

  /** Cancel a waiting job, or stop a running one (the shift resumes where it stopped next time). */
  async function cancel(id) {
    const job = await read(id);
    if (!job) throw new JobError(`no job ${id}`, 404);
    if (job.status === 'queued') {
      const cancelled = { ...job, status: 'cancelled', finishedAt: new Date().toISOString() };
      await writeFileAtomic(fileOf(id), `${JSON.stringify(cancelled, null, 2)}\n`);
      return cancelled;
    }
    if (job.status !== 'running') throw new JobError(`${job.title} has already ended`, 409);
    let current = job;
    while (current?.status === 'running' && !current.pid) {
      await sleep(25);
      current = await read(id);
    }
    if (current?.status !== 'running') throw new JobError(`${job.title} has already ended`, 409);
    // The runner and the CLI share a process group. Playwright closes its browser on the signal;
    // the runner sees to it that the CLI goes too.
    try {
      process.kill(-current.pid, 'SIGTERM');
    } catch (err) {
      if (err.code !== 'ESRCH') throw err;
    }
    return job;
  }

  /** The end of a job's log: at most `max` bytes, from `offset` when following it. */
  async function logOf(job, { offset = null, max = 200_000 } = {}) {
    let text;
    try {
      text = await readFile(job.log);
    } catch (err) {
      if (err.code === 'ENOENT') return { text: '', size: 0, truncated: false };
      throw err;
    }
    const from = offset === null ? Math.max(0, text.length - max) : Math.min(offset, text.length);
    return { text: text.subarray(from).toString('utf8'), size: text.length, truncated: offset === null && from > 0 };
  }

  return { dir, read, list, open, enqueue, cancel, pump, logOf };
}
