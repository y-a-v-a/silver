// The Studio's building blocks: the variant matrix, sketch extraction and the prompt
// variables. Kept separate from the agent (assistants.js) so each part is testable alone.
import { Script } from 'node:vm';
import { CANVAS, READY_FRAMES } from '../tools/template.js';
import { activeTechniques, techniqueWeight } from '../settings.js';
import { NO_DIRECTION } from '../lib/direction.js';

/** The name a line said by the human goes under on the floor and in a brief. */
export const HUMAN_PERSONA = 'the human';

/** Fisher-Yates sample of `n` items, using an injectable rng. */
export function sample(items, n, rng = Math.random) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Sample `n` distinct items, each drawn in proportion to its weight. */
export function weightedSample(items, weightOf, n, rng = Math.random) {
  const pool = items.map((item) => ({ item, weight: weightOf(item) }));
  const out = [];
  while (out.length < n && pool.length) {
    let at = rng() * pool.reduce((sum, p) => sum + p.weight, 0);
    let i = pool.findIndex((p) => (at -= p.weight) < 0);
    if (i === -1) i = pool.length - 1;
    out.push(pool.splice(i, 1)[0].item);
  }
  return out;
}

/** Techniques for one series: never one on the bench, favoured ones more often. */
export function drawTechniques(config, n, rng = Math.random) {
  const active = activeTechniques(config);
  const flat = active.every((t) => techniqueWeight(config, t) === 1);
  return flat ? sample(active, n, rng) : weightedSample(active, (t) => techniqueWeight(config, t), n, rng);
}

/**
 * What the human pinned for one series. Anything left out is dealt as usual.
 * @typedef {object} Steer
 * @property {string[]} [techniques]
 * @property {string[]} [models]
 * @property {number[]} [temperatures]
 * @property {string} [dare]     this card for every variant, instead of the deck
 * @property {string} [note]     a note from the human, read by every assistant on the series
 */

/**
 * The series matrix: models x temperatures x techniques, repeated to fill `variants`.
 * Variants are numbered v01, v02, ... in technique, model, temperature order. Each variant
 * also draws its own card from the dare deck (no repeats until the deck runs out), so no
 * two variants are made from the same brief.
 * @param {{models: {studio: string[], dryRun: string}, series: object, techniques: Record<string, string>, dares?: string[], steering?: object}} config
 * @param {{rng?: () => number, dryRun?: boolean, variants?: number, steer?: Steer}} [opts]
 */
export function buildMatrix(config, { rng = Math.random, dryRun = false, variants, steer = {} } = {}) {
  const { series } = config;
  const models = dryRun ? [config.models.dryRun] : steer.models?.length ? [...steer.models] : sample(config.models.studio, series.modelsPerSeries, rng);
  const techniques = steer.techniques?.length ? [...steer.techniques] : drawTechniques(config, series.techniquesPerSeries, rng);
  const temperatures = steer.temperatures?.length ? [...steer.temperatures] : [...series.temperatures];
  const cells = [];
  for (const technique of techniques) for (const model of models) for (const temperature of temperatures) cells.push({ technique, model, temperature });
  const total = variants ?? (dryRun ? 2 : series.variants);
  const deck = steer.dare ? [steer.dare] : config.dares?.length ? sample(config.dares, config.dares.length, rng) : [];
  const out = [];
  for (let i = 0; i < total; i++) out.push({ variant: `v${String(i + 1).padStart(2, '0')}`, ...cells[i % cells.length], dare: deck.length ? deck[i % deck.length] : null });
  return { models, techniques, temperatures, cells: out };
}

/** Below this many lines about the subject, the deal is topped up with lines overheard about other subjects. */
export const MIN_BRIEF_LINES = 3;

/**
 * Hand the floor's lines out as briefs: every variant gets one superstar line to take
 * literally. Each line is dealt about equally often, and the deal is shuffled so a line
 * doesn't always land on the same technique, model or temperature. When the subject has
 * fewer than MIN_BRIEF_LINES lines, strays (lines about other subjects) top up the hand,
 * marked `stray`: cross-contamination, the Factory's oldest trick. Mutates and returns
 * `cells`; with no lines at all every brief is null.
 * @param {{variant: string}[]} cells
 * @param {import('../floor.js').FloorEvent[]} chatter   lines about this subject
 * @param {() => number} [rng]
 * @param {{strays?: import('../floor.js').FloorEvent[]}} [opts]   lines about other subjects
 */
export function dealBriefs(cells, chatter, rng = Math.random, { strays = [] } = {}) {
  const topUp = chatter.length < MIN_BRIEF_LINES ? sample(strays, Math.min(MIN_BRIEF_LINES - chatter.length, strays.length), rng) : [];
  const pool = [...chatter.map((e) => ({ e, stray: false })), ...topUp.map((e) => ({ e, stray: true }))];
  const hand = pool.length ? Array.from({ length: cells.length }, (_, i) => pool[i % pool.length]) : [];
  const lines = sample(hand, hand.length, rng);
  cells.forEach((cell, i) => {
    const line = lines[i];
    cell.brief = line ? { from: line.e.payload.persona ?? line.e.actor.replace(/^superstar\./, ''), text: line.e.payload.text, eventId: line.e.id, ...(line.stray ? { stray: true } : {}) } : null;
  });
  return cells;
}

/** The assistant's own one-line note on the work: the sketch's `// WORK:` comment, if any. */
export function extractNote(sketch) {
  const m = String(sketch ?? '').match(/^[ \t]*\/\/[ \t]*WORK:[ \t]*(.+)$/m);
  if (!m) return null;
  const note = m[1].replace(/\s+/g, ' ').trim();
  return note ? (note.length > 280 ? note.slice(0, 279) + '…' : note) : null;
}

export class ExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExtractError';
  }
}

/**
 * Pull the sketch out of an assistant's reply: the largest fenced code block, or the
 * inline script of an HTML page, or the raw reply. It must define setup() and compile.
 * @param {string} reply
 * @returns {string}
 */
export function extractSketch(reply) {
  const text = String(reply ?? '').trim();
  if (!text) throw new ExtractError('empty reply');
  const fences = [...text.matchAll(/```[a-zA-Z]*[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  let code = fences.length ? fences.sort((a, b) => b.length - a.length)[0] : text;
  // A whole HTML page: keep the last inline script that isn't loading a library.
  if (/<script[\s>]/i.test(code)) {
    const inline = [...code.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((s) => s.trim());
    if (inline.length) code = inline.at(-1);
  }
  code = code.trim();
  if (!/\bfunction\s+setup\s*\(|\bsetup\s*=\s*(function|\()/.test(code)) throw new ExtractError('no setup() function in the reply');
  try {
    // Compile only, never run: catches syntax errors before a render is spent on them.
    new Script(code, { filename: 'sketch.js' });
  } catch (err) {
    throw new ExtractError(`syntax error: ${err.message}`);
  }
  return code;
}

const clipKeepLines = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The brief as prompt text: the superstar's line, or the Scout's proposal when nobody spoke. */
export function formatBrief(brief, subject) {
  if (brief?.stray) return `${capitalise(brief.from)} said it on the floor, about something else entirely: “${brief.text}”`;
  if (brief) return `${capitalise(brief.from)} said it on the floor: “${brief.text}”`;
  const image = subject.payload.image;
  return image ? `Nobody on the floor has said anything about it yet. The Scout proposed this image; it's yours to misuse: ${image}` : 'Nobody gave you a line. Find your own way in.';
}

/** Everything the assistant's role file needs, for one cell of the matrix. */
export function sketchVars({ subject, chatter, cell, techniques, direction = NO_DIRECTION }) {
  const p = subject.payload;
  const page = p.snapshot?.page;
  const context = [page?.description, page?.text, p.snapshot?.snippet].filter(Boolean).join('\n\n');
  const why = [p.why, p.scoutWhy].filter(Boolean).join(' / ');
  return {
    subject_title: p.title,
    subject_why: why || '(no note)',
    subject_image: p.image ?? '(none: find your own)',
    subject_context: context ? clipKeepLines(context, 2500) : '(only the title)',
    floor_excerpt: chatter.length ? chatter.map((e) => `- ${e.actor}: ${e.payload.text}`).join('\n') : '(the floor is quiet about this one)',
    technique: cell.technique,
    // A second pull of an old variant may name a procedure that has since left the menu.
    technique_guidance: techniques[cell.technique] ?? '(this procedure has left the menu; work from the image and your own code)',
    direction,
    brief: formatBrief(cell.brief ?? null, subject),
    dare: cell.dare ?? '(no card today)',
    width: String(CANVAS.width),
    height: String(CANVAS.height),
    ready_frames: String(READY_FRAMES),
  };
}
