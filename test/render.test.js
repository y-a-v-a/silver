import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSketchHtml, readSketchMeta, P5_URL, P5_VERSION, TEMPLATE_VERSION, CANVAS } from '../src/tools/template.js';

// ---------- template (no browser) ----------

test('buildSketchHtml fills every token and pins p5', () => {
  const html = buildSketchHtml({ sketch: 'function setup(){ createCanvas(SILVER.width, SILVER.height); }', meta: { title: 'Soup (Double)', subject: { id: 'S1', title: 'campbell soup' } } });
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.match(html, /<title>Soup \(Double\)<\/title>/);
  assert.ok(html.includes(`<script src="${P5_URL}"></script>`));
  assert.match(P5_URL, /p5@1\.11\.13\/lib\/p5\.min\.js$/);
  assert.match(html, /width: 1080, height: 1080/);
  assert.match(TEMPLATE_VERSION, /^[0-9a-f]{10}$/);
});

test('metadata round-trips, including hostile strings', () => {
  const meta = { title: 'A </script> <!-- title --> & "quotes"', subject: { title: '<b>x</b>' }, model: 'a/b' };
  const html = buildSketchHtml({ sketch: 'let s = "</script>"; // <!-- x', meta });
  const back = readSketchMeta(html);
  assert.equal(back.title, meta.title);
  assert.equal(back.subject.title, '<b>x</b>');
  assert.equal(back.p5, P5_VERSION);
  assert.equal(back.template, TEMPLATE_VERSION);
  // Only the template's own closing tags remain: the sketch and meta cannot close <script> early.
  const scriptCloses = html.match(/<\/script>/gi).length;
  assert.equal(scriptCloses, 4); // meta json, p5, seed/ready helper, sketch
  // The title inside the header comment cannot end the comment early.
  const comment = html.slice(html.indexOf('<!--') + 4, html.indexOf('-->'));
  assert.ok(comment.includes('Silver Factory variant'));
  assert.ok(!comment.includes('--'), 'no "--" inside the comment');
});

test('sketch code containing template tokens is not re-expanded', () => {
  const html = buildSketchHtml({ sketch: 'const s = "{{TITLE}} {{SKETCH}}";', meta: { title: 'T' } });
  assert.match(html, /const s = "\{\{TITLE\}\} \{\{SKETCH\}\}";/);
});

test('buildSketchHtml rejects empty sketches and missing titles', () => {
  assert.throws(() => buildSketchHtml({ sketch: '  ', meta: { title: 't' } }), /sketch code/);
  assert.throws(() => buildSketchHtml({ sketch: 'x', meta: {} }), /meta\.title/);
});

// ---------- renderer (headless Chromium) ----------

const skip = process.env.SILVER_SKIP_BROWSER ? 'SILVER_SKIP_BROWSER is set' : false;
let renderer;
let dir;

before(async () => {
  if (skip) return;
  const { createRenderer } = await import('../src/tools/render.js');
  renderer = await createRenderer({ timeoutMs: 8000 });
  dir = await mkdtemp(join(tmpdir(), 'silver-render-'));
});
after(async () => renderer?.close());

async function variant(name, sketch) {
  const path = join(dir, `${name}.html`);
  await writeFile(path, buildSketchHtml({ sketch, meta: { title: name } }));
  return path;
}

const GRID = `
function setup() { createCanvas(SILVER.width, SILVER.height); noStroke(); }
function draw() {
  background(230);
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) {
    fill(random(255), random(255), random(255));
    rect(x * 180, y * 180, 170, 170);
  }
}`;

test('a good sketch renders a non-blank PNG of the canvas size', { skip, timeout: 30_000 }, async () => {
  const res = await renderer.render(await variant('grid', GRID));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.reason, null);
  assert.equal(res.readySignal, true);
  const png = await readFile(res.shots[0].png);
  assert.equal(png.readUInt32BE(16), CANVAS.width);
  assert.equal(png.readUInt32BE(20), CANVAS.height);
  assert.equal(res.shots[0].blank, false);
  assert.ok(res.shots[0].colors > 10);
});

test('the same seed renders the same image; another seed differs', { skip, timeout: 30_000 }, async () => {
  const path = await variant('seeded', GRID);
  const a = await renderer.render(path, { seeds: [1, 2] });
  const again = await renderer.render(path, { seeds: [1], pngPath: () => join(dir, 'seeded.again.png') });
  const [s1, s2, s1b] = await Promise.all([a.shots[0].png, a.shots[1].png, again.shots[0].png].map((p) => readFile(p)));
  assert.ok(s1.equals(s1b), 'seed 1 is reproducible');
  assert.ok(!s1.equals(s2), 'seed 2 differs');
});

test('Math.random is seeded too', { skip, timeout: 30_000 }, async () => {
  const sketch = `function setup(){ createCanvas(SILVER.width, SILVER.height); noLoop(); }
    function draw(){ background(Math.random()*255, Math.random()*255, Math.random()*255); fill(0); rect(100,100,400,400); }`;
  const path = await variant('mathrandom', sketch);
  const a = await renderer.render(path, { pngPath: () => join(dir, 'mr-a.png') });
  const b = await renderer.render(path, { pngPath: () => join(dir, 'mr-b.png') });
  assert.ok((await readFile(a.shots[0].png)).equals(await readFile(b.shots[0].png)));
});

test('errors, blank canvases and missing canvases are failures, with reasons', { skip, timeout: 45_000 }, async () => {
  const crash = await renderer.render(await variant('crash', 'function setup(){ createCanvas(100,100); undefinedThing(); }'));
  assert.equal(crash.ok, false);
  assert.equal(crash.reason, 'error');
  assert.match(crash.errors.join('\n'), /undefinedThing is not defined/);

  const blank = await renderer.render(await variant('blank', 'function setup(){ createCanvas(SILVER.width, SILVER.height); background(12); noLoop(); }'));
  assert.equal(blank.ok, false);
  assert.equal(blank.reason, 'blank');
  assert.equal(blank.shots[0].blank, true);

  const none = await renderer.render(await variant('nocanvas', 'function setup(){ noCanvas(); }'));
  assert.equal(none.ok, false);
  assert.match(none.reason, /no-canvas|timeout/);

  const syntax = await renderer.render(await variant('syntax', 'function setup( { createCanvas(10,10) }'));
  assert.equal(syntax.reason, 'error');
});

test('network requests are blocked and reported, not fatal', { skip, timeout: 30_000 }, async () => {
  const sketch = `function setup(){ createCanvas(SILVER.width, SILVER.height); fetch('https://example.com/x.json').catch(()=>{}); }
    function draw(){ background(200,0,0); ellipse(540,540,500); }`;
  const res = await renderer.render(await variant('net', sketch));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.blocked, ['https://example.com/x.json']);
});

test('a sketch without draw() still renders', { skip, timeout: 30_000 }, async () => {
  const sketch = 'function setup(){ createCanvas(SILVER.width, SILVER.height); background(255,220,0); fill(0); circle(540,540,600); }';
  const res = await renderer.render(await variant('nodraw', sketch));
  assert.equal(res.ok, true, JSON.stringify(res));
});
