// The second pull (decision 2026-10-23): Warhol sends his first pick back to the hand that
// made it, with his note, the image as it came out and its own code, and asks for it again,
// pushed further. The new print joins the same series as the next variant (v13, ...) and
// waits for the human's review next to the first pull. Failures are recorded like any other.
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { findSeries } from './series-data.js';
import { extractNote, extractSketch, sketchVars } from './studio.js';
import { render } from '../roles.js';
import { buildSketchHtml, readSketchCode, READY_FRAMES } from '../tools/template.js';
import { NO_DIRECTION } from '../lib/direction.js';

export const PULL_PROMPT = "Here's how it came out (the image), and your code. Pull it again.";
const NO_HUMAN_NOTE = '(nothing: Andy pointed, and that was enough)';

export class PullError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PullError';
  }
}

/** The variant number after the series' highest one: v12 -> v13. */
export function nextVariant(variants) {
  const n = Math.max(0, ...variants.map((v) => Number(String(v.variant).replace(/^v/, '')) || 0));
  return `v${String(n + 1).padStart(2, '0')}`;
}

/** The variants of a series that are second pulls, keyed by the variant they pull. */
export const pulled = (series) => new Map(series.variants.filter((v) => v.pullOf).map((v) => [v.pullOf, v]));

/**
 * Pull one of Warhol's picks again.
 * @param {{config: object, floor: object, llm: {call: Function, roles?: object}, renderer: {render: Function}|null}} deps
 * @param {string} seriesRef           id, id suffix, or "latest"
 * @param {{variant?: string, note?: string, again?: boolean}} [opts]
 *   variant: default Warhol's first pick. note: what the human wants pushed. again: pull a
 *   variant that already has a second pull, once more.
 */
export async function secondPull({ config, floor, llm, renderer }, seriesRef, { variant, note: humanNote, again = false } = {}) {
  const series = await findSeries(floor, seriesRef);
  const picks = series.shortlist?.payload.picks ?? [];
  const pickId = variant ?? picks[0]?.variant;
  if (!pickId) throw new PullError(`series ${series.seriesId} has no shortlist pick to pull again`);
  if (pulled(series).has(pickId) && !again) throw new PullError(`${pickId} already has a second pull (${pulled(series).get(pickId).variant})`);
  const first = series.variants.find((v) => v.variant === pickId);
  if (!first?.ok || !first.png || !first.html) throw new PullError(`${pickId} has no rendered first pull to work from`);
  const subject = series.subject;
  if (!subject) throw new PullError(`series ${series.seriesId} has no subject on the floor`);

  const sketch = readSketchCode(await readFile(join(config.root, first.html), 'utf8'));
  if (!sketch) throw new PullError(`could not read the sketch out of ${first.html}`);
  const warholNote = picks.find((p) => p.variant === pickId)?.note || '(he only pointed at it)';

  // The brief it was made from, exactly as the studio assistant read it the first time.
  const cell = { technique: first.technique, dare: first.dare, brief: first.brief };
  const firstBrief = render(llm.roles.get('studio-assistant').body, sketchVars({ subject, chatter: series.chatter.slice(-20), cell, techniques: config.techniques, direction: series.started.payload.direction ?? NO_DIRECTION }));
  const human = String(humanNote ?? '').trim() || null;

  const seriesId = series.seriesId;
  const dir = join(config.paths.archive, 'variants', seriesId);
  const rel = (p) => relative(config.root, p);
  const id = nextVariant(series.variants);
  const base = { seriesId, variant: id, pullOf: pickId, technique: first.technique, requestedModel: first.model, temperature: first.temperature, dare: first.dare, brief: first.brief, warholNote, ...(human ? { humanNote: human } : {}) };
  const fail = async (stage, error, extra = {}) => {
    const actor = ['error', 'blank', 'no-canvas', 'timeout'].includes(stage) ? 'renderer' : 'studio-assistant';
    const event = await floor.append({ type: 'variant.failed', actor, ref: seriesId, payload: { ...base, stage, error, ...extra } });
    return { series, variant: id, pullOf: pickId, ok: false, event };
  };

  let res;
  try {
    res = await llm.call('second-pull', {
      vars: { warhol_note: warholNote, human_note: human ?? NO_HUMAN_NOTE, first_brief: firstBrief, ready_frames: String(READY_FRAMES) },
      messages: [{ role: 'user', content: `${PULL_PROMPT}\n\n\`\`\`js\n${sketch}\n\`\`\`` }],
      images: [join(config.root, first.png)],
      model: first.model ?? undefined,
      temperature: first.temperature,
      ref: seriesId,
    });
  } catch (err) {
    if (err.name === 'BudgetExhausted') throw err;
    return fail('llm', err.message);
  }

  let code;
  try {
    code = extractSketch(res.content);
  } catch (err) {
    const replyPath = join(dir, `${id}.reply.txt`);
    await writeFile(replyPath, res.content);
    return fail('extract', res.finishReason === 'length' ? `truncated at max_tokens (${err.message})` : err.message, { callId: res.id, model: res.model, reply: rel(replyPath) });
  }

  const note = extractNote(code);
  const htmlPath = join(dir, `${id}.html`);
  const meta = { title: `${subject.payload.title} (${id}, second pull of ${pickId})`, subject: { id: subject.id, title: subject.payload.title }, series: seriesId, variant: id, pullOf: pickId, technique: first.technique, dare: first.dare, brief: first.brief, note, model: res.model, temperature: first.temperature, callId: res.id };
  await writeFile(htmlPath, buildSketchHtml({ sketch: code, meta }));
  const made = { callId: res.id, model: res.model, usd: res.usd, path: rel(htmlPath), note };

  if (!renderer) {
    const event = await floor.append({ type: 'variant.produced', actor: 'studio-assistant', ref: seriesId, payload: { ...base, ...made, png: null, seed: null, rendered: false } });
    return { series, variant: id, pullOf: pickId, ok: true, event };
  }
  let shot;
  try {
    shot = await renderer.render(htmlPath);
  } catch (err) {
    return fail('timeout', `renderer: ${err.message}`, made);
  }
  if (!shot.ok) return fail(shot.reason, shot.errors.join('\n') || shot.reason, { ...made, blocked: shot.blocked });
  const png = shot.shots[0];
  const event = await floor.append({
    type: 'variant.produced',
    actor: 'studio-assistant',
    ref: seriesId,
    payload: { ...base, ...made, png: rel(png.png), seed: png.seed, rendered: true, render: { ms: shot.ms, colors: png.colors, readySignal: shot.readySignal, blocked: shot.blocked } },
  });
  return { series, variant: id, pullOf: pickId, ok: true, event };
}
