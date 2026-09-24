import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFloor } from '../src/floor.js';
import { postCommission, pendingCommissions, isUrl, CommissionError, MAX_COMMISSION_CHARS, annotateCommission } from '../src/agents/commissions.js';
import { readFile } from 'node:fs/promises';
import { routeFetch, tmpFactory, completion } from './helpers.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const PAGE = '<html><head><meta property="og:title" content="Brillo Box, 1964"><meta name="description" content="A soap pad carton."></head><body><article><p>Stacks of them.</p></article></body></html>';
const htmlRoute = () => new Response(PAGE, { headers: { 'content-type': 'text/html' } });

const newFloor = async () => createFloor({ dir: await mkdtemp(join(tmpdir(), 'silver-comm-')) });

test('isUrl only accepts a bare http(s) URL', () => {
  assert.ok(isUrl('https://example.com/a?b=1'));
  assert.ok(isUrl('  http://x.org  '));
  assert.ok(!isUrl('see https://example.com'));
  assert.ok(!isUrl('ftp://x.org'));
});

test('a text commission is its own subject, posted by the human', async () => {
  const floor = await newFloor();
  const { event, repeatOf } = await postCommission({ floor }, '  The queue outside the new phone shop  ', { why: 'Everyone waits for the same box.' });
  assert.equal(repeatOf, null);
  assert.equal(event.type, 'subject.posted');
  assert.equal(event.actor, 'human');
  assert.deepEqual(
    { origin: event.payload.origin, source: event.payload.source, title: event.payload.title, url: event.payload.url, why: event.payload.why },
    { origin: 'commission', source: 'commission', title: 'The queue outside the new phone shop', url: null, why: 'Everyone waits for the same box.' },
  );
  assert.equal(event.payload.snapshot.snippet, 'The queue outside the new phone shop');
});

test('long text is clipped for the title but kept whole in the snapshot', async () => {
  const text = 'soup '.repeat(100).trim();
  const { event } = await postCommission({ floor: await newFloor() }, text);
  assert.ok(event.payload.title.length <= 140);
  assert.equal(event.payload.snapshot.snippet, text);
});

test('a URL commission is snapshotted; a failed snapshot keeps the URL as the title', async () => {
  const floor = await newFloor();
  const fetch = routeFetch({ 'https://example.com/brillo': htmlRoute });
  const { event } = await postCommission({ floor, fetch }, 'https://example.com/brillo');
  assert.equal(event.payload.title, 'Brillo Box, 1964');
  assert.equal(event.payload.url, 'https://example.com/brillo');
  assert.equal(event.payload.snapshot.snippet, 'A soap pad carton.');
  assert.equal(event.payload.snapshot.page.text, 'Stacks of them.');
  assert.equal(event.payload.why, null);

  const { event: dead } = await postCommission({ floor, fetch }, 'https://example.com/gone');
  assert.equal(dead.payload.title, 'https://example.com/gone');
  assert.equal(dead.payload.snapshot.page.error, 'HTTP 404');
});

test('repeating an earlier subject is allowed, reported, and linked by ref', async () => {
  const floor = await newFloor();
  const scouted = await floor.append({
    type: 'subject.posted',
    actor: 'scout',
    payload: { origin: 'scouted', title: 'Electric chair museum reopens', url: 'https://news.example.com/chair' },
  });
  const { event, repeatOf } = await postCommission({ floor }, 'Electric Chair Museum Reopens');
  assert.equal(repeatOf.id, scouted.id);
  assert.equal(event.ref, scouted.id);
  assert.equal((await floor.read({ type: 'subject.posted' })).length, 2);
});

test('empty and oversized commissions are refused', async () => {
  const floor = await newFloor();
  await assert.rejects(postCommission({ floor }, '   '), CommissionError);
  await assert.rejects(postCommission({ floor }, 'x'.repeat(MAX_COMMISSION_CHARS + 1)), /at most/);
});

test('pendingCommissions lists commissions without a series, ignoring scouted subjects', async () => {
  const floor = await newFloor();
  const { event: a } = await postCommission({ floor }, 'First commission here');
  const { event: b } = await postCommission({ floor }, 'Second commission here');
  await floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'Scouted thing here' } });
  await floor.append({ type: 'series.started', actor: 'assistant', payload: { subjectId: a.id } });
  assert.deepEqual((await pendingCommissions(floor)).map((e) => e.id), [b.id]);
});

// ---------- CLI ----------

let server;
let pageUrl;
before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  pageUrl = `http://127.0.0.1:${server.address().port}/brillo`;
});
after(() => new Promise((r) => server.close(r)));

async function silver(root, args) {
  try {
    // No API key: annotation fails fast and offline. Never inherit the real key in tests.
    const r = await exec(process.execPath, [CLI, ...args], { env: { ...process.env, SILVER_ROOT: root, OPENROUTER_API_KEY: '' } });
    return { code: 0, ...r };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

test('silver commission posts text and URLs, lists pending ones, and explains --now', async () => {
  const root = await mkdtemp(join(tmpdir(), 'silver-comm-cli-'));
  let r = await silver(root, ['commission', 'Twelve identical parking tickets', '--why', 'Paper everyone gets.']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^commissioned: Twelve identical parking tickets\n {2}subject [0-9A-Z]{26}/);
  assert.match(r.stderr, /queued: it gets a series in the next shift/);
  assert.match(r.stderr, /could not annotate it \(LlmError: OPENROUTER_API_KEY is not set/);

  r = await silver(root, ['commission', pageUrl, '--now']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /commissioned: Brillo Box, 1964\n.*\n {2}snapshot: text\/html, 15 chars of text/);
  assert.match(r.stderr, /--now needs OPENROUTER_API_KEY; the commission is queued/);

  r = await silver(root, ['commission', 'twelve identical parking tickets']);
  assert.match(r.stderr, /note: this repeats [0-9A-Z]{26}/);

  r = await silver(root, ['commission', '--list']);
  assert.equal(r.stdout.trim().split('\n').length, 3);

  r = await silver(root, ['commission', 'A pallet of identical mops', '--no-annotate']);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /could not annotate/);

  r = await silver(root, ['commission']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^silver: give the commission as text or a URL/);
});

// ---------- the Scout's annotation ----------

const ANNOTATE_ROLE = await readFile(new URL('../roles/scout-annotate.md', import.meta.url), 'utf8');

test('the Scout annotates a commission without touching the human why', async () => {
  const reply = JSON.stringify({ why: 'A soap pad box everyone has seen.', image: 'A stack of cartons, printed flat.', sensitive: { flag: false } });
  const f = await tmpFactory({ roles: { 'scout-annotate.md': ANNOTATE_ROLE }, replies: [completion(reply)] });
  const fetch = routeFetch({ 'https://example.com/brillo': htmlRoute });
  const { event, annotation } = await postCommission({ floor: f.floor, fetch, llm: f.llm }, 'https://example.com/brillo', { why: 'Mine.' });

  assert.equal(annotation.ok, true);
  const p = event.payload;
  assert.equal(p.why, 'Mine.');
  assert.equal(p.scoutWhy, 'A soap pad box everyone has seen.');
  assert.equal(p.image, 'A stack of cartons, printed flat.');
  assert.deepEqual(p.sensitive, { flag: false, reason: null });
  assert.equal(p.annotation.callId, annotation.callId);

  const req = f.fetch.requests[0].body;
  assert.equal(req.model, 'test/text'); // model_role: scout
  const system = req.messages[0].content;
  assert.match(system, /Title: Brillo Box, 1964/);
  assert.match(system, /The human's own note: Mine\./);
  assert.match(system, /A soap pad carton\.\n\nStacks of them\./);
  assert.doesNotMatch(system, /\{\{/);
});

test('a text commission gives the Scout its text; a sensitive flag is kept', async () => {
  const reply = JSON.stringify({ why: 'x', image: 'y', sensitive: { flag: true, reason: 'a death' } });
  const f = await tmpFactory({ roles: { 'scout-annotate.md': ANNOTATE_ROLE }, replies: [completion(reply)] });
  const { event } = await postCommission({ floor: f.floor, llm: f.llm }, 'The funeral of a famous singer, on every channel');
  assert.deepEqual(event.payload.sensitive, { flag: true, reason: 'a death' });
  assert.equal(event.payload.why, null);
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.match(system, /URL: \(none: a text commission\)/);
  assert.match(system, /What the page or text says:\nThe funeral of a famous singer, on every channel/);
});

test('a failed annotation never blocks the commission', async () => {
  const f = await tmpFactory({ roles: { 'scout-annotate.md': ANNOTATE_ROLE }, replies: [completion('not json'), completion('still not')] });
  const { event, annotation } = await postCommission({ floor: f.floor, llm: f.llm }, 'Twelve identical parking tickets');
  assert.equal(annotation.ok, false);
  assert.match(annotation.error, /LlmOutputError/);
  assert.equal(event.payload.scoutWhy, null);
  assert.match(event.payload.annotation.error, /LlmOutputError/);
  assert.equal((await f.floor.read({ type: 'llm.failed' })).length, 1);
  assert.equal((await f.floor.read({ type: 'subject.posted' })).length, 1);
});

test('annotate: false, or no llm, means no Scout call', async () => {
  const f = await tmpFactory({ roles: { 'scout-annotate.md': ANNOTATE_ROLE }, replies: [] });
  const { annotation } = await postCommission({ floor: f.floor, llm: f.llm }, 'Twelve identical parking tickets', { annotate: false });
  assert.equal(annotation, null);
  assert.equal((await postCommission({ floor: f.floor }, 'Another plain commission')).annotation, null);
  assert.equal(f.fetch.requests.length, 0);
});

test('annotateCommission reports errors instead of throwing', async () => {
  const res = await annotateCommission({ call: async () => { throw new Error('boom'); } }, { title: 't', url: null, why: null, snapshot: { snippet: 's', page: null } });
  assert.deepEqual(res, { ok: false, error: 'Error: boom' });
});
