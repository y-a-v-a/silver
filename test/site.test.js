import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import Parser from 'rss-parser';
import { tmpFactory, completion, seedSeries, decide, fakePrintRenderer } from './helpers.js';
import { printApproved } from '../src/agents/printer.js';
import { releaseEditions } from '../src/agents/hughes.js';
import { buildSite, atomFeed, LICENCE_URL } from '../src/site.js';

const HUGHES_ROLE = await readFile(new URL('../roles/fred-hughes.md', import.meta.url), 'utf8');

async function gallery({ siteUrl = null } = {}) {
  const f = await tmpFactory({
    roles: { 'fred-hughes.md': HUGHES_ROLE },
    replies: [completion(JSON.stringify({ title: 'Soup <One>', wallText: 'A can & a grid.' })), completion(JSON.stringify({ title: 'Soup (Two)', wallText: 'Another can.' }))],
  });
  f.config.deploy = { ...f.config.deploy, siteUrl };
  const { seriesId } = await seedSeries(f, { subject: { url: 'https://example.com/soup' } });
  await decide(f, seriesId, [['v01', 'approved'], ['v02', 'approved'], ['v03', 'approved']]);
  await printApproved({ config: f.config, floor: f.floor, llm: null, renderer: fakePrintRenderer() });
  await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm }); // v03 fails: no third reply
  return f;
}

test('buildSite writes an index, a page per released edition, the feed and vercel.json', async () => {
  const f = await gallery();
  const { dir, works } = await buildSite({ config: f.config, floor: f.floor });
  assert.equal(works, 2, 'the unreleased work is not shown');
  const workDirs = await readdir(join(dir, 'works'));
  assert.equal(workDirs.length, 2);
  for (const d of workDirs) for (const file of ['index.html', 'sketch.html', 'poster.png']) await access(join(dir, 'works', d, file));

  const index = await readFile(join(dir, 'index.html'), 'utf8');
  assert.ok(index.indexOf('Soup (Two)') < index.indexOf('Soup &lt;One&gt;'), 'newest edition first, escaped');
  assert.match(index, /No\. 001/);
  assert.match(index, new RegExp(`href="${LICENCE_URL.replace(/\./g, '\\.')}" rel="license">CC BY 4\\.0`));

  const [first] = workDirs.sort();
  const page = await readFile(join(dir, 'works', first, 'index.html'), 'utf8');
  assert.match(page, /<iframe src="sketch\.html"/);
  assert.match(page, /A can &amp; a grid\./);
  assert.match(page, /After: <a href="https:\/\/example\.com\/soup"/);
  assert.match(page, /signature <code>[0-9a-f]{16}…<\/code>/);
  assert.match(page, /No\. 002 →/, 'a link to the next edition');
  assert.doesNotMatch(page, /og:image/, 'no absolute URLs without a siteUrl');

  const vercel = JSON.parse(await readFile(join(dir, 'vercel.json'), 'utf8'));
  assert.equal(vercel.trailingSlash, true);
});

test('the Atom feed parses, has stable tag ids and absolute links once siteUrl is set', async () => {
  const f = await gallery({ siteUrl: 'https://silver.example' });
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const xml = await readFile(join(dir, 'feed.xml'), 'utf8');
  const feed = await new Parser().parseString(xml);
  assert.equal(feed.title, 'Silver Factory: editions');
  assert.deepEqual(feed.items.map((i) => i.title), ['No. 002: Soup (Two)', 'No. 001: Soup <One>']);
  assert.match(feed.items[0].id, /^tag:silver-factory,2026:campbell-soup-v02-/);
  assert.match(feed.items[0].link, /^https:\/\/silver\.example\/works\/campbell-soup-v02-[a-z0-9]+\/$/);
  const page = await readFile(join(dir, 'works', (await readdir(join(dir, 'works')))[0], 'index.html'), 'utf8');
  assert.match(page, /<meta property="og:image" content="https:\/\/silver\.example\/works\/[^"]+\/poster\.png">/);
});

test('rebuilding keeps site/.vercel and removes stale files', async () => {
  const f = await gallery();
  await mkdir(join(f.config.paths.site, '.vercel'), { recursive: true });
  await writeFile(join(f.config.paths.site, '.vercel', 'project.json'), '{"projectId":"p"}');
  await writeFile(join(f.config.paths.site, 'stale.html'), 'old');
  await buildSite({ config: f.config, floor: f.floor });
  await access(join(f.config.paths.site, '.vercel', 'project.json'));
  await assert.rejects(access(join(f.config.paths.site, 'stale.html')));
});

test('an empty canon still builds a valid site', async () => {
  const f = await tmpFactory();
  const { works, dir } = await buildSite({ config: f.config, floor: f.floor });
  assert.equal(works, 0);
  assert.match(await readFile(join(dir, 'index.html'), 'utf8'), /Nothing signed yet/);
  assert.equal((await new Parser().parseString(atomFeed([], null))).items.length, 0);
});

test('the gallery poster is the later frame, and a revised label shows on the page and in the feed', async () => {
  const f = await gallery();
  const { retitleEdition } = await import('../src/agents/hughes.js');
  await retitleEdition({ config: f.config, floor: f.floor, llm: null }, { edition: 1, title: 'Soup (Corrected)' });
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const [first] = (await readdir(join(dir, 'works'))).sort();
  assert.deepEqual([...(await readFile(join(dir, 'works', first, 'poster.png')))], [0x89, 0x50, 0x4e, 0x47, 2], 'the hold frame (fake renderer writes 2 there)');
  const page = await readFile(join(dir, 'works', first, 'index.html'), 'utf8');
  assert.match(page, /<h2>Soup \(Corrected\)<\/h2>/);
  assert.match(page, /label revised \d{4}-\d{2}-\d{2}/);
  const feed = await new Parser().parseString(await readFile(join(dir, 'feed.xml'), 'utf8'));
  assert.equal(feed.items.length, 2, 'a correction is not a new entry');
  assert.equal(feed.items[1].title, 'No. 001: Soup (Corrected)');
});

test('the site works from any directory: its links are relative, so the admin can preview the real build', async () => {
  const f = await gallery();
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const index = await readFile(join(dir, 'index.html'), 'utf8');
  const [first] = (await readdir(join(dir, 'works'))).sort();
  const work = await readFile(join(dir, 'works', first, 'index.html'), 'utf8');
  assert.match(index, /<a href="works\/campbell-soup-v0\d-[a-z0-9]+\/" data-technique="/);
  assert.match(index, /<img src="works\/[^"]+\/poster\.png"/);
  assert.match(work, /<a class="mark" href="\.\.\/\.\.\/">/);
  assert.match(work, /rel="next" href="\.\.\/campbell-soup/);
  assert.doesNotMatch(`${index}${work}`, /(href|src)="\/(works|feed)/, 'nothing assumes the site sits at the root');
});

test('the wall can be filtered by procedure, and works without its script', async () => {
  const f = await gallery();
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const index = await readFile(join(dir, 'index.html'), 'utf8');
  assert.match(index, /<button type="button" data-technique="halftone" aria-pressed="false">halftone 1<\/button>/);
  assert.match(index, /<button type="button" data-technique="grid-repeat" aria-pressed="false">grid-repeat 1<\/button>/);
  assert.doesNotMatch(index, /<a [^>]*\shidden/, 'everything shows until a filter is clicked');
  assert.match(index, /2 editions\./);
});

test('the gallery says how it is made, and has a page for what is not there', async () => {
  const f = await gallery();
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const about = await readFile(join(dir, 'about', 'index.html'), 'utf8');
  assert.match(about, /2 editions in 2 procedures/);
  assert.match(about, /<link rel="alternate"[^>]*href="\.\.\/feed\.xml"/);
  assert.match(await readFile(join(dir, '404.html'), 'utf8'), /Not on the wall/);
});

test('a work is live in a sandbox; a line by the human reads right; a source that is no URL is no link', async () => {
  const f = await gallery();
  await f.floor.append({ type: 'work.published', actor: 'printer', payload: { canonId: 'zzz-v09-aaaaaa', seriesId: 'S', variant: 'v09', technique: 'x-ray', subjectTitle: 'a <can>', sourceUrl: 'javascript:alert(1)', sketch: (await f.floor.read({ type: 'work.published' }))[0].payload.sketch, poster: (await f.floor.read({ type: 'work.published' }))[0].payload.poster, later: null, signature: 'abcdefabcdefabcdef', brief: { from: 'the human', text: 'It smells of rain.' }, dare: 'Make it tender.' } });
  await f.floor.append({ type: 'edition.released', actor: 'fred-hughes', payload: { canonId: 'zzz-v09-aaaaaa', edition: 9, title: 'Rain', wallText: 'Wet.', channel: 'site' } });
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const page = await readFile(join(dir, 'works', 'zzz-v09-aaaaaa', 'index.html'), 'utf8');
  assert.match(page, /<iframe src="sketch\.html"[^>]*sandbox="allow-scripts"/);
  assert.match(page, /From a line the human said on the floor: “It smells of rain\.”/);
  assert.doesNotMatch(page, /javascript:alert/);
  assert.match(page, /After: a &lt;can&gt;/);
  assert.match(page, /Dare: Make it tender\./);
});

