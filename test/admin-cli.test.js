// The new commands and flags through the real CLI, against a mock OpenRouter in a temporary
// SILVER_ROOT: pins on a series, a note on a pull, an audition, a paused shift, the admin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { completion, mockOpenRouter } from './helpers.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const ROLES = fileURLToPath(new URL('../roles/', import.meta.url));
const SKETCH = '```js\n// WORK: One red scratch.\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\n```';

let mock;
before(async () => {
  mock = await mockOpenRouter({
    reply: (body) => {
      const system = body.messages[0].content;
      if (/Superstar/.test(system.slice(0, 200))) return completion(JSON.stringify({ lines: [{ subject: 1, text: 'The pool is empty.' }] }));
      return completion(SKETCH);
    },
  });
});
after(() => mock.close());

async function tmpRoot() {
  const root = await mkdtemp(join(tmpdir(), 'silver-admin-cli-'));
  await cp(ROLES, join(root, 'roles'), { recursive: true });
  return root;
}
const envFor = (root) => ({ ...process.env, SILVER_ROOT: root, OPENROUTER_BASE_URL: mock.baseUrl, OPENROUTER_API_KEY: 'test-key' });

async function silver(root, ...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { env: envFor(root) });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}
const events = async (root, type) => {
  const out = [];
  for (const name of await readdir(join(root, 'floor'))) for (const line of (await readFile(join(root, 'floor', name), 'utf8')).split('\n').filter(Boolean)) out.push(JSON.parse(line));
  return out.filter((e) => e.type === type);
};

test('a series takes pins and a note on the command line', async () => {
  const root = await tmpRoot();
  assert.equal((await silver(root, 'commission', 'a can', '--no-annotate')).code, 0);
  const r = await silver(root, 'series', 'latest', '--no-render', '--variants', '2', '--technique', 'rorschach', '--temperature', '0.5', '--dare', 'Make it tender.', '--note', 'Think of rain.');
  assert.equal(r.code, 0, r.stderr);
  const [started] = await events(root, 'series.started');
  assert.deepEqual(started.payload.techniques, ['rorschach']);
  assert.deepEqual(started.payload.temperatures, [0.5]);
  assert.deepEqual(started.payload.steer, { techniques: ['rorschach'], temperatures: [0.5], dare: 'Make it tender.', note: 'Think of rain.' });
  const call = mock.requests.at(-1).body;
  assert.equal(call.temperature, 0.5);
  assert.match(call.messages[0].content, /## From the human\n\nThink of rain\./);
  assert.match(call.messages[0].content, /## Your dare\n\nMake it tender\./);
  const bad = await silver(root, 'series', started.payload.subjectId, '--technique', 'nope', '--no-render');
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /no technique "nope"/);
});

test('direction.md reaches a real call without any restart or setting', async () => {
  const root = await tmpRoot();
  await silver(root, 'commission', 'a can', '--no-annotate');
  await writeFile(join(root, 'direction.md'), '# Direction\n\n## Studio\n\nNo words anywhere.\n');
  assert.equal((await silver(root, 'series', 'latest', '--no-render', '--variants', '1')).code, 0);
  assert.match(mock.requests.at(-1).body.messages[0].content, /## From the human\n\nNo words anywhere\./);
});

test('an edited role file counts from the very next run', async () => {
  const root = await tmpRoot();
  await silver(root, 'commission', 'a can', '--no-annotate');
  const path = join(root, 'roles', 'studio-assistant.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace('You are a Studio assistant', 'You are a tired Studio assistant'));
  await silver(root, 'series', 'latest', '--no-render', '--variants', '1');
  assert.match(mock.requests.at(-1).body.messages[0].content, /^You are a tired Studio assistant/);
});

test('settings in studio.json reach a real run; a broken one stops it with the reason', async () => {
  const root = await tmpRoot();
  await silver(root, 'commission', 'a can', '--no-annotate');
  await writeFile(join(root, 'studio.json'), JSON.stringify({ series: { variants: 1, modelsPerSeries: 1, temperatures: [0.3], techniquesPerSeries: 1 } }));
  assert.equal((await silver(root, 'series', 'latest', '--no-render')).code, 0);
  assert.equal(mock.requests.at(-1).body.temperature, 0.3);
  await writeFile(join(root, 'studio.json'), '{ nope');
  const r = await silver(root, 'config', '--check');
  assert.equal(r.code, 1);
  assert.match(r.stderr + r.stdout, /studio\.json is not valid JSON/);
});

test('an audition is one call on the superstar\'s own soul; nothing reaches the floor but its cost', async () => {
  const root = await tmpRoot();
  await silver(root, 'commission', 'a can', '--no-annotate');
  const before_ = (await events(root, 'chatter.posted')).length;
  const r = await silver(root, 'audition', 'nico');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Nico, on /);
  assert.match(r.stdout, /on "a can"\n {2}The pool is empty\./);
  assert.match(r.stdout, /Nothing went on the floor but the cost/);
  assert.equal((await events(root, 'chatter.posted')).length, before_);
  assert.equal((await events(root, 'cost.recorded')).at(-1).payload.role, 'nico');
  const nobody = await silver(root, 'audition', 'nobody');
  assert.equal(nobody.code, 1);
});

test('a paused shift says so and does nothing', async () => {
  const root = await tmpRoot();
  await writeFile(join(root, 'studio.json'), JSON.stringify({ shift: { paused: true }, sources: { rss: [], trending: { googleTrendsGeo: 'US', hackernews: false, reddit: false } } }));
  const r = await silver(root, 'shift', '--no-notify');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /the shift is paused/);
  assert.deepEqual(await readdir(join(root)).then((n) => n.includes('floor')), false);
});

/** Start `silver admin`, wait for its address, hand back the process and the URL. */
function startAdmin(root, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'admin', '--no-supervise', '--no-open', '--port', '0', ...args], { env: envFor(root) });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no address: ${out}`)), 15_000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/also (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, url: m[1], out });
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', () => reject(new Error(`exited: ${out}`)));
  });
}
const stopAdmin = (child) => new Promise((r) => {
  child.removeAllListeners('exit');
  child.once('exit', r);
  child.kill('SIGTERM');
});

test('the real admin serves, on the real roles and config, and stops on SIGTERM', async () => {
  const root = await tmpRoot();
  const { child, url, out } = await startAdmin(root);
  try {
    assert.match(out, /admin: http:\/\/silver\.localhost:\d+/);
    for (const path of ['/', '/review', '/subjects', '/studio', '/souls', '/souls/warhol', '/taste', '/floor', '/canon', '/diary', '/jobs', '/system']) assert.equal((await fetch(url + path)).status, 200, path);
  } finally {
    await stopAdmin(child);
  }
});

test('a broken studio.json doesn\'t lock you out of the page that fixes it; fixing it clears the warning', async () => {
  const root = await tmpRoot();
  await writeFile(join(root, 'studio.json'), JSON.stringify({ series: { variants: 13 } }));
  const { child, url } = await startAdmin(root);
  try {
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /studio\.json doesn&#39;t work/);
    const res = await fetch(`${url}/system/reset-settings`, { method: 'POST', redirect: 'manual', headers: { Origin: url } });
    assert.equal(res.status, 303);
    assert.doesNotMatch(await (await fetch(`${url}/`)).text(), /doesn&#39;t work/);
  } finally {
    await stopAdmin(child);
  }
});
