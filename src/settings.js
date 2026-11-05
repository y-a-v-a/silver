// The owner's settings: studio.json, an overlay over silver.config.js. The config file is
// code with comments that record why things are the way they are, so a browser must not
// rewrite it; what the admin changes lands here and wins over the file. It is data, kept out
// of git and backed up with the record, like taste.md. Environment variables still win.
//
// Only what is safe to change at runtime can be set. Paths, the admin's own port and the
// deploy provider stay in the config file on purpose: moving them would strand the record
// or lock the admin out of itself.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './lib/atomic.js';

export const OVERLAY_FILE = 'studio.json';

/** Dotted paths the overlay may set. A listed object may hold anything below it. */
export const EDITABLE = Object.freeze([
  'models.studio',
  'models.roles',
  'models.dryRun',
  'models.fallbacks',
  'budget.dailyUsd',
  'budget.chatterShare',
  'series.variants',
  'series.modelsPerSeries',
  'series.temperatures',
  'series.techniquesPerSeries',
  'series.concurrency',
  'series.secondPulls',
  'techniques',
  'dares',
  'shift.at',
  'shift.paused',
  'shift.subjectsPerShift',
  'shift.seriesPerShift',
  'shift.maxArchiveSubjectsPerShift',
  'sources.rss',
  'sources.trending',
  'sources.itemsPerSource',
  'sources.repeatAfterDays',
  'review.tasteEntriesInPrompt',
  'deploy.project',
  'deploy.siteUrl',
  'printer.holdSeconds',
  'superstars.linesPerShift',
  'superstars.proposeChance',
  'superstars.pileSize',
  'steering',
]);

/** Objects replaced whole, because leaving a key out of them must be able to remove it. */
const REPLACE_WHOLE = new Set(['models.fallbacks', 'steering']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const overlayPath = (root) => join(root, OVERLAY_FILE);

/** Every leaf path set by an overlay, stopping at paths that may hold anything. */
function leaves(overlay, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(overlay)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (EDITABLE.includes(path) || !isObj(value)) out.push(path);
    else out.push(...leaves(value, path));
  }
  return out;
}

/** Paths in the overlay that the admin isn't allowed to set. */
export function forbiddenPaths(overlay) {
  return leaves(overlay).filter((p) => !EDITABLE.includes(p));
}

/** A deep merge of the overlay over the config. Arrays and REPLACE_WHOLE objects are replaced. */
export function mergeOverlay(base, overlay, prefix = '') {
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(overlay ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    out[key] = isObj(value) && isObj(out[key]) && !REPLACE_WHOLE.has(path) ? mergeOverlay(out[key], value, path) : structuredClone(value);
  }
  return out;
}

export class SettingsError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`invalid settings:\n  - ${errors.join('\n  - ')}`);
    this.name = 'SettingsError';
    this.errors = errors;
  }
}

/**
 * Read studio.json. A missing file is an empty overlay; a broken one is an error, because
 * guessing what the owner meant could spend money they didn't mean to spend.
 * @param {string} root
 * @returns {Promise<object>}
 */
export async function readOverlay(root) {
  let text;
  try {
    text = await readFile(overlayPath(root), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SettingsError([`${OVERLAY_FILE} is not valid JSON (${err.message})`]);
  }
  if (!isObj(parsed)) throw new SettingsError([`${OVERLAY_FILE} must hold a JSON object`]);
  return parsed;
}

export async function writeOverlay(root, overlay) {
  await writeFileAtomic(overlayPath(root), `${JSON.stringify(overlay, null, 2)}\n`);
}

/** The value at a dotted path, or undefined. */
export const getPath = (o, path) => path.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), o);

/** A copy of the overlay with `path` set, creating parents. `undefined` removes it and any parents left empty. */
export function setPath(overlay, path, value) {
  const out = structuredClone(overlay);
  const keys = path.split('.');
  const parents = [out];
  for (const key of keys.slice(0, -1)) {
    if (!isObj(parents.at(-1)[key])) {
      if (value === undefined) return out;
      parents.at(-1)[key] = {};
    }
    parents.push(parents.at(-1)[key]);
  }
  const last = keys.at(-1);
  if (value === undefined) {
    delete parents.at(-1)[last];
    for (let i = parents.length - 1; i > 0; i--) if (!Object.keys(parents[i]).length) delete parents[i - 1][keys[i - 1]];
  } else parents.at(-1)[last] = value;
  return out;
}

// ---------- steering weights ----------

/** How often a technique is dealt: 0 = on the bench, 1 = normal, 2-3 = favoured. */
export const techniqueWeight = (config, name) => config.steering?.techniques?.[name] ?? 1;

/** The technique names a series may draw from. */
export const activeTechniques = (config) => Object.keys(config.techniques).filter((t) => techniqueWeight(config, t) > 0);
