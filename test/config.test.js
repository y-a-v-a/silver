import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { loadConfig, validateConfig, applyEnv, ConfigError, ROLES, ROOT } from '../src/config.js';
import shipped from '../silver.config.js';

/** A fresh, mutable copy of the shipped config. */
const base = () => structuredClone(shipped);

/** Assert that mutating a copy produces an error matching `pattern`. */
function rejects(mutate, pattern) {
  const c = base();
  mutate(c);
  const errors = validateConfig(c);
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `expected an error matching ${pattern}, got:\n${errors.join('\n') || '(none)'}`,
  );
}

test('the shipped silver.config.js is valid', () => {
  assert.deepEqual(validateConfig(base()), []);
});

test('the shipped config yields a 12-variant matrix, as decided in ACTIONS.md', () => {
  const { series } = base();
  assert.equal(series.variants, 12);
  assert.equal(series.modelsPerSeries * series.temperatures.length * series.techniquesPerSeries, 12);
});

test('the shipped config gives every role a model', () => {
  const { models } = base();
  for (const role of ROLES) assert.ok(models.roles[role], `no model for ${role}`);
});

test('loadConfig resolves paths to absolute, adds root, and deep-freezes', async () => {
  const cfg = await loadConfig({ env: {} });
  assert.equal(cfg.root, ROOT);
  for (const p of Object.values(cfg.paths)) assert.ok(isAbsolute(p), `${p} is not absolute`);
  assert.equal(cfg.paths.floor, join(ROOT, 'floor'));
  assert.ok(Object.isFrozen(cfg) && Object.isFrozen(cfg.models.studio));
  assert.throws(() => {
    'use strict';
    cfg.budget.dailyUsd = 100;
  }, TypeError);
});

test('loadConfig does not mutate the imported module object', async () => {
  await loadConfig({ env: { SILVER_BUDGET_DAILY_USD: '9' } });
  assert.equal(shipped.budget.dailyUsd, 5);
  assert.equal(shipped.paths.floor, 'floor');
});

test('env overrides budget and review port', async () => {
  const cfg = await loadConfig({ env: { SILVER_BUDGET_DAILY_USD: '1.5', SILVER_REVIEW_PORT: '5000' } });
  assert.equal(cfg.budget.dailyUsd, 1.5);
  assert.equal(cfg.review.port, 5000);
});

test('empty env values are ignored', () => {
  const { config, errors } = applyEnv(base(), { SILVER_BUDGET_DAILY_USD: '' });
  assert.deepEqual(errors, []);
  assert.equal(config.budget.dailyUsd, 5);
});

test('invalid env values raise a ConfigError listing them', async () => {
  await assert.rejects(loadConfig({ env: { SILVER_BUDGET_DAILY_USD: 'lots', SILVER_REVIEW_PORT: '99999' } }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.ok(err.errors.some((e) => /SILVER_BUDGET_DAILY_USD/.test(e)));
    assert.ok(err.errors.some((e) => /review\.port/.test(e)));
    return true;
  });
});

test('loadConfig rejects a file without a default object export', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'silver-cfg-')), 'bad.config.js');
  await writeFile(file, 'export const nope = 1;\n');
  await assert.rejects(loadConfig({ file, env: {} }), /must default-export an object/);
});

test('validateConfig reports every problem at once', () => {
  const c = base();
  c.budget.dailyUsd = 0;
  c.review.port = 0;
  c.shift.at = '9am';
  assert.equal(validateConfig(c).length, 3);
});

test('structural errors', () => {
  assert.deepEqual(validateConfig(null), ['config must be an object']);
  rejects((c) => (c.budgt = {}), /unknown top-level key "budgt"/);
  rejects((c) => delete c.series, /"series" must be an object/);
});

test('model errors', () => {
  rejects((c) => (c.models.studio = []), /models\.studio must be a non-empty array/);
  rejects((c) => c.models.studio.push('not a slug'), /models\.studio\[4\] is not an OpenRouter slug/);
  rejects((c) => c.models.studio.push(c.models.studio[0]), /duplicates/);
  rejects((c) => delete c.models.roles.warhol, /models\.roles\.warhol/);
  rejects((c) => (c.models.roles.andy = 'a/b'), /unknown role "andy"/);
  rejects((c) => (c.models.dryRun = ''), /models\.dryRun/);
});

test('slug pattern accepts variants and aliases', () => {
  const c = base();
  c.models.studio = ['openai/gpt-6-luna:batch', '~anthropic/claude-sonnet-latest', 'qwen/qwen3.8-27b:free'];
  assert.deepEqual(validateConfig(c), []);
});

test('budget errors', () => {
  rejects((c) => (c.budget.dailyUsd = -1), /budget\.dailyUsd/);
  rejects((c) => (c.budget.dailyUsd = '5'), /budget\.dailyUsd/);
  rejects((c) => (c.budget.chatterShare = 1.5), /chatterShare/);
});

test('series matrix errors', () => {
  rejects((c) => (c.series.variants = 10), /multiple of the matrix size .* \(12\)/);
  rejects((c) => (c.series.modelsPerSeries = 9), /exceeds models\.studio/);
  rejects((c) => (c.series.techniquesPerSeries = 99), /exceeds the technique menu/);
  rejects((c) => (c.series.temperatures = [0.5, 3]), /temperatures\[1\]/);
  rejects((c) => (c.series.concurrency = 0), /concurrency/);
});

test('a series may repeat the matrix (24 = 2 x 12)', () => {
  const c = base();
  c.series.variants = 24;
  assert.deepEqual(validateConfig(c), []);
});

test('technique errors', () => {
  rejects((c) => (c.techniques = {}), /at least one technique/);
  rejects((c) => (c.techniques['Bad Name'] = 'x'), /kebab-case/);
  rejects((c) => (c.techniques.halftone = '  '), /needs a guidance string/);
});

test('shift, sources, review, deploy and path errors', () => {
  rejects((c) => (c.shift.at = '24:00'), /shift\.at/);
  rejects((c) => (c.shift.maxArchiveSubjectsPerShift = -1), /maxArchiveSubjectsPerShift/);
  rejects((c) => c.sources.rss.push('ftp://example.com/feed'), /sources\.rss\[\d+\] is not an http/);
  rejects((c) => (c.sources.trending.googleTrendsGeo = 'usa'), /two-letter/);
  rejects((c) => (c.sources.trending.reddit = 'yes'), /trending\.reddit must be a boolean/);
  rejects((c) => (c.sources.repeatAfterDays = 0), /repeatAfterDays/);
  rejects((c) => delete c.sources.repeatAfterDays, /repeatAfterDays/);
  rejects((c) => (c.review.port = 70000), /review\.port/);
  rejects((c) => (c.deploy.provider = 'netlify'), /deploy\.provider/);
  rejects((c) => (c.deploy.project = 'Silver Factory'), /deploy\.project/);
  rejects((c) => (c.deploy.siteUrl = 'not a url'), /deploy\.siteUrl/);
  rejects((c) => (c.printer.holdSeconds = -1), /printer\.holdSeconds/);
  rejects((c) => (c.paths.floor = '/var/floor'), /paths\.floor must be relative/);
  rejects((c) => (c.paths.taste = ''), /paths\.taste/);
});
