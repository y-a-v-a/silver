// Loads role files: markdown whose body is the system prompt and whose frontmatter
// holds runtime settings (ACTIONS.md → Role file format). Code never hardcodes a prompt.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, basename, sep } from 'node:path';
import matter from 'gray-matter';
import { EVENT_TYPES } from './events.js';

/**
 * @typedef {object} Role
 * @property {string} id           file basename, e.g. "warhol", "brigid"
 * @property {string} name
 * @property {'role'|'superstar'} group
 * @property {string} actor        id on the floor: "warhol", "superstar.brigid"
 * @property {string} [model]      overrides the config default
 * @property {number} temperature
 * @property {number} maxTokens
 * @property {'json'|'text'} output
 * @property {boolean} vision      sends images; model must accept them
 * @property {string[]} reads
 * @property {string[]} emits
 * @property {string} body         system prompt template
 * @property {string[]} placeholders
 * @property {string} file         path relative to the roles dir
 */

const REQUIRED = ['id', 'name', 'temperature', 'output', 'reads', 'emits'];
const OPTIONAL = ['model', 'max_tokens', 'vision'];
const SLUG = /^~?[a-z0-9][\w.-]*\/[\w.:-]+$/i;
const PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export class RoleError extends Error {
  constructor(errors) {
    super(`invalid roles:\n  - ${errors.join('\n  - ')}`);
    this.name = 'RoleError';
    this.errors = errors;
  }
}

export class TemplateError extends Error {
  constructor(missing) {
    super(`missing template variables: ${missing.join(', ')}`);
    this.name = 'TemplateError';
    this.missing = missing;
  }
}

/** Names of all {{placeholders}} in a template, in order of first appearance. */
export function placeholdersIn(template) {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/**
 * Fill {{placeholders}}. Strings go in verbatim, other values as pretty JSON.
 * Strict mode throws on any missing variable; lenient mode leaves "[name]".
 * @param {string} template
 * @param {Record<string, unknown>} vars
 * @param {{strict?: boolean}} [opts]
 */
export function render(template, vars = {}, { strict = true } = {}) {
  const missing = placeholdersIn(template).filter((name) => vars[name] === undefined);
  if (strict && missing.length) throw new TemplateError(missing);
  return template.replace(PLACEHOLDER, (_, name) => {
    const v = vars[name];
    if (v === undefined) return `[${name}]`;
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}

/**
 * Parse and validate one role file's contents.
 * @param {string} text
 * @param {{file: string, group: 'role'|'superstar'}} where
 * @returns {{role?: Role, errors: string[]}}
 */
export function parseRole(text, { file, group }) {
  const errors = [];
  const err = (msg) => errors.push(`${file}: ${msg}`);
  let parsed;
  try {
    parsed = matter(text);
  } catch (e) {
    return { errors: [`${file}: frontmatter is not valid YAML (${e.message})`] };
  }
  const fm = parsed.data;
  const expectedId = basename(file, '.md');

  for (const key of REQUIRED) if (fm[key] === undefined) err(`missing "${key}"`);
  for (const key of Object.keys(fm)) if (![...REQUIRED, ...OPTIONAL].includes(key)) err(`unknown field "${key}"`);

  if (fm.id !== undefined && fm.id !== expectedId) err(`id "${fm.id}" must match the file name "${expectedId}"`);
  if (fm.name !== undefined && (typeof fm.name !== 'string' || !fm.name.trim())) err('name must be a non-empty string');
  if (fm.temperature !== undefined && !(typeof fm.temperature === 'number' && fm.temperature >= 0 && fm.temperature <= 2))
    err('temperature must be a number between 0 and 2');
  if (fm.output !== undefined && !['json', 'text'].includes(fm.output)) err('output must be "json" or "text"');
  for (const key of ['reads', 'emits']) {
    if (fm[key] === undefined) continue;
    if (!Array.isArray(fm[key])) err(`${key} must be a list of event types`);
    else for (const t of fm[key]) if (!EVENT_TYPES.includes(t)) err(`${key} has unknown event type "${t}"`);
  }
  if (fm.model !== undefined && !SLUG.test(fm.model)) err(`model "${fm.model}" is not an OpenRouter slug`);
  if (fm.max_tokens !== undefined && !(Number.isInteger(fm.max_tokens) && fm.max_tokens > 0)) err('max_tokens must be a positive integer');
  if (fm.vision !== undefined && typeof fm.vision !== 'boolean') err('vision must be true or false');

  const body = parsed.content.trim();
  if (!body) err('the body (system prompt) is empty');
  if (errors.length) return { errors };

  return {
    errors,
    role: {
      id: fm.id,
      name: fm.name,
      group,
      actor: group === 'superstar' ? `superstar.${fm.id}` : fm.id,
      model: fm.model,
      temperature: fm.temperature,
      maxTokens: fm.max_tokens ?? 2000,
      output: fm.output,
      vision: fm.vision ?? false,
      reads: fm.reads,
      emits: fm.emits,
      body,
      placeholders: placeholdersIn(body),
      file,
    },
  };
}

async function findMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/**
 * Load every role under `dir`. Files in `superstars/` become superstars.
 * All problems across all files are reported together.
 * @param {{dir: string, models: {studio: string[], roles: Record<string, string>}}} opts
 */
export async function loadRoles({ dir, models }) {
  let files;
  try {
    files = await findMarkdown(dir);
  } catch (err) {
    if (err.code === 'ENOENT') files = [];
    else throw err;
  }
  const errors = [];
  /** @type {Map<string, Role>} */
  const byId = new Map();
  for (const path of files) {
    const file = relative(dir, path);
    const group = file.split(sep)[0] === 'superstars' ? 'superstar' : 'role';
    const { role, errors: fileErrors } = parseRole(await readFile(path, 'utf8'), { file, group });
    errors.push(...fileErrors);
    if (!role) continue;
    if (byId.has(role.id)) errors.push(`${file}: duplicate role id "${role.id}" (also ${byId.get(role.id).file})`);
    else byId.set(role.id, role);
  }
  if (errors.length) throw new RoleError(errors);

  /** The model a role runs on: frontmatter, else the config default for its group. */
  function modelFor(role) {
    if (role.model) return role.model;
    if (role.group === 'superstar') return models.roles.superstar;
    if (role.id === 'studio-assistant') return models.studio[0];
    const model = models.roles[role.id];
    if (!model) throw new RoleError([`${role.file}: no model in frontmatter and no models.roles["${role.id}"] in config`]);
    return model;
  }

  return {
    /** @param {string} id */
    get(id) {
      const role = byId.get(id);
      if (!role) throw new RoleError([`no role "${id}" (known: ${[...byId.keys()].join(', ') || 'none'})`]);
      return role;
    },
    has: (id) => byId.has(id),
    list: () => [...byId.values()],
    superstars: () => [...byId.values()].filter((r) => r.group === 'superstar'),
    modelFor,
  };
}
