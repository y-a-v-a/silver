import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMatrix, extractSketch, sketchVars, sample, ExtractError } from '../src/agents/studio.js';
import { runSeries, findSubject, SeriesError } from '../src/agents/assistants.js';
import { buildContactSheet } from '../src/tools/contact-sheet.js';
import { readSketchMeta } from '../src/tools/template.js';
import { tmpFactory, completion } from './helpers.js';
import shipped from '../silver.config.js';

const ASSISTANT_ROLE = await readFile(new URL('../roles/studio-assistant.md', import.meta.url), 'utf8');
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

// ---------- matrix ----------

test('sample draws n distinct items', () => {
  const s = sample(['a', 'b', 'c', 'd'], 3, seq(0.1, 0.9, 0.5));
  assert.equal(s.length, 3);
  assert.equal(new Set(s).size, 3);
});

test('buildMatrix: the shipped config makes 12 cells = 3 models x 2 temperatures x 2 techniques', () => {
  const m = buildMatrix(shipped, { rng: seq(0.3, 0.7, 0.1, 0.9) });
  assert.equal(m.cells.length, 12);
  assert.equal(m.models.length, 3);
  assert.equal(m.techniques.length, 2);
  assert.deepEqual(m.cells.map((c) => c.variant).slice(0, 3), ['v01', 'v02', 'v03']);
  const combos = new Set(m.cells.map((c) => `${c.technique}|${c.model}|${c.temperature}`));
  assert.equal(combos.size, 12, 'every cell is a distinct combination');
  for (const c of m.cells) {
    assert.ok(shipped.models.studio.includes(c.model));
    assert.ok(c.technique in shipped.techniques);
  }
});

test('buildMatrix: dry run uses the dry-run model and 2 variants; variants can be overridden', () => {
  const dry = buildMatrix(shipped, { dryRun: true });
  assert.equal(dry.cells.length, 2);
  assert.ok(dry.cells.every((c) => c.model === shipped.models.dryRun));
  const five = buildMatrix(shipped, { variants: 5 });
  assert.equal(five.cells.length, 5);
  const big = buildMatrix(shipped, { variants: 24 });
  assert.equal(big.cells[12].technique, big.cells[0].technique, 'the matrix repeats');
});

// ---------- extraction ----------

const GOOD = 'function setup() {\n  createCanvas(SILVER.width, SILVER.height);\n}\nfunction draw() { background(0); }';

test('extractSketch takes the largest fenced block', () => {
  assert.equal(extractSketch('```js\n' + GOOD + '\n```'), GOOD);
  assert.equal(extractSketch('Here you go:\n```javascript\n' + GOOD + '\n```\nEnjoy!\n```\nx\n```'), GOOD);
  assert.equal(extractSketch(GOOD), GOOD);
});

test('extractSketch pulls the inline script out of a whole HTML page', () => {
  const html = `\`\`\`html\n<html><head><script src="https://cdn/p5.js"></script></head><body><script>\n${GOOD}\n</script></body></html>\n\`\`\``;
  assert.equal(extractSketch(html), GOOD);
});

test('extractSketch accepts arrow/assigned setup and rejects the rest', () => {
  assert.ok(extractSketch('const setup = () => { createCanvas(10, 10); };'));
  assert.throws(() => extractSketch(''), ExtractError);
  assert.throws(() => extractSketch('I cannot draw that.'), /no setup\(\)/);
  assert.throws(() => extractSketch('```js\nfunction setup( { \n```'), /syntax error/);
});

// ---------- prompt variables ----------

test('sketchVars merges the human and Scout notes and falls back when things are missing', () => {
  const subject = {
    payload: { title: 'Brillo', why: 'Mine.', scoutWhy: 'Soap.', image: 'Stacked boxes.', snapshot: { snippet: 'A carton.', page: { description: 'Desc.', text: 'Body\ntext.' } } },
  };
  const vars = sketchVars({ subject, chatter: [{ actor: 'superstar.viva', payload: { text: 'Boring. Print it.' } }], cell: { technique: 'halftone' }, techniques: { halftone: 'Dots.' } });
  assert.equal(vars.subject_why, 'Mine. / Soap.');
  assert.equal(vars.subject_context, 'Desc.\n\nBody\ntext.\n\nA carton.');
  assert.equal(vars.floor_excerpt, '- superstar.viva: Boring. Print it.');
  assert.equal(vars.technique_guidance, 'Dots.');
  assert.equal(vars.width, '1080');
  const bare = sketchVars({ subject: { payload: { title: 'x', snapshot: {} } }, chatter: [], cell: { technique: 't' }, techniques: { t: 'g' } });
  assert.equal(bare.subject_why, '(no note)');
  assert.equal(bare.subject_context, '(only the title)');
  assert.match(bare.floor_excerpt, /quiet/);
});

// ---------- contact sheet ----------

test('buildContactSheet shows images, failures and the sensitive warning, escaped', () => {
  const html = buildContactSheet({
    seriesId: 'S1',
    subject: { id: 'X', title: 'Soup <b>', sensitive: { flag: true, reason: 'a death' } },
    variants: [
      { variant: 'v01', technique: 'halftone', model: 'a/b', temperature: 0.7, ok: true, html: 'v01.html', png: 'v01.png' },
      { variant: 'v02', technique: 'halftone', model: 'a/b', temperature: 1.1, ok: false, reason: 'blank', error: 'uniform' },
    ],
  });
  assert.match(html, /<title>Contact sheet: Soup &lt;b&gt;<\/title>/);
  assert.match(html, /1 of 2 produced/);
  assert.match(html, /<img src="v01\.png"/);
  assert.match(html, /<strong>blank<\/strong><span>uniform<\/span>/);
  assert.match(html, /Sensitive subject: a death/);
});

// ---------- the agent ----------

/** A fake renderer: sketches containing "BLANK" or "CRASH" fail; others write a stub PNG. */
function fakeRenderer() {
  const rendered = [];
  return {
    rendered,
    async render(path) {
      rendered.push(path);
      const code = await readFile(path, 'utf8');
      if (code.includes('CRASH')) return { ok: false, reason: 'error', shots: [], errors: ['ReferenceError: CRASH is not defined'], blocked: [], readySignal: false, ms: 5 };
      if (code.includes('BLANK')) return { ok: false, reason: 'blank', shots: [{ seed: 1, png: path.replace('.html', '.png'), blank: true }], errors: [], blocked: [], readySignal: true, ms: 5 };
      return { ok: true, reason: null, shots: [{ seed: 1, png: path.replace('.html', '.png'), blank: false, colors: 40, dominantShare: 0.2 }], errors: [], blocked: [], readySignal: true, ms: 5 };
    },
  };
}

const sketchReply = (marker = '') => completion('```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\nfunction draw(){ background(200); ' + marker + ' }\n```', { cost: 0.01 });

async function studioSetup(replyFor, { variants = 4, dailyUsd = 5 } = {}) {
  const f = await tmpFactory({ roles: { 'studio-assistant.md': ASSISTANT_ROLE }, replies: [], dailyUsd });
  // Replies are chosen per request (concurrency makes the order unpredictable).
  f.fetch.queue.push(...Array.from({ length: 50 }, () => (body) => replyFor(body)));
  const config = {
    ...f.config,
    models: { ...f.config.models, studio: ['test/text', 'test/vision'], dryRun: 'test/cheap' },
    series: { variants, modelsPerSeries: 2, temperatures: [0.7], techniquesPerSeries: 2, concurrency: 3 },
    techniques: { halftone: 'Dots.', 'grid-repeat': 'Grid.' },
  };
  const subject = await f.floor.append({
    type: 'subject.posted',
    actor: 'scout',
    payload: { origin: 'scouted', title: 'campbell soup', why: 'The can.', image: 'A can.', sensitive: { flag: false, reason: null }, snapshot: { snippet: 'Soup.', page: null } },
  });
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.brigid', ref: subject.id, payload: { text: 'Tomato, darling.' } });
  return { ...f, config, subject };
}

test('runSeries: every cell becomes an event; sketches, PNG paths and a contact sheet land in the archive', async () => {
  const f = await studioSetup(() => sketchReply());
  const renderer = fakeRenderer();
  const out = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer }, f.subject.id, { rng: seq(0.5) });

  assert.equal(out.results.length, 4);
  assert.ok(out.results.every((r) => r.ok));
  assert.equal(renderer.rendered.length, 4);

  const [started] = await f.floor.read({ type: 'series.started' });
  assert.equal(started.id, out.seriesId);
  assert.equal(started.payload.subjectId, f.subject.id);
  assert.equal(started.ref, f.subject.id);

  const produced = await f.floor.read({ type: 'variant.produced' });
  assert.equal(produced.length, 4);
  assert.ok(produced.every((e) => e.ref === out.seriesId && e.payload.rendered && e.payload.png.endsWith('.png')));

  const files = await readdir(out.dir);
  assert.deepEqual(files.filter((n) => n.endsWith('.html')).sort(), ['index.html', 'v01.html', 'v02.html', 'v03.html', 'v04.html']);
  const meta = readSketchMeta(await readFile(join(out.dir, 'v01.html'), 'utf8'));
  assert.equal(meta.series, out.seriesId);
  assert.equal(meta.subject.id, f.subject.id);

  const [done] = await f.floor.read({ type: 'series.completed' });
  assert.deepEqual(done.payload.produced, ['v01', 'v02', 'v03', 'v04']);
  assert.equal(done.payload.contactSheet, `archive/variants/${out.seriesId}/index.html`);

  // The prompt: role placeholders all filled, with the subject, technique and chatter.
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.doesNotMatch(system, /\{\{|\[(subject_\w+|technique\w*|floor_excerpt|width|height)\]/);
  assert.match(system, /\*\*campbell soup\*\*/);
  assert.match(system, /- superstar\.brigid: Tomato, darling\./);
  // Each cell is called with its own model and temperature, and linked to the series.
  const models = new Set(f.fetch.requests.map((r) => r.body.model));
  assert.deepEqual([...models].sort(), ['test/text', 'test/vision']);
  const costs = await f.floor.read({ type: 'cost.recorded' });
  assert.ok(costs.every((c) => c.ref === out.seriesId));
});

test('runSeries: failures at every stage are recorded, not dropped', async () => {
  let n = 0;
  const f = await studioSetup(() => {
    n++;
    if (n === 1) return { status: 400, body: { error: { code: 400, message: 'bad request' } } };
    if (n === 2) return completion('Sorry, I only write haiku.');
    if (n === 3) return sketchReply('CRASH');
    return sketchReply('BLANK');
  }, { variants: 4 });
  const out = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: fakeRenderer() }, f.subject.id, { concurrency: 1, rng: seq(0.5) });

  assert.deepEqual(out.results.map((r) => r.reason), ['llm', 'extract', 'error', 'blank']);
  const failed = await f.floor.read({ type: 'variant.failed' });
  assert.equal(failed.length, 4);
  assert.deepEqual(failed.map((e) => e.actor), ['studio-assistant', 'studio-assistant', 'renderer', 'renderer']);
  const extract = failed.find((e) => e.payload.stage === 'extract');
  assert.match(await readFile(join(f.root, extract.payload.reply), 'utf8'), /haiku/);
  const [done] = await f.floor.read({ type: 'series.completed' });
  assert.deepEqual(done.payload.produced, []);
  assert.equal(done.payload.failed.length, 4);
  assert.match(await readFile(join(out.dir, 'index.html'), 'utf8'), /0 of 4 produced/);
});

test('runSeries: an exhausted budget stops new work and records the unstarted cells', async () => {
  // Each call costs $0.01, but is reserved at its upper-bound estimate (~$0.017 with
  // max_tokens 8000), so a $0.03 cap lets one or two calls through, never all four.
  const f = await studioSetup(() => sketchReply(), { variants: 4, dailyUsd: 0.03 });
  const out = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: fakeRenderer() }, f.subject.id, { concurrency: 1, rng: seq(0.5) });
  const ok = out.results.filter((r) => r.ok).length;
  assert.ok(ok >= 1 && ok < 4, `produced ${ok}`);
  assert.ok(out.results.filter((r) => !r.ok).every((r) => r.reason === 'budget'));
  assert.match(out.stoppedEarly, /budget exhausted/);
  assert.equal((await f.floor.read({ type: 'variant.failed' })).length, 4 - ok);
  assert.equal((await f.floor.read({ type: 'cost.recorded' })).length, ok, 'no call is made past the cap');
  assert.equal((await f.floor.read({ type: 'series.completed' }))[0].payload.stoppedEarly, out.stoppedEarly);
});

test('runSeries without a renderer writes sketches and marks them unrendered', async () => {
  const f = await studioSetup(() => sketchReply(), { variants: 2 });
  const out = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: null }, 'latest', { rng: seq(0.5) });
  const produced = await f.floor.read({ type: 'variant.produced' });
  assert.ok(produced.every((e) => e.payload.rendered === false && e.payload.png === null));
  assert.equal(out.subject.id, f.subject.id);
});

test('runSeries --dry-run uses the dry-run model and 2 variants', async () => {
  const f = await studioSetup(() => sketchReply(), { variants: 4 });
  const out = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer: fakeRenderer() }, f.subject.id, { dryRun: true });
  assert.equal(out.results.length, 2);
  assert.ok(f.fetch.requests.every((r) => r.body.model === 'test/cheap'));
  assert.equal((await f.floor.read({ type: 'series.started' }))[0].payload.dryRun, true);
});

test('findSubject: full id, unique suffix, latest open subject, and clear errors', async () => {
  const f = await studioSetup(() => sketchReply());
  const other = await f.floor.append({ type: 'subject.posted', actor: 'human', payload: { origin: 'commission', title: 'mops' } });
  assert.equal((await findSubject(f.floor, f.subject.id)).id, f.subject.id);
  assert.equal((await findSubject(f.floor, f.subject.id.slice(-8).toLowerCase())).id, f.subject.id);
  assert.equal((await findSubject(f.floor, 'latest')).id, other.id);
  await f.floor.append({ type: 'series.started', actor: 'studio-assistant', payload: { subjectId: other.id } });
  assert.equal((await findSubject(f.floor, 'latest')).id, f.subject.id);
  await assert.rejects(findSubject(f.floor, 'ZZZZZZZZZZ'), (e) => e instanceof SeriesError && /no subject matches/.test(e.message));
});

// ---------- end to end in a real browser ----------

test('runSeries with the real renderer: real sketches become real PNGs', { skip: process.env.SILVER_SKIP_BROWSER ? 'SILVER_SKIP_BROWSER is set' : false, timeout: 60_000 }, async () => {
  const { createRenderer } = await import('../src/tools/render.js');
  const f = await studioSetup(
    (body) =>
      body.temperature === 0.7 && body.model === 'test/text'
        ? completion('```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); noLoop(); }\nfunction draw(){ background(220,30,40); for (let i=0;i<9;i++){ fill(random(255)); rect((i%3)*360+20, floor(i/3)*360+20, 320, 320); } }\n```')
        : completion('```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); background(0); noLoop(); }\n```'),
    { variants: 2 },
  );
  const renderer = await createRenderer({ timeoutMs: 10_000 });
  try {
    const out = await runSeries({ config: f.config, floor: f.floor, llm: f.llm, renderer }, f.subject.id, { rng: seq(0.5) });
    const reasons = out.results.map((r) => (r.ok ? 'ok' : r.reason)).sort();
    assert.deepEqual(reasons, ['blank', 'ok']);
    const ok = out.results.find((r) => r.ok);
    const png = await readFile(join(out.dir, ok.png));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  } finally {
    await renderer.close();
  }
});
