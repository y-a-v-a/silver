// Retracting a work: off the gallery and out of the feed, its number empty for good, everything
// kept on the record; and putting it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Parser from 'rss-parser';
import { tmpFactory, completion, seedSeries, decide, fakePrintRenderer } from './helpers.js';
import { printApproved } from '../src/agents/printer.js';
import { releaseEditions, retitleEdition, RetitleError, takenTitles } from '../src/agents/hughes.js';
import { findWork, reinstateWork, retractWork, RetractError, MAX_REASON } from '../src/agents/retract.js';
import { buildCanon, CANON_EVENTS, galleryEventCount, onTheWall, readCanon, readCanonState, workName } from '../src/canon.js';
import { buildSite, atomFeed } from '../src/site.js';
import { canonChangedSinceDeploy, publish, publishWhenFree, withPublishLock, PublishBusy } from '../src/publish.js';
import { digest, buildManifest } from '../src/agents/archivist.js';
import { summarizeEvent } from '../src/lib/format.js';
import { validateEvent } from '../src/events.js';

const role = (name) => readFile(new URL(`../roles/${name}.md`, import.meta.url), 'utf8');
const ROLES = { 'printer.md': await role('printer'), 'fred-hughes.md': await role('fred-hughes') };
const label = (title) => completion(JSON.stringify({ title, wallText: `Wall ${title.toLowerCase()}.` }));

/** Three approved, printed works of one series; not yet numbered. */
async function printed({ approve = ['v01', 'v02', 'v03'], siteUrl = null } = {}) {
  const f = await tmpFactory({ roles: ROLES });
  f.config.deploy = { ...f.config.deploy, siteUrl };
  const s = await seedSeries(f, { subject: { url: 'https://example.com/soup' } });
  await decide(f, s.seriesId, approve.map((v) => [v, 'approved']));
  await printApproved({ config: f.config, floor: f.floor, llm: null, renderer: fakePrintRenderer() });
  return { ...f, ...s };
}

/** ...and numbered No. 001-003: Alpha, Bravo, Charlie. */
async function released(opts) {
  const f = await printed(opts);
  f.fetch.queue.push(label('Alpha'), label('Bravo'), label('Charlie'));
  const { released: out } = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(out.map((e) => e.payload.edition), [1, 2, 3]);
  return f;
}

const byEdition = async (f, n) => (await readCanon(f.floor)).find((w) => w.edition === n);

// ---------- the canon ----------

test('buildCanon: the latest retraction or reinstatement counts; the number and signature stay', () => {
  const ev = (id, type, payload) => ({ id, ts: `2026-11-16T10:00:0${id.slice(-1)}Z`, type, payload });
  const events = [
    ev('W1', 'work.published', { canonId: 'a', signature: 's' }),
    ev('E2', 'edition.released', { canonId: 'a', edition: 1, title: 'A', wallText: 'wa' }),
    ev('R3', 'work.retracted', { canonId: 'a', reason: 'wrong' }),
    ev('R4', 'work.retracted', { canonId: 'nobody' }),
  ];
  const [w] = buildCanon(events);
  assert.deepEqual([w.edition, w.signature, w.retracted], [1, 's', { at: '2026-11-16T10:00:03Z', reason: 'wrong', eventId: 'R3' }]);
  assert.equal(onTheWall(w), false);
  assert.equal(buildCanon(events).length, 1, 'a retraction of an unknown work is ignored');

  const [back] = buildCanon([...events, ev('B5', 'work.reinstated', { canonId: 'a' })]);
  assert.deepEqual([back.retracted, back.reinstatedAt, onTheWall(back)], [null, '2026-11-16T10:00:05Z', true]);
  const [again] = buildCanon([...events, ev('B5', 'work.reinstated', { canonId: 'a' }), ev('R6', 'work.retracted', { canonId: 'a', reason: 'no' })]);
  assert.equal(again.retracted.reason, 'no');

  // Retracted before Fred Hughes numbered it (he was mid-call): numbered, and still retracted.
  const [late] = buildCanon([ev('W1', 'work.published', { canonId: 'b' }), ev('R2', 'work.retracted', { canonId: 'b' }), ev('E3', 'edition.released', { canonId: 'b', edition: 4, title: 'B', wallText: 'wb' })]);
  assert.deepEqual([late.edition, Boolean(late.retracted), onTheWall(late)], [4, true, false]);
});

test('findWork takes an edition number in any spelling, or a canon id for a work with no number yet', async () => {
  const f = await released();
  const canon = await readCanon(f.floor);
  for (const ref of ['2', '002', 'No. 2', 'No.002', 'no 2', 2]) assert.equal(findWork(canon, ref).edition, 2, String(ref));
  assert.equal(findWork(canon, canon[0].canonId), canon[0]);
  assert.throws(() => findWork(canon, '9'), (e) => e instanceof RetractError && e.status === 404 && /no edition No\. 009/.test(e.message));
  assert.throws(() => findWork(canon, 'nope-v01-x'), /no work "nope-v01-x"/);
  assert.throws(() => findWork(canon, ''), /which work\?/);
  assert.throws(() => findWork(canon, undefined), /which work\?/);
});

test('retract and put back: events by the human on the floor, canon.json follows, nothing deleted', async () => {
  const f = await released();
  const w = await byEdition(f, 2);
  const { event, work } = await retractWork({ config: f.config, floor: f.floor }, { ref: '2', reason: '  An invented number.  ' });
  assert.deepEqual(validateEvent(event), []);
  assert.deepEqual([event.type, event.actor, event.ref], ['work.retracted', 'human', w.workEventId]);
  assert.deepEqual(event.payload, { canonId: w.canonId, edition: 2, title: 'Bravo', subjectTitle: 'campbell soup', variant: w.variant, reason: 'An invented number.' });
  assert.equal(work.canonId, w.canonId);

  const json = JSON.parse(await readFile(join(f.config.paths.canon, 'canon.json'), 'utf8'));
  assert.equal(json.works.length, 3, 'still in the canon');
  assert.equal(json.works.find((x) => x.edition === 2).retracted.reason, 'An invented number.');
  await access(join(f.config.root, w.sketch)); // its files stay where the Printer put them

  await assert.rejects(retractWork({ config: f.config, floor: f.floor }, { ref: 2 }), (e) => e.status === 409 && /No\. 002 was already retracted on \d{4}-\d{2}-\d{2}/.test(e.message));
  await assert.rejects(reinstateWork({ config: f.config, floor: f.floor }, { ref: 1 }), /No\. 001 isn't retracted: it's on the wall/);
  await assert.rejects(retractWork({ config: f.config, floor: f.floor }, { ref: 1, reason: 'x'.repeat(MAX_REASON + 1) }), /at most 1000 characters/);
  assert.equal((await f.floor.read({ type: 'work.retracted' })).length, 1, 'refusals leave no events');

  const back = await reinstateWork({ config: f.config, floor: f.floor }, { ref: 'No. 002' });
  assert.deepEqual([back.event.type, back.event.actor, back.event.payload.replaces], ['work.reinstated', 'human', event.id]);
  assert.equal(onTheWall(await byEdition(f, 2)), true);

  // No reason is fine, and recorded as none.
  const bare = await retractWork({ config: f.config, floor: f.floor }, { ref: 3 });
  assert.equal(bare.event.payload.reason, null);
});

// ---------- Fred Hughes ----------

test('a number is never given twice: a retracted edition keeps its own, and the next work counts on', async () => {
  const f = await released({ approve: ['v01', 'v02', 'v03'] });
  await retractWork({ config: f.config, floor: f.floor }, { ref: 3, reason: 'gone' });
  await decide(f, f.seriesId, [['v01', 'vetoed']]); // a decision in between changes nothing
  // A new approval in a second series of the same subject, printed and released.
  const s2 = await seedSeries(f, { produced: ['v01'], failed: [] });
  await decide(f, s2.seriesId, [['v01', 'approved']]);
  await printApproved({ config: f.config, floor: f.floor, llm: null, renderer: fakePrintRenderer() });
  f.fetch.queue.push(label('Delta'));
  const { released: out } = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(out.map((e) => [e.payload.edition, e.payload.title]), [[4, 'Delta']]);
  const canon = await readCanon(f.floor);
  assert.deepEqual(canon.map((w) => [w.edition, Boolean(w.retracted)]), [[1, false], [2, false], [3, true], [4, false]]);
});

test('a work retracted before it had a number is never numbered, even mid-call; put back, it is', async () => {
  const f = await printed();
  const canon = await readCanon(f.floor);
  const [first, second, third] = canon.map((w) => w.canonId);
  await retractWork({ config: f.config, floor: f.floor }, { ref: first, reason: 'approved by mistake' });
  // The human retracts the second while Fred Hughes is writing its label.
  f.fetch.queue.push(async () => {
    await retractWork({ config: f.config, floor: f.floor }, { ref: second });
    return label('Bravo');
  }, label('Charlie'));
  const { released: out, failed } = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(failed, []);
  assert.deepEqual(out.map((e) => [e.payload.canonId, e.payload.edition]), [[third, 1]], 'the third is No. 001: no number went to the other two');
  assert.equal(f.fetch.requests.length, 2, 'no call at all for the one retracted beforehand');

  assert.equal(workName((await readCanon(f.floor)).find((w) => w.canonId === first)), first, 'named by its id until it has a number');
  await reinstateWork({ config: f.config, floor: f.floor }, { ref: first });
  f.fetch.queue.push(label('Alpha'));
  const later = await releaseEditions({ config: f.config, floor: f.floor, llm: f.llm });
  assert.deepEqual(later.released.map((e) => [e.payload.canonId, e.payload.edition]), [[first, 2]]);
});

test('a retracted title stays taken, marked, so putting it back never doubles a title on the wall', async () => {
  const f = await released();
  const canon = await readCanon(f.floor);
  const probe = { canonId: 'new', subjectId: canon[0].subjectId, seriesId: canon[0].seriesId };
  assert.match(takenTitles(canon, probe), /- Bravo \(No\. 002\)$/m);
  await retractWork({ config: f.config, floor: f.floor }, { ref: 2 });
  const taken = takenTitles(await readCanon(f.floor), probe);
  assert.match(taken, /- Alpha \(No\. 001\)$/m);
  assert.match(taken, /- Bravo \(No\. 002, retracted\)$/m);
});

test('a retracted work\'s label is not corrected: nobody can see it; put back, it can be', async () => {
  const f = await released();
  await retractWork({ config: f.config, floor: f.floor }, { ref: 2 });
  await assert.rejects(retitleEdition({ config: f.config, floor: f.floor, llm: f.llm }, { edition: 2, note: 'x' }), (e) => e instanceof RetitleError && /No\. 002 is retracted: put it back first \(silver retract 2 --undo --no-publish\)/.test(e.message));
  assert.equal(f.fetch.requests.length, 3, 'no call was paid for');
  await reinstateWork({ config: f.config, floor: f.floor }, { ref: 2 });
  const fixed = await retitleEdition({ config: f.config, floor: f.floor, llm: null }, { edition: 2, title: 'Bravo (Corrected)' });
  assert.equal(fixed.payload.title, 'Bravo (Corrected)');
});

// ---------- the gallery ----------

test('the gallery: off the wall, out of the feed, neighbours skip it, and its address says only that it was retracted', async () => {
  const f = await released({ siteUrl: 'https://silver.example' });
  const gone = await byEdition(f, 2);
  const { event } = await retractWork({ config: f.config, floor: f.floor }, { ref: 2, reason: 'A private reason.' });
  const site = await buildSite({ config: f.config, floor: f.floor });
  assert.deepEqual([site.works, site.retracted, site.canonEvents], [2, 1, 7], '3 printed, 3 released, 1 retracted');
  assert.ok(event.id);

  const index = await readFile(join(site.dir, 'index.html'), 'utf8');
  assert.doesNotMatch(index, new RegExp(gone.canonId));
  assert.doesNotMatch(index, /Bravo/);
  assert.match(index, /2 editions\./);

  const dir = join(site.dir, 'works', gone.canonId);
  assert.deepEqual(await readdir(dir), ['index.html'], 'no sketch, no poster');
  const tomb = await readFile(join(dir, 'index.html'), 'utf8');
  assert.match(tomb, /<meta name="robots" content="noindex">/);
  assert.match(tomb, /No\. 002/);
  assert.match(tomb, /Retracted\./);
  assert.match(tomb, /taken off the wall on \d{4}-\d{2}-\d{2}/);
  for (const secret of [/Bravo/, /Wall bravo/, /A private reason/, /sketch\.html/, /poster\.png/, /og:image/, /campbell/i]) assert.doesNotMatch(tomb, secret);
  assert.match(tomb, /<a href="\.\.\/\.\.\/">Back to the wall<\/a>/);

  const first = await readFile(join(site.dir, 'works', (await byEdition(f, 1)).canonId, 'index.html'), 'utf8');
  assert.match(first, /No\. 003 →/, 'No. 001 links on to No. 003');
  assert.doesNotMatch(first, /No\. 002/);

  const about = await readFile(join(site.dir, 'about', 'index.html'), 'utf8');
  assert.match(about, /One edition has been retracted/);
  assert.doesNotMatch(about, /A private reason/);

  const xml = await readFile(join(site.dir, 'feed.xml'), 'utf8');
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom" xmlns:at="http:\/\/purl\.org\/atompub\/tombstones\/1\.0">/);
  assert.match(xml, new RegExp(`<at:deleted-entry ref="tag:silver-factory,2026:${gone.canonId}" when="${event.ts}"/>`));
  assert.match(xml, new RegExp(`<updated>${event.ts}</updated>\\n  <rights>Works`), 'the feed changed when the work left it');
  assert.doesNotMatch(xml, /A private reason|Bravo/);
  const feed = await new Parser().parseString(xml);
  assert.deepEqual(feed.items.map((i) => i.title), ['No. 003: Charlie', 'No. 001: Alpha']);
});

test('put back, it is on the wall under its own number, and new to a feed reader', async () => {
  const f = await released();
  await retractWork({ config: f.config, floor: f.floor }, { ref: 2 });
  const { event } = await reinstateWork({ config: f.config, floor: f.floor }, { ref: 2 });
  const site = await buildSite({ config: f.config, floor: f.floor });
  assert.deepEqual([site.works, site.retracted], [3, 0]);
  const w = await byEdition(f, 2);
  assert.deepEqual((await readdir(join(site.dir, 'works', w.canonId))).sort(), ['index.html', 'poster.png', 'sketch.html']);
  assert.match(await readFile(join(site.dir, 'works', w.canonId, 'index.html'), 'utf8'), /<h2>Bravo<\/h2>/);
  const xml = await readFile(join(site.dir, 'feed.xml'), 'utf8');
  assert.doesNotMatch(xml, /deleted-entry|xmlns:at/);
  const feed = await new Parser().parseString(xml);
  assert.equal(feed.items.length, 3);
  assert.match(xml, new RegExp(`<id>tag:silver-factory,2026:${w.canonId}</id>[\\s\\S]*?<published>${w.releasedAt}</published>\\s*<updated>${event.ts}</updated>`));
  assert.doesNotMatch(await readFile(join(site.dir, 'about', 'index.html'), 'utf8'), /retracted/);
});

test('atomFeed with only retractions is still a valid feed', async () => {
  const xml = atomFeed([], null, [{ canonId: 'x-v01-aaaaaa', retracted: { at: '2026-11-16T10:00:00.000Z' } }]);
  assert.match(xml, /<at:deleted-entry ref="tag:silver-factory,2026:x-v01-aaaaaa" when="2026-11-16T10:00:00\.000Z"\/>/);
  assert.match(xml, /<updated>2026-11-16T10:00:00\.000Z<\/updated>/);
  assert.equal((await new Parser().parseString(xml)).items.length, 0);
});

test('an unnumbered retracted work leaves no trace on the gallery: it was never there', async () => {
  const f = await printed({ approve: ['v01'] });
  const [w] = await readCanon(f.floor);
  await retractWork({ config: f.config, floor: f.floor }, { ref: w.canonId });
  const site = await buildSite({ config: f.config, floor: f.floor });
  assert.deepEqual([site.works, site.retracted], [0, 0]);
  await assert.rejects(access(join(site.dir, 'works')));
  assert.doesNotMatch(await readFile(join(site.dir, 'feed.xml'), 'utf8'), /deleted-entry/);
});

// ---------- publishing ----------

function replyFor(body) {
  const system = body.messages[0].content;
  if (system.startsWith('You are the master printer')) return completion(JSON.stringify({ verdict: 'ok', note: 'Fine.' }));
  if (system.startsWith('You are Fred Hughes')) return completion(JSON.stringify({ title: 'Soup', wallText: 'A can.' }));
  throw new Error('unexpected role');
}

async function pipeline() {
  const f = await tmpFactory({ roles: ROLES });
  f.fetch.queue.push(...Array.from({ length: 30 }, () => (body) => replyFor(body)));
  const s = await seedSeries(f);
  await decide(f, s.seriesId, [['v01', 'approved'], ['v02', 'approved']]);
  const deploys = [];
  let during = null;
  const deps = {
    config: f.config,
    floor: f.floor,
    llm: f.llm,
    createRenderer: async () => ({ ...fakePrintRenderer(), close: async () => {} }),
    deploy: async () => {
      // What goes out: the works whose sketch is in the build (a tombstone has none).
      const dir = join(f.config.paths.site, 'works');
      const names = await readdir(dir).catch(() => []);
      let shown = 0;
      for (const n of names) shown += await access(join(dir, n, 'sketch.html')).then(() => 1, () => 0);
      deploys.push(shown);
      if (during) await during();
      return { url: 'https://silver-test.vercel.app' };
    },
  };
  return { ...f, ...s, deps, deploys, setDuring: (fn) => (during = fn) };
}

test('a retraction is deployed, and so is one that lands while a publish is deploying', async () => {
  const p = await pipeline();
  const first = await publish(p.deps);
  assert.deepEqual([first.site.works, first.deployed.payload.works, first.deployed.payload.retracted], [2, 2, 0]);
  assert.equal(first.deployed.payload.canonEvents, (await readCanonState(p.floor)).canonEvents);
  assert.equal((await publish(p.deps)).deployed, null, 'nothing new: no deploy');

  await retractWork({ config: p.config, floor: p.floor }, { ref: 1 });
  const second = await publish(p.deps);
  assert.equal(second.deployed?.type, 'site.deployed', 'a retraction is a change to the gallery');
  assert.deepEqual([second.site.works, second.site.retracted], [1, 1]);

  // No. 002 is retracted after the site was built, while it is being deployed: the gallery that
  // goes out still has it, so the next publish must deploy again, though the retraction is older
  // than that deploy on the floor.
  p.setDuring(() => retractWork({ config: p.config, floor: p.floor }, { ref: 2 }));
  const racing = await publish(p.deps, { redeploy: true });
  assert.equal(racing.deployed?.type, 'site.deployed');
  assert.equal(racing.site.works, 1, 'built before the retraction');
  assert.ok((await p.floor.read({ type: 'work.retracted' })).at(-1).id < racing.deployed.id, 'the retraction is older than the deploy on the floor');
  p.setDuring(null);
  assert.equal(await canonChangedSinceDeploy(p.floor), true);
  const caught = await publish(p.deps);
  assert.equal(caught.deployed?.type, 'site.deployed');
  assert.deepEqual([caught.site.works, caught.site.retracted], [0, 2]);
  assert.equal((await publish(p.deps)).deployed, null, 'and then nothing new again');
  assert.deepEqual(p.deploys, [2, 1, 1, 0]);
});

test('canonChangedSinceDeploy: deploys from before the count fall back to their place on the floor', async () => {
  const f = await tmpFactory();
  const w = await f.floor.append({ type: 'work.published', actor: 'printer', payload: { canonId: 'a' } });
  assert.equal(await canonChangedSinceDeploy(f.floor), true, 'never deployed');
  await f.floor.append({ type: 'site.deployed', actor: 'fred-hughes', payload: { url: 'u', works: 0 } });
  assert.equal(await canonChangedSinceDeploy(f.floor), false);
  await f.floor.append({ type: 'edition.released', actor: 'fred-hughes', ref: w.id, payload: { canonId: 'a', edition: 1, title: 'A', wallText: 'a' } });
  assert.equal(await canonChangedSinceDeploy(f.floor), true);
  await f.floor.append({ type: 'site.deployed', actor: 'fred-hughes', payload: { url: 'u', works: 1, canonEvents: 0 } });
  assert.equal(await canonChangedSinceDeploy(f.floor), true, 'built from an empty canon: everything on it is new');
});

test('the deploy mark is a count: an event whose id is older than the deploy still counts when it lands later', async () => {
  const f = await released();
  await f.floor.append({ type: 'site.deployed', actor: 'fred-hughes', payload: { url: 'u', works: 3, canonEvents: (await readCanonState(f.floor)).canonEvents } });
  assert.equal(await canonChangedSinceDeploy(f.floor), false);
  // Another process took its id before the deploy, and its line reaches the floor after it.
  const w = await byEdition(f, 1);
  const late = { id: '01000000000000000000000000', ts: new Date().toISOString(), shift: f.floor.today(), type: 'work.retracted', actor: 'human', ref: w.workEventId, payload: { canonId: w.canonId, edition: 1, title: 'Alpha', reason: null } };
  await writeFile(f.floor.pathFor(f.floor.today()), JSON.stringify(late) + '\n', { flag: 'a' });
  assert.ok(late.id < (await f.floor.read({ type: 'site.deployed' })).at(-1).id);
  assert.equal(await canonChangedSinceDeploy(f.floor), true);
});

test('retracting a work that never had a number is no change to the gallery, until it gets one', async () => {
  const f = await printed({ approve: ['v01', 'v02'] });
  const [a, b] = await readCanon(f.floor);
  const ofFloor = async () => galleryEventCount(await f.floor.read({ shift: 'all', type: [...CANON_EVENTS] }));
  const before = await ofFloor();
  await retractWork({ config: f.config, floor: f.floor }, { ref: a.canonId });
  await reinstateWork({ config: f.config, floor: f.floor }, { ref: a.canonId });
  await retractWork({ config: f.config, floor: f.floor }, { ref: b.canonId });
  assert.equal(await ofFloor(), before, 'never on the gallery: nothing to deploy');
  // b was numbered anyway, by a release that raced the retraction: now its retraction counts.
  await f.floor.append({ type: 'edition.released', actor: 'fred-hughes', ref: b.workEventId, payload: { canonId: b.canonId, edition: 1, title: 'B', wallText: 'b' } });
  assert.equal(await ofFloor(), before + 2, 'the release and the retraction');
});

test('the feed parses as strict, namespaced XML', async () => {
  const { parseStringPromise } = await import('xml2js');
  const f = await released({ siteUrl: 'https://silver.example' });
  await retractWork({ config: f.config, floor: f.floor }, { ref: 2, reason: 'a <b> & "c"' });
  const { dir } = await buildSite({ config: f.config, floor: f.floor });
  const doc = await parseStringPromise(await readFile(join(dir, 'feed.xml'), 'utf8'), { strict: true, xmlns: true });
  const feed = doc.feed;
  assert.equal(feed.$ns.uri, 'http://www.w3.org/2005/Atom');
  const [tomb] = feed['at:deleted-entry'];
  assert.equal(tomb.$ns.uri, 'http://purl.org/atompub/tombstones/1.0');
  assert.match(tomb.$.ref.value, /^tag:silver-factory,2026:campbell-soup-v02-/);
  assert.ok(!Number.isNaN(Date.parse(tomb.$.when.value)));
  assert.equal(feed.entry.length, 2);
});

test('publishWhenFree waits for the publish that is running, then publishes after it; it gives up in time', async () => {
  const p = await pipeline();
  let release;
  const holding = withPublishLock(p.config, () => new Promise((r) => (release = r)));
  await new Promise((r) => setTimeout(r, 10));
  const waits = [];
  const after = publishWhenFree(p.deps, {}, { pollMs: 5, onWait: (err) => waits.push(err.pid) });
  await new Promise((r) => setTimeout(r, 40));
  release();
  await holding;
  const result = await after;
  assert.equal(result.site.works, 2);
  assert.deepEqual(waits, [process.pid], 'told once, with who holds the lock');

  let again;
  const held = withPublishLock(p.config, () => new Promise((r) => (again = r)));
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(publishWhenFree(p.deps, {}, { waitMs: 0 }), PublishBusy);
  again();
  await held;
});

// ---------- the record ----------

test('the diary and the manifest hear about it; the floor says it in a line', async () => {
  const f = await released();
  await retractWork({ config: f.config, floor: f.floor }, { ref: 2, reason: 'An invented number.' });
  await reinstateWork({ config: f.config, floor: f.floor }, { ref: 2 });
  const s2 = await seedSeries(f, { produced: ['v01'], failed: [] });
  await decide(f, s2.seriesId, [['v01', 'approved']]);
  await printApproved({ config: f.config, floor: f.floor, llm: null, renderer: fakePrintRenderer() });
  const loose = (await readCanon(f.floor)).find((w) => w.edition === null);
  await retractWork({ config: f.config, floor: f.floor }, { ref: loose.canonId, reason: 'Clicked by mistake.' });
  await reinstateWork({ config: f.config, floor: f.floor }, { ref: loose.canonId });

  const { text } = digest(await f.floor.read({ shift: 'all' }));
  assert.match(text, /the human retracts No\. 2, "Bravo" \(An invented number\.\): it comes off the wall, and the number stays empty\./);
  assert.match(text, /the human puts No\. 2, "Bravo", back on the wall\./);
  assert.match(text, /the human retracts the print of v01 of "campbell soup" before it is numbered \(Clicked by mistake\.\)\./);
  assert.match(text, /the human takes back the retraction of v01 of "campbell soup"; it waits for its number\./);

  const manifest = await buildManifest(f.config, f.floor, f.floor.today());
  assert.deepEqual(manifest.retractions.map((r) => [r.edition, r.retracted]), [[2, true], [2, false], [null, true], [null, false]]);
  assert.equal(manifest.retractions[0].reason, 'An invented number.');

  const [retracted, reinstated] = await f.floor.read({ type: ['work.retracted', 'work.reinstated'] });
  assert.equal(summarizeEvent(retracted), 'No. 002 retracted: Bravo (An invented number.)');
  assert.equal(summarizeEvent(reinstated), 'No. 002 back on the wall: Bravo');
});

test('a retraction never touches taste.md: it is not a veto', async () => {
  const f = await released();
  await writeFile(f.config.paths.taste, '# Taste\n');
  await retractWork({ config: f.config, floor: f.floor }, { ref: 1, reason: 'I changed my mind about the colour.' });
  assert.equal(await readFile(f.config.paths.taste, 'utf8'), '# Taste\n');
});
