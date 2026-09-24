import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { releaseTool, gitChanges, toolVersion, aboutTool, TOOLS, ReleaseError } from '../src/agents/technician.js';
import { tmpFactory, completion } from './helpers.js';

const TECH_ROLE = await readFile(new URL('../roles/technician.md', import.meta.url), 'utf8');

async function setup(replies) {
  const f = await tmpFactory({ roles: { 'technician.md': TECH_ROLE }, replies });
  await mkdir(join(f.root, 'src/tools'), { recursive: true });
  await writeFile(join(f.root, TOOLS.renderer), '// The template.\n// Seeds things.\nexport const v = 1;\n');
  return f;
}

test('toolVersion is a short content hash', async () => {
  const f = await setup([]);
  const v = await toolVersion(join(f.root, TOOLS.renderer));
  assert.match(v, /^[0-9a-f]{10}$/);
});

test('gitChanges returns commit subjects, or empty when git fails', async () => {
  const run = async (cmd, args) => ({ stdout: `abc1234 Seed Math.random too\n${args.join(' ')}\n` });
  assert.match(await gitChanges('/x', 'src/tools/p5-template.html', { run }), /^abc1234 Seed Math\.random too\nlog -5 --format=%h %s -- src\/tools\/p5-template\.html$/);
  assert.equal(await gitChanges('/x', 'f', { run: async () => { throw new Error('not a repo'); } }), '');
});

test('releaseTool posts the Technician note as tool.released, and refuses a repeat', async () => {
  const f = await setup([completion('Template now seeds Math.random. Use random() anyway.'), completion('Second note.')]);
  const run = async () => ({ stdout: 'abc1234 Seed Math.random too\n' });
  const deps = { config: f.config, floor: f.floor, llm: f.llm, run };

  const first = await releaseTool(deps, 'renderer');
  assert.equal(first.type, 'tool.released');
  assert.equal(first.actor, 'technician');
  assert.equal(first.payload.previous, null);
  assert.equal(first.payload.note, 'Template now seeds Math.random. Use random() anyway.');
  assert.equal(first.payload.changes, 'abc1234 Seed Math.random too');
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, /Tool: renderer \(src\/tools\/render\.js\), version [0-9a-f]{10}, first release/);
  assert.match(system, /What changed:\nabc1234 Seed Math\.random too/);
  assert.match(system, /from its own header:\nThe template\.\nSeeds things\./);

  await assert.rejects(releaseTool(deps, 'renderer'), (e) => e instanceof ReleaseError && /already released/.test(e.message));

  await writeFile(join(f.root, TOOLS.renderer), '// v2\n');
  const second = await releaseTool(deps, 'renderer', { changes: 'Bigger canvas.' });
  assert.equal(second.payload.previous, first.payload.version);
  assert.equal(second.ref, first.id);
  assert.equal(second.payload.changes, 'Bigger canvas.');
});

test('releaseTool rejects unknown tools', async () => {
  const f = await setup([]);
  await assert.rejects(releaseTool({ config: f.config, floor: f.floor, llm: f.llm }, 'hammer'), /unknown tool "hammer"/);
});

test('aboutTool reads the leading // block or the first HTML comment', async () => {
  assert.equal(aboutTool('// The renderer.\n// Loads variants.\nimport x from "y";\n// not this'), 'The renderer.\nLoads variants.');
  assert.equal(aboutTool('<!doctype html>\n<!--\n  Header line.\n-->\n<p>'), 'Header line.');
  assert.equal(aboutTool('const x = 1;'), '');
  const real = aboutTool(await readFile(new URL('../src/tools/render.js', import.meta.url), 'utf8'));
  assert.match(real, /^The Technician's renderer: loads a variant in headless Chromium/);
});

test('the template has a written description, since its first comment is the variant header', async () => {
  const f = await tmpFactory({ roles: { 'technician.md': TECH_ROLE }, replies: [completion('ok')] });
  await mkdir(join(f.root, 'src/tools'), { recursive: true });
  await writeFile(join(f.root, TOOLS['p5-template']), '<!doctype html>\n<!--\n  Silver Factory variant: {{TITLE}}\n-->');
  await releaseTool({ config: f.config, floor: f.floor, llm: f.llm, run: async () => ({ stdout: '' }) }, 'p5-template');
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, /from its own header:\nThe HTML page every variant is built into/);
  assert.doesNotMatch(system, /\{\{TITLE\}\}/);
  assert.match(system, /What changed:\n\(no change log available\)/);
});
