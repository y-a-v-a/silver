// The direct line to Anthropic: which models take it, how a request and a reply are translated,
// and what happens when Anthropic won't answer (the call goes out again through OpenRouter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpFactory, roleFile, completion, anthropicReply, anthropicError } from './helpers.js';
import { anthropicModelId, effortFor, toAnthropicRequest, fromAnthropicMessage } from '../src/anthropic.js';
import { LlmError, LlmOutputError, REPAIR_PROMPT } from '../src/llm.js';
import { summarise } from '../src/budget.js';

const CLAUDE = 'anthropic/claude-test-1.5';
const KEY = 'sk-ant-test';
const roles = (fm = {}) => ({ 'technician.md': roleFile('technician', { model: CLAUDE, max_tokens: 300, ...fm }) });
const direct = (opts = {}) => tmpFactory({ roles: roles(opts.fm), ...opts, llm: { anthropicKey: KEY, ...opts.llm } });
const ask = (f, opts = {}) => f.llm.call('technician', { vars: { who: 'Danny' }, prompt: 'Status?', ...opts });
const isAnthropic = (req) => req.url === 'https://api.anthropic.com/v1/messages';
const isOpenRouter = (req) => req.url === 'https://openrouter.ai/api/v1/chat/completions';

// ---------- translation ----------

test('anthropicModelId turns an OpenRouter slug into an Anthropic id, and only for Claude', () => {
  assert.equal(anthropicModelId('anthropic/claude-opus-5.5'), 'claude-opus-5-5');
  assert.equal(anthropicModelId('anthropic/claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(anthropicModelId('anthropic/claude-haiku-4.5'), 'claude-haiku-4-5');
  for (const other of ['google/gemini-4-argon', 'openai/gpt-6-luna-pro', 'anthropic/claude-opus-5.5:thinking', '~anthropic/claude-opus-5.5', 'claude-opus-5-5', undefined]) {
    assert.equal(anthropicModelId(other), null, String(other));
  }
});

test('effortFor: effort levels pass, a thinking budget becomes its nearest level, off becomes low', () => {
  assert.equal(effortFor(undefined, 2000), undefined);
  assert.equal(effortFor({ effort: 'medium' }, 2000), 'medium');
  assert.equal(effortFor({ enabled: false }, 2000), 'low');
  assert.equal(effortFor({ max_tokens: 2000 }, 16000), 'low', 'the studio assistant: an eighth of the reply');
  assert.equal(effortFor({ max_tokens: 1000 }, 2000), 'medium');
  assert.equal(effortFor({ max_tokens: 3000 }, 4000), 'high');
});

test('toAnthropicRequest: system on top, images as base64 blocks, effort; no sampling or OpenRouter fields', () => {
  const params = toAnthropicRequest({
    model: 'anthropic/claude-opus-5.5',
    messages: [
      { role: 'system', content: 'You are Andy.' },
      { role: 'user', content: 'First.' },
      { role: 'assistant', content: 'Gee.' },
      { role: 'user', content: [{ type: 'text', text: 'Pick one.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } }, { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } }] },
    ],
    temperature: 1.1,
    max_tokens: 3000,
    usage: { include: true },
    reasoning: { effort: 'low' },
    models: ['anthropic/claude-opus-5.5', 'x/y'],
  });
  assert.deepEqual(params, {
    model: 'claude-opus-5-5',
    max_tokens: 3000,
    messages: [
      { role: 'user', content: 'First.' },
      { role: 'assistant', content: 'Gee.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Pick one.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/a.jpg' } },
        ],
      },
    ],
    system: 'You are Andy.',
    output_config: { effort: 'low' },
  });
  assert.equal(toAnthropicRequest({ model: CLAUDE, messages: [{ role: 'user', content: 'p' }], max_tokens: 10 }).output_config, undefined, 'no reasoning setting: the model\'s default');
  assert.throws(() => toAnthropicRequest({ model: 'google/gemini-4-argon', messages: [], max_tokens: 10 }), /not an Anthropic model/);
});

test('fromAnthropicMessage: text only, the slug it was asked by, stop reasons and tokens in our terms', () => {
  const data = fromAnthropicMessage(
    {
      id: 'msg_1',
      model: 'claude-opus-5-5',
      stop_reason: 'max_tokens',
      content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Half a ' }, { type: 'text', text: 'sketch' }],
      usage: { input_tokens: 90, cache_creation_input_tokens: 6, cache_read_input_tokens: 4, output_tokens: 50, output_tokens_details: { thinking_tokens: 30 } },
    },
    'anthropic/claude-opus-5.5',
  );
  assert.deepEqual(data, {
    id: 'msg_1',
    model: 'anthropic/claude-opus-5.5',
    provider: 'Anthropic',
    choices: [{ finish_reason: 'length', native_finish_reason: 'max_tokens', message: { role: 'assistant', content: 'Half a sketch' } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 30 } },
  });
  const finish = (stop_reason) => fromAnthropicMessage({ stop_reason, content: [] }, CLAUDE).choices[0].finish_reason;
  assert.deepEqual(['end_turn', 'stop_sequence', 'refusal', 'pause_turn'].map(finish), ['stop', 'stop', 'content_filter', 'pause_turn']);
});

// ---------- which line a call takes ----------

test('with the key, a Claude model goes straight to Anthropic; the call is costed from the price list', async () => {
  const f = await direct({ fm: { reasoning: 'low' }, replies: [anthropicReply('Rewired the projector.', { thinking: 7 })] });
  const res = await ask(f);

  assert.equal(res.content, 'Rewired the projector.');
  assert.equal(res.via, 'anthropic');
  assert.equal(res.model, CLAUDE);
  assert.equal(res.finishReason, 'stop');
  assert.equal(f.fetch.requests.length, 1);
  const [req] = f.fetch.requests;
  assert.ok(isAnthropic(req), req.url);
  assert.equal(req.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(req.body, {
    model: 'claude-test-1-5',
    max_tokens: 300,
    messages: [{ role: 'user', content: 'Status?' }],
    system: 'You are Danny.',
    output_config: { effort: 'low' },
    stream: true,
  });

  // 100 prompt tokens x 3e-6 + 27 completion tokens (7 of them thinking) x 15e-6
  assert.equal(res.usd.toFixed(8), (100 * 3e-6 + 27 * 15e-6).toFixed(8));
  const [cost] = await f.floor.read({ type: 'cost.recorded' });
  assert.equal(cost.id, res.id);
  assert.deepEqual(
    { ...cost.payload, usd: undefined, transcript: undefined },
    { role: 'technician', group: 'role', model: CLAUDE, requestedModel: CLAUDE, via: 'anthropic', provider: 'Anthropic', generationId: 'msg_test', promptTokens: 100, completionTokens: 27, reasoningTokens: 7, usd: undefined, estimated: true, finishReason: 'stop', transcript: undefined },
  );

  const raw = await readFile(join(f.root, res.transcript), 'utf8');
  assert.ok(!raw.includes(KEY), 'the API key must never reach a transcript');
  const transcript = JSON.parse(raw);
  assert.equal(transcript.via, 'anthropic');
  assert.equal(transcript.request.model, CLAUDE, 'the request as the role made it');
  assert.equal(transcript.response.choices[0].message.content, 'Rewired the projector.');
  assert.deepEqual(transcript.native.request, { model: 'claude-test-1-5', max_tokens: 300, output_config: { effort: 'low' } });
  assert.equal(transcript.native.response.stop_reason, 'end_turn');
  assert.deepEqual(transcript.attempts.map((a) => [a.via, a.status]), [['anthropic', 200]]);
});

test('other models stay on OpenRouter, and so does everything when there is no Anthropic key', async () => {
  const f = await direct({ replies: [completion('from the router')] });
  const res = await ask(f, { model: 'test/text' });
  assert.equal(res.via, 'openrouter');
  assert.ok(isOpenRouter(f.fetch.requests[0]));
  assert.equal(f.fetch.requests[0].headers.Authorization, 'Bearer test-key');
  const [cost] = await f.floor.read({ type: 'cost.recorded' });
  assert.equal(cost.payload.via, 'openrouter');
  assert.equal(cost.payload.fallback, undefined);

  const noKey = await tmpFactory({ roles: roles(), replies: [completion('also the router', { model: CLAUDE })] });
  assert.equal((await ask(noKey)).via, 'openrouter');
  assert.ok(isOpenRouter(noKey.fetch.requests[0]));
  assert.equal(noKey.fetch.requests[0].body.model, CLAUDE);
});

test('a dry run never takes the direct line: it runs on the cheap model', async () => {
  const f = await direct({ replies: [completion('dry')], llm: { dryRun: true } });
  assert.equal((await ask(f)).via, 'openrouter');
  assert.equal(f.fetch.requests[0].body.model, 'test/cheap');
});

test('images go to Anthropic as base64 blocks, are redacted in the transcript, and cost only their tokens', async () => {
  const f = await tmpFactory({ roles: { 'warhol.md': roleFile('warhol', { vision: true, model: CLAUDE }) }, replies: [anthropicReply('The second one.')], llm: { anthropicKey: KEY } });
  const png = join(f.root, 'v1.png');
  await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const res = await f.llm.call('warhol', { vars: { who: 'Andy' }, prompt: 'Pick one.', images: [png] });
  assert.deepEqual(f.fetch.requests[0].body.messages[0].content, [
    { type: 'text', text: 'Pick one.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
  ]);
  // No per-image price on top (the catalogue lists one): Anthropic counts an image as prompt tokens.
  assert.equal(res.usd.toFixed(8), (100 * 3e-6 + 20 * 15e-6).toFixed(8));
  const transcript = await readFile(join(f.root, res.transcript), 'utf8');
  assert.ok(!transcript.includes('iVBORw=='));
  assert.match(transcript, /<omitted 4 bytes sha256:[0-9a-f]+ from .*v1\.png>/);
});

// ---------- retries on the direct line ----------

test('the direct line retries rate limits (honouring Retry-After), overload, dropped connections and broken streams', async () => {
  const f = await direct({
    replies: [
      anthropicError(429, 'rate_limit_error', 'slow down', { 'retry-after': '3' }),
      anthropicError(529, 'overloaded_error', 'Overloaded'),
      new TypeError('fetch failed'),
      anthropicReply('', { breakAfterStart: { type: 'overloaded_error', message: 'Overloaded' } }),
      anthropicReply('ok'),
    ],
    llm: { maxRetries: 4 },
  });
  const res = await ask(f);
  assert.equal(res.content, 'ok');
  assert.equal(res.via, 'anthropic');
  assert.ok(f.fetch.requests.every(isAnthropic), 'no detour while retries last');
  assert.equal(f.sleeps.length, 4);
  assert.equal(f.sleeps[0], 3000);
  const { attempts } = JSON.parse(await readFile(join(f.root, res.transcript), 'utf8'));
  assert.deepEqual(attempts.map((a) => a.status), [429, 529, null, null, 200]);
  assert.match(attempts[2].error, /APIConnectionError.*fetch failed/);
  assert.match(attempts[3].error, /the reply broke off \(overloaded_error: Overloaded\)/);
  assert.equal((await f.floor.read({ type: 'cost.recorded' }))[0].payload.fallback, undefined);
});

test('x-should-retry overrules the status', async () => {
  const f = await direct({ replies: [anthropicError(400, 'invalid_request_error', 'try again', { 'x-should-retry': 'true' }), anthropicReply('ok')] });
  assert.equal((await ask(f)).via, 'anthropic');
  assert.equal(f.sleeps.length, 1);

  const g = await direct({ replies: [anthropicError(503, 'api_error', 'do not', { 'x-should-retry': 'false' }), completion('router', { model: CLAUDE })] });
  assert.equal((await ask(g)).via, 'openrouter');
  assert.equal(g.sleeps.length, 0);
});

// ---------- the fallback ----------

test('when Anthropic turns a call down (no credit), it goes out again through OpenRouter and says so', async () => {
  const low = 'Your credit balance is too low to access the Anthropic API.';
  const f = await direct({ fm: { reasoning: 2000, max_tokens: 16000 }, replies: [anthropicError(400, 'invalid_request_error', low), completion('Rewired, by the back door.', { model: CLAUDE, cost: 0.0042 })] });
  const res = await ask(f);

  assert.equal(res.content, 'Rewired, by the back door.');
  assert.equal(res.via, 'openrouter');
  assert.equal(res.usd, 0.0042);
  assert.equal(f.sleeps.length, 0, 'a refusal is not retried');
  assert.ok(isAnthropic(f.fetch.requests[0]) && isOpenRouter(f.fetch.requests[1]));
  // OpenRouter gets the request as the role wrote it: its own slug, temperature and reasoning field.
  const sent = f.fetch.requests[1].body;
  assert.deepEqual([sent.model, sent.temperature, sent.reasoning, sent.max_tokens], [CLAUDE, 0.4, { max_tokens: 2000 }, 16000]);
  assert.deepEqual(f.fetch.requests[0].body.output_config, { effort: 'low' });

  const [cost] = await f.floor.read({ type: 'cost.recorded' });
  assert.equal(cost.payload.via, 'openrouter');
  assert.equal(cost.payload.estimated, false);
  assert.deepEqual(cost.payload.fallback, { from: 'anthropic', status: 400, error: `Anthropic request failed: ${low}` });
  assert.deepEqual(await f.floor.read({ type: 'llm.failed' }), [], 'the call succeeded');
  const transcript = JSON.parse(await readFile(join(f.root, res.transcript), 'utf8'));
  assert.deepEqual(transcript.attempts.map((a) => [a.via, a.status]), [['anthropic', 400], ['openrouter', 200]]);
  assert.equal(transcript.native, undefined);
});

test('a bad key, an unknown model and an outage that outlasts the retries all fall back', async () => {
  for (const refusal of [anthropicError(401, 'authentication_error', 'invalid x-api-key'), anthropicError(404, 'not_found_error', 'model: claude-test-1-5')]) {
    const f = await direct({ replies: [refusal, completion('ok', { model: CLAUDE })] });
    assert.equal((await ask(f)).via, 'openrouter');
    assert.equal(f.fetch.requests.length, 2);
  }
  const busy = anthropicError(529, 'overloaded_error', 'Overloaded');
  const f = await direct({ replies: [busy, busy, busy, completion('ok', { model: CLAUDE })], llm: { maxRetries: 2 } });
  assert.equal((await ask(f)).via, 'openrouter');
  assert.equal(f.sleeps.length, 2);
  const [cost] = await f.floor.read({ type: 'cost.recorded' });
  assert.deepEqual(cost.payload.fallback, { from: 'anthropic', status: 529, error: 'Anthropic request failed: Overloaded' });
});

test('when both lines fail, the failure names the last one and keeps every attempt', async () => {
  const f = await direct({ replies: [anthropicError(401, 'authentication_error', 'invalid x-api-key'), { status: 402, body: { error: { code: 402, message: 'would exceed your available credits' } } }] });
  await assert.rejects(ask(f), (err) => {
    assert.ok(err instanceof LlmError);
    assert.match(err.message, /^OpenRouter request failed: would exceed/);
    assert.deepEqual(err.attempts.map((a) => [a.via, a.status]), [['anthropic', 401], ['openrouter', 402]]);
    return true;
  });
  const [failed] = await f.floor.read({ type: 'llm.failed' });
  assert.deepEqual([failed.payload.via, failed.payload.status, failed.payload.attempts.length], ['openrouter', 402, 2]);
  assert.deepEqual(await f.floor.read({ type: 'cost.recorded' }), []);
});

test('with only the Anthropic key: Claude runs, a failure has nowhere to go, other models have no line', async () => {
  const f = await direct({ replies: [anthropicReply('ok'), anthropicError(401, 'authentication_error', 'invalid x-api-key')], llm: { apiKey: undefined } });
  assert.equal((await ask(f)).via, 'anthropic');
  await assert.rejects(ask(f), /^LlmError: Anthropic request failed: invalid x-api-key/);
  assert.equal(f.fetch.requests.length, 2);
  const [failed] = await f.floor.read({ type: 'llm.failed' });
  assert.deepEqual([failed.payload.via, failed.payload.status], ['anthropic', 401]);
  await assert.rejects(ask(f, { model: 'test/text' }), /OPENROUTER_API_KEY is not set/);
});

// ---------- replies ----------

test('a reply cut off at max_tokens (thinking ate it) is costed, recorded and thrown, as on OpenRouter', async () => {
  const f = await direct({ replies: [anthropicReply('', { stop: 'max_tokens', thinking: 280 })] });
  await assert.rejects(ask(f), (err) => err instanceof LlmOutputError && /empty reply \(finish_reason: length\)/.test(err.message));
  const [cost] = await f.floor.read({ type: 'cost.recorded' });
  assert.deepEqual([cost.payload.finishReason, cost.payload.reasoningTokens, cost.payload.completionTokens], ['length', 280, 300]);
  assert.equal((await f.floor.read({ type: 'llm.failed' }))[0].payload.reason, 'empty');
});

test('a refusal is no reply, even with a few words in it; it is not sent round to OpenRouter', async () => {
  const f = await direct({ replies: [anthropicReply('I can', { stop: 'refusal' })] });
  await assert.rejects(ask(f), (err) => err instanceof LlmOutputError && /declined to answer/.test(err.message));
  assert.equal(f.fetch.requests.length, 1);
  assert.equal((await f.floor.read({ type: 'cost.recorded' })).length, 1, 'it was billed, so it is costed');
  const [failed] = await f.floor.read({ type: 'llm.failed' });
  assert.deepEqual([failed.payload.reason, failed.payload.finishReason], ['refused', 'content_filter']);
});

test('the JSON repair round stays on the direct line, as a continuation of the conversation', async () => {
  const f = await direct({ fm: { output: 'json' }, replies: [anthropicReply('I pick the silver one.'), anthropicReply('{"picks":["v3"]}')] });
  const res = await ask(f);
  assert.deepEqual(res.json, { picks: ['v3'] });
  assert.ok(f.fetch.requests.every(isAnthropic));
  assert.deepEqual(f.fetch.requests[1].body.messages, [
    { role: 'user', content: 'Status?' },
    { role: 'assistant', content: 'I pick the silver one.' },
    { role: 'user', content: REPAIR_PROMPT },
  ]);
  const costs = await f.floor.read({ type: 'cost.recorded' });
  assert.equal(costs.length, 2);
  assert.equal(costs[1].ref, costs[0].id);
});

// ---------- the ledger ----------

test('the ledger splits spend by line; calls from before the direct line count as OpenRouter', () => {
  const ev = (usd, via) => ({ type: 'cost.recorded', payload: { role: 'warhol', model: CLAUDE, usd, promptTokens: 10, completionTokens: 5, ...(via ? { via } : {}) } });
  const { byLine, total } = summarise([ev(0.3, 'anthropic'), ev(0.2, 'openrouter'), ev(0.1), ev(0.05, 'anthropic')]);
  assert.equal(total.toFixed(2), '0.65');
  assert.deepEqual([byLine.anthropic.calls, byLine.anthropic.usd.toFixed(2)], [2, '0.35']);
  assert.deepEqual([byLine.openrouter.calls, byLine.openrouter.usd.toFixed(2)], [2, '0.30']);
});
