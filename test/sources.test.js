import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTrends, googleTrends, trendsUrl } from '../src/sources/google-trends.js';
import { hnCandidate, hackerNews, HN_API } from '../src/sources/hackernews.js';
import { parseReddit, redditTarget, reddit } from '../src/sources/reddit.js';
import { parseFeed, rssSourceName } from '../src/sources/rss.js';
import { gatherCandidates, enabledSources } from '../src/sources/index.js';
import { htmlToText, decodeEntities, clip, fetchText, fetchJson, USER_AGENT, SourceError } from '../src/sources/http.js';
import { candidate } from '../src/sources/candidate.js';
import { routeFetch } from './helpers.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// ---------- helpers ----------

test('htmlToText strips tags and scripts, decodes entities, keeps paragraph breaks', () => {
  assert.equal(htmlToText('<p>Soup &amp; <b>cans</b></p><script>x()</script><p>two&#8217;s &#x2014; ok</p>'), 'Soup & cans\ntwo’s — ok');
  assert.equal(decodeEntities('&unknown; &nbsp;&hellip;'), '&unknown;  …');
  assert.equal(clip('a\n\nb   c', 10), 'a b c');
  assert.equal(clip('abcdef', 4), 'abc…');
});

test('fetchText/fetchJson send the User-Agent and turn failures into SourceError', async () => {
  const fetch = routeFetch({ 'https://a/x': 'hi', 'https://a/j': { n: 1 }, 'https://a/500': 500, 'https://a/net': new TypeError('ECONNRESET'), 'https://a/notjson': 'nope' });
  assert.equal(await fetchText('https://a/x', { fetch }), 'hi');
  assert.equal(fetch.seen[0].headers['User-Agent'], USER_AGENT);
  assert.deepEqual(await fetchJson('https://a/j', { fetch }), { n: 1 });
  await assert.rejects(fetchText('https://a/500', { fetch }), (e) => e instanceof SourceError && e.status === 500);
  await assert.rejects(fetchText('https://a/net', { fetch }), /ECONNRESET/);
  await assert.rejects(fetchJson('https://a/notjson', { fetch }), /not JSON/);
});

test('candidate requires a title and normalises empties', () => {
  assert.throws(() => candidate({ title: ' ', source: 's' }), /without a title/);
  const c = candidate({ title: ' Soup ', url: '', source: 's' });
  assert.equal(c.title, 'Soup');
  assert.equal(c.url, null);
});

// ---------- google trends ----------

test('Google Trends: search term as title, lead news link as url, headlines in snippet', async () => {
  const [soup, eclipse] = await parseTrends(await fixture('trends.xml'), { limit: 10 });
  assert.equal(soup.title, 'campbell soup');
  assert.equal(soup.source, 'google-trends');
  assert.equal(soup.url, 'https://news.example.com/soup-can');
  assert.match(soup.snippet, /^2000\+ searches\. In the news: "Soup maker changes can design.*" \(Example News\); "Shoppers stockpile the old cans" \(Other Paper\)\.$/);
  assert.equal(soup.meta.news.length, 2);
  assert.equal(eclipse.url, null);
  assert.equal(eclipse.snippet, '500+ searches.');
});

test('Google Trends: limit and URL', async () => {
  assert.equal((await parseTrends(await fixture('trends.xml'), { limit: 1 })).length, 1);
  const fetch = routeFetch({ [trendsUrl('NL')]: await fixture('trends.xml') });
  assert.equal((await googleTrends({ geo: 'NL', limit: 5, fetch })).length, 2);
});

// ---------- hacker news ----------

test('Hacker News: stories become candidates; dead, deleted and non-stories are dropped', () => {
  const c = hnCandidate({ id: 7, type: 'story', title: 'Show HN: Soup', url: 'https://soup.dev', score: 120, descendants: 33 });
  assert.equal(c.url, 'https://soup.dev');
  assert.equal(c.snippet, '120 points, 33 comments on Hacker News.');
  assert.equal(c.meta.discussion, 'https://news.ycombinator.com/item?id=7');
  const ask = hnCandidate({ id: 8, type: 'story', title: 'Ask HN: Why cans?', text: '<p>Serious &amp; question</p>' });
  assert.equal(ask.url, 'https://news.ycombinator.com/item?id=8');
  assert.match(ask.snippet, /Serious & question$/);
  for (const bad of [null, { id: 1, dead: true, type: 'story', title: 'x' }, { id: 2, deleted: true }, { id: 3, type: 'job', title: 'x' }]) {
    assert.equal(hnCandidate(bad), null);
  }
});

test('Hacker News: fetches the top N items and survives a missing one', async () => {
  const fetch = routeFetch({
    [`${HN_API}/topstories.json`]: [1, 2, 3, 4],
    [`${HN_API}/item/1.json`]: { id: 1, type: 'story', title: 'One', url: 'https://one' },
    [`${HN_API}/item/2.json`]: 500,
    [`${HN_API}/item/3.json`]: { id: 3, type: 'story', title: 'Three' },
    [`${HN_API}/item/4.json`]: { id: 4, type: 'story', title: 'Four' },
  });
  const cs = await hackerNews({ limit: 3, fetch, concurrency: 2 });
  assert.deepEqual(cs.map((c) => c.title), ['One', 'Three']);
  assert.ok(!fetch.seen.some((s) => s.url.endsWith('/item/4.json')));
});

// ---------- reddit ----------

test('Reddit: the [link] target is the url; self posts fall back to the thread', async () => {
  const [boxes, ask] = await parseReddit(await fixture('reddit.atom'), { limit: 10 });
  assert.equal(boxes.title, 'A warehouse of identical boxes');
  assert.equal(boxes.url, 'https://i.redd.it/boxes.jpg?a=1&b=2');
  assert.equal(boxes.snippet, 'Top of r/all today, from r/pics, posted by u/brillo.');
  assert.equal(boxes.meta.discussion, 'https://www.reddit.com/r/pics/comments/abc/boxes/');
  assert.equal(ask.url, 'https://www.reddit.com/r/AskReddit/comments/def/q/');
  assert.equal(redditTarget('no link here'), null);
});

test('Reddit: uses the Atom feed, not the (403) JSON API', async () => {
  const fetch = routeFetch({ 'https://www.reddit.com/r/all/top/.rss?t=day&limit=1': await fixture('reddit.atom') });
  assert.equal((await reddit({ limit: 1, fetch })).length, 1);
});

// ---------- rss ----------

test('RSS: source names come from the host', () => {
  assert.equal(rssSourceName('https://feeds.bbci.co.uk/news/world/rss.xml'), 'rss:bbci.co.uk');
  assert.equal(rssSourceName('https://www.theguardian.com/world/rss'), 'rss:theguardian.com');
  assert.equal(rssSourceName('https://rss.nytimes.com/x.xml'), 'rss:nytimes.com');
});

test('RSS: titles are cleaned, untitled items skipped, snippets from descriptions', async () => {
  const items = await parseFeed(await fixture('news.rss'), { url: 'https://www.example.com/rss', limit: 10 });
  assert.deepEqual(items.map((i) => i.title), ['Celebrity & the car crash', 'Electric chair museum reopens']);
  assert.equal(items[0].snippet, 'A famous face, a twisted car.');
  assert.equal(items[0].source, 'rss:example.com');
  assert.equal(items[0].meta.feed, 'Example World News');
  assert.equal((await parseFeed(await fixture('news.rss'), { url: 'https://x.org/f', limit: 1 })).length, 1);
});

// ---------- gathering ----------

const CONFIG = {
  sources: {
    rss: ['https://www.example.com/rss', 'https://down.example.org/feed'],
    trending: { googleTrendsGeo: 'US', hackernews: false, reddit: true },
    itemsPerSource: 20,
  },
};

test('enabledSources follows the config', () => {
  assert.deepEqual(enabledSources(CONFIG).map((s) => s.name), ['google-trends', 'reddit', 'rss:example.com', 'rss:down.example.org']);
});

test('gatherCandidates merges all sources and reports failures without throwing', async () => {
  const fetch = routeFetch({
    [trendsUrl('US')]: await fixture('trends.xml'),
    'https://www.reddit.com/r/all/top/.rss?t=day&limit=20': await fixture('reddit.atom'),
    'https://www.example.com/rss': await fixture('news.rss'),
    'https://down.example.org/feed': 503,
  });
  const { candidates, report } = await gatherCandidates(CONFIG, { fetch });
  assert.equal(candidates.length, 2 + 2 + 2);
  assert.deepEqual(report.map((r) => [r.source, r.ok, r.count]), [
    ['google-trends', true, 2],
    ['reddit', true, 2],
    ['rss:example.com', true, 2],
    ['rss:down.example.org', false, 0],
  ]);
  assert.match(report[3].error, /HTTP 503/);
});

test('gatherCandidates can run a subset: exact names or "rss" for every feed', async () => {
  const fetch = routeFetch({ 'https://www.example.com/rss': await fixture('news.rss'), 'https://down.example.org/feed': 503 });
  const { report } = await gatherCandidates(CONFIG, { fetch, only: ['rss'] });
  assert.deepEqual(report.map((r) => r.source), ['rss:example.com', 'rss:down.example.org']);
});
