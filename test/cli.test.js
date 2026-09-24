import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { COMMANDS, NOT_IMPLEMENTED_EXIT } from '../src/commands/registry.js';
import { buildProgram } from '../src/cli.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/** Run the CLI and return { code, stdout, stderr } without throwing on non-zero exit. */
async function silver(...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

test('registry: names are unique and phases are ACTIONS.md phases (0-8)', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const c of COMMANDS) {
    assert.ok(Number.isInteger(c.phase) && c.phase >= 0 && c.phase <= 8, `${c.name} phase`);
    assert.ok(c.description, `${c.name} description`);
  }
});

test('registry: every implemented command module default-exports a function', async () => {
  for (const c of COMMANDS.filter((c) => c.load)) {
    const mod = await c.load();
    assert.equal(typeof mod.default, 'function', c.name);
  }
});

test('buildProgram registers every command in the registry', () => {
  const registered = buildProgram().commands.map((c) => c.name());
  assert.deepEqual(registered, COMMANDS.map((c) => c.name));
});

test('silver --help lists every command (Phase 0 "done when")', async () => {
  const { code, stdout } = await silver('--help');
  assert.equal(code, 0);
  for (const c of COMMANDS) assert.match(stdout, new RegExp(`^\\s+${c.name}\\b`, 'm'), c.name);
});

test('silver --version prints the package version', async () => {
  const { stdout } = await silver('--version');
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('an unbuilt command names its phase and exits with the not-implemented code', async () => {
  const { code, stderr } = await silver('release', 'p5-template');
  assert.equal(code, NOT_IMPLEMENTED_EXIT);
  assert.match(stderr, /not built yet \(ACTIONS\.md phase 3\)/);
});

test('an unknown command fails with help', async () => {
  const { code, stderr } = await silver('paint');
  assert.equal(code, 1);
  assert.match(stderr, /unknown command 'paint'/);
});

test('a missing required argument fails', async () => {
  const { code, stderr } = await silver('ping');
  assert.equal(code, 1);
  assert.match(stderr, /missing required argument/);
});

test('silver config --check validates the shipped config', async () => {
  const { code, stdout } = await silver('config', '--check');
  assert.equal(code, 0);
  assert.equal(stdout.trim(), 'ok');
});

test('silver config --json prints the resolved config', async () => {
  const { code, stdout } = await silver('config', '--json');
  assert.equal(code, 0);
  const cfg = JSON.parse(stdout);
  assert.equal(cfg.series.variants, 12);
  assert.ok(cfg.paths.floor.endsWith('/floor'));
});

test('silver config prints a readable summary', async () => {
  const { code, stdout } = await silver('config');
  assert.equal(code, 0);
  assert.match(stdout, /12 variants = 3 models x 2 temps x 2 techniques/);
  assert.match(stdout, /^warhol\s+\S+\/\S+/m);
});
