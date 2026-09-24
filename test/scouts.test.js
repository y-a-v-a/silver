import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpFactory, completion, routeFetch } from './helpers.js';
import { runScouts, validatePicks, formatCandidates, normalizeSensitive } from '../src/agents/scouts.js';
import { extractPage, snapshotPage } from '../src/lib/snapshot.js';
import { trendsUrl } from '../src/sources/google-trends.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SCOUT_ROLE = await readFile(new URL('../roles/scout.md', import.meta.url), 'utf8');

const html = (body, headers = {}) => () =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

const ARTICLE = `<!doctype html><html><head><title>Ignored &amp; tag title</title>
<meta property="og:title" content="Soup maker changes can design">
<meta name="description" content="For the first time in decades.">
<meta content="https://news.example.com/can.jpg" property="og:image">
</head><body><nav>Home | World</nav><article><h1>Soup maker changes can</h1><p>The red and white label is going.</p><figure>caption junk</figure></article><footer>(c)</footer></body></html>`;

// ---------- snapshot ----------

test('extractPage prefers og tags and article text, dropping nav/footer/figure', () => {
  const page = extractPage(ARTICLE);
  assert.equal(page.title, 'Soup maker changes can design');
  assert.equal(page.description, 'For the first time in decades.');
  assert.equal(page.image, 'https://news.example.com/can.jpg');
  assert.equal(page.text, 'Soup maker changes can\nThe red and white label is going.');
  assert.equal(extractPage('<title>Only &amp; title</title><body>x</body>').title, 'Only & title');
  assert.equal(extractPage('<p>' + 'word '.repeat(1000) + '</p>', { maxChars: 50 }).text.length, 50);
});

test('snapshotPage handles html, non-html, HTTP errors and network errors without throwing', async () => {
  const fetch = routeFetch({
    'https://a/page': html(ARTICLE),
    'https://a/img.jpg': () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
    'https://a/paywall': 403,
    'https://a/down': new TypeError('ECONNREFUSED'),
  });
  const page = await snapshotPage('https://a/page', { fetch });
  assert.equal(page.contentType, 'text/html');
  assert.equal(page.title, 'Soup maker changes can design');
  assert.equal(page.error, undefined);

  const img = await snapshotPage('https://a/img.jpg', { fetch });
  assert.equal(img.contentType, 'image/jpeg');
  assert.equal(img.text, null);

  assert.equal((await snapshotPage('https://a/paywall', { fetch })).error, 'HTTP 403');
  assert.match((await snapshotPage('https://a/down', { fetch })).error, /ECONNREFUSED/);
});

// ---------- picks ----------

test('formatCandidates numbers from 1 and shows source and context', () => {
  const text = formatCandidates([{ source: 'reddit', title: 'Boxes', snippet: 'Top of r/all.' }, { source: 'rss:x', title: 'Chair', snippet: '' }]);
  assert.equal(text, '[1] (reddit) Boxes\n    Top of r/all.\n[2] (rss:x) Chair\n    (no context)');
});

test('validatePicks keeps valid unique picks up to count and explains the rest', () => {
  const { picks, note, problems } = validatePicks(
    {
      picks: [
        { n: 2, why: 'A face everyone saw.', image: 'The face, twelve times.' },
        { n: 2, why: 'again' },
        { n: 0, why: 'zero' },
        { n: '3', why: 'numeric string is fine' },
        { n: 4, why: '  ' },
        { n: 1, why: 'over the count' },
      ],
      note: ' slow news day ',
    },
    5,
    2,
  );
  assert.deepEqual(picks, [
    { index: 1, why: 'A face everyone saw.', image: 'The face, twelve times.', sensitive: { flag: false, reason: null } },
    { index: 2, why: 'numeric string is fine', image: null, sensitive: { flag: false, reason: null } },
  ]);
  assert.equal(note, 'slow news day');
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /picked twice[\s\S]*not a listed candidate[\s\S]*no "why"[\s\S]*more than the 2/);
  assert.deepEqual(validatePicks({ nope: 1 }, 5, 2).problems, ['reply has no "picks" array']);
});

// ---------- the agent ----------

async function scoutSetup(replies) {
  const f = await tmpFactory({ roles: { 'scout.md': SCOUT_ROLE }, replies });
  const config = {
    ...f.config,
    shift: { subjectsPerShift: 2 },
    sources: { rss: ['https://www.example.com/rss'], trending: { googleTrendsGeo: 'US', hackernews: false, reddit: true }, itemsPerSource: 20 },
  };
  const fetch = routeFetch({
    [trendsUrl('US')]: await fixture('trends.xml'),
    'https://www.reddit.com/r/all/top/.rss?t=day&limit=20': await fixture('reddit.atom'),
    'https://www.example.com/rss': await fixture('news.rss'),
    'https://news.example.com/soup-can': html(ARTICLE),
  });
  return { ...f, config, sourcesFetch: fetch };
}

test('runScouts: gathers, asks the Scout with the real role file, posts subject cards with snapshots', async () => {
  const reply = JSON.stringify({
    picks: [
      { n: 1, why: 'The can everyone owns.', image: 'One can, repeated.', sensitive: { flag: false } },
      { n: 6, why: 'A chair people queue to see.', sensitive: { flag: true, reason: 'execution device' } },
    ],
  });
  const f = await scoutSetup([completion(reply)]);
  const result = await runScouts({ config: f.config, floor: f.floor, llm: f.llm, fetch: f.sourcesFetch });

  assert.equal(result.candidates, 6);
  assert.equal(result.shown, 6);
  assert.deepEqual(result.problems, []);
  assert.equal(result.posted.length, 2);

  // The prompt: role placeholders all filled, candidates numbered, count stated.
  const system = f.fetch.requests[0].body.messages[0].content;
  assert.doesNotMatch(system, /\{\{|\[(today|count|recent|candidates)\]/);
  assert.match(system, /How many to choose: 2 at most/);
  assert.match(system, /\[1\] \(google-trends\) campbell soup/);
  assert.match(system, /\(none yet\)/);

  const [soup, chair] = result.posted;
  assert.equal(soup.type, 'subject.posted');
  assert.equal(soup.actor, 'scout');
  assert.equal(soup.ref, result.callId);
  assert.deepEqual(
    { origin: soup.payload.origin, title: soup.payload.title, source: soup.payload.source, why: soup.payload.why, image: soup.payload.image },
    { origin: 'scouted', title: 'campbell soup', source: 'google-trends', why: 'The can everyone owns.', image: 'One can, repeated.' },
  );
  assert.equal(soup.payload.snapshot.page.title, 'Soup maker changes can design');
  assert.match(soup.payload.snapshot.snippet, /2000\+ searches/);
  assert.equal(chair.payload.title, 'Electric chair museum reopens');
  assert.deepEqual(soup.payload.sensitive, { flag: false, reason: null });
  assert.deepEqual(chair.payload.sensitive, { flag: true, reason: 'execution device' });
  assert.match(system, /What you never pick[\s\S]*Suicide or self-harm[\s\S]*Children[\s\S]*Named private victims/);
  assert.equal(chair.payload.snapshot.page.error, 'HTTP 404'); // unreachable page: recorded, not fatal
});

test('runScouts: a second run skips subjects already on the floor and reminds the Scout of them', async () => {
  const first = JSON.stringify({ picks: [{ n: 1, why: 'can' }] });
  const second = JSON.stringify({ picks: [{ n: 1, why: 'next' }] });
  const f = await scoutSetup([completion(first), completion(second)]);
  const deps = { config: f.config, floor: f.floor, llm: f.llm, fetch: f.sourcesFetch };
  await runScouts(deps, { snapshot: false });
  const again = await runScouts(deps, { snapshot: false });
  assert.equal(again.duplicates, 1);
  assert.equal(again.shown, 5);
  const system = f.fetch.requests[1].body.messages[0].content;
  assert.match(system, /- campbell soup/);
  assert.doesNotMatch(system, /\(google-trends\) campbell soup/);
  assert.equal((await f.floor.read({ type: 'subject.posted' })).length, 2);
});

test('runScouts: count, source subsets and bad picks', async () => {
  const reply = JSON.stringify({ picks: [{ n: 9, why: 'not listed' }, { n: 2, why: 'fine' }], note: 'thin pickings' });
  const f = await scoutSetup([completion(reply)]);
  const result = await runScouts({ config: f.config, floor: f.floor, llm: f.llm, fetch: f.sourcesFetch }, { count: 1, only: ['rss'], snapshot: false });
  assert.deepEqual(result.report.map((r) => r.source), ['rss:example.com']);
  assert.equal(result.shown, 2);
  assert.equal(result.posted.length, 1);
  assert.equal(result.posted[0].payload.title, 'Electric chair museum reopens');
  assert.equal(result.note, 'thin pickings');
  assert.match(result.problems[0], /n=9 is not a listed candidate/);
  assert.match(f.fetch.requests[0].body.messages[0].content, /How many to choose: 1 at most/);
});

test('runScouts: no fresh candidates means no model call', async () => {
  const f = await scoutSetup([]);
  const result = await runScouts({ config: f.config, floor: f.floor, llm: f.llm, fetch: routeFetch({}) });
  assert.equal(result.shown, 0);
  assert.equal(f.fetch.requests.length, 0);
  assert.match(result.problems[0], /no fresh candidates/);
  assert.ok(result.report.every((r) => !r.ok));
});

test('normalizeSensitive: explicit false is clean, anything else ambiguous is flagged', () => {
  assert.deepEqual(normalizeSensitive(undefined), { flag: false, reason: null });
  assert.deepEqual(normalizeSensitive({ flag: false }), { flag: false, reason: null });
  assert.deepEqual(normalizeSensitive(false), { flag: false, reason: null });
  assert.deepEqual(normalizeSensitive(true), { flag: true, reason: null });
  assert.deepEqual(normalizeSensitive({ flag: true, reason: ' war ' }), { flag: true, reason: 'war' });
  assert.deepEqual(normalizeSensitive({ reason: 'grief' }), { flag: true, reason: 'grief' });
  assert.deepEqual(normalizeSensitive('violence'), { flag: true, reason: 'violence' });
});
