// Guards the "record everything" decision: the record directories exist and are never gitignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, ROOT } from '../src/config.js';

const exec = promisify(execFile);
const cfg = await loadConfig({ env: {} });

const RECORD_DIRS = [
  cfg.paths.floor,
  join(cfg.paths.archive, 'transcripts'),
  join(cfg.paths.archive, 'variants'),
  join(cfg.paths.archive, 'diary'),
  join(cfg.paths.canon, 'works'),
];

/** true if git would ignore the path (exit 0 from check-ignore means ignored). */
async function ignored(path) {
  try {
    await exec('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT });
    return true;
  } catch (err) {
    if (err.code === 1) return false;
    throw err;
  }
}

test('record directories and roles/superstars exist', () => {
  for (const dir of [...RECORD_DIRS, cfg.paths.roles, join(cfg.paths.roles, 'superstars')]) {
    assert.ok(existsSync(dir), `${dir} is missing`);
  }
});

test('floor, archive and canon contents are tracked, never gitignored', async () => {
  for (const dir of RECORD_DIRS) {
    assert.equal(await ignored(join(dir, 'example.jsonl')), false, `${dir} is gitignored`);
  }
  assert.equal(await ignored(cfg.paths.taste), false, 'taste.md is gitignored');
});

test('secrets and generated output are gitignored', async () => {
  const paths = ['.env', '.env.local', 'node_modules/x'].map((p) => join(ROOT, p));
  for (const path of [...paths, join(cfg.paths.site, 'index.html')]) {
    assert.equal(await ignored(path), true, `${path} should be ignored`);
  }
  assert.equal(await ignored(join(ROOT, '.env.example')), false, '.env.example must be tracked');
});
