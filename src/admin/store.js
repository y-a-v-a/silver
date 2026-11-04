// Changing the Factory's settings from the admin. Each change is validated against the whole
// config before anything is written, and recorded on the floor with what it was and what it
// became, so the diary can say "the human cut the budget" and a change can be traced later.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadRawConfig, validateOverlay } from '../config.js';
import { getPath, mergeOverlay, readOverlay, setPath, SettingsError, writeOverlay } from '../settings.js';
import { audienceHeadings, directionPath, readDirection, writeDirection, AUDIENCES } from '../lib/direction.js';
import { DECISIONS_MARKER, readTaste, writeTasteHeader } from '../lib/taste.js';
import { recordChange, saveRevision } from './souls.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const brief = (v) => (v === undefined ? '(unset)' : typeof v === 'string' ? (v.length > 40 ? `${v.slice(0, 39)}…` : v) : (() => {
  const s = JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
})());

/**
 * Apply settings. A value equal to the config file's removes the override, so studio.json only
 * ever holds real differences. Nothing is written if the result wouldn't validate.
 * @param {{config: object, floor: object, rawConfig?: () => Promise<object>}} deps
 * @param {Record<string, unknown>} changes  dotted path -> value; `undefined` resets it
 * @param {{summary?: string}} [opts]
 * @returns {Promise<{changed: string[]}>}
 */
export async function applySettings({ config, floor, rawConfig = () => loadRawConfig() }, changes, { summary } = {}) {
  const raw = await rawConfig();
  const overlay = await readOverlay(config.root);
  const before = mergeOverlay(raw, overlay);
  let next = overlay;
  for (const [path, value] of Object.entries(changes)) next = setPath(next, path, value === undefined || same(value, getPath(raw, path)) ? undefined : value);
  const errors = validateOverlay(raw, next);
  if (errors.length) throw new SettingsError(errors);
  const after = mergeOverlay(raw, next);
  const changed = Object.keys(changes).filter((p) => !same(getPath(before, p), getPath(after, p)));
  if (!changed.length) return { changed: [] };
  await writeOverlay(config.root, next);
  await recordChange(floor, {
    what: 'settings',
    target: changed.join(', '),
    summary: summary ?? changed.map((p) => `${p} from ${brief(getPath(before, p))} to ${brief(getPath(after, p))}`).join('; '),
    changes: Object.fromEntries(changed.map((p) => [p, { from: getPath(before, p) ?? null, to: getPath(after, p) ?? null }])),
  });
  return { changed };
}

/** A saved text changed on disk while the form was open: nothing is overwritten unseen. */
export class TextConflict extends Error {
  constructor() {
    super('This changed on disk while you were editing it, probably in your text editor. Your text is still in the box; saving again replaces the newer version, which is kept under earlier versions.');
    this.name = 'TextConflict';
  }
}

const hashOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The version a form was opened on. */
export const directionHash = async (root) => hashOf(await readFile(directionPath(root), 'utf8').catch(() => ''));
export const tasteHash = async (config) => hashOf((await readTaste(config.paths.taste)).header);

/** Save the direction. The old text is kept as a revision; an unchanged audience says nothing. */
export async function saveDirection({ config, floor }, next, { baseHash } = {}) {
  if (baseHash && baseHash !== (await directionHash(config.root))) throw new TextConflict();
  const current = await readDirection(config.root);
  const merged = Object.fromEntries(AUDIENCES.map((a) => [a, String(next[a] ?? current[a] ?? '').replace(/\r\n/g, '\n').trim()]));
  const clash = AUDIENCES.flatMap((a) => audienceHeadings(merged[a]));
  if (clash.length) throw new SettingsError([`"${clash[0]}" can't be in a direction: that line starts a section in direction.md, so what follows it would go to the wrong audience`]);
  const changed = AUDIENCES.filter((a) => merged[a] !== current[a]);
  if (!changed.length) return { changed };
  const old = await readFile(directionPath(config.root), 'utf8').catch(() => null);
  const path = old === null ? null : await saveRevision(config, 'direction', 'direction', old);
  await writeDirection(config.root, merged);
  await recordChange(floor, { what: 'direction', target: changed.join(', '), summary: `the direction for the ${changed.join(', ')}`, path, text: Object.fromEntries(changed.map((a) => [a, merged[a]])) });
  return { changed };
}

/** Save the human's own words at the top of taste.md. The decision log below is never touched. */
export async function saveTaste({ config, floor }, header, { baseHash } = {}) {
  if (baseHash && baseHash !== (await tasteHash(config))) throw new TextConflict();
  const { header: current } = await readTaste(config.paths.taste);
  const clean = String(header ?? '').replace(/\r\n/g, '\n').trim();
  if (clean.includes(DECISIONS_MARKER)) throw new SettingsError([`"${DECISIONS_MARKER}" can't be in your words: it's where the log of your decisions starts, and that log can't be written by hand`]);
  if (clean === current) return { changed: false };
  const path = await saveRevision(config, 'taste', 'taste', `${current}\n`);
  await writeTasteHeader(config.paths.taste, clean);
  await recordChange(floor, { what: 'taste', target: 'taste.md', summary: 'what they say about their taste', path });
  return { changed: true };
}
