import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFloor } from '../src/floor.js';
import { retireSubject, retiredSubjects, RetireError } from '../src/agents/retire.js';
import { findSubject, SeriesError } from '../src/agents/assistants.js';
import { pendingCommissions } from '../src/agents/commissions.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'silver-retire-'));
  const floor = createFloor({ dir: join(root, 'floor') });
  const post = (title, origin = 'scouted') => floor.append({ type: 'subject.posted', actor: origin === 'commission' ? 'human' : 'scout', payload: { origin, title } });
  return { root, floor, post };
}

test('retireSubject records subject.retired, and refuses non-subjects and repeats', async () => {
  const { floor, post } = await setup();
  const s = await post('Navy story from before the rule');
  const e = await retireSubject(floor, s, ' posted before the exclusion rule ');
  assert.equal(e.type, 'subject.retired');
  assert.equal(e.actor, 'human');
  assert.equal(e.ref, s.id);
  assert.deepEqual(e.payload, { subjectId: s.id, title: 'Navy story from before the rule', reason: 'posted before the exclusion rule' });
  assert.ok((await retiredSubjects(floor)).has(s.id));
  await assert.rejects(retireSubject(floor, s), (err) => err instanceof RetireError && /already retired/.test(err.message));
  await assert.rejects(retireSubject(floor, e), /only subjects/);
});

test('retired subjects are skipped by latest, refused by id, and hidden from pending commissions', async () => {
  const { floor, post } = await setup();
  const older = await post('An ordinary subject');
  const newer = await post('A retired subject');
  const commission = await post('A retired commission', 'commission');
  await retireSubject(floor, newer, 'test');
  await retireSubject(floor, commission);

  assert.equal((await findSubject(floor, 'latest')).id, older.id);
  await assert.rejects(findSubject(floor, newer.id.slice(-8)), (err) => err instanceof SeriesError && /was retired on .* \(test\)/.test(err.message));
  assert.deepEqual(await pendingCommissions(floor), []);
});

test('silver subjects --retire, and the R marker in listings', async () => {
  const { root, floor, post } = await setup();
  const s = await post('A subject to retire');
  await post('A subject to keep');
  const env = { ...process.env, SILVER_ROOT: root, OPENROUTER_API_KEY: '' };
  const run = (...args) => exec(process.execPath, [CLI, ...args], { env });

  const r = await run('subjects', '--retire', s.id.slice(-8), '--reason', 'before the rule');
  assert.match(r.stdout, /^retired [0-9A-Z]{8}: A subject to retire \(before the rule\)/);
  const list = await run('subjects');
  assert.match(list.stdout, /  R  --  A subject to retire/);
  const open = await run('subjects', '--open');
  assert.doesNotMatch(open.stdout, /A subject to retire/);
  assert.match(open.stdout, /A subject to keep/);
  await assert.rejects(run('subjects', '--retire', s.id), (err) => /already retired/.test(err.stderr));
  assert.equal((await floor.read({ type: 'subject.retired' })).length, 1);
});
