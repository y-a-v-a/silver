import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpFactory, seedSeries } from './helpers.js';
import { createReviewServer } from '../src/tools/review/server.js';
import { recordDecision, closeReview, ReviewError } from '../src/agents/review.js';
import { listSeries } from '../src/agents/series-data.js';
import { readTaste } from '../src/lib/taste.js';
import { indexPage, seriesPage, fileUrl, esc } from '../src/tools/review/pages.js';

let f;
let series;
let review;
let base;

before(async () => {
  f = await tmpFactory();
  series = await seedSeries(f, { subject: { sensitive: { flag: true, reason: 'a crash' } } });
  await f.floor.append({
    type: 'shortlist.proposed',
    actor: 'warhol',
    ref: series.seriesId,
    payload: { seriesId: series.seriesId, subjectId: series.subject.id, picks: [{ variant: 'v02', note: 'Gee, a can.', offTechnique: true }], rejects: 'Too busy.' },
  });
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.brigid', ref: series.subject.id, payload: { text: 'Tomato <b>darling</b>.' } });
  review = createReviewServer({ config: f.config, floor: f.floor });
  base = await review.listen(0);
});
after(() => review.close());

const post = (path, form, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, ...headers }, body: new URLSearchParams(form) });

// ---------- pages ----------

test('esc and fileUrl', () => {
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(fileUrl('archive/variants/S1/v01.png'), '/files/S1/v01.png');
});

test('the index lists the pending series with Warhol status', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Waiting for review \(1\)/);
  assert.match(html, new RegExp(`<a href="/series/${series.seriesId}">campbell soup</a> <span class="warn">sensitive</span>`));
  assert.match(html, /<td>3\/4<\/td><td>1 picked<\/td>/);
});

test('a series page shows picks first, notes, badges, chatter (escaped), failures and forms', async () => {
  const html = await (await fetch(`${base}/series/${series.seriesId}`)).text();
  assert.match(html, /Sensitive subject: a crash\. Look twice before approving\./);
  assert.match(html, /judged here, case by case/);
  assert.ok(html.indexOf('id="v02"') < html.indexOf('id="v01"'), "Warhol's pick comes first");
  assert.match(html, /<span class="badge pick">Warhol #1<\/span><span class="badge off">off technique<\/span>/);
  assert.match(html, /Warhol: Gee, a can\./);
  assert.match(html, /The rest: Too busy\./);
  assert.match(html, /Tomato &lt;b&gt;darling&lt;\/b&gt;\./);
  assert.match(html, /<strong>v04<\/strong> halftone · test\/text: blank/);
  assert.equal((html.match(/<form class="decide"/g) ?? []).length, 3, 'one form per produced variant');
  assert.match(html, new RegExp(`src="/files/${series.seriesId}/v01\\.png"`));
});

test('unknown series and paths are 404', async () => {
  assert.equal((await fetch(`${base}/series/NOPE`)).status, 404);
  assert.equal((await fetch(`${base}/nothing`)).status, 404);
});

// ---------- files ----------

test('archived files are served; nothing outside archive/variants is', async () => {
  const png = await fetch(`${base}/files/${series.seriesId}/v01.png`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  for (const bad of ['/files/..%2F..%2Ftaste.md', '/files/%2E%2E/%2E%2E/package.json', `/files/${series.seriesId}/..%2F..%2F..%2Ffloor`, `/files/${series.seriesId}/v01.exe`]) {
    assert.equal((await fetch(base + bad)).status, 404, bad);
  }
});

// ---------- decisions ----------

test('approving through the form records review.decision and a taste.md line, then redirects back', async () => {
  const res = await post(`/series/${series.seriesId}/decide`, { variant: 'v02', verdict: 'approved', note: 'Yes. Flat.' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), new RegExp(`^/series/${series.seriesId}\\?done=v02%20approved\\.#v02$`));
  const [decision] = await f.floor.read({ type: 'review.decision' });
  assert.equal(decision.actor, 'human');
  assert.deepEqual(
    { variant: decision.payload.variant, verdict: decision.payload.verdict, note: decision.payload.note, picked: decision.payload.pickedByWarhol, warholNote: decision.payload.warholNote },
    { variant: 'v02', verdict: 'approved', note: 'Yes. Flat.', picked: true, warholNote: 'Gee, a can.' },
  );
  const { entries } = await readTaste(f.config.paths.taste);
  assert.match(entries.at(-1), /· approved · v02 \(grid-repeat\) · "campbell soup" · Warhol's pick: Yes\. Flat\.$/);
  const page = await (await fetch(`${base}${res.headers.get('location')}`)).text();
  assert.match(page, /<p class="flash" role="status">v02 approved\.<\/p>/);
  assert.match(page, /class="card pick approved" id="v02"/);
});

test('a variant Warhol did not pick can be approved too (the veto works both ways)', async () => {
  await post(`/series/${series.seriesId}/decide`, { variant: 'v03', verdict: 'approved' });
  const d = (await f.floor.read({ type: 'review.decision' })).at(-1);
  assert.equal(d.payload.variant, 'v03');
  assert.equal(d.payload.pickedByWarhol, false);
});

test('invalid decisions redirect back with an error and record nothing', async () => {
  const before = (await f.floor.read({ type: 'review.decision' })).length;
  for (const [form, pattern] of [
    [{ variant: 'v04', verdict: 'approved' }, /v04 failed \(blank\)/],
    [{ variant: 'v99', verdict: 'approved' }, /has no variant "v99"/],
    [{ variant: 'v01', verdict: 'maybe' }, /verdict must be one of/],
    [{ variant: 'v01', verdict: 'vetoed', note: 'x'.repeat(1001) }, /at most 1000 characters/],
  ]) {
    const res = await post(`/series/${series.seriesId}/decide`, form);
    assert.equal(res.status, 303);
    assert.match(decodeURIComponent(res.headers.get('location')), pattern);
  }
  assert.equal((await f.floor.read({ type: 'review.decision' })).length, before);
});

test('cross-site form posts are refused', async () => {
  const res = await post(`/series/${series.seriesId}/decide`, { variant: 'v01', verdict: 'vetoed' }, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  const sneaky = await fetch(`${base}/series/${series.seriesId}/decide`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'cross-site' },
    body: 'variant=v01&verdict=vetoed',
  });
  assert.equal(sneaky.status, 403);
});

test('oversized bodies are rejected', async () => {
  const res = await post(`/series/${series.seriesId}/decide`, { variant: 'v01', verdict: 'vetoed', note: 'x'.repeat(20_000) });
  assert.equal(res.status, 413);
});

test('closing a review moves it off the pending list; closing twice is an error', async () => {
  const res = await post(`/series/${series.seriesId}/close`, {});
  assert.equal(res.status, 303);
  assert.match(decodeURIComponent(res.headers.get('location')), /Closed the review of "campbell soup"/);
  const html = await (await fetch(base)).text();
  assert.match(html, /Waiting for review \(0\)/);
  assert.match(html, /Recently closed/);
  const again = await post(`/series/${series.seriesId}/close`, {});
  assert.match(decodeURIComponent(again.headers.get('location')), /already closed/);
});

// ---------- the agent, directly ----------

test('recordDecision and closeReview validate without the server', async () => {
  const g = await tmpFactory();
  await seedSeries(g);
  const [view] = await listSeries(g.floor);
  await assert.rejects(recordDecision({ config: g.config, floor: g.floor }, view, { variant: 'v01', verdict: 'nope' }), ReviewError);
  const { event: e } = await recordDecision({ config: g.config, floor: g.floor }, view, { variant: 'v01', verdict: 'vetoed' });
  assert.equal(e.payload.pickedByWarhol, false, 'no shortlist yet');
  await closeReview({ floor: g.floor }, view);
  const [closed] = await listSeries(g.floor);
  await assert.rejects(closeReview({ floor: g.floor }, closed), /already closed/);
  assert.match(await readFile(g.config.paths.taste, 'utf8'), /· vetoed · v01 \(halftone\)/);
});

test('page builders work on bare views (no subject, no shortlist)', async () => {
  const g = await tmpFactory();
  await seedSeries(g, { produced: [], failed: [] });
  const views = await listSeries(g.floor);
  views[0].subject = null;
  assert.match(indexPage(views), /\(unknown subject\)|campbell soup/);
  assert.match(seriesPage(views[0]), /Warhol hasn't looked at this series yet/);
});

test('the same decision twice (double click, resubmit) is recorded once; a changed note or verdict is new', async () => {
  const g = await tmpFactory();
  await seedSeries(g);
  const deps = { config: g.config, floor: g.floor };
  const view = async () => (await listSeries(g.floor))[0];
  const first = await recordDecision(deps, await view(), { variant: 'v01', verdict: 'approved', note: 'yes' });
  const again = await recordDecision(deps, await view(), { variant: 'v01', verdict: 'approved', note: ' yes ' });
  assert.equal(again.duplicate, true);
  assert.equal(again.event.id, first.event.id);
  assert.equal((await g.floor.read({ type: 'review.decision' })).length, 1);
  assert.equal((await readTaste(g.config.paths.taste)).entries.length, 1);
  assert.equal((await recordDecision(deps, await view(), { variant: 'v01', verdict: 'approved', note: 'changed my mind, still yes' })).duplicate, false);
  assert.equal((await recordDecision(deps, await view(), { variant: 'v01', verdict: 'vetoed', note: 'changed my mind, still yes' })).duplicate, false);
  assert.equal((await g.floor.read({ type: 'review.decision' })).length, 3);
});

test('a double-clicked form says "already recorded"', async () => {
  const g = await tmpFactory();
  const { seriesId } = await seedSeries(g);
  const srv = createReviewServer({ config: g.config, floor: g.floor });
  const url = await srv.listen(0);
  try {
    const send = () => fetch(`${url}/series/${seriesId}/decide`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: url }, body: 'variant=v01&verdict=approved' });
    await send();
    const second = await send();
    assert.match(decodeURIComponent(second.headers.get('location')), /v01 approved \(already recorded\)\./);
    assert.equal((await g.floor.read({ type: 'review.decision' })).length, 1);
  } finally {
    await srv.close();
  }
});
