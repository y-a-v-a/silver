import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoles, parseRole, render, placeholdersIn, RoleError, TemplateError } from '../src/roles.js';
import { loadConfig } from '../src/config.js';

const MODELS = { studio: ['a/studio-1', 'b/studio-2'], roles: { scout: 'x/scout', superstar: 'x/cheap' } };

const roleFile = (fm, body = 'You are {{who}}.') =>
  `---\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n\n${body}\n`;

const valid = (id, extra = {}) => ({ id, name: id, temperature: 0.5, output: 'text', reads: [], emits: ['chatter.posted'], ...extra });

async function rolesDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'silver-roles-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

test('placeholdersIn finds unique names, tolerating whitespace', () => {
  assert.deepEqual(placeholdersIn('{{a}} {{ b }} {{a}} {{not valid}}'), ['a', 'b']);
});

test('render fills strings verbatim and objects as JSON', () => {
  assert.equal(render('hi {{ who }}', { who: 'Andy' }), 'hi Andy');
  assert.equal(render('{{x}}', { x: { a: 1 } }), '{\n  "a": 1\n}');
  assert.equal(render('{{n}}', { n: 0 }), '0');
});

test('render is strict by default and lenient on request', () => {
  assert.throws(() => render('{{a}} {{b}}', { a: 1 }), (err) => err instanceof TemplateError && err.missing[0] === 'b');
  assert.equal(render('{{a}} {{b}}', { a: 'x' }, { strict: false }), 'x [b]');
});

test('parseRole maps frontmatter to a role with defaults', () => {
  const { role, errors } = parseRole(roleFile(valid('scout')), { file: 'scout.md', group: 'role' });
  assert.deepEqual(errors, []);
  assert.equal(role.actor, 'scout');
  assert.equal(role.maxTokens, 2000);
  assert.equal(role.vision, false);
  assert.deepEqual(role.placeholders, ['who']);
});

test('parseRole reports every problem in the file', () => {
  const fm = { id: 'wrong', name: '', temperature: 3, output: 'xml', reads: ['nope.event'], emits: 'x', colour: 'silver', model: 'bad slug', max_tokens: 0, vision: 'yes' };
  const { role, errors } = parseRole(roleFile(fm, ''), { file: 'scout.md', group: 'role' });
  assert.equal(role, undefined);
  for (const pattern of [/id "wrong" must match/, /name/, /temperature/, /output/, /unknown event type "nope\.event"/, /emits must be a list/, /unknown field "colour"/, /model/, /max_tokens/, /vision/, /body/]) {
    assert.ok(errors.some((e) => pattern.test(e)), `no error for ${pattern}:\n${errors.join('\n')}`);
  }
});

test('parseRole reports missing required fields and broken YAML', () => {
  const { errors } = parseRole('---\nid: scout\n---\nbody', { file: 'scout.md', group: 'role' });
  for (const key of ['name', 'temperature', 'output', 'reads', 'emits']) assert.ok(errors.some((e) => e.includes(`missing "${key}"`)), key);
  assert.match(parseRole('---\nid: [\n---\nx', { file: 'x.md', group: 'role' }).errors[0], /not valid YAML/);
});

test('loadRoles loads roles and superstars, and resolves models', async () => {
  const dir = await rolesDir({
    'scout.md': roleFile(valid('scout')),
    'studio-assistant.md': roleFile(valid('studio-assistant')),
    'warhol.md': roleFile(valid('warhol', { model: 'z/vision', vision: true })),
    'superstars/brigid.md': roleFile(valid('brigid')),
    'README.txt': 'ignored',
  });
  const roles = await loadRoles({ dir, models: MODELS });
  assert.deepEqual(roles.list().map((r) => r.id).sort(), ['brigid', 'scout', 'studio-assistant', 'warhol']);
  assert.deepEqual(roles.superstars().map((r) => r.actor), ['superstar.brigid']);
  assert.equal(roles.modelFor(roles.get('scout')), 'x/scout');
  assert.equal(roles.modelFor(roles.get('brigid')), 'x/cheap');
  assert.equal(roles.modelFor(roles.get('studio-assistant')), 'a/studio-1');
  assert.equal(roles.modelFor(roles.get('warhol')), 'z/vision'); // frontmatter wins
});

test('loadRoles aggregates errors across files and catches duplicate ids', async () => {
  const dir = await rolesDir({
    'scout.md': roleFile(valid('scout', { temperature: 9 })),
    'brigid.md': roleFile(valid('brigid')),
    'superstars/brigid.md': roleFile(valid('brigid')),
  });
  await assert.rejects(loadRoles({ dir, models: MODELS }), (err) => {
    assert.ok(err instanceof RoleError);
    assert.ok(err.errors.some((e) => /scout\.md: temperature/.test(e)));
    assert.ok(err.errors.some((e) => /duplicate role id "brigid"/.test(e)));
    return true;
  });
});

test('get throws for unknown roles; modelFor throws when no model can be resolved', async () => {
  const roles = await loadRoles({ dir: await rolesDir({ 'printer.md': roleFile(valid('printer')) }), models: MODELS });
  assert.throws(() => roles.get('andy'), /no role "andy" \(known: printer\)/);
  assert.throws(() => roles.modelFor(roles.get('printer')), /no model in frontmatter/);
});

test('a missing roles dir is an empty set of roles', async () => {
  const roles = await loadRoles({ dir: join(tmpdir(), 'silver-no-such-dir'), models: MODELS });
  assert.deepEqual(roles.list(), []);
});

test('the shipped roles/ load cleanly against the shipped config', async () => {
  const cfg = await loadConfig({ env: {} });
  const roles = await loadRoles({ dir: cfg.paths.roles, models: cfg.models });
  assert.ok(roles.list().length >= 1);
  for (const role of roles.list()) assert.ok(roles.modelFor(role), `${role.id} has no model`);
});
