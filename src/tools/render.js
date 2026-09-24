// The Technician's renderer: loads a variant in headless Chromium, collects errors,
// waits for the template's ready flag, screenshots the canvas and checks it isn't blank.
// p5 is served from node_modules in place of the CDN, and all other network is blocked:
// renders are offline, fast and reproducible, and sketches can't phone home.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { P5_URL, CANVAS } from './template.js';

const require = createRequire(import.meta.url);
const P5_LOCAL = require.resolve('p5/lib/p5.min.js');

/** A canvas whose dominant colour covers at least this share of samples is blank. */
export const BLANK_SHARE = 0.995;

/**
 * @typedef {object} RenderResult
 * @property {boolean} ok            no page errors, a canvas, and not blank
 * @property {string|null} reason    why not ok: "error" | "no-canvas" | "blank" | "timeout"
 * @property {{seed: number, png: string, blank: boolean, dominantShare: number, colors: number}[]} shots
 * @property {string[]} errors       uncaught exceptions and console.error lines
 * @property {string[]} blocked      network requests the sketch tried to make
 * @property {boolean} readySignal   the template's ready flag fired (false = waited for the timeout)
 * @property {number} ms
 */

/**
 * @param {{timeoutMs?: number, launch?: object}} [opts]
 */
export async function createRenderer({ timeoutMs = 15_000, launch = {} } = {}) {
  const browser = await chromium.launch(launch);
  const p5Source = await readFile(P5_LOCAL, 'utf8');
  // One scratch page decodes screenshots for the blank check.
  const analyser = await browser.newPage();

  /** Colour statistics of a PNG: dominant colour share and number of distinct colours (quantised). */
  async function analyse(png) {
    return analyser.evaluate(async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const size = 96;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const dominant = Math.max(...counts.values());
      return { dominantShare: dominant / (size * size), colors: counts.size };
    }, `data:image/png;base64,${png.toString('base64')}`);
  }

  /**
   * Render one variant file.
   * @param {string} htmlPath
   * @param {{seeds?: number[], pngPath?: (seed: number) => string}} [opts]
   * @returns {Promise<RenderResult>}
   */
  async function render(htmlPath, { seeds = [1], pngPath = (seed) => htmlPath.replace(/\.html$/, seeds.length > 1 ? `.s${seed}.png` : '.png') } = {}) {
    const started = Date.now();
    const errors = [];
    const blocked = [];
    const shots = [];
    let readySignal = true;
    let reason = null;

    const context = await browser.newContext({ viewport: { width: CANVAS.width, height: CANVAS.height }, deviceScaleFactor: 1 });
    try {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url === P5_URL) return route.fulfill({ status: 200, contentType: 'application/javascript', body: p5Source });
        if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        blocked.push(url);
        return route.abort();
      });
      for (const seed of seeds) {
        const page = await context.newPage();
        // The first uncaught error ends the wait: a crashed sketch never becomes ready.
        let crashed;
        const crash = new Promise((resolve) => (crashed = resolve));
        page.on('pageerror', (err) => {
          errors.push(`${err.name}: ${err.message}`);
          crashed();
        });
        page.on('console', (msg) => msg.type() === 'error' && !/net::ERR_FAILED/.test(msg.text()) && errors.push(`console.error: ${msg.text()}`));
        const url = `${pathToFileURL(htmlPath).href}?seed=${seed}&freeze=1`;
        await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
        const ready = page.waitForFunction(() => window.__silverReady === true, null, { timeout: timeoutMs }).then(() => true, () => false);
        readySignal = (await Promise.race([ready, crash.then(() => false)])) && readySignal;
        if (errors.length) {
          reason = 'error';
          await page.close();
          break;
        }
        const canvas = page.locator('canvas').first();
        if ((await canvas.count()) === 0) {
          reason = readySignal ? 'no-canvas' : 'timeout';
          await page.close();
          break;
        }
        const png = await canvas.screenshot({ path: pngPath(seed), animations: 'disabled' });
        const stats = await analyse(png);
        const blank = stats.dominantShare >= BLANK_SHARE;
        shots.push({ seed, png: pngPath(seed), blank, ...stats });
        await page.close();
        if (blank && seed === seeds[0]) {
          reason = 'blank';
          break;
        }
      }
    } finally {
      await context.close();
    }
    return { ok: reason === null, reason, shots, errors, blocked, readySignal, ms: Date.now() - started };
  }

  return { render, close: () => browser.close() };
}
