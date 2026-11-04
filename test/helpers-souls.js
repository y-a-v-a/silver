// The shipped role files, for tests that hold them against the code's expectations.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const ROLES = fileURLToPath(new URL('../roles/', import.meta.url));

export async function listRoles() {
  const entries = await readdir(ROLES, { withFileTypes: true, recursive: true });
  const out = [];
  for (const e of entries.filter((x) => x.isFile() && x.name.endsWith('.md'))) {
    const path = join(e.parentPath, e.name);
    const file = path.slice(ROLES.length);
    out.push({ file, id: basename(file, '.md'), group: file.split(sep)[0] === 'superstars' ? 'superstar' : 'role', body: matter(await readFile(path, 'utf8')).content });
  }
  return out;
}
