import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv } from '../src/lib/env.js';

test('loadDotEnv returns false when there is no .env', async () => {
  assert.equal(loadDotEnv(join(await mkdtemp(join(tmpdir(), 'silver-env-')), '.env')), false);
});

test('loadDotEnv loads values but does not override existing env vars', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'silver-env-')), '.env');
  await writeFile(path, 'SILVER_TEST_NEW=fromfile\nSILVER_TEST_KEEP=fromfile\n');
  process.env.SILVER_TEST_KEEP = 'fromshell';
  try {
    assert.equal(loadDotEnv(path), true);
    assert.equal(process.env.SILVER_TEST_NEW, 'fromfile');
    assert.equal(process.env.SILVER_TEST_KEEP, 'fromshell');
  } finally {
    delete process.env.SILVER_TEST_NEW;
    delete process.env.SILVER_TEST_KEEP;
  }
});
