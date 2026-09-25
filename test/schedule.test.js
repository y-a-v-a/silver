import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlist, envHasKey, installSchedule, uninstallSchedule, plistPath, LABEL, ScheduleError } from '../src/schedule.js';

const tmp = () => mkdtemp(join(tmpdir(), 'silver-schedule-'));

test('buildPlist runs `node cli.js shift` daily at shift.at, with logs, escaped', () => {
  const plist = buildPlist({ node: '/usr/bin/node', cli: '/a & b/src/cli.js', root: '/a & b', at: '09:05', logDir: '/a & b/archive/logs' });
  assert.match(plist, /<key>Label<\/key>\n {2}<string>com\.silver\.shift<\/string>/);
  assert.match(plist, /<string>\/usr\/bin\/node<\/string>\n {4}<string>\/a &amp; b\/src\/cli\.js<\/string>\n {4}<string>shift<\/string>/);
  assert.match(plist, /<key>Hour<\/key>\n {4}<integer>9<\/integer>\n {4}<key>Minute<\/key>\n {4}<integer>5<\/integer>/);
  assert.match(plist, /<string>\/a &amp; b\/archive\/logs\/shift\.log<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n {2}<false\/>/);
  assert.doesNotMatch(plist, /& b/);
});

test('envHasKey finds a non-empty OPENROUTER_API_KEY in .env', async () => {
  const dir = await tmp();
  const env = join(dir, '.env');
  assert.equal(await envHasKey(env), false, 'missing file');
  await writeFile(env, 'OPENROUTER_API_KEY=\nVERCEL_TOKEN=x\n');
  assert.equal(await envHasKey(env), false, 'empty value');
  await writeFile(env, '# comment\nOPENROUTER_API_KEY="sk-or-123"\n');
  assert.equal(await envHasKey(env), true);
});

async function setup({ withKey = true } = {}) {
  const root = await tmp();
  const home = await tmp();
  if (withKey) await writeFile(join(root, '.env'), 'OPENROUTER_API_KEY=sk-or-test\n');
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'bootout') throw new Error('not loaded');
    return { stdout: '' };
  };
  const config = { root, paths: { archive: join(root, 'archive') }, shift: { at: '09:00' } };
  return { root, home, calls, run, config };
}

test('installSchedule writes the plist, creates the log dir, and bootstraps it', async () => {
  const s = await setup();
  const r = await installSchedule({ config: s.config }, { home: s.home, uid: 501, node: '/n', run: s.run });
  assert.equal(r.path, plistPath(s.home));
  assert.match(await readFile(r.path, 'utf8'), /<string>\/n<\/string>/);
  await access(join(s.root, 'archive', 'logs'));
  assert.deepEqual(s.calls, [['launchctl', 'bootout', `gui/501/${LABEL}`], ['launchctl', 'bootstrap', 'gui/501', r.path]]);
});

test('installSchedule refuses without a key in .env, unless forced; reports bootstrap failures', async () => {
  const s = await setup({ withKey: false });
  await assert.rejects(installSchedule({ config: s.config }, { home: s.home, uid: 501, run: s.run }), (e) => e instanceof ScheduleError && /no OPENROUTER_API_KEY/.test(e.message));
  assert.deepEqual(s.calls, []);
  await installSchedule({ config: s.config }, { home: s.home, uid: 501, run: s.run, force: true });
  const failing = async (cmd, args) => {
    if (args[0] === 'bootstrap') throw Object.assign(new Error('x'), { stderr: 'Bootstrap failed: 5: Input/output error' });
  };
  await assert.rejects(installSchedule({ config: s.config }, { home: s.home, uid: 501, run: failing, force: true }), /Bootstrap failed: 5/);
});

test('uninstallSchedule unloads and removes; a second time there is nothing to remove', async () => {
  const s = await setup();
  await installSchedule({ config: s.config }, { home: s.home, uid: 501, run: s.run });
  assert.deepEqual(await uninstallSchedule({ home: s.home, uid: 501, run: s.run }), { path: plistPath(s.home), removed: true });
  assert.deepEqual(await uninstallSchedule({ home: s.home, uid: 501, run: s.run }), { path: plistPath(s.home), removed: false });
});
