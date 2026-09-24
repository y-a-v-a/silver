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
import { mockOpenRouter, roleFile } from './helpers.js';
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
  assert.equal(rows.length, shipped.models.studio.length + Object.keys(shipped.models.roles).length + 1);
  assert.equal(rows[0].promptPerM, 1);
  assert.equal(rows[0].completionPerM, 2);
});

test('missing models and text-only image roles are problems', async () => {
  const list = allShipped().filter((m) => m.id !== shipped.models.studio[1]);
  const warhol = list.findIndex((m) => m.id === shipped.models.roles.warhol);
  list[warhol] = model(shipped.models.roles.warhol, { vision: false });
  const { problems } = await auditModels(shipped, [], lookupFrom(list));
  assert.ok(problems.some((p) => p.includes(`studio: "${shipped.models.studio[1]}" is not on OpenRouter`)));
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

// ---------- CLI ----------

let mock;
before(async () => {
  mock = await mockOpenRouter({ models: allShipped() });
});
after(() => mock.close());

async function silver(args) {
  const root = await mkdtemp(join(tmpdir(), 'silver-models-'));
  await mkdir(join(root, 'roles'), { recursive: true });
  await writeFile(join(root, 'roles', 'technician.md'), roleFile('technician'));
  try {
    const r = await exec(process.execPath, [CLI, ...args], { env: { ...process.env, SILVER_ROOT: root, OPENROUTER_BASE_URL: mock.baseUrl } });
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
});

test('silver models exits 1 and names the problem', async () => {
  mock.state.models = allShipped().filter((m) => m.id !== shipped.models.dryRun);
  const r = await silver(['models', '--json']);
  assert.equal(r.code, 1);
  const { problems } = JSON.parse(r.stdout);
  assert.ok(problems.some((p) => p.startsWith('dry-run:')));
});
