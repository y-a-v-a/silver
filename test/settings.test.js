import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigError, loadConfig, loadRawConfig, ROOT, validateConfig, validateOverlay } from '../src/config.js';
import { activeTechniques, forbiddenPaths, getPath, mergeOverlay, readOverlay, setPath, techniqueWeight, writeOverlay } from '../src/settings.js';
import { AUDIENCES, directionFor, formatDirection, NO_DIRECTION, parseDirection, readDirection, writeDirection } from '../src/lib/direction.js';
import { DATA_PATHS } from '../src/record.js';
import { EVENT_TYPES } from '../src/events.js';
import shipped from '../silver.config.js';

const exec = promisify(execFile);
const tmp = () => mkdtemp(join(tmpdir(), 'silver-settings-'));

test('the overlay merges deeply: arrays and fallbacks replace, everything else keeps what it does not name', () => {
  const merged = mergeOverlay(shipped, { budget: { dailyUsd: 2 }, models: { roles: { warhol: 'a/b' }, fallbacks: { 'a/b': ['c/d'] } }, dares: ['One card.'], techniques: { 'my-own': 'Mine.' } });
  assert.equal(merged.budget.dailyUsd, 2);
  assert.equal(merged.budget.chatterShare, shipped.budget.chatterShare);
  assert.equal(merged.models.roles.warhol, 'a/b');
  assert.equal(merged.models.roles.scout, shipped.models.roles.scout);
  assert.deepEqual(merged.models.fallbacks, { 'a/b': ['c/d'] }, 'an object that must be able to lose keys is replaced');
  assert.deepEqual(merged.dares, ['One card.']);
  assert.equal(merged.techniques['my-own'], 'Mine.');
  assert.equal(merged.techniques['scratch-film'], shipped.techniques['scratch-film']);
  assert.notEqual(shipped.budget.dailyUsd, 2, 'the imported config module is untouched');
});

test('paths, the port and the deploy provider cannot be set through the overlay', () => {
  assert.deepEqual(forbiddenPaths({ budget: { dailyUsd: 1 }, techniques: { x: 'y' }, steering: { anything: 1 } }), []);
  assert.deepEqual(forbiddenPaths({ paths: { floor: '/tmp' }, review: { port: 1, tasteEntriesInPrompt: 3 }, deploy: { provider: 'x', siteUrl: null } }).sort(), ['deploy.provider', 'paths.floor', 'review.port']);
  assert.match(validateOverlay(shipped, { paths: { floor: 'elsewhere' } })[0], /paths\.floor can't be set/);
});

test('validateOverlay runs the whole config validation on the merged result', () => {
  assert.deepEqual(validateOverlay(shipped, {}), []);
  assert.deepEqual(validateOverlay(shipped, { series: { variants: 24 } }), []);
  assert.ok(validateOverlay(shipped, { series: { variants: 13 } }).some((e) => /multiple of the matrix/.test(e)));
  assert.ok(validateOverlay(shipped, { budget: { dailyUsd: -1 } }).some((e) => /dailyUsd/.test(e)));
});

test('loadConfig leaves the overlay out by default; the CLI path applies it, with the environment on top', async () => {
  const root = await tmp();
  await writeOverlay(root, { budget: { dailyUsd: 2 }, shift: { paused: true } });
  assert.equal((await loadConfig({ env: {}, root })).budget.dailyUsd, shipped.budget.dailyUsd);
  const cfg = await loadConfig({ env: {}, root, overlay: true });
  assert.equal(cfg.budget.dailyUsd, 2);
  assert.equal(cfg.shift.paused, true);
  assert.equal((await loadConfig({ env: { SILVER_BUDGET_DAILY_USD: '9' }, root, overlay: true })).budget.dailyUsd, 9);
});

test('a broken overlay is a ConfigError that names the file, never a silent fallback', async () => {
  const root = await tmp();
  await writeFile(join(root, 'studio.json'), '{ nope');
  await assert.rejects(loadConfig({ env: {}, root, overlay: true }), (err) => err instanceof ConfigError && /studio\.json is not valid JSON/.test(err.message));
  await writeFile(join(root, 'studio.json'), '[]');
  await assert.rejects(readOverlay(root), /must hold a JSON object/);
  await writeFile(join(root, 'studio.json'), JSON.stringify({ paths: { floor: 'x' } }));
  await assert.rejects(loadConfig({ env: {}, root, overlay: true }), /paths\.floor can't be set in studio\.json/);
  await writeFile(join(root, 'studio.json'), JSON.stringify({ series: { variants: 13 } }));
  await assert.rejects(loadConfig({ env: {}, root, overlay: true }), /multiple of the matrix.*studio\.json/);
});

test('setPath sets and removes, pruning parents left empty', () => {
  const a = setPath({}, 'budget.dailyUsd', 3);
  assert.deepEqual(a, { budget: { dailyUsd: 3 } });
  assert.deepEqual(setPath(a, 'budget.dailyUsd', undefined), {});
  assert.deepEqual(setPath({ budget: { dailyUsd: 3, chatterShare: 0.2 } }, 'budget.dailyUsd', undefined), { budget: { chatterShare: 0.2 } });
  assert.deepEqual(setPath({}, 'a.b', undefined), {}, 'removing what is not there changes nothing');
  assert.equal(getPath({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(getPath({}, 'a.b'), undefined);
});

test('steering weights: 0 benches a technique, and the matrix must still fit what is off the bench', () => {
  const config = mergeOverlay(shipped, { steering: { techniques: { 'scratch-film': 0, rorschach: 3 } } });
  assert.deepEqual(validateConfig(config), []);
  assert.equal(techniqueWeight(config, 'scratch-film'), 0);
  assert.equal(techniqueWeight(config, 'rorschach'), 3);
  assert.equal(techniqueWeight(config, 'seismograph'), 1);
  assert.ok(!activeTechniques(config).includes('scratch-film'));
  assert.ok(activeTechniques(config).includes('rorschach'));

  const bad = mergeOverlay(shipped, { steering: { techniques: { rorschach: 9 } } });
  assert.ok(validateConfig(bad).some((e) => /steering\.techniques\["rorschach"\]/.test(e)));
  const all = Object.fromEntries(Object.keys(shipped.techniques).map((t) => [t, 0]));
  assert.ok(validateConfig(mergeOverlay(shipped, { steering: { techniques: all } })).some((e) => /off the bench/.test(e)));
  assert.deepEqual(validateConfig(mergeOverlay(shipped, { steering: { techniques: { 'long-gone': 0 } } })), [], 'a name no longer on the menu stops nothing');
});

test('direction.md round-trips by audience, and a missing file reads as no direction', async () => {
  const root = await tmp();
  assert.deepEqual(await readDirection(root), Object.fromEntries(AUDIENCES.map((a) => [a, ''])));
  await writeDirection(root, { scouts: 'Only weather.', studio: 'No text at all.\n\n## not a heading we know\nstill mine', warhol: '' });
  const back = await readDirection(root);
  assert.equal(back.scouts, 'Only weather.');
  assert.equal(back.warhol, '');
  assert.equal(back.superstars, '');
  assert.match(await readFile(join(root, 'direction.md'), 'utf8'), /^# Direction\n/);
  assert.equal(parseDirection(formatDirection({ scouts: 'x' })).scouts, 'x');
  assert.equal(parseDirection('## SCOUTS\nloud\n').scouts, 'loud', 'headings match in any case, for a hand edit');
});

test('directionFor adds an extra note, and says so when there is nothing at all', () => {
  assert.equal(directionFor({ studio: '' }, 'studio'), NO_DIRECTION);
  assert.equal(directionFor(null, 'studio'), NO_DIRECTION);
  assert.equal(directionFor({ studio: 'A.' }, 'studio'), 'A.');
  assert.equal(directionFor({ studio: 'A.' }, 'studio', 'B.'), 'A.\n\nB.');
  assert.equal(directionFor({ studio: '  ' }, 'studio', 'B.'), 'B.');
});

test('the owner\'s steering files stay out of git and go into the record', async () => {
  for (const file of ['studio.json', 'direction.md']) {
    assert.ok(DATA_PATHS.includes(file));
    await exec('git', ['check-ignore', '-q', '--no-index', join(ROOT, file)], { cwd: ROOT });
  }
  assert.ok(EVENT_TYPES.includes('studio.changed') && EVENT_TYPES.includes('subject.pinned'));
});

test('loadRawConfig gives the file as written', async () => {
  assert.equal((await loadRawConfig()).budget.dailyUsd, shipped.budget.dailyUsd);
});

test('in a direction only an audience\'s own heading starts a section; other headings are just text', () => {
  const text = formatDirection({ studio: 'Less text.\n\n## Colour\nOnly grey.', warhol: 'Pick it.' });
  const back = parseDirection(text);
  assert.equal(back.studio, 'Less text.\n\n## Colour\nOnly grey.');
  assert.equal(back.warhol, 'Pick it.');
});

