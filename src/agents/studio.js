// The Studio's building blocks: the variant matrix, sketch extraction and the prompt
// variables. Kept separate from the agent (assistants.js) so each part is testable alone.
import { Script } from 'node:vm';
import { CANVAS } from '../tools/template.js';

/** Fisher-Yates sample of `n` items, using an injectable rng. */
export function sample(items, n, rng = Math.random) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/**
 * The series matrix: models x temperatures x techniques, repeated to fill `variants`.
 * Variants are numbered v01, v02, ... in technique, model, temperature order.
 * @param {{models: {studio: string[], dryRun: string}, series: object, techniques: Record<string, string>}} config
 * @param {{rng?: () => number, dryRun?: boolean, variants?: number}} [opts]
 */
export function buildMatrix(config, { rng = Math.random, dryRun = false, variants } = {}) {
  const { series } = config;
  const models = dryRun ? [config.models.dryRun] : sample(config.models.studio, series.modelsPerSeries, rng);
  const techniques = sample(Object.keys(config.techniques), series.techniquesPerSeries, rng);
  const temperatures = [...series.temperatures];
  const cells = [];
  for (const technique of techniques) for (const model of models) for (const temperature of temperatures) cells.push({ technique, model, temperature });
  const total = variants ?? (dryRun ? 2 : series.variants);
  const out = [];
  for (let i = 0; i < total; i++) out.push({ variant: `v${String(i + 1).padStart(2, '0')}`, ...cells[i % cells.length] });
  return { models, techniques, temperatures, cells: out };
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

/** Everything the assistant's role file needs, for one cell of the matrix. */
export function sketchVars({ subject, chatter, cell, techniques }) {
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
    technique_guidance: techniques[cell.technique],
    width: String(CANVAS.width),
    height: String(CANVAS.height),
  };
}
