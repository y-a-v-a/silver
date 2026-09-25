import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initRecord, commitRecord, setRecordRemote, recordStatus, recordGit, hasRecord } from '../src/record.js';

const run = promisify(execFile);

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'silver-record-'));
  for (const d of ['floor', 'archive/diary', 'canon', 'src', 'node_modules/x']) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, 'floor', '2026-09-25.jsonl'), '{"id":"1"}\n');
  await writeFile(join(root, 'archive', 'diary', '2026-09-25.md'), '# A day\n');
  await writeFile(join(root, 'canon', 'canon.json'), '{}');
  await writeFile(join(root, 'canon', '.publish.lock'), '123');
  await writeFile(join(root, 'taste.md'), '# taste\n');
  await writeFile(join(root, 'src', 'code.js'), 'x');
  await writeFile(join(root, 'node_modules', 'x', 'index.js'), 'x');
  await writeFile(join(root, '.env'), 'OPENROUTER_API_KEY=secret');
  return { root };
}

test('initRecord tracks only the data, never code, secrets or the publish lock', async () => {
  const config = await project();
  assert.equal(await hasRecord(config), false);
  const r = await initRecord(config);
  assert.equal(r.created, true);
  assert.match(r.commit, /^[0-9a-f]{40}$/);
  const files = (await recordGit(config)('ls-files')).split('\n').sort();
  assert.deepEqual(files, ['archive/diary/2026-09-25.md', 'canon/canon.json', 'floor/2026-09-25.jsonl', 'taste.md']);
  assert.deepEqual(await initRecord(config), { created: false, commit: null }, 'idempotent');
});

test('commitRecord commits changes only; pushes to a remote when there is one; a failed push is reported, not thrown', async () => {
  const config = await project();
  await initRecord(config);
  assert.equal((await commitRecord(config, { message: 'nothing' })).committed, false);

  await writeFile(join(config.root, 'floor', '2026-09-26.jsonl'), '{"id":"2"}\n');
  const local = await commitRecord(config, { message: 'Shift 2026-09-26' });
  assert.deepEqual([local.committed, local.pushed, local.remote, local.error], [true, false, null, null]);

  const bare = await mkdtemp(join(tmpdir(), 'silver-record-remote-'));
  await run('git', ['init', '--quiet', '--bare', bare]);
  await setRecordRemote(config, bare);
  await writeFile(join(config.root, 'taste.md'), '# taste\nmore\n');
  const pushed = await commitRecord(config, { message: 'Shift 2026-09-27' });
  assert.deepEqual([pushed.committed, pushed.pushed, pushed.remote], [true, true, 'origin']);
  const { stdout } = await run('git', ['--git-dir', bare, 'log', '--format=%s', 'main']);
  assert.deepEqual(stdout.trim().split('\n'), ['Shift 2026-09-27', 'Shift 2026-09-26', 'The record begins']);

  await setRecordRemote(config, join(config.root, 'no-such-remote'));
  await writeFile(join(config.root, 'taste.md'), '# taste\neven more\n');
  const failed = await commitRecord(config, { message: 'Shift 2026-09-28' });
  assert.deepEqual([failed.committed, failed.pushed], [true, false]);
  assert.ok(failed.error);

  const s = await recordStatus(config);
  assert.deepEqual([s.exists, s.commits, s.dirty, s.files], [true, 4, false, 5]);
});

test('without a record, commitRecord says so', async () => {
  const config = await project();
  assert.match((await commitRecord(config, { message: 'x' })).error, /silver init-record/);
});
