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
import { postCommission, pendingCommissions, isUrl, CommissionError, MAX_COMMISSION_CHARS } from '../src/agents/commissions.js';
import { routeFetch } from './helpers.js';

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
    const r = await exec(process.execPath, [CLI, ...args], { env: { ...process.env, SILVER_ROOT: root } });
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

  r = await silver(root, ['commission', pageUrl, '--now']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /commissioned: Brillo Box, 1964\n.*\n {2}snapshot: text\/html, 15 chars of text/);
  assert.match(r.stderr, /--now needs the studio \(ACTIONS\.md phase 3\)/);

  r = await silver(root, ['commission', 'twelve identical parking tickets']);
  assert.match(r.stderr, /note: this repeats [0-9A-Z]{26}/);

  r = await silver(root, ['commission', '--list']);
  assert.equal(r.stdout.trim().split('\n').length, 3);

  r = await silver(root, ['commission']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^silver: give the commission as text or a URL/);
});
