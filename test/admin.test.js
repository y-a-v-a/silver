// The admin over HTTP: its guards, every page, and each thing it can change. Jobs run against
// a stub instead of the real CLI, so nothing here calls a model or starts a browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createAdminServer, LOCAL_NAME } from '../src/admin/server.js';
import { createJobs } from '../src/admin/jobs.js';
import { createFloor } from '../src/floor.js';
import { readOverlay, writeOverlay } from '../src/settings.js';
import { readDirection } from '../src/lib/direction.js';
import { readTaste, appendTaste } from '../src/lib/taste.js';
import { listRevisions, readSoul } from '../src/admin/souls.js';
import { pinnedSubjects, retiredSubjects } from '../src/agents/retire.js';
import { listSeries } from '../src/agents/series-data.js';
import { seedSeries } from './helpers.js';
import shipped from '../silver.config.js';

const ROLES = fileURLToPath(new URL('../roles/', import.meta.url));
const STUB = `console.log('ran', process.argv.slice(2).join(' '));`;

let root;
let config;
let floor;
let admin;
let base;
let jobs;
let seeded;
let restarted = 0;
const approvals = [];
const notices = [];

async function freshConfig() {
  return loadConfig({ env: {}, root, overlay: true });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'silver-admin-'));
  await cp(ROLES, join(root, 'roles'), { recursive: true });
  await writeFile(join(root, 'stub.mjs'), STUB);
  config = await freshConfig();
  floor = createFloor({ dir: config.paths.floor });
  jobs = createJobs({ config, cli: join(root, 'stub.mjs') });
  seeded = await seedSeries({ floor, root }, { subject: { sensitive: { flag: true, reason: 'a crash' }, url: 'javascript:alert(1)' } });
  admin = createAdminServer({
    config,
    floor,
    jobs,
    getConfig: freshConfig,
    onApproved: () => approvals.push(Date.now()),
    notices: { list: () => notices },
    boot: 'bootid',
    extra: { env: { OPENROUTER_API_KEY: 'set' }, rawConfig: async () => shipped, restart: () => restarted++ },
  });
  base = await admin.listen(0);
});
after(() => admin.close());

const page = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, html: await res.text(), headers: res.headers };
};
const post = async (path, form = {}, headers = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const one of [].concat(v)) body.append(k, one);
  return fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, ...headers }, body });
};
const told = (res) => decodeURIComponent(res.headers.get('location') ?? '');
const lastJob = async () => (await jobs.list({ limit: 1 }))[0];
const untilEnded = async (id) => {
  for (let i = 0; i < 200; i++) {
    const job = await jobs.read(id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await sleep(25);
  }
  throw new Error('job never ended');
};
/** Everything queued so far has run: keeps the jobs from one test out of the next. */
const settle = async () => {
  for (let i = 0; i < 400; i++) {
    await jobs.pump();
    if (!(await jobs.open()).length) return;
    await sleep(25);
  }
  throw new Error('jobs never settled');
};

// ---------- the guards ----------

const rawGet = (path, host) =>
  new Promise((resolve, reject) => {
    const { port } = new URL(base);
    httpGet({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });

test('only this machine\'s own names are served: another Host is refused (DNS rebinding)', async () => {
  const { port } = new URL(base);
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `${LOCAL_NAME}:${port}`]) assert.equal(await rawGet('/', host), 200, host);
  for (const host of ['evil.example', `evil.example:${port}`, `other.localhost:${port}`, `127.0.0.1:${Number(port) + 1}`]) {
    assert.equal(await rawGet('/', host), 403, host);
    assert.equal(await rawGet('/events', host), 403, `${host} on the wire`);
  }
});

test('form posts from anywhere else are refused, sandboxed sketches included; the nice name is fine', async () => {
  const { port } = new URL(base);
  assert.equal((await post('/system/pause', { paused: '0' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/system/pause', { paused: '0' }, { Origin: 'null' })).status, 403, 'a sketch in a sandbox has a null origin');
  assert.equal((await post('/system/pause', { paused: '0' }, { Origin: `http://other.localhost:${port}` })).status, 403);
  assert.equal((await post('/system/pause', { paused: '0' }, { Origin: `http://${LOCAL_NAME}:${port}` })).status, 303);
  const res = await fetch(`${base}/system/pause`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'cross-site' }, body: 'paused=0' });
  assert.equal(res.status, 403);
});

test('a sketch is served in a sandbox: it never runs with the powers of the admin', async () => {
  const res = await fetch(`${base}/files/${seeded.seriesId}/v01.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), 'sandbox allow-scripts');
  const { html, headers } = await page(`/series/${seeded.seriesId}`);
  assert.match(headers.get('content-security-policy'), /script-src 'self';/);
  assert.doesNotMatch(html, /\son[a-z]+="/, 'no inline event handlers: the policy would block them');
  assert.doesNotMatch(html.replace(/<script src="[^"]*" defer><\/script>/, ''), /<script/, 'no inline scripts either');
});

test('a link that came in from a feed is only a link if it goes somewhere harmless', async () => {
  const { html } = await page(`/series/${seeded.seriesId}`);
  assert.doesNotMatch(html, /javascript:alert/);
});

test('files outside their directories stay out of reach', async () => {
  await writeFile(join(root, 'taste.md'), '# Taste\n');
  for (const bad of ['/files/..%2F..%2Ftaste.md', `/files/${seeded.seriesId}/..%2F..%2F..%2Ftaste.md`, '/assets/..%2F..%2Fcli.js', '/assets/%2E%2E/server.js', '/canon-files/..%2Ftaste.md', '/gallery/..%2Ftaste.md', '/files/%E0%A4%A']) {
    assert.equal((await fetch(base + bad)).status, 404, bad);
  }
});

test('the wire says hello with the boot id, so an open page knows when to reload', async () => {
  const ac = new AbortController();
  const res = await fetch(`${base}/events`, { signal: ac.signal });
  assert.match(res.headers.get('content-type'), /event-stream/);
  const { value } = await res.body.getReader().read();
  assert.match(Buffer.from(value).toString(), /event: hello\ndata: \{"boot":"bootid"\}/);
  ac.abort();
});

// ---------- the pages ----------

test('every page renders in the frame, with the section marked', async () => {
  for (const [path, title] of [['/', 'Today'], ['/review', 'Review'], ['/subjects', 'Subjects'], ['/studio', 'Studio'], ['/souls', 'Souls'], ['/souls/warhol', 'Warhol'], ['/souls/nico', 'Nico'], ['/taste', 'Taste'], ['/floor', 'The floor'], ['/canon', 'The canon'], ['/diary', 'The diary'], ['/jobs', 'Jobs'], ['/system', 'System'], [`/series/${seeded.seriesId}`, 'campbell soup'], [`/subjects/${seeded.subject.id}`, 'campbell soup']]) {
    const { status, html } = await page(path);
    assert.equal(status, 200, path);
    assert.match(html, new RegExp(`<title>${title} · Silver</title>`), path);
    assert.match(html, /aria-current="page"/, path);
    assert.match(html, /<meta name="silver-boot" content="bootid">/);
  }
});

test('unknown pages are 404 and unknown methods 405', async () => {
  assert.equal((await page('/nothing/here')).status, 404);
  assert.equal((await page('/series/NOPE')).status, 404);
  assert.equal((await page('/souls/nobody')).status, 404);
  assert.equal((await page('/souls/warhol/history/NOT-A-ULID')).status, 404);
  assert.equal((await page('/transcripts/NOT-A-ULID')).status, 404);
  assert.equal((await page('/jobs/NOT-A-ULID')).status, 404);
  assert.equal((await post('/series', {})).status, 404);
  assert.equal((await post('/jobs/start/x/y', {})).status, 404);
  assert.equal((await fetch(`${base}/studio/direction`)).status, 405);
});

test('assets are served and the supervisor\'s notices reach every page', async () => {
  assert.match((await fetch(`${base}/assets/admin.css`)).headers.get('content-type'), /text\/css/);
  assert.match((await fetch(`${base}/assets/admin.js`)).headers.get('content-type'), /javascript/);
  notices.push({ level: 'bad', text: 'The code <you> saved is broken' });
  const { html } = await page('/review');
  assert.match(html, /The code &lt;you&gt; saved is broken/);
  notices.length = 0;
});

// ---------- today ----------

test('Today puts what is wrong first: no credit, thin series, a backlog', async () => {
  await floor.append({ type: 'llm.failed', actor: 'warhol', payload: { role: 'warhol', model: 'a/b', status: 402, error: 'OpenRouter request failed: would exceed your available credits' } });
  const { html } = await page('/');
  assert.match(html, /refused 1 call in the last day for lack of credits/);
  assert.match(html, /<a href="https:\/\/openrouter\.ai\/settings\/credits"/);
  assert.match(html, /Today&#39;s series came out thin|Warhol hasn&#39;t looked at/);
  assert.match(html, /Run today&#39;s shift/);
});

test('the shift can be started from the page; a job that is not offered can\'t be', async () => {
  const res = await post('/jobs/start', { kind: 'shift', dryRun: '1' });
  assert.match(res.headers.get('location'), /^\/jobs\/[0-9A-Z]{26}$/);
  const job = await lastJob();
  assert.deepEqual(job.args, ['shift', '--no-notify', '--dry-run']);
  const done = await untilEnded(job.id);
  assert.equal(done.status, 'done');
  const { html } = await page(`/jobs/${job.id}`);
  assert.match(html, /ran shift --no-notify --dry-run/);
  assert.deepEqual(await (await fetch(`${base}/jobs/${job.id}/log?offset=0`)).json().then((d) => [d.ended, d.text.startsWith('ran shift')]), [true, true]);

  assert.match(told(await post('/jobs/start', { kind: 'series' })), /error=no job "series"/);
  assert.match(told(await post('/jobs/start', { kind: 'rm -rf' })), /no job "rm -rf"/);
  await settle();
});

// ---------- the review ----------

test('approving asks for a print once; vetoing and repeating don\'t', async () => {
  approvals.length = 0;
  const decide = (variant, verdict) => post(`/series/${seeded.seriesId}/decide`, { variant, verdict });
  assert.match(told(await decide('v01', 'approved')), /Printing and publishing in the background/);
  await decide('v01', 'approved');
  await decide('v02', 'vetoed');
  assert.equal(approvals.length, 1);
  const { html } = await page(`/series/${seeded.seriesId}`);
  assert.match(html, /class="card approved" id="v01"/);
  assert.match(html, /class="card vetoed" id="v02"/);
  assert.match(html, /class="mark ok"/, 'a grease-pencil circle');
  assert.match(html, /class="mark no"/, 'and a cross');
});

test('a variant goes back to its maker with a note, even twice; a dead one can\'t', async () => {
  const res = await post(`/series/${seeded.seriesId}/pull`, { variant: 'v03', note: 'Bigger.' });
  assert.equal(res.status, 303);
  assert.deepEqual((await lastJob()).args, ['pull', seeded.seriesId, '--variant', 'v03', '--note', 'Bigger.']);
  assert.match(told(await post(`/series/${seeded.seriesId}/pull`, { variant: 'v04' })), /didn't come out/);
  await settle();
});

test('Warhol can be asked for one series or for everything he has not seen', async () => {
  await post(`/series/${seeded.seriesId}/shortlist`, {});
  assert.deepEqual((await lastJob()).args, ['shortlist', seeded.seriesId]);
  await settle();
  const res = await post('/review/shortlist-all', {});
  assert.match(told(res), /Warhol has 1 series to look at/);
  await settle();
});

test('the review list searches and pages', async () => {
  assert.match((await page('/review?q=campbell')).html, /campbell soup/);
  assert.match((await page('/review?q=grid-repeat')).html, /campbell soup/);
  assert.match((await page('/review?q=zzz')).html, /Nothing matches that/);
  assert.match((await page('/review?show=all&page=99')).html, /campbell soup/, 'a page past the end shows the last one');
});

test('the backlog can be closed by date: decisions stay, and newer series stay open', async () => {
  const f = { floor, root };
  const fresh = await seedSeries(f, { subject: { title: 'keep me' } });
  const res = await post('/review/close-before', { before: '2000-01-01' });
  assert.match(told(res), /Closed 0 reviews/);
  assert.match(told(await post('/review/close-before', { before: 'whenever' })), /pick a date/);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.match(told(await post('/review/close-before', { before: tomorrow })), /Closed 2 reviews/);
  const views = await listSeries(floor);
  assert.ok(views.every((v) => v.closed));
  assert.ok(views.find((v) => v.seriesId === seeded.seriesId).decisions.size >= 2, 'decisions stay');
  assert.equal(fresh.seriesId.length, 26);
});

// ---------- subjects ----------

test('a commission goes through a job, whatever it says, and a blank one is refused', async () => {
  const res = await post('/subjects/commission', { text: '--evil "quotes" & more', why: 'because', now: '1' });
  assert.equal(res.status, 303);
  assert.deepEqual((await lastJob()).args, ['commission', '--why', 'because', '--now', '--', '--evil "quotes" & more']);
  assert.match(told(await post('/subjects/commission', { text: '   ' })), /needs some text/);
  await settle();
});

test('a subject can be pinned, said something about and retired', async () => {
  const s = seeded.subject;
  assert.match(told(await post(`/subjects/${s.id}/pin`, { pinned: '1' })), /Pinned "campbell soup"/);
  assert.ok((await pinnedSubjects(floor)).has(s.id));
  await post(`/subjects/${s.id}/pin`, { pinned: '0' });
  assert.ok(!(await pinnedSubjects(floor)).has(s.id));

  assert.match(told(await post(`/subjects/${s.id}/say`, { text: 'It smells of rain.' })), /Said on the floor/);
  const chatter = await floor.read({ type: 'chatter.posted', ref: s.id });
  assert.equal(chatter.at(-1).actor, 'human');
  assert.match((await page(`/subjects/${s.id}`)).html, /the human<\/b>: It smells of rain\./);
  assert.match(told(await post(`/subjects/${s.id}/say`, { text: '' })), /error=say something first/);

  const other = await floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'to retire' } });
  assert.match(told(await post(`/subjects/${other.id}/retire`, { reason: 'too sad' })), /Retired "to retire"/);
  assert.equal((await retiredSubjects(floor)).get(other.id).payload.reason, 'too sad');
  assert.equal((await post('/subjects/NOPE/pin', {})).status, 404);
});

test('a series can be made with everything pinned, and pins are checked before it starts', async () => {
  const s = seeded.subject;
  await post(`/subjects/${s.id}/series`, { note: 'Rain.', techniques: ['rorschach', 'x-ray'], models: ['a/b'], temperatures: '0.5, 1.5', dare: 'Make it tender.', variants: '8', noChatter: '1' });
  assert.deepEqual((await lastJob()).args, ['series', s.id, '--technique', 'rorschach', 'x-ray', '--model', 'a/b', '--temperature', '0.5', '1.5', '--dare', 'Make it tender.', '--note', 'Rain.', '--variants', '8', '--no-chatter']);
  await post(`/subjects/${s.id}/series`, { variants: String(config.series.variants), temperatures: '' });
  assert.deepEqual((await lastJob()).args, ['series', s.id], 'nothing pinned: dealt as usual');
  assert.match(told(await post(`/subjects/${s.id}/series`, { techniques: 'nope' })), /no technique "nope"/);
  assert.match(told(await post(`/subjects/${s.id}/series`, { temperatures: '9' })), /run from 0 to 2/);
  await settle();
});

// ---------- the studio ----------

test('settings land in studio.json and count at once; the config file is never touched', async () => {
  const fileBefore = await readFile(new URL('../silver.config.js', import.meta.url), 'utf8');
  const form = { at: '07:30', seriesPerShift: '3', subjectsPerShift: '6', maxArchiveSubjectsPerShift: '1', dailyUsd: '2.5', chatterShare: '0.1', linesPerShift: '3', proposeChance: '0.34', secondPulls: '1', tasteEntriesInPrompt: '40', holdSeconds: '10' };
  const res = await post('/studio/settings/pace', form);
  assert.match(told(res), /Saved: 3 settings changed/);
  assert.deepEqual(await readOverlay(root), { shift: { at: '07:30', seriesPerShift: 3 }, budget: { dailyUsd: 2.5 } }, 'only what differs from the config file');
  assert.equal((await freshConfig()).budget.dailyUsd, 2.5);
  assert.match((await page('/')).html, /of \$2\.50/, 'the next page already knows');
  assert.equal(await readFile(new URL('../silver.config.js', import.meta.url), 'utf8'), fileBefore);
  const [change] = (await floor.read({ type: 'studio.changed' })).filter((e) => e.payload.what === 'settings').slice(-1);
  assert.deepEqual(change.payload.changes['budget.dailyUsd'], { from: 5, to: 2.5 });
  assert.match(change.payload.summary, /budget\.dailyUsd from 5 to 2\.5/);

  assert.match(told(await post('/studio/settings/pace', { reset: '1' })), /Saved: 3 settings/);
  assert.deepEqual(await readOverlay(root), {});
  assert.match(told(await post('/studio/settings/pace', { ...form, dailyUsd: 'lots' })), /daily budget must be a number/);
});

test('a setting that would not validate is refused whole, with the reason', async () => {
  const res = await post('/studio/settings/matrix', { variants: '13', modelsPerSeries: '3', temperatures: '0.7, 1.1', techniquesPerSeries: '2', concurrency: '4' });
  assert.match(told(res), /multiple of the matrix/);
  assert.deepEqual(await readOverlay(root), {});
  assert.match(told(await post('/studio/settings/matrix', { variants: '24', modelsPerSeries: '3', temperatures: '0.7, 1.1', techniquesPerSeries: '2', concurrency: '4' })), /Saved: 1 setting/);
  assert.equal((await freshConfig()).series.variants, 24);
  await writeOverlay(root, {});
  assert.equal((await post('/studio/settings/nonsense', {})).status, 404);
});

test('the hands and the sources can be changed, and an unknown shape is refused', async () => {
  const roles = Object.fromEntries(Object.entries(shipped.models.roles).map(([r, m]) => [`role.${r}`, m]));
  const base_ = { studio: shipped.models.studio.slice(0, 3), dryRun: shipped.models.dryRun, ...roles, fallbacks: 'a/b: c/d, e/f' };
  assert.match(told(await post('/studio/settings/models', { ...base_, add: 'new/hand' })), /Saved/);
  const after_ = await freshConfig();
  assert.deepEqual(after_.models.studio, [...shipped.models.studio.slice(0, 3), 'new/hand']);
  assert.deepEqual(after_.models.fallbacks, { 'a/b': ['c/d', 'e/f'] });
  assert.match(told(await post('/studio/settings/models', { ...base_, fallbacks: 'nonsense' })), /a fallback line looks like/);
  assert.match(told(await post('/studio/settings/models', { ...base_, studio: ['not a slug'] })), /not an OpenRouter slug/);
  assert.match(told(await post('/studio/settings/models', { reset: '1' })), /Saved/);

  const form = { rss: 'https://a.example/rss\n  \nhttps://b.example/rss', hackernews: '1', googleTrendsGeo: 'nl', itemsPerSource: '10', repeatAfterDays: '3' };
  await post('/studio/settings/sources', form);
  const s = (await freshConfig()).sources;
  assert.deepEqual(s.rss, ['https://a.example/rss', 'https://b.example/rss']);
  assert.deepEqual(s.trending, { googleTrendsGeo: 'NL', hackernews: true, reddit: false });
  assert.match(told(await post('/studio/settings/sources', { ...form, rss: 'ftp://nope' })), /not an http/);
  await post('/studio/settings/sources', { reset: '1' });
  assert.deepEqual(await readOverlay(root), {});
});

test('a procedure can be benched, favoured, rewritten, added and removed; the originals can\'t be removed', async () => {
  await post('/studio/techniques/rorschach', { action: 'weight', weight: '0' });
  assert.equal((await freshConfig()).steering.techniques.rorschach, 0);
  await post('/studio/techniques/x-ray', { action: 'weight', weight: '3' });
  assert.deepEqual((await freshConfig()).steering.techniques, { rorschach: 0, 'x-ray': 3 });
  await post('/studio/techniques/rorschach', { action: 'weight', weight: '1' });
  await post('/studio/techniques/x-ray', { action: 'weight', weight: '1' });
  assert.deepEqual(await readOverlay(root), {}, 'back to normal leaves nothing behind');

  await post('/studio/techniques/rorschach', { action: 'save', guidance: 'Two blots.' });
  assert.equal((await freshConfig()).techniques.rorschach, 'Two blots.');
  assert.match((await page('/studio')).html, /<span class="chip warn">edited<\/span>/);
  await post('/studio/techniques/rorschach', { action: 'restore' });
  assert.equal((await freshConfig()).techniques.rorschach, shipped.techniques.rorschach);

  assert.match(told(await post('/studio/techniques', { name: 'carbon-paper', guidance: 'Blue ghosts.' })), /"carbon-paper" is on the menu/);
  assert.equal((await freshConfig()).techniques['carbon-paper'], 'Blue ghosts.');
  assert.match(told(await post('/studio/techniques', { name: 'carbon-paper', guidance: 'Again.' })), /already on the menu/);
  assert.match(told(await post('/studio/techniques', { name: 'Not Kebab', guidance: 'x' })), /must be kebab-case/);
  await post('/studio/techniques/carbon-paper', { action: 'weight', weight: '2' });
  await post('/studio/techniques/carbon-paper', { action: 'remove' });
  assert.equal((await freshConfig()).techniques['carbon-paper'], undefined);
  assert.deepEqual(await readOverlay(root), {}, 'removing it takes its weight along');
  assert.match(told(await post('/studio/techniques/rorschach', { action: 'remove' })), /put it on the bench instead/);
  assert.equal((await post('/studio/techniques/nope', { action: 'save' })).status, 404);
});

test('the dare deck is one card per line; empty lines and doubles go', async () => {
  await post('/studio/dares', { dares: 'One.\n\nTwo.\nOne.\n' });
  assert.deepEqual((await freshConfig()).dares, ['One.', 'Two.']);
  await post('/studio/dares', { reset: '1' });
  assert.deepEqual((await freshConfig()).dares, shipped.dares);
});

test('the direction is saved per audience, kept as a revision, and noted on the floor', async () => {
  assert.match(told(await post('/studio/direction', { scouts: 'Only weather.', superstars: '', studio: 'No text.', warhol: '' })), /The scouts, studio hear it/);
  assert.equal((await readDirection(root)).studio, 'No text.');
  assert.match((await page('/studio')).html, />No text\.<\/textarea>/);
  assert.match(told(await post('/studio/direction', { scouts: 'Only weather.', superstars: '', studio: 'No text.', warhol: '' })), /Nothing changed/);
  await post('/studio/direction', { scouts: 'Only rain.', superstars: '', studio: 'No text.', warhol: '' });
  assert.equal((await listRevisions(config, 'direction', 'direction')).length, 1);
  await post('/studio/direction', { scouts: '', superstars: '', studio: '', warhol: '' });
});

// ---------- the souls ----------

const soulForm = (soul, change = {}) => ({ baseHash: soul.hash, body: soul.role.body, name: soul.role.name, temperature: String(soul.role.temperature), max_tokens: String(soul.role.maxTokens), reasoning: String(soul.role.reasoning ?? ''), model: soul.role.model ?? '', ...change });

test('a soul edited on the page is on disk, loads, and leaves a version behind', async () => {
  const soul = await readSoul(config, 'viva');
  const res = await post('/souls/viva', soulForm(soul, { body: `${soul.role.body}\n\nShe never sleeps.`, temperature: '1.25' }));
  assert.equal(res.status, 303);
  assert.match(told(res), /Saved\. It counts from the next call/);
  const after_ = await readSoul(config, 'viva');
  assert.match(after_.role.body, /She never sleeps\./);
  assert.equal(after_.role.temperature, 1.25);
  assert.match(after_.raw, /^reads: \[subject\.posted, chatter\.posted\]$/m, 'the rest of the frontmatter is as it was');
  const [revision] = await listRevisions(config, 'roles', 'viva');
  assert.equal((await post(`/souls/viva/history/${revision.id}`, { baseHash: after_.hash })).status, 303);
  assert.equal((await readSoul(config, 'viva')).raw.includes('She never sleeps.'), false, 'back to the earlier version');
  assert.match((await page(`/souls/viva/history/${revision.id}`)).html, /The same as the current text/);
});

test('a refused soul keeps your text in the box and changes nothing', async () => {
  const soul = await readSoul(config, 'warhol');
  const res = await post('/souls/warhol', soulForm(soul, { body: `${soul.role.body}\n\nAnd {{wibble}}, darling.` }));
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, /Not saved:/);
  assert.match(html, /\{\{wibble\}\} isn&#39;t something this role is given/);
  assert.match(html, /And \{\{wibble\}\}, darling\.<\/textarea>/);
  assert.equal((await readSoul(config, 'warhol')).raw, soul.raw);

  const bad = await post('/souls/warhol', soulForm(soul, { temperature: '9' }));
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /value="9"/, 'the settings as typed stay too');
});

test('an edit made in a text editor is never overwritten by a stale page, and neither is lost', async () => {
  const soul = await readSoul(config, 'brigid');
  await writeFile(soul.path, `${soul.raw}\nFrom the editor.\n`);
  const res = await post('/souls/brigid', soulForm(soul, { body: 'Mine, typed in the browser. {{subjects}} {{floor}} {{pile}} {{lines}}' }));
  assert.equal(res.status, 409);
  const html = await res.text();
  assert.match(html, /The file changed on disk while you were editing/);
  assert.match(html, /Mine, typed in the browser\./);
  assert.match((await readSoul(config, 'brigid')).raw, /From the editor\./);
  // Saving again, on purpose, replaces it; the editor's version goes in the history.
  const newest = (await readSoul(config, 'brigid')).hash;
  assert.equal((await post('/souls/brigid', soulForm(soul, { baseHash: newest, body: 'Mine now. {{subjects}} {{floor}} {{pile}} {{lines}}' }))).status, 303);
  const [kept] = await listRevisions(config, 'roles', 'brigid');
  assert.match(await readFile(join(config.paths.archive, 'revisions', 'roles', 'brigid', `${kept.id}.md`), 'utf8'), /From the editor\./);
  await post(`/souls/brigid/history/${kept.id}`, { baseHash: (await readSoul(config, 'brigid')).hash });
  await writeFile(soul.path, soul.raw);
});

test('the editor checks as you type', async () => {
  const soul = await readSoul(config, 'warhol');
  const check = async (change) => (await post('/souls/warhol/check', soulForm(soul, change))).json();
  assert.deepEqual(await check({}), { errors: [], warnings: [], used: ['subject', 'chatter', 'taste', 'direction', 'variants', 'max_picks'], stale: false });
  assert.match((await check({ body: soul.role.body.replace('{{taste}}', '') })).warnings[0], /\{\{taste\}\} is gone/);
  assert.match((await check({ body: `${soul.role.body} {{x}}` })).errors[0], /\{\{x\}\}/);
  assert.equal((await check({ baseHash: 'old' })).stale, true);
});

test('a soul that doesn\'t load can be opened, and fixed, from the page', async () => {
  const soul = await readSoul(config, 'ondine');
  await writeFile(soul.path, '---\nid: ondine\nname: [broken\n---\nbody');
  const list = await page('/souls');
  assert.match(list.html, /<span class="chip bad">broken<\/span>/);
  const open = await page('/souls/ondine');
  assert.equal(open.status, 200);
  assert.match(open.html, /This file doesn't load/);
  assert.match(open.html, /not valid YAML/, 'the real reason, also on a second read');
  assert.match(open.html, /<textarea class="code body" id="raw" name="raw"/, 'edited as a whole file');

  const broken = (await readSoul(config, 'ondine')).hash;
  const stillBad = await post('/souls/ondine', { baseHash: broken, raw: '---\nid: nope\n---\nbody' });
  assert.equal(stillBad.status, 422);
  assert.match(await stillBad.text(), /id: nope/, 'your text stays');
  assert.equal((await post('/souls/ondine', { baseHash: broken, raw: soul.raw })).status, 303);
  assert.equal((await readSoul(config, 'ondine')).raw, soul.raw);
});

test('the cast changes from the page; the Factory\'s own roles can\'t be benched', async () => {
  assert.match(told(await post('/souls/cast', { id: 'edie', name: 'Edie', voice: 'Whispers.' })), /Edie is on the floor from the next shift/);
  assert.match((await page('/souls')).html, /href="\/souls\/edie"/);
  assert.equal(told(await post('/souls/cast', { id: 'edie', name: 'Edie' })).includes('already a role'), true);
  assert.match(told(await post('/souls/edie/bench', {})), /has left the floor/);
  assert.match((await page('/souls')).html, /Bring Edie back/);
  assert.match(told(await post('/souls/recall', { id: 'edie' })), /Edie is back/);
  assert.match(told(await post('/souls/warhol/bench', {})), /can&#39;t be benched|can't be benched/);
  await post('/souls/edie/bench', {});
  await post('/souls/edie/audition', {}).then(async (r) => assert.match(told(r), /no role "edie"/));
  await post('/souls/nico/audition', {});
  assert.deepEqual((await lastJob()).args, ['audition', 'nico']);
  await settle();
});

// ---------- taste ----------

test('the words above the log can be rewritten; the log itself can\'t be touched', async () => {
  await appendTaste(config.paths.taste, { date: '2026-01-01', verdict: 'approved', variant: 'v01', subject: 'a can' });
  const before = (await readTaste(config.paths.taste)).entries;
  assert.match(told(await post('/taste', { header: '# Taste\n\nLoud.\n\n## Decisions\n\n- fake: forged line' })), /can't be in your words/);
  assert.match(told(await post('/taste', { header: '# Taste\n\nLoud things.' })), /Saved/);
  const after_ = await readTaste(config.paths.taste);
  assert.deepEqual(after_.entries, before);
  assert.match(after_.header, /Loud things\./);
  assert.ok((await listRevisions(config, 'taste', 'taste')).length >= 1);
  assert.match((await page('/taste')).html, /Loud things\./);
  assert.match(told(await post('/taste', { header: after_.header })), /Nothing changed/);
});

// ---------- the floor, the canon, the diary ----------

test('the floor filters by day, kind and actor; only safe days are read', async () => {
  assert.match((await page('/floor?type=studio.*')).html, /studio\.changed/);
  assert.doesNotMatch((await page('/floor?type=studio.*')).html, /subject\.posted/);
  assert.match((await page('/floor?shift=all&actor=human')).html, /human ·/);
  assert.match((await page('/floor?shift=..%2F..%2Fetc')).html, /The floor/);
});

test('a model call can be read in full', async () => {
  const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  await mkdir(join(config.paths.archive, 'transcripts'), { recursive: true });
  await writeFile(join(config.paths.archive, 'transcripts', `${id}.json`), JSON.stringify({ role: 'warhol', startedAt: 'now', request: { model: 'a/b', temperature: 0.4, messages: [{ role: 'system', content: 'You are <Andy>.' }, { role: 'user', content: [{ type: 'text', text: 'Choose.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,<omitted>' } }] }] }, response: { model: 'a/b', usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.1 }, choices: [{ finish_reason: 'stop', message: { content: 'Gee.' } }] } }));
  const { html } = await page(`/transcripts/${id}`);
  assert.match(html, /You are &lt;Andy&gt;\./);
  assert.match(html, /Choose\.\n\[image_url: data:image\/png/);
  assert.match(html, /Gee\./);
  assert.equal((await page('/transcripts/01ARZ3NDEKTSV4RRFFQ69G5FAW')).status, 404);
});

test('a label correction goes through a job: your words as they are, or Fred Hughes with a note', async () => {
  const work = { canonId: 'can-v01-x', seriesId: seeded.seriesId, variant: 'v01', technique: 'halftone', title: 'Soup', sketch: 'canon/works/can/sketch.html', poster: 'canon/works/can/poster.png', later: null, signature: 'abc', subjectTitle: 'campbell soup' };
  const e = await floor.append({ type: 'work.published', actor: 'printer', ref: seeded.seriesId, payload: work });
  await floor.append({ type: 'edition.released', actor: 'fred-hughes', ref: e.id, payload: { canonId: 'can-v01-x', edition: 1, title: 'Soup', wallText: 'A can.', channel: 'site' } });
  assert.match((await page('/canon')).html, /▸ No\. 001/);
  await post('/canon/1/retitle', { title: 'Soup (Again)', wall: 'A can.' });
  assert.deepEqual((await lastJob()).args, ['retitle', '1', '--title', 'Soup (Again)']);
  await post('/canon/1/retitle', { title: 'Soup', wall: 'A can.', fred: '1', note: 'Wrong year.' });
  assert.deepEqual((await lastJob()).args, ['retitle', '1', '--note', 'Wrong year.']);
  assert.match(told(await post('/canon/1/retitle', { title: 'Soup', wall: 'A can.' })), /the same as the one on the wall/);
  assert.equal((await post('/canon/9/retitle', {})).status, 404);
  await settle();
});

test('the diary reads as a page, with whatever a model wrote escaped', async () => {
  await mkdir(join(config.paths.archive, 'diary'), { recursive: true });
  await writeFile(join(config.paths.archive, 'diary', '2026-01-02.md'), '# Friday\n\n**Gee**, it was <script>big</script>.\n\n- one\n- two');
  const res = await fetch(`${base}/diary`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/diary/2026-01-02');
  const { html } = await page('/diary/2026-01-02');
  assert.match(html, /<strong>Gee<\/strong>, it was &lt;script&gt;big/);
  assert.match(html, /<li>two<\/li>/);
  assert.equal((await page('/diary/2026-01-03')).status, 404);
  assert.equal((await page('/diary/..%2F..%2Ftaste')).status, 404);
});

test('the gallery is served as built, sketches in a sandbox; the Vercel link isn\'t', async () => {
  await mkdir(join(config.paths.site, 'works', 'x'), { recursive: true });
  await mkdir(join(config.paths.site, '.vercel'), { recursive: true });
  await writeFile(join(config.paths.site, 'index.html'), '<h1>Gallery</h1>');
  await writeFile(join(config.paths.site, 'works', 'x', 'sketch.html'), '<script>1</script>');
  await writeFile(join(config.paths.site, '.vercel', 'project.json'), '{}');
  assert.equal((await fetch(`${base}/gallery`, { redirect: 'manual' })).status, 301);
  assert.match((await page('/gallery/')).html, /<h1>Gallery<\/h1>/);
  assert.equal((await fetch(`${base}/gallery/works/x/sketch.html`)).headers.get('content-security-policy'), 'sandbox allow-scripts');
  assert.equal((await fetch(`${base}/gallery/.vercel/project.json`)).status, 404);
});

// ---------- the system ----------

test('the shift can be paused and unpaused; a pause is on the floor', async () => {
  assert.match(told(await post('/system/pause', { paused: '1' })), /Paused\./);
  assert.equal((await freshConfig()).shift.paused, true);
  assert.match((await page('/')).html, /The daily shift is paused/);
  await post('/system/pause', { paused: '0' });
  assert.equal((await freshConfig()).shift.paused, undefined);
  assert.deepEqual(await readOverlay(root), {});
  const changes = (await floor.read({ type: 'studio.changed' })).slice(-2).map((e) => e.payload.summary);
  assert.deepEqual(changes, ['the daily shift: paused', 'the daily shift: back on']);
});

test('settings can all be reset; secrets are never on a page', async () => {
  await writeOverlay(root, { budget: { dailyUsd: 1 } });
  const { html } = await page('/system');
  assert.match(html, /&quot;dailyUsd&quot;: 1/);
  assert.match(html, /OpenRouter key/);
  assert.doesNotMatch(html, /OPENROUTER_API_KEY=/);
  assert.match(told(await post('/system/reset-settings', {})), /Everything comes from silver\.config\.js again/);
  assert.deepEqual(await readOverlay(root), {});
});

test('the restart button answers first, then asks the supervisor', async () => {
  const res = await post('/system/restart', {});
  assert.equal(res.status, 303);
  await sleep(250);
  assert.equal(restarted, 1);
});

test('a job can be stopped from the page, and a finished one says so', async () => {
  const done = await jobs.list({ limit: 1 });
  assert.match(told(await post(`/jobs/${done[0].id}/cancel`, {})), /already ended/);
  assert.match((await page('/jobs')).html, /<span class="chip ok">done<\/span>/);
});

test('the revisions a page writes are in the record, where the Archivist can see them', async () => {
  const e = (await floor.read({ type: 'studio.changed' })).find((x) => x.payload.what === 'role' && x.payload.path);
  await access(join(root, e.payload.path));
});
