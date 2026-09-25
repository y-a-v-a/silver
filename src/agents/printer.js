// The Printer: turns each approved variant into a signed work in the canon. It copies the
// sketch (the published piece has no seed, so it drifts on every load), renders a poster,
// runs the piece for a while and looks again, and has the print check judged. A concern
// is recorded but never blocks: nothing un-signs an approved work.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { approvalsToPrint, canonIdFor, signature, readCanon, writeCanonJson } from '../canon.js';
import { listSeries } from './series-data.js';

/**
 * Print every approved variant that has no work yet.
 * @param {object} deps
 * @param {object} deps.config
 * @param {ReturnType<import('../floor.js').createFloor>} deps.floor
 * @param {{call: Function}|null} deps.llm        null: skip the print check
 * @param {{render: Function, hold: Function}} deps.renderer
 * @param {{limit?: number}} [opts]
 * @returns {Promise<object[]>} the work.published events
 */
export async function printApproved({ config, floor, llm, renderer }, { limit = Infinity } = {}) {
  const views = await listSeries(floor);
  const published = await floor.read({ shift: 'all', type: 'work.published' });
  const todo = approvalsToPrint(views, published).slice(0, limit);
  const rel = (p) => relative(config.root, p);
  const out = [];

  for (const { series, variant, approval, pick } of todo) {
    const subjectTitle = series.subject?.payload.title ?? series.started.payload.subjectTitle ?? 'Untitled';
    const canonId = canonIdFor({ subjectTitle, variant: variant.variant, seriesId: series.seriesId });
    const dir = join(config.paths.canon, 'works', canonId);
    await mkdir(dir, { recursive: true });
    const sketchPath = join(dir, 'sketch.html');
    await copyFile(join(config.root, variant.html), sketchPath);
    const sketch = await readFile(sketchPath, 'utf8');

    // The poster: seed 1, frozen at the ready frame. If it won't render, keep the review screenshot.
    const posterPath = join(dir, 'poster.png');
    const shot = await renderer.render(sketchPath, { pngPath: () => posterPath }).catch((err) => ({ ok: false, reason: 'error', errors: [err.message] }));
    if (!shot.ok && variant.png) await copyFile(join(config.root, variant.png), posterPath);

    // Run it and look again.
    const holdSeconds = config.printer.holdSeconds;
    const laterPath = join(dir, 'later.png');
    const held = holdSeconds > 0
      ? await renderer.hold(sketchPath, { holdMs: holdSeconds * 1000, pngPath: laterPath }).catch((err) => ({ ok: false, reason: 'error', errors: [err.message], png: null }))
      : null;

    const printCheck = await check({ llm, subjectTitle, variant, pick, approval, holdSeconds, held, images: [posterPath, held?.png].filter(Boolean) });

    const event = await floor.append({
      type: 'work.published',
      actor: 'printer',
      ref: approval.id,
      payload: {
        canonId,
        seriesId: series.seriesId,
        variant: variant.variant,
        subjectId: series.subject?.id ?? null,
        subjectTitle,
        sourceUrl: series.subject?.payload.url ?? null,
        technique: variant.technique,
        model: variant.model,
        approvalId: approval.id,
        humanNote: approval.payload.note ?? null,
        warholNote: pick?.note ?? null,
        signature: signature({ sketch, warholNote: pick?.note ?? null, approvalId: approval.id }),
        sketch: rel(sketchPath),
        poster: rel(posterPath),
        later: held?.png ? rel(held.png) : null,
        printCheck,
      },
    });
    out.push(event);
  }
  if (out.length) await writeCanonJson(config, await readCanon(floor));
  return out;
}

/** The Printer's look at the proofs. A failed or skipped check is recorded, never fatal. */
async function check({ llm, subjectTitle, variant, pick, approval, holdSeconds, held, images }) {
  const hold = held ? { ok: held.ok, reason: held.reason, errors: held.errors.slice(0, 3) } : null;
  // A hard failure while running is a concern whatever the model says.
  const hard = held && !held.ok ? `the piece ${held.reason === 'error' ? 'threw an error' : held.reason === 'blank' ? 'went blank' : 'lost its canvas'} while running` : null;
  if (!llm) return { verdict: hard ? 'concern' : 'unchecked', note: hard ?? 'no print check (no model)', hold };
  try {
    const res = await llm.call('printer', {
      vars: {
        work: [`${subjectTitle} (${variant.variant}, ${variant.technique})`, pick?.note && `Warhol said: ${pick.note}`, approval.payload.note && `The human said: ${approval.payload.note}`].filter(Boolean).join('\n'),
        hold: `${holdSeconds} seconds`,
        run: held ? (held.ok ? 'it ran without errors' : `${hard}${held.errors.length ? `: ${held.errors[0]}` : ''}`) : 'not run (hold disabled)',
      },
      prompt: 'Here are the proofs. Reply with JSON only.',
      images,
      ref: approval.id,
    });
    const verdict = hard ? 'concern' : res.json?.verdict === 'concern' ? 'concern' : 'ok';
    const note = [hard, typeof res.json?.note === 'string' ? res.json.note.trim() : null].filter(Boolean).join('; ') || null;
    return { verdict, note, hold, callId: res.id };
  } catch (err) {
    return { verdict: hard ? 'concern' : 'unchecked', note: [hard, `print check failed: ${err.message}`].filter(Boolean).join('; '), hold };
  }
}
