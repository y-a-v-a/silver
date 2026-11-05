#!/usr/bin/env node
// Runs one job: starts the Factory's CLI with the job's arguments, its output going to the
// job's log, and writes down how it ended. This small process owns the job, not the admin
// server, so a job keeps going (and its ending is still recorded) when the server restarts.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';

const [, , jobPath, cli] = process.argv;
const KILL_AFTER_MS = 3000;

async function save(changes) {
  const current = JSON.parse(await readFile(jobPath, 'utf8'));
  const next = { ...current, ...changes };
  const tmp = `${jobPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tmp, jobPath);
  return next;
}

// Signal handlers go first: from the moment the pid is on file, a cancel may arrive.
let child = null;
let cancelled = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (cancelled) return;
    cancelled = true;
    child?.kill('SIGTERM');
    // Playwright answers SIGTERM by closing its browser and leaves the process running, which
    // would go on paying for model calls. So the browser gets its moment, then the job ends.
    setTimeout(() => child?.kill('SIGKILL'), KILL_AFTER_MS).unref();
  });
}

const job = await save({ pid: process.pid });
if (cancelled) {
  await save({ status: 'cancelled', finishedAt: new Date().toISOString() });
  process.exit(0);
}

const log = openSync(job.log, 'a');
child = spawn(process.execPath, [cli, ...job.args], { cwd: job.cwd, env: process.env, stdio: ['ignore', log, log] });

child.on('error', async (err) => {
  await save({ status: 'failed', finishedAt: new Date().toISOString(), exitCode: null, error: err.message });
  process.exit(1);
});
child.on('close', async (code, signal) => {
  // A stop signals this process and the CLI together, and either can be seen first, so a CLI
  // ended by SIGTERM was stopped too. Any other signal (a crash, a kill) means it failed.
  const status = cancelled || signal === 'SIGTERM' || signal === 'SIGINT' ? 'cancelled' : code === 0 ? 'done' : 'failed';
  await save({ status, finishedAt: new Date().toISOString(), exitCode: code, ...(signal ? { signal } : {}) });
  process.exit(0);
});
