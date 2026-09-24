import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeEntry, logProgress, readProgress } from '../src/lib/process-log.js';

const run = promisify(execFile);

test('makeEntry fills defaults and normalises phase to a string', () => {
  const e = makeEntry({ phase: 0, task: '  scaffold  ' });
  assert.equal(e.phase, '0');
  assert.equal(e.task, 'scaffold');
  assert.equal(e.status, 'done');
  assert.deepEqual(e.files, []);
  assert.ok(!Number.isNaN(Date.parse(e.ts)));
});

test('makeEntry rejects missing or invalid fields', () => {
  assert.throws(() => makeEntry({ task: 'x' }), /phase/);
  assert.throws(() => makeEntry({ phase: 0 }), /task/);
  assert.throws(() => makeEntry({ phase: 0, task: 'x', status: 'nope' }), /status/);
  assert.throws(() => makeEntry({ phase: 0, task: 'x', files: 'a,b' }), /files/);
});

test('logProgress appends and readProgress filters by phase', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'silver-plog-')), 'process-log.jsonl');
  await logProgress(path, { phase: 0, task: 'a' });
  await logProgress(path, { phase: 1, task: 'b' });
  await logProgress(path, { phase: 0, task: 'c', status: 'note' });
  assert.equal((await readProgress(path)).length, 3);
  assert.deepEqual((await readProgress(path, { phase: 0 })).map((e) => e.task), ['a', 'c']);
});

test('bin/log-progress.js exits non-zero on invalid input', async () => {
  await assert.rejects(run(process.execPath, ['bin/log-progress.js', '--phase', '0']), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /task is required/);
    return true;
  });
});
