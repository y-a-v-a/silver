import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, roleFile, completion } from './helpers.js';
import { parseJsonReply, backoffMs, reasoningParam, redactImages, LlmError, LlmOutputError, REPAIR_PROMPT } from '../src/llm.js';
import { BudgetExhausted } from '../src/budget.js';
import { TemplateError } from '../src/roles.js';

const TECH = { 'technician.md': roleFile('technician', { max_tokens: 300, reasoning: 'low' }) };
const JSONROLE = { 'technician.md': roleFile('technician', { output: 'json' }) };

// ---------- pure helpers ----------

test('parseJsonReply handles plain, fenced and embedded JSON', () => {
  assert.deepEqual(parseJsonReply('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonReply('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonReply('Sure! Here it is: {"picks": [1, 2]} Hope that helps.'), { picks: [1, 2] });
  assert.deepEqual(parseJsonReply('the list: [1, 2, 3]'), [1, 2, 3]);
  assert.throws(() => parseJsonReply('no json here'), SyntaxError);
});

test('backoffMs honours Retry-After, else grows exponentially with capped jitter', () => {
  assert.equal(backoffMs(0, '2'), 2000);
  assert.equal(backoffMs(0, '999'), 60_000);
  const noJitter = { random: () => 0 };
  assert.deepEqual([0, 1, 2, 3].map((a) => backoffMs(a, null, noJitter)), [1000, 2000, 4000, 8000]);
  assert.ok(backoffMs(0, null, { random: () => 0.999 }) < 1250);
  assert.equal(backoffMs(10, null, noJitter), 60_000);
});

test('reasoningParam maps role settings to the OpenRouter field', () => {
  assert.equal(reasoningParam(undefined), undefined);
  assert.deepEqual(reasoningParam('off'), { enabled: false });
  assert.deepEqual(reasoningParam('high'), { effort: 'high' });
});

test('redactImages replaces base64 payloads with a fingerprint and source', () => {
  const url = `data:image/png;base64,${Buffer.from('pixels').toString('base64')}`;
  const out = redactImages({ a: [{ image_url: { url } }], keep: 'data:text/plain,hello' }, new Map([[url, 'shot.png']]));
  assert.match(out.a[0].image_url.url, /^data:image\/png;base64,<omitted 6 bytes sha256:[0-9a-f]{16} from shot\.png>$/);
  assert.equal(out.keep, 'data:text/plain,hello');
});

// ---------- calls ----------

test('a text call builds the request from the role, archives a transcript and costs it on the floor', async () => {
  const f = await tmpFactory({ roles: TECH, replies: [completion('Rewired the projector.', { cost: 0.0042 })] });
  const res = await f.llm.call('technician', { vars: { who: 'Danny' }, prompt: 'Status?' });

  assert.equal(res.content, 'Rewired the projector.');
  assert.equal(res.usd, 0.0042);
  const [req] = f.fetch.requests;
  assert.equal(req.headers.Authorization, 'Bearer test-key');
  assert.equal(req.body.model, 'test/text');
  assert.equal(req.body.temperature, 0.4);
  assert.equal(req.body.max_tokens, 300);
  assert.deepEqual(req.body.reasoning, { effort: 'low' });
  assert.deepEqual(req.body.usage, { include: true });
  assert.deepEqual(req.body.messages, [
    { role: 'system', content: 'You are Danny.' },
    { role: 'user', content: 'Status?' },
  ]);

  const [cost] = await f.floor.read({ type: 'cost.recorded' });
  assert.equal(cost.id, res.id);
  assert.equal(cost.actor, 'technician');
  assert.equal(cost.payload.usd, 0.0042);
  assert.equal(cost.payload.estimated, false);
  assert.equal(cost.payload.transcript, `archive/transcripts/${res.id}.json`);

  const raw = await readFile(join(f.root, cost.payload.transcript), 'utf8');
  assert.ok(!raw.includes('test-key'), 'the API key must never reach a transcript');
  const transcript = JSON.parse(raw);
  assert.equal(transcript.id, res.id);
  assert.equal(transcript.request.model, 'test/text');
  assert.equal(transcript.response.choices[0].message.content, 'Rewired the projector.');
});

test('overrides: model, temperature, maxTokens, ref; dryRun forces the cheap model', async () => {
  const f = await tmpFactory({ roles: TECH, replies: [completion('a'), completion('b')] });
  const subject = await f.floor.append({ type: 'subject.posted', actor: 'scout' });
  await f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p', model: 'test/vision', temperature: 1.1, maxTokens: 50, ref: subject.id });
  const [req] = f.fetch.requests;
  assert.deepEqual([req.body.model, req.body.temperature, req.body.max_tokens], ['test/vision', 1.1, 50]);
  assert.equal((await f.floor.read({ type: 'cost.recorded' }))[0].ref, subject.id);

  const dry = await tmpFactory({ roles: TECH, replies: [completion('c')], llm: { dryRun: true } });
  await dry.llm.call('technician', { vars: { who: 'x' }, prompt: 'p', model: 'test/vision' });
  assert.equal(dry.fetch.requests[0].body.model, 'test/cheap');
});

test('retries 429 with Retry-After, then succeeds; attempts are in the transcript', async () => {
  const f = await tmpFactory({
    roles: TECH,
    replies: [{ status: 429, body: { error: { code: 429, message: 'slow down' } }, headers: { 'retry-after': '3' } }, completion('ok')],
  });
  const res = await f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' });
  assert.equal(res.content, 'ok');
  assert.deepEqual(f.sleeps, [3000]);
  const transcript = JSON.parse(await readFile(join(f.root, res.transcript), 'utf8'));
  assert.equal(transcript.attempts.length, 2);
  assert.equal(transcript.attempts[0].status, 429);
});

test('retries network errors and 200-with-upstream-error bodies', async () => {
  const f = await tmpFactory({
    roles: TECH,
    replies: [new TypeError('fetch failed'), { error: { code: 502, message: 'upstream down' } }, completion('ok')],
  });
  assert.equal((await f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' })).content, 'ok');
  assert.equal(f.sleeps.length, 2);
});

test('a 400 fails immediately, is recorded as llm.failed, and costs nothing', async () => {
  const f = await tmpFactory({ roles: TECH, replies: [{ status: 400, body: { error: { code: 400, message: 'bad model' } } }] });
  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' }), (err) => {
    assert.ok(err instanceof LlmError);
    assert.equal(err.status, 400);
    return true;
  });
  assert.equal(f.sleeps.length, 0);
  const [failed] = await f.floor.read({ type: 'llm.failed' });
  assert.match(failed.payload.error, /bad model/);
  assert.deepEqual(await f.floor.read({ type: 'cost.recorded' }), []);
});

test('gives up after maxRetries transient failures', async () => {
  const busy = { status: 503, body: { error: { code: 503, message: 'busy' } } };
  const f = await tmpFactory({ roles: TECH, replies: [busy, busy, busy], llm: { maxRetries: 2 } });
  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' }), (err) => err.attempts.length === 3);
  assert.equal(f.sleeps.length, 2);
});

test('an empty reply (reasoning ate max_tokens) is costed, recorded and thrown', async () => {
  const f = await tmpFactory({ roles: TECH, replies: [completion(null, { finish: 'length' })] });
  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' }), (err) => {
    assert.ok(err instanceof LlmOutputError);
    assert.match(err.message, /finish_reason: length/);
    return true;
  });
  assert.equal((await f.floor.read({ type: 'cost.recorded' })).length, 1);
  const [failed] = await f.floor.read({ type: 'llm.failed' });
  assert.equal(failed.payload.reason, 'empty');
});

test('json roles parse fenced replies', async () => {
  const f = await tmpFactory({ roles: JSONROLE, replies: [completion('```json\n{"picks":["v1"]}\n```')] });
  const res = await f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' });
  assert.deepEqual(res.json, { picks: ['v1'] });
  assert.equal(res.rounds.length, 1);
});

test('json roles get one repair round, costed separately and linked by ref', async () => {
  const f = await tmpFactory({ roles: JSONROLE, replies: [completion('I pick the silver one.'), completion('{"picks":["v3"]}')] });
  const res = await f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' });
  assert.deepEqual(res.json, { picks: ['v3'] });
  const repairMsgs = f.fetch.requests[1].body.messages;
  assert.deepEqual(repairMsgs.slice(-2), [
    { role: 'assistant', content: 'I pick the silver one.' },
    { role: 'user', content: REPAIR_PROMPT },
  ]);
  const costs = await f.floor.read({ type: 'cost.recorded' });
  assert.equal(costs.length, 2);
  assert.equal(costs[1].ref, costs[0].id);
});

test('json that stays broken after repair is recorded and thrown', async () => {
  const f = await tmpFactory({ roles: JSONROLE, replies: [completion('nope'), completion('still nope')] });
  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' }), LlmOutputError);
  const [failed] = await f.floor.read({ type: 'llm.failed' });
  assert.equal(failed.payload.reason, 'invalid-json');
});

test('without usage.cost, cost comes from pricing and is flagged as estimated', async () => {
  const f = await tmpFactory({ roles: TECH, replies: [completion('ok', { usage: { cost: undefined } })] });
  const res = await f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' });
  // test/text: 100 prompt tokens x 1e-6 + 20 completion tokens x 2e-6
  assert.equal(res.usd.toFixed(8), (100e-6 + 40e-6).toFixed(8));
  assert.equal((await f.floor.read({ type: 'cost.recorded' }))[0].payload.estimated, true);
});

test('images require a vision role; they are sent as data URLs and redacted in transcripts', async () => {
  const roles = { ...TECH, 'warhol.md': roleFile('warhol', { vision: true }) };
  const f = await tmpFactory({ roles, replies: [completion('The second one.')] });
  const png = join(f.root, 'v1.png');
  await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p', images: [png] }), /lacks vision: true/);
  await assert.rejects(f.llm.call('warhol', { vars: { who: 'x' }, prompt: 'p', images: [join(f.root, 'x.bmp')] }), /unsupported image type/);

  const res = await f.llm.call('warhol', { vars: { who: 'Andy' }, prompt: 'Pick one.', images: [png] });
  const user = f.fetch.requests[0].body.messages[1];
  assert.equal(user.content[0].text, 'Pick one.');
  assert.match(user.content[1].image_url.url, /^data:image\/png;base64,iVBORw==$/);
  assert.equal(f.fetch.requests[0].body.model, 'test/vision');

  const transcript = await readFile(join(f.root, res.transcript), 'utf8');
  assert.ok(!transcript.includes('iVBORw=='));
  assert.match(transcript, /<omitted 4 bytes sha256:[0-9a-f]+ from .*v1\.png>/);
});

test('an exhausted budget blocks the call before any request is made', async () => {
  const f = await tmpFactory({ roles: TECH, dailyUsd: 0.01, replies: [completion('never')] });
  await f.floor.append({ type: 'cost.recorded', actor: 'scout', payload: { role: 'scout', group: 'role', usd: 0.01 } });
  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' }, prompt: 'p' }), BudgetExhausted);
  assert.equal(f.fetch.requests.length, 0);
});

test('superstar calls count against the chatter share', async () => {
  const roles = { 'superstars/brigid.md': roleFile('brigid') };
  const f = await tmpFactory({ roles, dailyUsd: 1, replies: [completion('gossip')] });
  await f.floor.append({ type: 'cost.recorded', actor: 'superstar.viva', payload: { role: 'viva', group: 'superstar', usd: 0.1 } });
  await assert.rejects(f.llm.call('brigid', { vars: { who: 'x' }, prompt: 'p' }), (err) => err.scope === 'chatter');
});

test('input errors: no key, no user message, missing vars (strict) vs lenient', async () => {
  const noKey = await tmpFactory({ roles: TECH, llm: { apiKey: undefined } });
  await assert.rejects(noKey.llm.call('technician', { prompt: 'p' }), /OPENROUTER_API_KEY is not set/);

  const f = await tmpFactory({ roles: TECH, replies: [completion('ok')] });
  await assert.rejects(f.llm.call('technician', { vars: { who: 'x' } }), /needs a prompt/);
  await assert.rejects(f.llm.call('technician', { prompt: 'p' }), TemplateError);
  await f.llm.call('technician', { prompt: 'p', strict: false });
  assert.equal(f.fetch.requests[0].body.messages[0].content, 'You are [who].');
});
