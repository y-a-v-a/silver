import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, completion, seedSeries, decide, fakePrintRenderer } from './helpers.js';
import { publish, publishQueue, withPublishLock, PublishBusy } from '../src/publish.js';
import { deployVercel, parseDeployUrl, DeployError } from '../src/deploy.js';
import { createReviewServer } from '../src/tools/review/server.js';

const role = (name) => readFile(new URL(`../roles/${name}.md`, import.meta.url), 'utf8');
const ROLES = { 'printer.md': await role('printer'), 'fred-hughes.md': await role('fred-hughes') };

function replyFor(body) {
  const system = body.messages[0].content;
  if (system.startsWith('You are the master printer')) return completion(JSON.stringify({ verdict: 'ok', note: 'Fine.' }), { cost: 0.001 });
  if (system.startsWith('You are Fred Hughes')) return completion(JSON.stringify({ title: 'Soup (Again)', wallText: 'A can.' }), { cost: 0.002 });
  throw new Error('unexpected role');
}

async function setup() {
  const f = await tmpFactory({ roles: ROLES });
  f.fetch.queue.push(...Array.from({ length: 50 }, () => (body) => replyFor(body)));
  const s = await seedSeries(f);
  let renderers = 0;
  const createRenderer = async () => {
    renderers++;
    return { ...fakePrintRenderer(), close: async () => {} };
  };
  return { ...f, ...s, createRenderer, renderers: () => renderers };
}

// ---------- deploy ----------

test('parseDeployUrl takes the last URL the CLI printed', () => {
  assert.equal(parseDeployUrl('Inspect: https://vercel.com/x/y\nProduction: https://silver-abc.vercel.app [2s]\n'), 'https://silver-abc.vercel.app');
  assert.equal(parseDeployUrl('nothing'), null);
});

test('deployVercel links once, then deploys --prod; never leaks the token', async () => {
  const f = await tmpFactory();
  await mkdir(f.config.paths.site, { recursive: true });
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin.split('/').pop(), ...args]);
    if (args[0] === 'link') {
      await mkdir(join(f.config.paths.site, '.vercel'), { recursive: true });
      await writeFile(join(f.config.paths.site, '.vercel', 'project.json'), '{}');
      return { stdout: '', stderr: '' };
    }
    return { stdout: 'https://silver-test-abc.vercel.app\n', stderr: '' };
  };
  const first = await deployVercel({ config: f.config }, { token: 'tok', run });
  assert.deepEqual(first, { url: 'https://silver-test-abc.vercel.app', linked: true });
  assert.deepEqual(calls[0], ['vercel', 'link', '--project', 'silver-test', '--yes', '--token', 'tok', '--cwd', f.config.paths.site]);
  assert.deepEqual(calls[1].slice(0, 3), ['vercel', 'deploy', '--prod']);
  const second = await deployVercel({ config: f.config }, { token: 'tok', run });
  assert.equal(second.linked, false);
  assert.equal(calls.length, 3, 'no second link');

  await assert.rejects(deployVercel({ config: f.config }, { token: '' }), (e) => e instanceof DeployError && /VERCEL_TOKEN is not set/.test(e.message));
  const failing = async () => { throw Object.assign(new Error('x'), { stderr: 'Error: token tok-secret is invalid' }); };
  await assert.rejects(deployVercel({ config: f.config }, { token: 'tok-secret', run: failing }), (e) => /token \*\*\* is invalid/.test(e.message) && !e.message.includes('tok-secret'));
});

// ---------- the pipeline ----------

test('publish prints approvals, releases editions, builds the site and deploys once', async () => {
  const s = await setup();
  await decide(s, s.seriesId, [['v01', 'approved'], ['v02', 'approved'], ['v03', 'vetoed']]);
  const deploys = [];
  const deploy = async () => {
    deploys.push(1);
    return { url: 'https://silver-test.vercel.app' };
  };
  const r = await publish({ config: s.config, floor: s.floor, llm: s.llm, createRenderer: s.createRenderer, deploy });
  assert.equal(r.printed.length, 2);
  assert.deepEqual(r.released.map((e) => e.payload.edition), [1, 2]);
  assert.equal(r.site.works, 2);
  assert.equal(r.deployed.type, 'site.deployed');
  assert.equal(r.deployed.payload.url, 'https://silver-test.vercel.app');
  await access(join(s.config.paths.site, 'index.html'));

  const again = await publish({ config: s.config, floor: s.floor, llm: s.llm, createRenderer: s.createRenderer, deploy });
  assert.deepEqual([again.printed.length, again.released.length, again.deployed], [0, 0, null], 'nothing new: no reprint, no redeploy');
  assert.equal(deploys.length, 1);
  assert.equal(s.renderers(), 1, 'no renderer when there is nothing to print');

  const { retitleEdition } = await import('../src/agents/hughes.js');
  await retitleEdition({ config: s.config, floor: s.floor, llm: null }, { edition: 1, title: 'Soup (Corrected)' });
  const corrected = await publish({ config: s.config, floor: s.floor, llm: s.llm, createRenderer: s.createRenderer, deploy });
  assert.equal(corrected.deployed?.type, 'site.deployed', 'a correction is deployed');
  const forced = await publish({ config: s.config, floor: s.floor, llm: s.llm, createRenderer: s.createRenderer, deploy }, { redeploy: true });
  assert.equal(forced.deployed?.type, 'site.deployed', '--redeploy deploys without changes');
  assert.equal(deploys.length, 3);
});

test('a failed deploy is reported and nothing else is lost', async () => {
  const s = await setup();
  await decide(s, s.seriesId, [['v01', 'approved']]);
  const r = await publish({ config: s.config, floor: s.floor, llm: s.llm, createRenderer: s.createRenderer, deploy: async () => { throw new DeployError('vercel deploy failed: nope'); } });
  assert.equal(r.printed.length, 1);
  assert.equal(r.released.length, 1);
  assert.match(r.deployError, /nope/);
  assert.equal((await s.floor.read({ type: 'site.deployed' })).length, 0);
});

test('one publish at a time; a lock left by a dead process is taken over', async () => {
  const f = await tmpFactory();
  let release;
  const holding = withPublishLock(f.config, () => new Promise((r) => (release = r)));
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(withPublishLock(f.config, async () => 'x'), PublishBusy);
  release('done');
  assert.equal(await holding, 'done');
  await writeFile(join(f.config.paths.canon, '.publish.lock'), '999999');
  assert.equal(await withPublishLock(f.config, async () => 'taken over'), 'taken over');
});

test('publishQueue runs one at a time and coalesces requests made while running', async () => {
  let runs = 0;
  let gate;
  const results = [];
  const q = publishQueue(async () => {
    runs++;
    await new Promise((r) => (gate = r));
    return runs;
  }, (err, r) => results.push(err ? err.message : r));
  q.request();
  q.request();
  q.request();
  await new Promise((r) => setTimeout(r, 5));
  gate();
  await new Promise((r) => setTimeout(r, 5));
  gate();
  await q.idle();
  assert.equal(runs, 2, 'three requests while busy -> exactly one more run');
  assert.deepEqual(results, [1, 2]);
});

// ---------- the review server triggers it ----------

test('the review server asks for a publish after each new approval, not after vetoes or repeats', async () => {
  const s = await setup();
  let requests = 0;
  const srv = createReviewServer({ config: s.config, floor: s.floor, onApproved: () => requests++ });
  const url = await srv.listen(0);
  const post = (form) => fetch(`${url}/series/${s.seriesId}/decide`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: url }, body: new URLSearchParams(form) });
  try {
    const res = await post({ variant: 'v01', verdict: 'approved' });
    assert.match(decodeURIComponent(res.headers.get('location')), /Printing and publishing in the background/);
    await post({ variant: 'v01', verdict: 'approved' });
    await post({ variant: 'v02', verdict: 'vetoed' });
    assert.equal(requests, 1);

    await publish({ config: s.config, floor: s.floor, llm: s.llm, createRenderer: s.createRenderer, deploy: null });
    const page = await (await fetch(`${url}/series/${s.seriesId}`)).text();
    assert.match(page, /<span class="badge ok">No\. 001<\/span>/);
  } finally {
    await srv.close();
  }
});
