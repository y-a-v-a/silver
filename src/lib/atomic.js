// Write a file so that readers see the old version or the new one, never half of either:
// a shift starting at 09:00 may read a role file at the moment the admin saves it.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

let counter = 0;

/** @param {string} path @param {string|Buffer} data */
export async function writeFileAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${++counter}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
