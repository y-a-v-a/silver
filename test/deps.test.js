// Smoke tests: every runtime dependency resolves, and the renderer's browser launches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

for (const name of Object.keys(pkg.dependencies ?? {})) {
  test(`dependency "${name}" can be imported`, async () => {
    const mod = await import(name);
    assert.ok(mod, `${name} exported nothing`);
  });
}

test('ulid produces sortable ids', async () => {
  const { monotonicFactory } = await import('ulid');
  const next = monotonicFactory();
  const a = next();
  const b = next();
  assert.equal(a.length, 26);
  assert.ok(a < b);
});

test(
  'playwright chromium launches headless',
  { skip: process.env.SILVER_SKIP_BROWSER ? 'SILVER_SKIP_BROWSER is set' : false, timeout: 30_000 },
  async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas id="c" width="4" height="4"></canvas>');
      assert.equal(await page.evaluate(() => document.getElementById('c').width), 4);
    } finally {
      await browser.close();
    }
  },
);
