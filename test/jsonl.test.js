import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLine, readLines } from '../src/lib/jsonl.js';

const tmp = () => mkdtemp(join(tmpdir(), 'silver-jsonl-'));

test('appendLine writes one line per record and never rewrites', async () => {
  const path = join(await tmp(), 'nested', 'log.jsonl');
  await appendLine(path, { a: 1 });
  await appendLine(path, { b: 'two\nlines' });
  const text = await readFile(path, 'utf8');
  assert.equal(text.split('\n').length, 3); // two lines + trailing newline
  assert.deepEqual(await readLines(path), [{ a: 1 }, { b: 'two\nlines' }]);
});

test('appendLine rejects non-objects', async () => {
  const path = join(await tmp(), 'log.jsonl');
  for (const bad of [null, 'x', 3, [1]]) {
    await assert.rejects(appendLine(path, bad), TypeError);
  }
});

test('readLines treats a missing file as empty', async () => {
  assert.deepEqual(await readLines(join(await tmp(), 'nope.jsonl')), []);
});

test('readLines skips blank lines and reports malformed ones by line number', async () => {
  const path = join(await tmp(), 'log.jsonl');
  await writeFile(path, '{"a":1}\n\n{"b":2}\n');
  assert.deepEqual(await readLines(path), [{ a: 1 }, { b: 2 }]);
  await writeFile(path, '{"a":1}\n{broken\n');
  await assert.rejects(readLines(path), /log\.jsonl:2: invalid JSON/);
});
