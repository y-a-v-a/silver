import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpFactory, completion } from './helpers.js';
import { runSuperstars, validateChatter, formatFloor, formatSubjects, MAX_LINE } from '../src/agents/superstars.js';
import { runSeries } from '../src/agents/assistants.js';
import { buildSeriesViews } from '../src/agents/series-data.js';

const star = (id) => readFile(new URL(`../roles/superstars/${id}.md`, import.meta.url), 'utf8');
const CAST = { 'superstars/brigid.md': await star('brigid'), 'superstars/ondine.md': await star('ondine'), 'superstars/viva.md': await star('viva') };

async function setup(replies) {
  const f = await tmpFactory({ roles: CAST, replies });
  const soup = await f.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'Soup can redesign', source: 'rss', why: 'The can.' } });
  const chair = await f.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'Chair museum reopens', source: 'hackernews' } });
  return { ...f, soup, chair };
}

const reply = (lines, propose = null) => completion(JSON.stringify({ lines, propose }), { cost: 0.0004, model: 'test/cheap' });

test('validateChatter keeps valid lines, caps them, clips long ones and checks the pile', () => {
  const r = validateChatter(
    { lines: [{ subject: 1, text: '  I have it  on tape. ' }, { subject: 3, text: 'x' }, { subject: 2, text: '' }, { subject: 2, text: 'y'.repeat(400) }, { subject: 1, text: 'one too many' }], propose: { pile: 'P2', why: 'Better.' } },
    { subjects: 2, maxLines: 2, pileSize: 3 },
  );
  assert.deepEqual(r.lines.map((l) => l.subject), [1, 2]);
  assert.equal(r.lines[0].text, 'I have it on tape.');
  assert.equal(r.lines[1].text.length, MAX_LINE);
  assert.deepEqual(r.proposal, { pile: 2, why: 'Better.', sensitive: { flag: false, reason: null } });
  assert.equal(r.problems.length, 3);
  assert.match(validateChatter({ lines: [], propose: { pile: 1 } }, { subjects: 1, maxLines: 3, pileSize: 0 }).problems[0], /not shown/);
  assert.match(validateChatter({}, { subjects: 1, maxLines: 3, pileSize: 0 }).problems[0], /no "lines"/);
});

test('each superstar talks in turn and hears the ones before; chatter is cheap, capped and on the floor', async () => {
  const f = await setup([
    reply([{ subject: 1, text: 'I have the can on tape.' }]),
    reply([{ subject: 1, text: 'Brigid, darling, the can is Callas.' }, { subject: 2, text: 'A chair! Act three!' }]),
    reply([{ subject: 2, text: 'Boring.' }]),
  ]);
  const r = await runSuperstars({ config: f.config, floor: f.floor, llm: f.llm }, { subjects: [f.soup, f.chair], rng: () => 0.99 });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.chatter.map((e) => [e.actor, e.ref === f.soup.id ? 'soup' : 'chair']), [['superstar.brigid', 'soup'], ['superstar.ondine', 'soup'], ['superstar.ondine', 'chair'], ['superstar.viva', 'chair']]);
  assert.equal(r.chatter[0].payload.persona, 'brigid');

  const [b, o, v] = f.fetch.requests.map((q) => q.body);
  assert.equal(b.model, 'test/cheap');
  assert.match(b.messages[0].content, /You are Brigid/);
  assert.match(b.messages[0].content, /\[1\] Soup can redesign \(rss\)\n    why: The can\./);
  assert.match(b.messages[0].content, /nobody has said anything yet/);
  assert.match(b.messages[0].content, /the pile is not yours today/);
  assert.match(b.messages[1].content, /House rules:[\s\S]*facts are not/);
  assert.match(o.messages[0].content, /- brigid on \[1\]: I have the can on tape\./);
  assert.match(v.messages[0].content, /- ondine on \[2\]: A chair! Act three!/);

  const costs = await f.floor.read({ type: 'cost.recorded' });
  assert.ok(costs.every((c) => c.payload.group === 'superstar'));
  assert.ok((await f.budget.ledger()).chatter > 0);
});

test('one superstar may get the pile and push a subject; it is marked as theirs', async () => {
  const f = await setup([
    reply([{ subject: 1, text: 'Soup.' }], { pile: 'P2', why: 'Everyone has this lamp.', sensitive: { flag: false } }),
    reply([{ subject: 1, text: 'Soup!' }], { pile: 1 }),
    reply([]),
  ]);
  const pile = [
    { title: 'A bridge', source: 'rss', url: null },
    { title: 'The lamp everyone owns', source: 'reddit', url: null, snippet: '10k upvotes' },
  ];
  // rng: first < proposeChance (the pile is handed out), second picks cast[0] = brigid.
  const values = [0.1, 0.0];
  const r = await runSuperstars({ config: f.config, floor: f.floor, llm: f.llm }, { subjects: [f.soup], pile, rng: () => values.shift() ?? 0.5 });
  assert.equal(r.proposed.length, 1);
  const [p] = r.proposed;
  assert.deepEqual([p.actor, p.payload.origin, p.payload.proposedBy, p.payload.title, p.payload.why], ['superstar.brigid', 'superstar', 'brigid', 'The lamp everyone owns', 'Everyone has this lamp.']);
  assert.match(f.fetch.requests[0].body.messages[0].content, /\[P2\] \(reddit\) The lamp everyone owns\n    10k upvotes/);
  assert.match(f.fetch.requests[1].body.messages[0].content, /the pile is not yours today/);
  assert.deepEqual(r.problems, ['ondine: proposed from a pile it was not shown']);
});

test('the chatter share stops the superstars without failing; a broken reply only skips that one', async () => {
  const f = await setup([completion('not json at all'), completion('still not json'), reply([{ subject: 1, text: 'Fine.' }]), reply([{ subject: 1, text: 'Also fine.' }])]);
  const r = await runSuperstars({ config: f.config, floor: f.floor, llm: f.llm }, { subjects: [f.soup], rng: () => 0.99 });
  assert.equal(r.chatter.length, 2);
  assert.match(r.problems[0], /^brigid: /);

  const g = await setup([]);
  await g.floor.append({ type: 'cost.recorded', actor: 'superstar.viva', payload: { role: 'viva', group: 'superstar', usd: 0.5 } });
  const stopped = await runSuperstars({ config: g.config, floor: g.floor, llm: g.llm }, { subjects: [g.soup] });
  assert.match(stopped.stopped, /chatter budget exhausted/);
  assert.equal(g.fetch.requests.length, 0);
});

test('dry-run chatter is marked, and a real series or review never hears it', async () => {
  const f = await setup([reply([{ subject: 1, text: 'Dry.' }]), reply([]), reply([])]);
  await runSuperstars({ config: f.config, floor: f.floor, llm: f.llm }, { subjects: [f.soup], dryRun: true, rng: () => 0.99 });
  await f.floor.append({ type: 'chatter.posted', actor: 'superstar.viva', ref: f.soup.id, payload: { persona: 'viva', text: 'Real.' } });
  const events = await f.floor.read({ shift: 'all' });
  const real = { type: 'series.started', id: 'S1', ts: 'x', shift: 'x', actor: 'studio-assistant', ref: f.soup.id, payload: { subjectId: f.soup.id } };
  const dry = { ...real, id: 'S2', payload: { subjectId: f.soup.id, dryRun: true } };
  const none = { ...real, id: 'S3', payload: { subjectId: f.soup.id, chatter: false } };
  const views = new Map(buildSeriesViews([...events, real, dry, none]).map((v) => [v.seriesId, v]));
  assert.deepEqual(views.get('S1').chatter.map((e) => e.payload.text), ['Real.']);
  assert.deepEqual(views.get('S2').chatter.map((e) => e.payload.text), ['Dry.', 'Real.']);
  assert.deepEqual(views.get('S3').chatter, []);
});

test('formatFloor and formatSubjects number by the subjects on the floor', () => {
  const subjects = [{ id: 'A', payload: { title: 'One', source: 'rss', origin: 'commission' } }, { id: 'B', payload: { title: 'Two' } }];
  assert.equal(formatSubjects(subjects), '[1] One (rss, a commission)\n[2] Two');
  assert.equal(formatFloor([{ ref: 'B', actor: 'superstar.viva', payload: { text: 'Hm.' } }, { ref: 'Z', actor: 'x', payload: { text: 'elsewhere' } }], subjects), '- viva on [2]: Hm.');
});

test('runSeries puts the chatter in the assistants\' prompts, and --no-chatter leaves it out', async () => {
  const role = await readFile(new URL('../roles/studio-assistant.md', import.meta.url), 'utf8');
  const g = await tmpFactory({ roles: { 'studio-assistant.md': role }, replies: Array.from({ length: 4 }, () => completion('```js\nfunction setup(){ createCanvas(SILVER.width, SILVER.height); }\n```')) });
  g.config.series = { variants: 2, modelsPerSeries: 1, temperatures: [0.7], techniquesPerSeries: 2, concurrency: 1 };
  g.config.techniques = { halftone: 'Dots.', 'grid-repeat': 'Grid.' };
  const subject = await g.floor.append({ type: 'subject.posted', actor: 'scout', payload: { origin: 'scouted', title: 'Soup' } });
  await g.floor.append({ type: 'chatter.posted', actor: 'superstar.ondine', ref: subject.id, payload: { persona: 'ondine', text: 'Callas in a can!' } });
  await runSeries({ config: g.config, floor: g.floor, llm: g.llm, renderer: null }, subject.id);
  assert.match(g.fetch.requests[0].body.messages[0].content, /superstar\.ondine: Callas in a can!/);
  await runSeries({ config: g.config, floor: g.floor, llm: g.llm, renderer: null }, subject.id, { chatter: false });
  assert.doesNotMatch(g.fetch.requests[2].body.messages[0].content, /Callas/);
  const started = await g.floor.read({ type: 'series.started' });
  assert.deepEqual(started.map((e) => [e.payload.chatter, e.payload.chatterLines]), [[true, 1], [false, 0]]);
});
