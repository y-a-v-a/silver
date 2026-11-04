// The supervisor against a small stand-in server in a temporary directory: it restarts on
// code changes, refuses code that doesn't parse, ignores what doesn't need a restart, and
// keeps the address answering when the server can't boot at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSupervisor, isCodeChange, preflight } from '../src/admin/supervisor.js';

test('code, config, dependencies and secrets mean a restart; souls, data and assets do not', () => {
  for (const f of ['src/cli.js', 'src/admin/pages/review.js', 'src/tools/p5-template.html', 'silver.config.js', 'package.json', '.env']) assert.equal(isCodeChange(f), true, f);
  for (const f of ['roles/warhol.md', 'roles/superstars/viva.md', 'taste.md', 'direction.md', 'studio.json', 'floor/2026-01-01.jsonl', 'archive/jobs/x.json', 'src/admin/assets/admin.css', 'README.md', 'src/notes.txt', 'site/index.html']) assert.equal(isCodeChange(f), false, f);
});

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * A CLI stand-in: `config --check` passes without loading the code (like the real one, whose
 * commands load lazily); otherwise it serves one line saying which code runs.
 */
const cli = (port) => `
import { createServer } from 'node:http';
if (process.argv[2] === 'config') process.exit(0);
const { VERSION } = await import('./src/version.js');
const server = createServer((req, res) => {
  if (req.url === '/restart') { process.send?.({ type: 'restart' }); return res.end('ok'); }
  res.end(VERSION + ':' + process.pid);
});
server.listen(${port}, '127.0.0.1', () => process.send?.({ type: 'ready' }));
process.once('SIGTERM', () => process.exit(0));
`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'silver-super-'));
  const port = await freePort();
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'cli.mjs'), cli(port));
  await writeFile(join(root, 'src', 'version.js'), `export const VERSION = 'one';\n`);
  const logs = [];
  const sup = createSupervisor({ root, cli: join(root, 'cli.mjs'), childArgs: ['serve'], port, env: process.env, log: (l) => logs.push(l), debounceMs: 60 });
  await sup.start();
  const read = async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return { status: res.status, text: await res.text() };
  };
  const until = async (check, ms = 10_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const r = await read().catch(() => null);
      if (r && check(r)) return r;
      if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(r)}\n${logs.join('\n')}`);
      await sleep(40);
    }
  };
  return { root, port, sup, until, logs, read };
}

test('a saved code file restarts the server on the new code', async () => {
  const { root, sup, until } = await setup();
  try {
    const first = await until((r) => r.text.startsWith('one:'));
    await writeFile(join(root, 'src', 'version.js'), `export const VERSION = 'two';\n`);
    const second = await until((r) => r.text.startsWith('two:'));
    assert.notEqual(first.text.split(':')[1], second.text.split(':')[1], 'a new process');
  } finally {
    await sup.stop();
  }
});

test('code that does not parse never takes the page away: the old server keeps running', async () => {
  const { root, sup, until, logs, read } = await setup();
  try {
    const first = await until((r) => r.text.startsWith('one:'));
    await writeFile(join(root, 'src', 'version.js'), `export const VERSION = ;;; nonsense\n`);
    for (let i = 0; i < 100 && !logs.some((l) => l.includes("doesn't stand up")); i++) await sleep(50);
    assert.ok(logs.some((l) => /doesn't stand up/.test(l)), logs.join('\n'));
    const still = await read();
    assert.equal(still.text, first.text, 'the same process is still answering');
    await writeFile(join(root, 'src', 'version.js'), `export const VERSION = 'three';\n`);
    await until((r) => r.text.startsWith('three:'));
  } finally {
    await sup.stop();
  }
});

test('a soul or a data file changes nothing; the button restarts it on request', async () => {
  const { root, sup, until, port } = await setup();
  try {
    const first = await until((r) => r.text.startsWith('one:'));
    await mkdir(join(root, 'roles'), { recursive: true });
    await writeFile(join(root, 'roles', 'warhol.md'), 'x');
    await writeFile(join(root, 'taste.md'), 'x');
    await writeFile(join(root, 'src', 'notes.txt'), 'x');
    await sleep(350);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())), first.text);
    await fetch(`http://127.0.0.1:${port}/restart`);
    await until((r) => r.text.startsWith('one:') && r.text !== first.text);
  } finally {
    await sup.stop();
  }
});

test('a crash brings it back; a server that keeps crashing leaves a page saying why, until a save fixes it', async () => {
  const { root, sup, until } = await setup();
  try {
    await until((r) => r.text.startsWith('one:'));
    // It parses, but it dies at boot: only running it can tell.
    await writeFile(join(root, 'src', 'version.js'), `throw new Error('wired wrong');\nexport const VERSION = 'x';\n`);
    const down = await until((r) => r.status === 503, 20_000);
    assert.match(down.text, /The admin doesn't start/);
    assert.match(down.text, /wired wrong/);
    await writeFile(join(root, 'src', 'version.js'), `export const VERSION = 'fixed';\n`);
    await until((r) => r.text.startsWith('fixed:'), 15_000);
  } finally {
    await sup.stop();
  }
});

test('stopping the supervisor stops the server', async () => {
  const { sup, until, read } = await setup();
  await until((r) => r.text.startsWith('one:'));
  await sup.stop();
  await assert.rejects(read());
});

test('preflight names the file that does not parse, and a config that does not load', async () => {
  const root = await mkdtemp(join(tmpdir(), 'silver-pre-'));
  await writeFile(join(root, 'ok.js'), 'export const a = 1;\n');
  await writeFile(join(root, 'bad.js'), 'export const = ;\n');
  await writeFile(join(root, 'cli.mjs'), `process.exit(process.env.BROKEN ? 1 : 0)`);
  const env = { PATH: process.env.PATH };
  assert.deepEqual(await preflight({ root, cli: join(root, 'cli.mjs'), files: ['ok.js'], env }), []);
  const bad = await preflight({ root, cli: join(root, 'cli.mjs'), files: ['ok.js', 'bad.js'], env });
  assert.match(bad[0], /^bad\.js:/);
  await writeFile(join(root, 'cli.mjs'), `console.error('invalid silver config'); process.exit(1)`);
  assert.match((await preflight({ root, cli: join(root, 'cli.mjs'), files: ['.env'], env }))[0], /invalid silver config/);
  assert.equal((await readFile(join(root, 'ok.js'), 'utf8')).length > 0, true);
});
