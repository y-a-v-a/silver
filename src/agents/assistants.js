// The Studio assistants: turn one subject into a series of variants across models,
// temperatures and techniques. Each variant is made blind to the others, and the drift
// between them is kept (principle 2). Every variant is recorded, including failures.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { buildMatrix, extractSketch, sketchVars } from './studio.js';
import { buildSketchHtml } from '../tools/template.js';
import { buildContactSheet } from '../tools/contact-sheet.js';

export const ASSISTANT_PROMPT = 'Make your variant now. Reply with the JavaScript in one ```js block, nothing else.';

export class SeriesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeriesError';
  }
}

/**
 * Find a subject by full id, a unique id suffix, or "latest" (the newest subject without a series).
 * @param {ReturnType<import('../floor.js').createFloor>} floor
 * @param {string} ref
 */
export async function findSubject(floor, ref) {
  const events = await floor.read({ shift: 'all', type: ['subject.posted', 'series.started'] });
  const subjects = events.filter((e) => e.type === 'subject.posted');
  if (ref === 'latest') {
    const claimed = new Set(events.filter((e) => e.type === 'series.started').map((e) => e.payload.subjectId));
    const open = subjects.filter((s) => !claimed.has(s.id));
    if (!open.length) throw new SeriesError('no subject is waiting for a series');
    return open.at(-1);
  }
  const key = ref.toUpperCase();
  const matches = subjects.filter((s) => s.id === key || s.id.endsWith(key));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new SeriesError(`no subject matches "${ref}" (see: silver subjects)`);
  throw new SeriesError(`"${ref}" matches ${matches.length} subjects; use more characters`);
}

/** Run `fn` over `items` with at most `limit` in flight. Stops starting new work once `stop()` is true. */
async function pool(items, limit, fn, stop = () => false) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Produce one series.
 * @param {object} deps
 * @param {object} deps.config
 * @param {ReturnType<import('../floor.js').createFloor>} deps.floor
 * @param {{call: Function}} deps.llm
 * @param {{render: Function}|null} deps.renderer   null: write sketches but don't render (variants stay unverified)
 * @param {string} subjectRef  id, unique id suffix, or "latest"
 * @param {{variants?: number, dryRun?: boolean, concurrency?: number, rng?: () => number}} [opts]
 */
export async function runSeries({ config, floor, llm, renderer }, subjectRef, { variants, dryRun = false, concurrency = config.series.concurrency, rng } = {}) {
  const subject = await findSubject(floor, subjectRef);
  const chatter = (await floor.read({ shift: 'all', type: 'chatter.posted', ref: subject.id })).slice(-20);
  const matrix = buildMatrix(config, { rng, dryRun, variants });

  const started = await floor.append({
    type: 'series.started',
    actor: 'studio-assistant',
    ref: subject.id,
    payload: {
      subjectId: subject.id,
      subjectTitle: subject.payload.title,
      models: matrix.models,
      techniques: matrix.techniques,
      temperatures: matrix.temperatures,
      variants: matrix.cells.length,
      dryRun,
    },
  });
  const seriesId = started.id;
  const dir = join(config.paths.archive, 'variants', seriesId);
  await mkdir(dir, { recursive: true });
  const rel = (p) => relative(config.root, p);

  const results = [];
  let stoppedEarly = null;

  await pool(
    matrix.cells,
    concurrency,
    async (cell) => {
      const base = { seriesId, variant: cell.variant, technique: cell.technique, requestedModel: cell.model, temperature: cell.temperature };
      const fail = async (stage, error, extra = {}) => {
        const actor = ['error', 'blank', 'no-canvas', 'timeout'].includes(stage) ? 'renderer' : 'studio-assistant';
        await floor.append({ type: 'variant.failed', actor, ref: seriesId, payload: { ...base, stage, error, ...extra } });
        results.push({ ...cell, ok: false, reason: stage, error, ...extra });
      };

      let res;
      try {
        res = await llm.call('studio-assistant', {
          vars: sketchVars({ subject, chatter, cell, techniques: config.techniques }),
          prompt: ASSISTANT_PROMPT,
          model: cell.model,
          temperature: cell.temperature,
          ref: seriesId,
        });
      } catch (err) {
        if (err.name === 'BudgetExhausted') stoppedEarly ??= err.message;
        return fail(err.name === 'BudgetExhausted' ? 'budget' : 'llm', err.message);
      }

      let sketch;
      try {
        sketch = extractSketch(res.content);
      } catch (err) {
        const replyPath = join(dir, `${cell.variant}.reply.txt`);
        await writeFile(replyPath, res.content);
        return fail('extract', err.message, { callId: res.id, model: res.model, reply: rel(replyPath) });
      }

      const htmlPath = join(dir, `${cell.variant}.html`);
      const meta = {
        title: `${subject.payload.title} (${cell.variant})`,
        subject: { id: subject.id, title: subject.payload.title },
        series: seriesId,
        variant: cell.variant,
        technique: cell.technique,
        model: res.model,
        temperature: cell.temperature,
        callId: res.id,
      };
      await writeFile(htmlPath, buildSketchHtml({ sketch, meta }));
      const made = { callId: res.id, model: res.model, usd: res.usd, path: rel(htmlPath) };

      if (!renderer) {
        await floor.append({ type: 'variant.produced', actor: 'studio-assistant', ref: seriesId, payload: { ...base, ...made, png: null, seed: null, rendered: false } });
        results.push({ ...cell, ok: true, html: `${cell.variant}.html`, png: null, model: res.model });
        return;
      }

      let shot;
      try {
        shot = await renderer.render(htmlPath);
      } catch (err) {
        return fail('timeout', `renderer: ${err.message}`, made);
      }
      if (!shot.ok) return fail(shot.reason, shot.errors.join('\n') || shot.reason, { ...made, blocked: shot.blocked });

      const png = shot.shots[0];
      await floor.append({
        type: 'variant.produced',
        actor: 'studio-assistant',
        ref: seriesId,
        payload: { ...base, ...made, png: rel(png.png), seed: png.seed, rendered: true, render: { ms: shot.ms, colors: png.colors, readySignal: shot.readySignal, blocked: shot.blocked } },
      });
      results.push({ ...cell, ok: true, html: `${cell.variant}.html`, png: `${cell.variant}.png`, model: res.model });
    },
    () => stoppedEarly !== null,
  );

  // Cells never started because the budget ran out are recorded too.
  for (const cell of matrix.cells) {
    if (results.some((r) => r.variant === cell.variant)) continue;
    await floor.append({ type: 'variant.failed', actor: 'studio-assistant', ref: seriesId, payload: { seriesId, variant: cell.variant, technique: cell.technique, requestedModel: cell.model, temperature: cell.temperature, stage: 'budget', error: 'not started: budget exhausted' } });
    results.push({ ...cell, ok: false, reason: 'budget', error: 'not started: budget exhausted' });
  }
  results.sort((a, b) => a.variant.localeCompare(b.variant));

  const sheetPath = join(dir, 'index.html');
  await writeFile(
    sheetPath,
    buildContactSheet({ seriesId, subject: { id: subject.id, title: subject.payload.title, why: subject.payload.why ?? subject.payload.scoutWhy, sensitive: subject.payload.sensitive }, variants: results }),
  );

  const completed = await floor.append({
    type: 'series.completed',
    actor: 'studio-assistant',
    ref: seriesId,
    payload: {
      seriesId,
      subjectId: subject.id,
      produced: results.filter((r) => r.ok).map((r) => r.variant),
      failed: results.filter((r) => !r.ok).map((r) => ({ variant: r.variant, stage: r.reason })),
      contactSheet: rel(sheetPath),
      stoppedEarly,
    },
  });
  return { subject, seriesId, dir, matrix, results, completed, stoppedEarly };
}
