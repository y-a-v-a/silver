// The role files as the admin sees them: each role's soul. Edits are validated the way the
// loader validates them, refused rather than half-applied, written atomically, kept in the
// record as revisions, and announced on the floor. Every shift and job reads the role files
// from disk when it starts, so a saved soul counts from the next one with no restart.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, join, relative, sep } from 'node:path';
import { monotonicFactory } from 'ulid';
import { parseRole, placeholdersIn } from '../roles.js';
import { writeFileAtomic } from '../lib/atomic.js';
import { varsFor } from './contract.js';

const execFileP = promisify(execFile);
const nextId = monotonicFactory();
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export class SoulError extends Error {
  /** @param {string|string[]} problems @param {number} [status] */
  constructor(problems, status = 422) {
    const list = [].concat(problems);
    super(list.join('; '));
    this.name = 'SoulError';
    this.problems = list;
    this.status = status;
  }
}

export class SoulConflict extends SoulError {
  constructor(current) {
    super('this file changed on disk while you were editing it', 409);
    this.name = 'SoulConflict';
    this.current = current;
  }
}

/** The revisions of everything the admin overwrites live in the record. */
export const revisionsDir = (config, kind, id) => join(config.paths.archive, 'revisions', kind, id);
const benchDir = (config) => join(config.paths.archive, 'revisions', 'benched-superstars');

/** Announce a change on the floor. `path` is relative to the root, so the Archivist can check it. */
export function recordChange(floor, { what, target, summary, path = null, ...rest }) {
  return floor.append({ type: 'studio.changed', actor: 'human', payload: { what, target, summary, ...(path ? { path } : {}), ...rest } });
}

/** Keep `text` as a revision of kind/id. Returns its path relative to the root. */
export async function saveRevision(config, kind, id, text) {
  const dir = revisionsDir(config, kind, id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${nextId()}.md`);
  await writeFile(path, text);
  return relative(config.root, path);
}

/** Revisions of kind/id, newest first. */
export async function listRevisions(config, kind, id) {
  const dir = revisionsDir(config, kind, id);
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const revisions = [];
  for (const name of names.filter((n) => n.endsWith('.md')).sort().reverse()) {
    const { mtime } = await stat(join(dir, name));
    revisions.push({ id: name.slice(0, -3), at: mtime.toISOString() });
  }
  return revisions;
}

export async function readRevision(config, kind, id, revision) {
  // Revision ids are ULIDs: anything else is not a file we wrote.
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(revision)) throw new SoulError(`no revision "${revision}"`, 404);
  try {
    return await readFile(join(revisionsDir(config, kind, id), `${revision}.md`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new SoulError(`no revision "${revision}"`, 404);
    throw err;
  }
}

async function markdownFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => join(e.parentPath, e.name)).sort();
}

const groupOf = (file) => (file.split(sep)[0] === 'superstars' ? 'superstar' : 'role');

function toSoul(config, path, raw, mtime) {
  const file = relative(config.paths.roles, path);
  const group = groupOf(file);
  const { role, errors } = parseRole(raw, { file, group });
  return { id: basename(file, '.md'), file, path, group, raw, hash: sha(raw), mtime: mtime.toISOString(), role: role ?? null, errors };
}

/**
 * Every role file, broken ones included: a soul that fails to parse is exactly the one that
 * has to be opened to fix it, so nothing here throws on a bad file.
 */
export async function listSouls(config) {
  const souls = [];
  for (const path of await markdownFiles(config.paths.roles)) {
    souls.push(toSoul(config, path, await readFile(path, 'utf8'), (await stat(path)).mtime));
  }
  return souls;
}

export async function readSoul(config, id) {
  const soul = (await listSouls(config)).find((s) => s.id === id);
  if (!soul) throw new SoulError(`no role "${id}"`, 404);
  return soul;
}

/** The frontmatter block and the body of a role file, without interpreting either. */
export function splitSoul(raw) {
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  return m ? { front: m[1], body: m[2].replace(/^\r?\n/, '') } : { front: '', body: String(raw) };
}

const yamlValue = (v) => {
  if (typeof v !== 'string') return String(v);
  return /^[\w][\w ./()@~:+-]*$/.test(v) && !/:\s|\s$/.test(v) && !/^(true|false|null|yes|no|on|off|~|\d[\d.]*)$/i.test(v) ? v : JSON.stringify(v);
};

/**
 * A role file with some scalar settings and the body replaced. Only the named lines change, so
 * the rest of the frontmatter keeps its order and its style. `undefined` removes a setting.
 * @param {string} raw
 * @param {{settings?: Record<string, string|number|boolean|undefined>, body?: string}} change
 */
export function composeSoul(raw, { settings = {}, body }) {
  const { front, body: oldBody } = splitSoul(raw);
  const lines = front ? front.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(settings)) {
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (value === undefined) {
      if (at !== -1) lines.splice(at, 1);
    } else if (at !== -1) lines[at] = `${key}: ${yamlValue(value)}`;
    else lines.push(`${key}: ${yamlValue(value)}`);
  }
  const text = String(body ?? oldBody).replace(/\r\n/g, '\n').trim();
  return `---\n${lines.join('\n')}\n---\n\n${text}\n`;
}

/**
 * Everything wrong with a role file, before it reaches the disk.
 * errors stop the save; warnings are shown and let it through.
 * @param {string} raw        the proposed file
 * @param {{id: string, group: 'role'|'superstar', file: string, previous?: string}} where
 */
export function checkSoul(raw, { id, group, file, previous }) {
  const { role, errors } = parseRole(raw, { file, group });
  const warnings = [];
  const known = varsFor(id, group);
  const body = splitSoul(raw).body;
  const used = placeholdersIn(body);
  if (known) {
    for (const name of used) if (!(name in known)) errors.push(`{{${name}}} isn't something this role is given: the role would fail on its next call. It gets: ${Object.keys(known).join(', ')}`);
    if (previous !== undefined) {
      const before = placeholdersIn(splitSoul(previous).body);
      for (const name of before) if (!used.includes(name) && name in known) warnings.push(`{{${name}}} is gone from the text, so this role no longer sees ${known[name]}.`);
    }
  }
  // Superstars get the reply format with every call; the persona files hold only the voice.
  if (role?.output === 'json' && group !== 'superstar' && !/json/i.test(body)) warnings.push('This role has to reply in JSON, and the text no longer asks for it.');
  return { role: role ?? null, errors, warnings };
}

/**
 * Save a soul. Refuses invalid text and text based on a version that has since changed on
 * disk (the file may also be open in an editor, and neither side should lose its work).
 * @param {{config: object, floor: object}} deps
 * @param {string} id
 * @param {{raw: string, baseHash: string, summary?: string}} change
 */
export async function saveSoul({ config, floor }, id, { raw, baseHash, summary }) {
  const soul = await readSoul(config, id);
  if (baseHash && baseHash !== soul.hash) throw new SoulConflict(soul);
  if (raw === soul.raw) return { changed: false, soul, warnings: [] };
  const { errors, warnings } = checkSoul(raw, { id, group: soul.group, file: soul.file, previous: soul.raw });
  if (errors.length) throw new SoulError(errors);
  const revision = await saveRevision(config, 'roles', id, soul.raw);
  await writeFileAtomic(soul.path, raw);
  const event = await recordChange(floor, { what: 'role', target: id, summary: summary?.trim() || `${soul.role?.name ?? id}'s soul`, path: revision });
  return { changed: true, soul: await readSoul(config, id), warnings, event };
}

/** A starting point for a new superstar: the same frontmatter and placeholders as the others. */
export function superstarTemplate({ id, name, voice }) {
  const body = `You are ${name}, a Superstar at the Silver Factory.

${String(voice ?? '').trim() || "Your voice:\n- (How do they talk? What do they notice? What would they never say?)"}

You are cast talent, not a critic. You react to the *subjects*: the news, the objects, the spectacle, public figures as public figures. You don't talk about code, models, or "the AI".

## What's on the floor today

{{subjects}}

## What people are saying

{{floor}}

## The pile

{{pile}}

You may say up to {{lines}} lines today, about any of the subjects above.`;
  return `---
id: ${id}
name: ${yamlValue(name)}
temperature: 1.1
output: json
reads: [subject.posted, chatter.posted]
emits: [chatter.posted, subject.posted]
max_tokens: 1500
reasoning: 256
---

${body}
`;
}

/**
 * Cast a new superstar: a new file, and they talk from the next shift on.
 * @param {{config: object, floor: object}} deps
 * @param {{id: string, name: string, voice?: string}} who
 */
export async function castSuperstar({ config, floor }, { id, name, voice }) {
  const cleanId = String(id ?? '').trim().toLowerCase();
  const cleanName = String(name ?? '').trim();
  if (!KEBAB.test(cleanId)) throw new SoulError('the id must be lowercase letters, digits and dashes, like "edie"');
  if (!cleanName) throw new SoulError('a superstar needs a name');
  if ((await listSouls(config)).some((s) => s.id === cleanId)) throw new SoulError(`there is already a role "${cleanId}"`, 409);
  const file = join('superstars', `${cleanId}.md`);
  const raw = superstarTemplate({ id: cleanId, name: cleanName, voice });
  const { errors } = checkSoul(raw, { id: cleanId, group: 'superstar', file });
  if (errors.length) throw new SoulError(errors);
  await writeFileAtomic(join(config.paths.roles, file), raw);
  await recordChange(floor, { what: 'role', target: cleanId, summary: `the cast: ${cleanName} joins the superstars`, cast: true });
  return readSoul(config, cleanId);
}

/** Superstars on the bench, ready to come back. */
export async function benchedSuperstars(config) {
  const souls = [];
  for (const path of await markdownFiles(benchDir(config))) {
    const raw = await readFile(path, 'utf8');
    const id = basename(path, '.md');
    souls.push({ id, name: parseRole(raw, { file: `${id}.md`, group: 'superstar' }).role?.name ?? id, raw });
  }
  return souls;
}

/** Take a superstar off the floor. The file moves to the record, so nothing is lost. */
export async function benchSuperstar({ config, floor }, id) {
  const soul = await readSoul(config, id);
  if (soul.group !== 'superstar') throw new SoulError(`${id} isn't a superstar: the Factory's own roles can't be benched`, 409);
  await mkdir(benchDir(config), { recursive: true });
  await rename(soul.path, join(benchDir(config), `${id}.md`));
  await recordChange(floor, { what: 'role', target: id, summary: `the cast: ${soul.role?.name ?? id} leaves the floor`, benched: true });
  return soul;
}

export async function recallSuperstar({ config, floor }, id) {
  const from = join(benchDir(config), `${basename(String(id))}.md`);
  let raw;
  try {
    raw = await readFile(from, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new SoulError(`no one called "${id}" on the bench`, 404);
    throw err;
  }
  if ((await listSouls(config)).some((s) => s.id === id)) throw new SoulError(`there is already a role "${id}"`, 409);
  await writeFileAtomic(join(config.paths.roles, 'superstars', `${id}.md`), raw);
  await rm(from);
  await recordChange(floor, { what: 'role', target: id, summary: `the cast: ${parseRole(raw, { file: `${id}.md`, group: 'superstar' }).role?.name ?? id} is back on the floor` });
  return readSoul(config, id);
}

// trimEnd: in `status --porcelain` the leading space is part of the line.
const git = (root, ...args) => execFileP('git', ['-C', root, ...args]).then(({ stdout }) => stdout.trimEnd());

/**
 * Role files changed since the last commit, and the branch a commit would land on. Null when
 * the roles aren't in a git repository (a sandbox).
 * @returns {Promise<{branch: string, files: string[]}|null>}
 */
export async function soulChanges(config) {
  const roles = relative(config.root, config.paths.roles);
  try {
    if ((await git(config.root, 'rev-parse', '--show-toplevel')) !== (await realpath(config.root))) return null;
    const status = await git(config.root, 'status', '--porcelain', '--', roles);
    return { branch: await git(config.root, 'rev-parse', '--abbrev-ref', 'HEAD'), files: status ? status.split('\n').map((l) => l.slice(3)) : [] };
  } catch {
    return null;
  }
}

/**
 * Commit the role files, and nothing else that happens to be staged. Only ever on request: an
 * unattended commit could land on whatever branch happens to be checked out.
 */
export async function commitSouls({ config, floor }, { message }) {
  const changes = await soulChanges(config);
  if (!changes) throw new SoulError("the roles aren't in a git repository here", 409);
  if (!changes.files.length) throw new SoulError('no soul has changed since the last commit', 409);
  const roles = relative(config.root, config.paths.roles);
  const names = changes.files.map((f) => basename(f, '.md')).join(', ');
  const text = String(message ?? '').trim() || `Souls: ${names}`;
  try {
    await git(config.root, 'add', '--all', '--', roles);
    await git(config.root, 'commit', '--quiet', '-m', text, '--', roles);
  } catch (err) {
    throw new SoulError(`git wouldn't commit it: ${String(err.stderr || err.message).trim().split('\n').at(-1)}`, 409);
  }
  const commit = await git(config.root, 'rev-parse', '--short', 'HEAD');
  await recordChange(floor, { what: 'role', target: names, summary: `committed the souls (${names}) to ${changes.branch}`, commit });
  return { commit, branch: changes.branch, files: changes.files };
}

