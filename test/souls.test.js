import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { benchedSuperstars, benchSuperstar, castSuperstar, checkSoul, commitSouls, soulChanges, composeSoul, listRevisions, listSouls, readRevision, readSoul, recallSuperstar, saveSoul, sha, SoulConflict, SoulError, splitSoul } from '../src/admin/souls.js';
import { ROLE_VARS, varsFor } from '../src/admin/contract.js';
import { compactDiff, hasChanges, lineDiff } from '../src/lib/diff.js';
import { listRoles } from './helpers-souls.js';
import { loadRoles, placeholdersIn } from '../src/roles.js';
import { roleFile, tmpFactory } from './helpers.js';

const exec = promisify(execFile);
const VIVA = await readFile(new URL('../roles/superstars/viva.md', import.meta.url), 'utf8');
const WARHOL = await readFile(new URL('../roles/warhol.md', import.meta.url), 'utf8');

const setup = () => tmpFactory({ roles: { 'superstars/viva.md': VIVA, 'warhol.md': WARHOL } });
const deps = (f) => ({ config: f.config, floor: f.floor });

test('every placeholder in the shipped role files is something the code hands that role', async () => {
  for (const { file, group, id, body } of await listRoles()) {
    const known = varsFor(id, group);
    assert.ok(known, `${file} has no entry in the contract`);
    for (const name of placeholdersIn(body)) assert.ok(name in known, `${file} uses {{${name}}}, which isn't in the contract`);
  }
  assert.ok(ROLE_VARS['studio-assistant'].direction && ROLE_VARS.warhol.direction && ROLE_VARS.scout.direction);
});

test('composeSoul changes only the named settings and the body; the rest keeps its order and style', () => {
  const next = composeSoul(WARHOL, { settings: { temperature: 0.6, reasoning: undefined, model: 'a/b' }, body: 'New body.\r\nSecond line. {{taste}}' });
  const { front, body } = splitSoul(next);
  assert.match(front, /^id: warhol\nname: Warhol\ntemperature: 0\.6\noutput: json\nvision: true\nreads: \[series\.completed, chatter\.posted\]\nemits: \[shortlist\.proposed\]\nmax_tokens: 3000\nmodel: a\/b$/);
  assert.equal(body, 'New body.\nSecond line. {{taste}}\n');
  assert.equal(composeSoul(WARHOL, {}), `${WARHOL.trimEnd()}\n`, 'no change: same file');
  assert.match(composeSoul(WARHOL, { settings: { name: 'Andy: the boss' } }), /^name: "Andy: the boss"$/m, 'quoted when YAML would misread it');
  assert.match(composeSoul(WARHOL, { settings: { name: 'yes' } }), /^name: "yes"$/m);
});

test('checkSoul stops what would break the role, and warns about what would quietly weaken it', () => {
  const where = { id: 'warhol', group: 'role', file: 'warhol.md', previous: WARHOL };
  assert.deepEqual(checkSoul(WARHOL, where).errors, []);
  assert.deepEqual(checkSoul(WARHOL, where).warnings, []);

  const unknown = checkSoul(composeSoul(WARHOL, { body: `${splitSoul(WARHOL).body}\n{{wibble}}` }), where);
  assert.match(unknown.errors[0], /\{\{wibble\}\} isn't something this role is given.*It gets: subject/);

  const dropped = checkSoul(WARHOL.replace('{{taste}}', ''), where);
  assert.deepEqual(dropped.errors, []);
  assert.match(dropped.warnings[0], /\{\{taste\}\} is gone from the text, so this role no longer sees taste\.md/);

  const noJson = checkSoul(composeSoul(WARHOL, { body: 'Choose. {{taste}}' }), where);
  assert.ok(noJson.warnings.some((w) => /reply in JSON/.test(w)));

  assert.match(checkSoul('---\nid: warhol\n---\nx', where).errors.join(' '), /missing "name"/);
  assert.match(checkSoul(composeSoul(WARHOL, { settings: { temperature: 9 } }), where).errors.join(' '), /temperature must be/);
  assert.match(checkSoul(composeSoul(WARHOL, { settings: { reasoning: 99999 } }), where).errors.join(' '), /below max_tokens/);
  assert.match(checkSoul(`---\nnot: [valid\n---\nx`, where).errors.join(' '), /not valid YAML/);
  assert.deepEqual(checkSoul(roleFile('new', {}, 'Say {{anything}}.'), { id: 'new', group: 'role', file: 'new.md' }).errors, [], 'a role the contract does not know is left alone');
});

test('saving a soul writes it, keeps the old text as a revision, and says so on the floor', async () => {
  const f = await setup();
  const before = await readSoul(f.config, 'viva');
  const raw = composeSoul(before.raw, { settings: { temperature: 1.3 }, body: `${before.role.body}\nAnd she never sleeps.` });
  const r = await saveSoul(deps(f), 'viva', { raw, baseHash: before.hash });
  assert.equal(r.changed, true);
  assert.equal(await readFile(before.path, 'utf8'), raw);

  const revisions = await listRevisions(f.config, 'roles', 'viva');
  assert.equal(revisions.length, 1);
  assert.equal(await readRevision(f.config, 'roles', 'viva', revisions[0].id), before.raw);

  const [event] = await f.floor.read({ type: 'studio.changed' });
  assert.equal(event.actor, 'human');
  assert.equal(event.payload.target, 'viva');
  assert.match(event.payload.path, /^archive\/revisions\/roles\/viva\//);

  const roles = await loadRoles({ dir: f.config.paths.roles, models: f.config.models });
  assert.equal(roles.get('viva').temperature, 1.3, 'the loader reads the new file as it is');
  assert.match(roles.get('viva').body, /never sleeps/);
});

test('saving the same text again is no change: no revision, no event', async () => {
  const f = await setup();
  const soul = await readSoul(f.config, 'viva');
  assert.equal((await saveSoul(deps(f), 'viva', { raw: soul.raw, baseHash: soul.hash })).changed, false);
  assert.equal((await listRevisions(f.config, 'roles', 'viva')).length, 0);
  assert.equal((await f.floor.read({ type: 'studio.changed' })).length, 0);
});

test('a save based on an old version is refused: an edit made in a text editor is never overwritten', async () => {
  const f = await setup();
  const soul = await readSoul(f.config, 'viva');
  const edited = `${soul.raw}\nFrom the editor.\n`;
  await writeFile(soul.path, edited);
  await assert.rejects(saveSoul(deps(f), 'viva', { raw: composeSoul(soul.raw, { body: 'Mine.{{subjects}}{{floor}}{{pile}}{{lines}}' }), baseHash: soul.hash }), (err) => err instanceof SoulConflict && err.current.raw === edited && err.status === 409);
  assert.equal(await readFile(soul.path, 'utf8'), edited);
  assert.equal((await listRevisions(f.config, 'roles', 'viva')).length, 0);
});

test('an invalid save changes nothing on disk', async () => {
  const f = await setup();
  const soul = await readSoul(f.config, 'viva');
  await assert.rejects(saveSoul(deps(f), 'viva', { raw: composeSoul(soul.raw, { settings: { temperature: 5 } }), baseHash: soul.hash }), (err) => err instanceof SoulError && err.status === 422 && /temperature/.test(err.message));
  await assert.rejects(saveSoul(deps(f), 'viva', { raw: composeSoul(soul.raw, { body: '{{nope}}' }), baseHash: soul.hash }), /\{\{nope\}\}/);
  await assert.rejects(saveSoul(deps(f), 'nobody', { raw: 'x', baseHash: 'y' }), (err) => err.status === 404);
  assert.equal(await readFile(soul.path, 'utf8'), soul.raw);
  assert.equal((await f.floor.read({ type: 'studio.changed' })).length, 0);
});

test('a broken role file still shows up, so it can be opened and fixed', async () => {
  const f = await setup();
  const soul = await readSoul(f.config, 'viva');
  await writeFile(soul.path, 'no frontmatter at all');
  const broken = (await listSouls(f.config)).find((s) => s.id === 'viva');
  assert.equal(broken.role, null);
  assert.ok(broken.errors.length);
  const fixed = await saveSoul(deps(f), 'viva', { raw: soul.raw, baseHash: sha('no frontmatter at all') });
  assert.equal(fixed.soul.role.name, 'Viva');
});

test('a revision that is not a ULID is not a file we wrote', async () => {
  const f = await setup();
  await assert.rejects(readRevision(f.config, 'roles', 'viva', '../../taste'), (err) => err.status === 404);
});

test('casting, benching and recalling a superstar; the Factory\'s own roles stay', async () => {
  const f = await setup();
  const edie = await castSuperstar(deps(f), { id: 'Edie', name: 'Edie: the girl', voice: 'Whispers. Lies about money.' });
  assert.equal(edie.group, 'superstar');
  assert.equal(edie.role.name, 'Edie: the girl');
  assert.match(edie.raw, /Whispers\. Lies about money\./);
  assert.deepEqual(edie.errors, []);
  const roles = await loadRoles({ dir: f.config.paths.roles, models: f.config.models });
  assert.ok(roles.superstars().some((r) => r.id === 'edie'));

  await assert.rejects(castSuperstar(deps(f), { id: 'viva', name: 'Viva' }), /already a role/);
  await assert.rejects(castSuperstar(deps(f), { id: '../evil', name: 'x' }), /lowercase letters/);
  await assert.rejects(castSuperstar(deps(f), { id: 'ok', name: ' ' }), /needs a name/);

  await benchSuperstar(deps(f), 'edie');
  assert.ok(!(await listSouls(f.config)).some((s) => s.id === 'edie'));
  assert.deepEqual((await benchedSuperstars(f.config)).map((s) => s.name), ['Edie: the girl']);
  await assert.rejects(benchSuperstar(deps(f), 'warhol'), /can't be benched/);

  await recallSuperstar(deps(f), 'edie');
  assert.ok((await listSouls(f.config)).some((s) => s.id === 'edie'));
  assert.deepEqual(await benchedSuperstars(f.config), []);
  await assert.rejects(recallSuperstar(deps(f), 'nobody'), /on the bench/);
  assert.deepEqual((await f.floor.read({ type: 'studio.changed' })).map((e) => e.payload.summary), ['the cast: Edie: the girl joins the superstars', 'the cast: Edie: the girl leaves the floor', 'the cast: Edie: the girl is back on the floor']);
  assert.deepEqual(await readdir(join(f.config.paths.roles, 'superstars')).then((n) => n.sort()), ['edie.md', 'viva.md']);
});

test('lineDiff finds the changed lines; compactDiff keeps only those and their surroundings', () => {
  const a = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n');
  const b = ['one', 'two', 'THREE', 'four', 'five', 'six', 'seven', 'eight', 'nine'].join('\n');
  const d = lineDiff(a, b);
  assert.deepEqual(d.filter((x) => x.op !== 'same'), [{ op: 'del', text: 'three' }, { op: 'add', text: 'THREE' }, { op: 'add', text: 'nine' }]);
  assert.equal(hasChanges(d), true);
  assert.equal(hasChanges(lineDiff(a, a)), false);
  const c = compactDiff(d, 1);
  assert.deepEqual(c.map((x) => x.op), ['skip', 'same', 'del', 'add', 'same', 'skip', 'same', 'add']);
  assert.equal(c[0].count, 1);
  assert.deepEqual(lineDiff('', 'x').filter((x) => x.op !== 'same').map((x) => x.op), ['del', 'add']);
});

test('souls are committed only on request: just the role files, whatever else is staged', async () => {
  const f = await setup();
  const run = (...args) => exec('git', ['-C', f.root, ...args]).then((r) => r.stdout.trim());
  assert.equal(await soulChanges(f.config), null, 'not a repository: nothing to offer');
  await assert.rejects(commitSouls(deps(f), {}), /aren't in a git repository/);

  await run('init', '--quiet', '--initial-branch=wilder');
  await run('config', 'user.name', 'T');
  await run('config', 'user.email', 't@example.invalid');
  await writeFile(join(f.root, 'other.txt'), 'x');
  await run('add', 'roles', 'other.txt');
  await run('commit', '--quiet', '-m', 'start');
  assert.deepEqual(await soulChanges(f.config), { branch: 'wilder', files: [] });
  await assert.rejects(commitSouls(deps(f), {}), /no soul has changed/);

  const soul = await readSoul(f.config, 'viva');
  await saveSoul(deps(f), 'viva', { raw: composeSoul(soul.raw, { settings: { temperature: 1.2 } }), baseHash: soul.hash });
  await writeFile(join(f.root, 'other.txt'), 'staged, and none of our business');
  await run('add', 'other.txt');
  assert.deepEqual((await soulChanges(f.config)).files, ['roles/superstars/viva.md']);

  const r = await commitSouls(deps(f), {});
  assert.equal(r.branch, 'wilder');
  assert.equal(await run('log', '-1', '--format=%s'), 'Souls: viva');
  assert.deepEqual((await run('show', '--name-only', '--format=', 'HEAD')).split('\n'), ['roles/superstars/viva.md']);
  assert.match(await run('status', '--porcelain'), /^M {2}other\.txt/m, 'what was staged stays staged, uncommitted');
  assert.deepEqual((await soulChanges(f.config)).files, []);
  assert.match((await f.floor.read({ type: 'studio.changed' })).at(-1).payload.summary, /committed the souls \(viva\) to wilder/);

  await benchSuperstar(deps(f), 'viva');
  assert.equal((await commitSouls(deps(f), { message: 'She left.' })).files.length, 1);
  assert.equal(await run('log', '-1', '--format=%s'), 'She left.');
});

