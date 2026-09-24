import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, appendFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFloor, shiftOf } from '../src/floor.js';
import { validateEvent, typeMatches, EventError, EVENT_TYPES } from '../src/events.js';

const tmp = () => mkdtemp(join(tmpdir(), 'silver-floor-'));

/** A clock that starts at `iso` and advances one second per call. */
function clock(iso) {
  let t = Date.parse(iso);
  return () => new Date((t += 1000));
}

test('shiftOf uses the local calendar date', () => {
  assert.equal(shiftOf(new Date(2026, 8, 24, 23, 59)), '2026-09-24');
  assert.equal(shiftOf(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
});

test('typeMatches supports exact, prefix.* and *', () => {
  assert.ok(typeMatches('cost.recorded', 'cost.recorded'));
  assert.ok(typeMatches('series.*', 'series.started'));
  assert.ok(!typeMatches('series.*', 'subject.posted'));
  assert.ok(typeMatches('*', 'anything'));
});

test('append fills the envelope and writes one line to the shift file', async () => {
  const dir = await tmp();
  const floor = createFloor({ dir, now: clock('2026-09-24T08:00:00') });
  const e = await floor.append({ type: 'subject.posted', actor: 'scout', payload: { title: 'Soup' } });
  assert.deepEqual(validateEvent(e), []);
  assert.equal(e.shift, '2026-09-24');
  assert.equal(e.ref, null);
  const text = await readFile(join(dir, '2026-09-24.jsonl'), 'utf8');
  assert.deepEqual(JSON.parse(text), e);
});

test('append rejects invalid events and writes nothing', async () => {
  const dir = await tmp();
  const floor = createFloor({ dir });
  await assert.rejects(floor.append({ type: 'subject.invented', actor: 'scout' }), EventError);
  await assert.rejects(floor.append({ type: 'subject.posted', actor: 'Scout!' }), /actor/);
  await assert.rejects(floor.append({ type: 'subject.posted', actor: 'scout', ref: 'nope' }), /ref/);
  await assert.rejects(floor.append({ type: 'subject.posted', actor: 'scout', payload: [] }), /payload/);
  assert.deepEqual(await readdir(dir).catch(() => []), []);
});

test('append accepts a caller-supplied ULID (used to match transcripts)', async () => {
  const floor = createFloor({ dir: await tmp() });
  const e = await floor.append({ id: '01K5ZZZZZZZZZZZZZZZZZZZZZZ', type: 'cost.recorded', actor: 'scout' });
  assert.equal(e.id, '01K5ZZZZZZZZZZZZZZZZZZZZZZ');
});

test('concurrent appends keep id order on disk', async () => {
  const floor = createFloor({ dir: await tmp() });
  const written = await Promise.all(
    Array.from({ length: 50 }, (_, i) => floor.append({ type: 'chatter.posted', actor: 'superstar.brigid', payload: { i } })),
  );
  const onDisk = await floor.read();
  assert.equal(onDisk.length, 50);
  assert.deepEqual(onDisk.map((e) => e.id), written.map((e) => e.id).sort());
  assert.deepEqual(onDisk.map((e) => e.payload.i), [...Array(50).keys()]);
});

test('read filters by type, prefix, actor, ref and since', async () => {
  const floor = createFloor({ dir: await tmp(), now: clock('2026-09-24T08:00:00') });
  const subject = await floor.append({ type: 'subject.posted', actor: 'scout' });
  const chat = await floor.append({ type: 'chatter.posted', actor: 'superstar.viva', ref: subject.id });
  await floor.append({ type: 'series.started', actor: 'assistant' });
  await floor.append({ type: 'series.completed', actor: 'orchestrator' });
  const q = (query) => floor.read({ shift: '2026-09-24', ...query }).then((es) => es.map((e) => e.type));

  assert.deepEqual(await q({ type: 'series.*' }), ['series.started', 'series.completed']);
  assert.deepEqual(await q({ type: ['subject.posted', 'chatter.posted'] }), ['subject.posted', 'chatter.posted']);
  assert.deepEqual(await q({ actor: 'superstar.viva' }), ['chatter.posted']);
  assert.deepEqual(await q({ ref: subject.id }), ['chatter.posted']);
  assert.deepEqual(await q({ since: chat.id }), ['series.started', 'series.completed']);
});

test('events land in the file of their own shift; read all spans shifts in order', async () => {
  const dir = await tmp();
  let now = new Date(2026, 8, 23, 23, 59, 58);
  const floor = createFloor({ dir, now: () => now });
  await floor.append({ type: 'shift.ended', actor: 'orchestrator' });
  now = new Date(2026, 8, 24, 9, 0, 0);
  await floor.append({ type: 'shift.started', actor: 'orchestrator' });
  assert.deepEqual(await floor.shifts(), ['2026-09-23', '2026-09-24']);
  assert.equal((await floor.read()).length, 1); // default: today
  assert.deepEqual((await floor.read({ shift: 'all' })).map((e) => e.type), ['shift.ended', 'shift.started']);
});

test('read on an empty floor returns nothing', async () => {
  const floor = createFloor({ dir: join(await tmp(), 'missing') });
  assert.deepEqual(await floor.read({ shift: 'all' }), []);
  assert.deepEqual(await floor.shifts(), []);
});

test('tail yields existing events, then new ones, and stops on abort', async () => {
  const floor = createFloor({ dir: await tmp() });
  await floor.append({ type: 'subject.posted', actor: 'scout' });
  const ac = new AbortController();
  const seen = [];
  const done = (async () => {
    for await (const e of floor.tail({ pollMs: 10, signal: ac.signal })) {
      seen.push(e.type);
      if (seen.length === 3) ac.abort();
    }
  })();
  await floor.append({ type: 'chatter.posted', actor: 'superstar.brigid' });
  await floor.append({ type: 'series.started', actor: 'assistant' });
  await done;
  assert.deepEqual(seen, ['subject.posted', 'chatter.posted', 'series.started']);
});

test('tail with fromEnd skips history and filters by type', async () => {
  const floor = createFloor({ dir: await tmp() });
  await floor.append({ type: 'cost.recorded', actor: 'scout' });
  const ac = new AbortController();
  const seen = [];
  const done = (async () => {
    for await (const e of floor.tail({ fromEnd: true, type: 'cost.*', pollMs: 10, signal: ac.signal })) {
      seen.push(e.actor);
      ac.abort();
    }
  })();
  await new Promise((r) => setTimeout(r, 30));
  await floor.append({ type: 'chatter.posted', actor: 'superstar.brigid' });
  await floor.append({ type: 'cost.recorded', actor: 'warhol' });
  await done;
  assert.deepEqual(seen, ['warhol']);
});

test('tail waits for a partially written line to complete', async () => {
  const dir = await tmp();
  const floor = createFloor({ dir });
  const path = floor.pathFor(floor.today());
  const ac = new AbortController();
  const seen = [];
  const done = (async () => {
    for await (const e of floor.tail({ pollMs: 10, signal: ac.signal })) {
      seen.push(e.payload.n);
      ac.abort();
    }
  })();
  const line = JSON.stringify({ id: '01K5ZZZZZZZZZZZZZZZZZZZZZZ', type: 'note', payload: { n: 7 } });
  await appendFile(path, line.slice(0, 20));
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, []);
  await appendFile(path, line.slice(20) + '\n');
  await done;
  assert.deepEqual(seen, [7]);
});

test('every documented event type is known', () => {
  assert.ok(EVENT_TYPES.includes('cost.recorded'));
  assert.ok(EVENT_TYPES.includes('review.decision'));
  assert.equal(new Set(EVENT_TYPES).size, EVENT_TYPES.length);
});
