// Loads silver.config.js, applies env overrides, validates, resolves paths, freezes.
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * @typedef {object} SilverConfig
 * @property {{studio: string[], roles: Record<string, string>, dryRun: string}} models
 * @property {{dailyUsd: number, chatterShare: number}} budget
 * @property {{variants: number, modelsPerSeries: number, temperatures: number[], techniquesPerSeries: number, concurrency: number}} series
 * @property {Record<string, string>} techniques
 * @property {{at: string, subjectsPerShift: number, seriesPerShift: number, maxArchiveSubjectsPerShift: number}} shift
 * @property {{rss: string[], trending: {googleTrendsGeo: string, hackernews: boolean, reddit: boolean}, itemsPerSource: number, repeatAfterDays: number}} sources
 * @property {{port: number, tasteEntriesInPrompt: number}} review
 * @property {{provider: 'vercel'}} deploy
 * @property {{roles: string, floor: string, archive: string, canon: string, site: string, taste: string}} paths
 */

export const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
export const DEFAULT_CONFIG_PATH = resolve(ROOT, 'silver.config.js');

/** Roles that need a default model. Superstars share one entry. */
export const ROLES = Object.freeze(['scout', 'superstar', 'warhol', 'printer', 'fred-hughes', 'archivist', 'technician']);

const TOP_LEVEL = ['models', 'budget', 'series', 'techniques', 'shift', 'sources', 'review', 'deploy', 'paths'];
const PATH_KEYS = ['roles', 'floor', 'archive', 'canon', 'site', 'taste'];
const SLUG = /^~?[a-z0-9][\w.-]*\/[\w.:-]+$/i;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ConfigError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`invalid silver config:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, min = -Infinity, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min = -Infinity, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isUrl = (v) => {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * Validate a raw config object. Returns every problem found, not just the first.
 * @param {unknown} c
 * @returns {string[]}
 */
export function validateConfig(c) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!isObj(c)) return ['config must be an object'];

  for (const key of Object.keys(c)) if (!TOP_LEVEL.includes(key)) err(`unknown top-level key "${key}"`);
  for (const key of TOP_LEVEL) if (!isObj(c[key])) err(`"${key}" must be an object`);
  if (errors.length) return errors;

  const { models, budget, series, techniques, shift, sources, review, deploy, paths } = c;

  // models
  if (!Array.isArray(models.studio) || models.studio.length === 0) err('models.studio must be a non-empty array');
  else {
    models.studio.forEach((m, i) => SLUG.test(m) || err(`models.studio[${i}] is not an OpenRouter slug: ${JSON.stringify(m)}`));
    if (new Set(models.studio).size !== models.studio.length) err('models.studio contains duplicates');
  }
  if (!isObj(models.roles)) err('models.roles must be an object');
  else {
    for (const role of ROLES) if (!SLUG.test(models.roles[role] ?? '')) err(`models.roles.${role} must be an OpenRouter slug`);
    for (const role of Object.keys(models.roles)) if (!ROLES.includes(role)) err(`models.roles has unknown role "${role}"`);
  }
  if (!SLUG.test(models.dryRun ?? '')) err('models.dryRun must be an OpenRouter slug');

  // budget
  if (!isNum(budget.dailyUsd, Number.MIN_VALUE)) err('budget.dailyUsd must be a positive number');
  if (!isNum(budget.chatterShare, 0, 1)) err('budget.chatterShare must be between 0 and 1');

  // techniques
  const techniqueNames = Object.keys(techniques);
  if (techniqueNames.length === 0) err('techniques must define at least one technique');
  for (const [name, guidance] of Object.entries(techniques)) {
    if (!KEBAB.test(name)) err(`technique name "${name}" must be kebab-case`);
    if (typeof guidance !== 'string' || guidance.trim() === '') err(`technique "${name}" needs a guidance string`);
  }

  // series
  if (!isInt(series.variants, 1)) err('series.variants must be a positive integer');
  if (!isInt(series.modelsPerSeries, 1)) err('series.modelsPerSeries must be a positive integer');
  else if (Array.isArray(models.studio) && series.modelsPerSeries > models.studio.length)
    err(`series.modelsPerSeries (${series.modelsPerSeries}) exceeds models.studio (${models.studio.length})`);
  if (!Array.isArray(series.temperatures) || series.temperatures.length === 0) err('series.temperatures must be a non-empty array');
  else series.temperatures.forEach((t, i) => isNum(t, 0, 2) || err(`series.temperatures[${i}] must be between 0 and 2`));
  if (!isInt(series.techniquesPerSeries, 1)) err('series.techniquesPerSeries must be a positive integer');
  else if (series.techniquesPerSeries > techniqueNames.length)
    err(`series.techniquesPerSeries (${series.techniquesPerSeries}) exceeds the technique menu (${techniqueNames.length})`);
  if (!isInt(series.concurrency, 1, 64)) err('series.concurrency must be an integer between 1 and 64');
  const cells = series.modelsPerSeries * (series.temperatures?.length ?? 0) * series.techniquesPerSeries;
  if (isInt(series.variants, 1) && isInt(cells, 1) && series.variants % cells !== 0)
    err(`series.variants (${series.variants}) must be a multiple of the matrix size models x temperatures x techniques (${cells})`);

  // shift
  if (!HHMM.test(shift.at ?? '')) err('shift.at must be "HH:MM" (24h)');
  if (!isInt(shift.subjectsPerShift, 1)) err('shift.subjectsPerShift must be a positive integer');
  if (!isInt(shift.seriesPerShift, 1)) err('shift.seriesPerShift must be a positive integer');
  if (!isInt(shift.maxArchiveSubjectsPerShift, 0)) err('shift.maxArchiveSubjectsPerShift must be a non-negative integer');

  // sources
  if (!Array.isArray(sources.rss)) err('sources.rss must be an array');
  else sources.rss.forEach((u, i) => isUrl(u) || err(`sources.rss[${i}] is not an http(s) URL`));
  if (!isObj(sources.trending)) err('sources.trending must be an object');
  else {
    if (!/^[A-Z]{2}$/.test(sources.trending.googleTrendsGeo ?? '')) err('sources.trending.googleTrendsGeo must be a two-letter country code');
    for (const k of ['hackernews', 'reddit']) if (typeof sources.trending[k] !== 'boolean') err(`sources.trending.${k} must be a boolean`);
  }
  if (!isInt(sources.itemsPerSource, 1, 500)) err('sources.itemsPerSource must be an integer between 1 and 500');
  if (!isInt(sources.repeatAfterDays, 1, 3650)) err('sources.repeatAfterDays must be an integer between 1 and 3650');

  // review
  if (!isInt(review.port, 1, 65535)) err('review.port must be a valid TCP port');
  if (!isInt(review.tasteEntriesInPrompt, 0)) err('review.tasteEntriesInPrompt must be a non-negative integer');

  // deploy
  if (deploy.provider !== 'vercel') err('deploy.provider must be "vercel"');

  // paths
  for (const key of PATH_KEYS) {
    const p = paths[key];
    if (typeof p !== 'string' || p === '') err(`paths.${key} must be a non-empty string`);
    else if (isAbsolute(p)) err(`paths.${key} must be relative to the repository root`);
  }

  return errors;
}

/**
 * Apply environment overrides. Returns a new object; invalid values become errors.
 * @param {SilverConfig} c
 * @param {Record<string, string|undefined>} env
 */
export function applyEnv(c, env) {
  const out = structuredClone(c);
  const errors = [];
  const num = (name, set) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) errors.push(`${name} must be a number, got ${JSON.stringify(raw)}`);
    else set(n);
  };
  num('SILVER_BUDGET_DAILY_USD', (n) => (out.budget.dailyUsd = n));
  num('SILVER_REVIEW_PORT', (n) => (out.review.port = n));
  return { config: out, errors };
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/**
 * Load the config the way the CLI does: SILVER_CONFIG picks the file and SILVER_ROOT the
 * directory that paths resolve against. Both default to this repository.
 * @param {Record<string, string|undefined>} [env]
 */
export function loadConfigFromEnv(env = process.env) {
  return loadConfig({ file: env.SILVER_CONFIG || DEFAULT_CONFIG_PATH, env, root: env.SILVER_ROOT ? resolve(env.SILVER_ROOT) : ROOT });
}

/**
 * Load, override, validate and freeze. `paths` come back as absolute paths.
 * @param {{file?: string, env?: Record<string, string|undefined>, root?: string}} [opts]
 * @returns {Promise<SilverConfig & {root: string}>}
 */
export async function loadConfig({ file = DEFAULT_CONFIG_PATH, env = process.env, root = ROOT } = {}) {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const raw = mod.default;
  if (!isObj(raw)) throw new ConfigError([`${file} must default-export an object`]);

  const { config, errors: envErrors } = applyEnv(raw, env);
  const errors = [...envErrors, ...validateConfig(config)];
  if (errors.length) throw new ConfigError(errors);

  for (const key of PATH_KEYS) config.paths[key] = resolve(root, config.paths[key]);
  config.root = root;
  return deepFreeze(config);
}
