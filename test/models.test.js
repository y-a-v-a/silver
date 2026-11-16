import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditModels, VISION_ROLES } from '../src/model-audit.js';
import { toModelInfo } from '../src/pricing.js';
import { mockAnthropic, mockOpenRouter, roleFile } from './helpers.js';
import shipped from '../silver.config.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

const model = (id, { vision = true, prompt = '0.000001', completion = '0.000002' } = {}) => ({
  id,
  pricing: { prompt, completion },
  architecture: { input_modalities: vision ? ['text', 'image'] : ['text'] },
});

/** Every model the shipped config names, all vision-capable. */
const allShipped = () =>
  [...new Set([...shipped.models.studio, ...Object.values(shipped.models.roles), shipped.models.dryRun])].map((id) => model(id));

const lookupFrom = (list) => {
  const map = new Map(list.map((m) => [m.id, toModelInfo(m)]));
  return async (id) => map.get(id) ?? null;
};

test('warhol and printer are the roles that always need images', () => {
  assert.deepEqual([...VISION_ROLES], ['warhol', 'printer']);
});

test('a complete catalogue passes, with prices per million tokens', async () => {
  const { rows, problems } = await auditModels(shipped, [], lookupFrom(allShipped()));
  assert.deepEqual(problems, []);
  const fallbacks = Object.values(shipped.models.fallbacks ?? {}).flat().length;
  assert.equal(rows.length, shipped.models.studio.length + Object.keys(shipped.models.roles).length + 1 + fallbacks);
  if (fallbacks) assert.match(rows.at(-1).use, /^fallback for /);
  assert.equal(rows[0].promptPerM, 1);
  assert.equal(rows[0].completionPerM, 2);
});

test('missing models and text-only image roles are problems', async () => {
  // A studio model that no role uses, so dropping it only hits the studio row.
  const studioOnly = shipped.models.studio.find((m) => !Object.values(shipped.models.roles).includes(m));
  const list = allShipped().filter((m) => m.id !== studioOnly);
  const warhol = list.findIndex((m) => m.id === shipped.models.roles.warhol);
  list[warhol] = model(shipped.models.roles.warhol, { vision: false });
  const { problems } = await auditModels(shipped, [], lookupFrom(list));
  assert.ok(problems.some((p) => p.includes(`studio: "${studioOnly}" is not on OpenRouter`)));
  assert.ok(problems.some((p) => /role warhol: .* cannot take images/.test(p)));
});

test('role files that set a model or need vision are audited too', async () => {
  const roles = [
    { id: 'brigid', group: 'superstar', file: 'superstars/brigid.md', model: 'x/custom', vision: false },
    { id: 'scout', group: 'role', file: 'scout.md', vision: true },
    { id: 'archivist', group: 'role', file: 'archivist.md', vision: false }, // nothing special: skipped
  ];
  const list = [...allShipped().filter((m) => m.id !== shipped.models.roles.scout), model(shipped.models.roles.scout, { vision: false })];
  const { rows, problems } = await auditModels(shipped, roles, lookupFrom(list));
  assert.ok(rows.some((r) => r.use === 'file superstars/brigid.md' && r.model === 'x/custom' && !r.exists));
  assert.ok(problems.some((p) => /file scout\.md: .* cannot take images/.test(p)));
  assert.ok(!rows.some((r) => r.use === 'file archivist.md'));
});

test('with an Anthropic key, Claude models are checked on the direct line too', async () => {
  const claude = [...new Set([...shipped.models.studio, ...Object.values(shipped.models.roles)])].filter((m) => m.startsWith('anthropic/'));
  assert.ok(claude.length >= 2, 'the shipped config casts Claude models');
  const asked = [];
  const direct = (known) => async (m) => (asked.push(m), known(m));

  let { rows, problems } = await auditModels(shipped, [], lookupFrom(allShipped()), { direct: direct(() => true) });
  assert.deepEqual(problems, []);
  assert.deepEqual(asked.sort(), [...claude].sort(), 'each Claude model is asked about once, and no other model');
  for (const r of rows) assert.equal(r.line, r.model.startsWith('anthropic/') ? 'anthropic' : 'openrouter', r.model);

  // A model Anthropic doesn't know still runs (through OpenRouter), which is exactly what the key was meant to avoid.
  ({ problems } = await auditModels(shipped, [], lookupFrom(allShipped()), { direct: direct((m) => m !== shipped.models.roles.warhol) }));
  assert.ok(problems.length >= 1);
  assert.match(problems.find((p) => p.startsWith('role warhol:')), /Anthropic has no model "claude-opus-5-5" \(from "anthropic\/claude-opus-5\.5"\), so these calls will fall back to OpenRouter/);

  // Couldn't ask (offline, a key without that permission): no verdict, no problem.
  ({ problems } = await auditModels(shipped, [], lookupFrom(allShipped()), { direct: direct(() => null) }));
  assert.deepEqual(problems, []);

  // No key: everything is on OpenRouter's line.
  ({ rows } = await auditModels(shipped, [], lookupFrom(allShipped())));
  assert.ok(rows.every((r) => r.line === 'openrouter'));
});

// ---------- CLI ----------

let mock;
before(async () => {
  mock = await mockOpenRouter({ models: allShipped() });
});
after(() => mock.close());

async function silver(args, env = {}) {
  const root = await mkdtemp(join(tmpdir(), 'silver-models-'));
  await mkdir(join(root, 'roles'), { recursive: true });
  await writeFile(join(root, 'roles', 'technician.md'), roleFile('technician'));
  try {
    const r = await exec(process.execPath, [CLI, ...args], { env: { ...process.env, SILVER_ROOT: root, OPENROUTER_BASE_URL: mock.baseUrl, ANTHROPIC_API_KEY: '', ...env } });
    return { code: 0, ...r };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

test('silver models prints the table and passes on a complete catalogue', async () => {
  mock.state.models = allShipped();
  const r = await silver(['models']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^use\s+model\s+found\s+images\s+\$\/M in\s+\$\/M out/);
  assert.match(r.stdout, /role warhol\s+\S+\s+yes\s+yes\s+1\.00\s+2\.00/);
  assert.match(r.stdout, /all models found/);
  assert.match(r.stdout, /no ANTHROPIC_API_KEY: Claude models run through OpenRouter too/);
});

test('silver models asks Anthropic about the Claude models when its key is set', async () => {
  mock.state.models = allShipped();
  const anthropic = await mockAnthropic({ models: ['claude-sonnet-5-5', 'claude-sonnet-5'] });
  try {
    const r = await silver(['models'], { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: anthropic.baseUrl });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /role warhol\s+anthropic\/claude-opus-5\.5\s+.*\s+anthropic\n/);
    assert.match(r.stdout, /role scout\s+\S+\s+.*\s+openrouter\n/);
    assert.match(r.stdout, /problem: role warhol: Anthropic has no model "claude-opus-5-5"/);
    assert.doesNotMatch(r.stdout, /Anthropic has no model "claude-sonnet-5"/);
    assert.doesNotMatch(r.stdout, /no ANTHROPIC_API_KEY/);
  } finally {
    await anthropic.close();
  }
});

test('silver models exits 1 and names the problem', async () => {
  mock.state.models = allShipped().filter((m) => m.id !== shipped.models.dryRun);
  const r = await silver(['models', '--json']);
  assert.equal(r.code, 1);
  const { problems } = JSON.parse(r.stdout);
  assert.ok(problems.some((p) => p.startsWith('dry-run:')));
});
