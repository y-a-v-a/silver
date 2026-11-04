// The parts of the admin only a browser can test: the keyboard, swapping a page in place, the
// live wire, and above all the sandbox: a sketch written by a model must not be able to touch
// the admin it's shown in. No network: the sketches here are small pages without p5.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createAdminServer } from '../src/admin/server.js';
import { createFloor } from '../src/floor.js';
import { readOverlay } from '../src/settings.js';
import { listSeries } from '../src/agents/series-data.js';
import { seedSeries } from './helpers.js';

const SKIP = process.env.SILVER_SKIP_BROWSER ? 'SILVER_SKIP_BROWSER is set' : false;
const ROLES = fileURLToPath(new URL('../roles/', import.meta.url));
// 1x1 grey PNG, so the frames have something real to show.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let browser;
let root;
let config;
let floor;
let seeded;
let admin;
let base;
let page;
const errors = [];

before(async () => {
  if (SKIP) return;
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  root = await mkdtemp(join(tmpdir(), 'silver-admin-browser-'));
  await cp(ROLES, join(root, 'roles'), { recursive: true });
  config = await loadConfig({ env: {}, root, overlay: true });
  floor = createFloor({ dir: config.paths.floor });
  seeded = await seedSeries({ floor, root });
  for (const v of ['v01', 'v02', 'v03']) await writeFile(join(seeded.dir, `${v}.png`), PNG);
  // What a hostile sketch would try: change a setting, read a page, write a soul.
  await writeFile(join(seeded.dir, 'v01.html'), `<!doctype html><title>sketch</title><script>
    const send = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b }).then((r) => r.status, (e) => 'refused');
    Promise.all([send('/system/pause', 'paused=1'), fetch('/').then((r) => r.status, () => 'refused')]).then(([post, read]) => { document.title = 'done ' + post + ' ' + read; });
  </script>`);
  admin = createAdminServer({ config, floor, getConfig: () => loadConfig({ env: {}, root, overlay: true }), extra: { env: {} } });
  base = await admin.listen(0);
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => errors.push(e.message));
});
after(async () => {
  await admin?.close();
  await browser?.close();
});

test('no script errors, and the content security policy lets the page\'s own script run', { skip: SKIP }, async () => {
  await page.goto(`${base}/series/${seeded.seriesId}`);
  await page.keyboard.press('j');
  assert.equal(await page.locator('.card.current').count(), 1, 'the script is running');
  assert.deepEqual(errors, []);
});

test('the keyboard approves in place: no page load, the mark appears, it moves on', { skip: SKIP }, async () => {
  await page.goto(`${base}/series/${seeded.seriesId}`);
  await page.evaluate(() => (window.sameDocument = true));
  await page.keyboard.press('j');
  const id = await page.locator('.card.current').getAttribute('id');
  await page.keyboard.press('a');
  await page.waitForFunction((v) => document.getElementById(v)?.classList.contains('approved'), id);
  assert.equal(await page.evaluate(() => window.sameDocument), true, 'the same document, no navigation');
  assert.equal(await page.locator(`#${id} .mark.ok`).count(), 1);
  assert.notEqual(await page.locator('.card.current').getAttribute('id'), id);
  const view = (await listSeries(floor))[0];
  assert.equal(view.decisions.get(id).payload.verdict, 'approved');
});

test('the lightbox opens, moves and closes', { skip: SKIP }, async () => {
  await page.goto(`${base}/series/${seeded.seriesId}`);
  await page.locator('.sheet .frame').first().click();
  assert.equal(await page.locator('dialog.light[open]').count(), 1);
  assert.ok(await page.locator('.light-stage img').count());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog.light[open]').count(), 0);
});

test('a two-step button asks first, and goes through on the second click', { skip: SKIP }, async () => {
  await page.goto(`${base}/studio`);
  await page.locator('form[action="/studio/settings/pace"] [name=dailyUsd]').fill('3');
  await page.locator('form[action="/studio/settings/pace"] button.primary').click();
  await page.waitForLoadState();
  assert.equal((await readOverlay(root)).budget.dailyUsd, 3);
  const reset = page.locator('form[action="/studio/settings/pace"] button[name=reset]');
  await reset.click();
  assert.equal(await reset.getAttribute('data-armed'), '1', 'armed, nothing sent yet');
  assert.equal((await readOverlay(root)).budget.dailyUsd, 3);
  await reset.click();
  await page.waitForLoadState();
  assert.deepEqual(await readOverlay(root), {});
});

test('a select with a field named "action" in its form still posts to the right place', { skip: SKIP }, async () => {
  await page.goto(`${base}/studio`);
  await page.selectOption('select[aria-label="Weight of rorschach"]', '0');
  await page.waitForFunction(() => document.querySelector('tr#t-rorschach.off'));
  assert.equal((await readOverlay(root)).steering.techniques.rorschach, 0);
  await page.selectOption('select[aria-label="Weight of rorschach"]', '1');
  await page.waitForFunction(() => !document.querySelector('tr#t-rorschach.off'));
  assert.deepEqual(await readOverlay(root), {});
});

test('the soul editor checks as you type, and asks before losing what you typed', { skip: SKIP }, async () => {
  await page.goto(`${base}/souls/nico`);
  const text = await page.inputValue('#body');
  await page.fill('#body', `${text}\n{{wibble}}`);
  await page.waitForFunction(() => /wibble/.test(document.querySelector('.check-result')?.textContent ?? ''));
  assert.equal(await page.locator('form[data-soul]').getAttribute('data-dirty'), '1');
  page.once('dialog', (d) => d.dismiss());
  await page.goto(`${base}/`).catch(() => {});
  assert.match(page.url(), /\/souls\/nico$/, 'stayed: the unsaved text is still here');
  assert.match(await page.inputValue('#body'), /wibble/);
  await page.evaluate(() => delete document.querySelector('form[data-soul]').dataset.dirty);
});

test('the wire brings floor events to an open page', { skip: SKIP }, async () => {
  await page.goto(`${base}/floor`);
  await page.waitForTimeout(1500); // the wire has seen where the floor is
  await floor.append({ type: 'chatter.posted', actor: 'superstar.viva', ref: seeded.subject.id, payload: { persona: 'viva', text: 'Boring, live.' } });
  await page.waitForFunction(() => /Boring, live\./.test(document.querySelector('[data-live-floor]')?.textContent ?? ''), null, { timeout: 8000 });
});

test('a sketch opened on its own can\'t touch the admin: no posts, nothing read', { skip: SKIP }, async () => {
  const sketch = await browser.newPage();
  await sketch.goto(`${base}/files/${seeded.seriesId}/v01.html`);
  await sketch.waitForFunction(() => document.title.startsWith('done'));
  const [, post, read] = (await sketch.title()).split(' ');
  assert.equal(post, 'refused', 'its opaque origin can\'t even ask');
  assert.equal(read, 'refused');
  await sketch.close();
  assert.equal((await readOverlay(root)).shift, undefined, 'the shift was not paused');
});

test('a sketch played in place runs in the sandbox too', { skip: SKIP }, async () => {
  await page.goto(`${base}/series/${seeded.seriesId}`);
  await page.locator('#v01 [data-live]').click();
  const frame = page.locator('#v01 .frame iframe');
  assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts');
  const child = await (await frame.elementHandle()).contentFrame();
  await child.waitForFunction(() => document.title.startsWith('done'));
  assert.equal((await child.title()).split(' ')[1], 'refused');
  assert.equal((await readOverlay(root)).shift, undefined);
});
