import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { secondPull, nextVariant, pulled, PullError } from '../src/agents/pull.js';
import { findSeries } from '../src/agents/series-data.js';
import { buildSketchHtml, readSketchCode } from '../src/tools/template.js';
import { tmpFactory, seedSeries, completion } from './helpers.js';

const role = (name) => readFile(new URL(`../roles/${name}.md`, import.meta.url), 'utf8');
const ROLES = { 'studio-assistant.md': await role('studio-assistant'), 'second-pull.md': await role('second-pull') };
const SKETCH = '// WORK: A small horn.\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\nfunction draw(){ background(9); }';
const PULLED = '```js\n// WORK: A horn as big as the wall.\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\nfunction draw(){ background(200, 0, 0); }\n```';

function fakeRenderer() {
  const rendered = [];
  return {
    rendered,
    async render(path) {
      rendered.push(path);
      return { ok: true, reason: null, shots: [{ seed: 1, png: path.replace('.html', '.png'), blank: false, colors: 9 }], errors: [], blocked: [], readySignal: true, ms: 3 };
    },
  };
}

/** A seeded series whose v02 is a real built sketch, with Nico on the floor and Warhol's pick of v02. */
async function pullSetup(reply) {
  const f = await tmpFactory({ roles: ROLES, replies: [reply] });
  const config = { ...f.config, techniques: { halftone: 'Dots.', 'grid-repeat': 'Grid.' } };
  const s = await seedSeries(f);
  await writeFile(join(s.dir, 'v02.html'), buildSketchHtml({ sketch: SKETCH, meta: { title: 'campbell soup (v02)' } }));
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.nico', ref: s.subject.id, payload: { persona: 'nico', text: 'The can is a moon in a cold kitchen.' } });
  await f.floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: s.seriesId, payload: { seriesId: s.seriesId, subjectId: s.subject.id, picks: [{ variant: 'v02', note: 'The black one. Gee.', offTechnique: false }], rejects: null, shown: ['v01', 'v02', 'v03'] } });
  return { ...f, config, ...s };
}

test('nextVariant counts on from the highest variant', () => {
  assert.equal(nextVariant([{ variant: 'v01' }, { variant: 'v12' }, { variant: 'v04' }]), 'v13');
  assert.equal(nextVariant([]), 'v01');
});

test('readSketchCode gives back exactly the code that was built in, escapes undone', () => {
  const sketch = 'function setup(){ createCanvas(10, 10); }\n// a "</script>" and a <!-- in a comment\nfunction draw(){}';
  assert.equal(readSketchCode(buildSketchHtml({ sketch, meta: { title: 'x' } })), sketch);
  assert.equal(readSketchCode('<html>not a variant</html>'), null);
});

test("secondPull sends Warhol's first pick back to the same hand, with his note, the image and the code", async () => {
  const f = await pullSetup(completion(PULLED));
  const renderer = fakeRenderer();
  const r = await secondPull({ config: f.config, floor: f.floor, llm: f.llm, renderer }, f.seriesId);

  assert.equal(r.ok, true);
  assert.equal(r.variant, 'v05', 'after v01-v04, failed ones included');
  assert.equal(r.pullOf, 'v02');
  const p = r.event.payload;
  assert.equal(r.event.type, 'variant.produced');
  assert.equal(p.note, 'A horn as big as the wall.');
  assert.equal(p.warholNote, 'The black one. Gee.');
  assert.equal(p.technique, 'grid-repeat');
  assert.equal(p.png, `archive/variants/${f.seriesId}/v05.png`);
  assert.equal(renderer.rendered.length, 1);
  assert.match(readSketchCode(await readFile(join(f.dir, 'v05.html'), 'utf8')), /background\(200, 0, 0\)/);

  const body = f.fetch.requests[0].body;
  assert.equal(body.model, 'test/text', 'the model that made the first pull');
  assert.equal(body.temperature, 0.7);
  const system = body.messages[0].content;
  assert.match(system, /^You are the Studio assistant who made one of the works/);
  assert.match(system, /"The black one\. Gee\."/);
  assert.match(system, /You are a Studio assistant at the Silver Factory/, 'the first brief, as it was');
  assert.match(system, /\*\*campbell soup\*\*/);
  assert.match(system, /- superstar\.nico: The can is a moon in a cold kitchen\./);
  assert.match(system, /## Your procedure: grid-repeat\n\nGrid\./);
  assert.doesNotMatch(system, /\{\{|\[(warhol_note|first_brief|ready_frames|brief|dare)\]/);
  const user = body.messages.at(-1).content;
  assert.equal(user.filter((c) => c.type === 'image_url').length, 1);
  assert.ok(user.find((c) => c.type === 'text').text.includes(SKETCH), 'its own code');

  const series = await findSeries(f.floor, f.seriesId);
  assert.equal(pulled(series).get('v02').variant, 'v05');
  await assert.rejects(secondPull({ config: f.config, floor: f.floor, llm: f.llm, renderer }, f.seriesId), (e) => e instanceof PullError && /already has a second pull \(v05\)/.test(e.message));
});

test('a second pull that fails is recorded as a failed variant, and counts as pulled', async () => {
  const f = await pullSetup(completion('I would rather not.'));
  const r = await secondPull({ config: f.config, floor: f.floor, llm: f.llm, renderer: fakeRenderer() }, f.seriesId);
  assert.equal(r.ok, false);
  assert.equal(r.event.type, 'variant.failed');
  assert.equal(r.event.payload.stage, 'extract');
  assert.equal(r.event.payload.pullOf, 'v02');
  assert.ok(pulled(await findSeries(f.floor, f.seriesId)).has('v02'));
});

test('secondPull needs a shortlist pick with a rendered first pull', async () => {
  const f = await tmpFactory({ roles: ROLES });
  const s = await seedSeries(f);
  await assert.rejects(secondPull({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.seriesId), /no shortlist pick/);
  await assert.rejects(secondPull({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.seriesId, { variant: 'v04' }), /no rendered first pull/);
  await assert.rejects(secondPull({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, s.seriesId, { variant: 'v01' }), /could not read the sketch/);
});
