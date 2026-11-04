// A lock file holding its owner's pid. A lock left by a dead process is taken over, so a crash
// never blocks anything. Used across processes: the budget's reservations and the record's
// commits only hold if two of these jobs don't run side by side.
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

export class LockBusy extends Error {
  constructor(pid) {
    super(`held by pid ${pid}`);
    this.name = 'LockBusy';
    this.pid = pid;
  }
}

/** The pid holding the lock, or null when nobody alive does. */
export async function lockHolder(path) {
  const pid = Number(await readFile(path, 'utf8').catch(() => '0'));
  return pid && pidAlive(pid) ? pid : null;
}

/** Hold the lock while `fn` runs. Throws LockBusy when a live process has it. */
export async function withLock(path, fn) {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(path, 'wx');
      await fh.writeFile(String(process.pid));
      await fh.close();
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = await lockHolder(path);
      if (holder) throw new LockBusy(holder);
      await rm(path, { force: true }); // stale
      continue;
    }
    try {
      return await fn();
    } finally {
      await rm(path, { force: true });
    }
  }
  throw new LockBusy('?');
}
