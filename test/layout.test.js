// Guards the "data stays out of git" decision (2026-09-24): runtime data (floor, archive,
// canon, taste.md) is kept on disk but never committed, and neither are secrets or the
// generated site. Code, roles and config stay tracked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, ROOT } from '../src/config.js';

const exec = promisify(execFile);
const cfg = await loadConfig({ env: {} });

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

test('runtime data is gitignored: floor, archive, canon and taste.md', async () => {
  const data = [
    join(cfg.paths.floor, '2026-01-01.jsonl'),
    join(cfg.paths.archive, 'transcripts', 'x.json'),
    join(cfg.paths.archive, 'variants', 's', 'v.html'),
    join(cfg.paths.archive, 'diary', '2026-01-01.md'),
    join(cfg.paths.canon, 'canon.json'),
    cfg.paths.taste,
  ];
  for (const path of data) assert.equal(await ignored(path), true, `${path} should be ignored`);
});

test('no runtime data is tracked by git', async () => {
  const { stdout } = await exec('git', ['ls-files', '--', 'floor', 'archive', 'canon', 'taste.md'], { cwd: ROOT });
  assert.equal(stdout.trim(), '', `tracked data files:\n${stdout}`);
});

test('secrets and generated output are gitignored', async () => {
  for (const path of [...['.env', '.env.local', 'node_modules/x'].map((p) => join(ROOT, p)), join(cfg.paths.site, 'index.html')]) {
    assert.equal(await ignored(path), true, `${path} should be ignored`);
  }
});

test('code, roles, config and docs stay tracked', async () => {
  for (const path of ['.env.example', 'silver.config.js', 'roles/scout.md', 'src/cli.js', 'ACTIONS.md', 'process-log.jsonl']) {
    assert.equal(await ignored(join(ROOT, path)), false, `${path} must not be ignored`);
  }
  assert.ok(existsSync(join(cfg.paths.roles, 'superstars')), 'roles/superstars/ exists');
});
