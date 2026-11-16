// Shared test fixtures. (node --test also loads this file; it defines no tests.)
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFloor } from '../src/floor.js';
import { createBudget } from '../src/budget.js';
import { createPricing } from '../src/pricing.js';
import { loadRoles } from '../src/roles.js';
import { createLlm } from '../src/llm.js';

export const MODELS_LIST = [
  { id: 'test/text', pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { input_modalities: ['text'] } },
  { id: 'test/vision', pricing: { prompt: '0.000002', completion: '0.000004', image: '0.001' }, architecture: { input_modalities: ['text', 'image'] } },
  { id: 'test/cheap', pricing: { prompt: '0', completion: '0.0000001' }, architecture: { input_modalities: ['text'] } },
  { id: 'anthropic/claude-test-1.5', pricing: { prompt: '0.000003', completion: '0.000015', image: '0.0048' }, architecture: { input_modalities: ['text', 'image'] } },
];

/** A role file as a string. */
export function roleFile(id, fm = {}, body = 'You are {{who}}.') {
  const front = { id, name: id, temperature: 0.4, output: 'text', reads: [], emits: [], ...fm };
  const yaml = Object.entries(front).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  return `---\n${yaml}\n---\n\n${body}\n`;
}

/** A successful chat completion body. */
export function completion(content, { cost = 0.001, model = 'test/text', finish = 'stop', usage = {} } = {}) {
  return {
    id: 'gen-test',
    model,
    provider: 'TestProvider',
    choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost, completion_tokens_details: { reasoning_tokens: 0 }, ...usage },
  };
}

/**
 * A successful Messages API reply, streamed as Anthropic streams it. Returns a function (a
 * queue entry for fakeFetch), because a Response can only be read once.
 * @param {string} text
 * @param {{stop?: string, model?: string, thinking?: number, usage?: object, breakAfterStart?: object}} [opts]
 *   thinking: thinking tokens to report (a thinking block comes first); breakAfterStart: an
 *   error event sent in place of the reply, once the stream has started
 */
export function anthropicReply(text, { stop = 'end_turn', model = 'claude-test-1-5', thinking = 0, usage = {}, breakAfterStart = null } = {}) {
  const outputTokens = 20 + thinking;
  const events = [
    ['message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, ...usage } } }],
  ];
  if (breakAfterStart) events.push(['error', { error: breakAfterStart }]);
  else {
    const blocks = [...(thinking ? [[{ type: 'thinking', thinking: '', signature: '' }, { type: 'signature_delta', signature: 'sig' }]] : []), ...(text ? [[{ type: 'text', text: '' }, { type: 'text_delta', text }]] : [])];
    blocks.forEach(([block, delta], index) => {
      events.push(['content_block_start', { index, content_block: block }], ['content_block_delta', { index, delta }], ['content_block_stop', { index }]);
    });
    events.push(
      ['message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outputTokens, ...(thinking ? { output_tokens_details: { thinking_tokens: thinking } } : {}) } }],
      ['message_stop', {}],
    );
  }
  const sse = events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join('');
  return () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
}

/** An Anthropic error reply, as a fakeFetch queue entry. */
export const anthropicError = (status, type, message, headers = {}) => ({ status, body: { type: 'error', error: { type, message } }, headers });

/**
 * A fake fetch. `/models` serves MODELS_LIST; every other request (OpenRouter's
 * `/chat/completions`, Anthropic's `/v1/messages`) replies from one queue whose entries are
 * bodies, {status, body, headers}, Errors (thrown), or functions.
 */
export function fakeFetch(queue = []) {
  const requests = [];
  const fn = async (url, init = {}) => {
    url = String(url);
    if (url.endsWith('/models')) return Response.json({ data: MODELS_LIST });
    const body = init.body ? JSON.parse(init.body) : null;
    // The Anthropic SDK hands over a Headers object; plain lookups work on a plain one.
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers;
    requests.push({ url, headers, body });
    if (!queue.length) throw new Error('fakeFetch: no queued reply');
    let next = queue.shift();
    if (typeof next === 'function') next = await next(body);
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    if (next && 'status' in next && 'body' in next) {
      return Response.json(next.body, { status: next.status, headers: next.headers ?? {} });
    }
    return Response.json(next);
  };
  fn.requests = requests;
  fn.queue = queue;
  return fn;
}

/**
 * A complete temporary factory: config, floor, roles, budget, pricing, llm.
 * @param {{roles?: Record<string, string>, dailyUsd?: number, replies?: any[], llm?: object}} [opts]
 */
export async function tmpFactory({ roles: roleFiles = {}, dailyUsd = 5, replies = [], llm: llmOpts = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'silver-factory-'));
  const rolesDir = join(root, 'roles');
  for (const [path, text] of Object.entries(roleFiles)) {
    await mkdir(join(rolesDir, path, '..'), { recursive: true });
    await writeFile(join(rolesDir, path), text);
  }
  const config = {
    root,
    models: { studio: ['test/text'], roles: { technician: 'test/text', scout: 'test/text', warhol: 'test/vision', printer: 'test/vision', 'fred-hughes': 'test/text', archivist: 'test/text', superstar: 'test/cheap' }, dryRun: 'test/cheap' },
    budget: { dailyUsd, chatterShare: 0.1 },
    review: { port: 0, tasteEntriesInPrompt: 40 },
    printer: { holdSeconds: 1 },
    superstars: { linesPerShift: 3, proposeChance: 0.34, pileSize: 8 },
    deploy: { provider: 'vercel', project: 'silver-test', siteUrl: null },
    paths: { roles: rolesDir, floor: join(root, 'floor'), archive: join(root, 'archive'), canon: join(root, 'canon'), site: join(root, 'site'), taste: join(root, 'taste.md') },
  };
  const fetch = fakeFetch(replies);
  const floor = createFloor({ dir: config.paths.floor });
  const roles = await loadRoles({ dir: rolesDir, models: config.models });
  const budget = createBudget({ floor, dailyUsd, chatterShare: 0.1 });
  const pricing = createPricing({ fetch });
  const sleeps = [];
  const llm = createLlm({
    config,
    floor,
    roles,
    budget,
    pricing,
    apiKey: 'test-key',
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    ...llmOpts,
  });
  return { root, config, fetch, floor, roles, budget, pricing, llm, sleeps };
}

/**
 * A local mock of OpenRouter's HTTP API for end-to-end CLI tests.
 * `models` is served at /models; `reply()` answers each chat completion and may
 * return {status, body} for errors.
 */
export async function mockOpenRouter({ models = [], reply = () => completion('ok') } = {}) {
  const { createServer } = await import('node:http');
  const requests = [];
  const state = { models, reply };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: state.models }));
    if (req.method === 'GET') return res.end(JSON.stringify({ data: {} }));
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
    const r = state.reply(JSON.parse(raw));
    res.statusCode = r.status ?? 200;
    res.end(JSON.stringify(r.body ?? r));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    requests,
    state,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * A local mock of Anthropic's HTTP API for end-to-end CLI tests. `reply()` answers each
 * Messages request with an anthropicReply() or an anthropicError(); `models` are the ids
 * GET /v1/models/:id knows.
 */
export async function mockAnthropic({ models = [], reply = () => anthropicReply('ok') } = {}) {
  const { createServer } = await import('node:http');
  const requests = [];
  const state = { models, reply };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.method === 'GET') {
      const id = decodeURIComponent(req.url.split('/').pop());
      res.setHeader('content-type', 'application/json');
      res.statusCode = state.models.includes(id) ? 200 : 404;
      return res.end(JSON.stringify(res.statusCode === 200 ? { type: 'model', id, display_name: id } : { type: 'error', error: { type: 'not_found_error', message: `model: ${id}` } }));
    }
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
    const r = state.reply(JSON.parse(raw));
    const response = typeof r === 'function' ? r() : Response.json(r.body, { status: r.status, headers: r.headers ?? {} });
    res.statusCode = response.status;
    res.setHeader('content-type', response.headers.get('content-type'));
    res.end(await response.text());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    state,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * fetch that serves `routes[url]` and records requests: string -> text, object -> JSON,
 * number -> that status, Error -> thrown, function -> its (Response) return value.
 */
export function routeFetch(routes) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, headers: init?.headers });
    const r = routes[url];
    if (r === undefined) return new Response('not found', { status: 404 });
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r(url, init);
    if (typeof r === 'number') return new Response('', { status: r });
    return typeof r === 'string' ? new Response(r) : Response.json(r);
  };
  fn.seen = seen;
  return fn;
}

/**
 * Put a finished series on the floor, with stub PNGs for the produced variants.
 * @param {{floor: object, root: string}} f
 * @param {{produced?: string[], failed?: string[], subject?: object}} [opts]
 */
export async function seedSeries(f, { produced = ['v01', 'v02', 'v03'], failed = ['v04'], subject: subjectPayload = {} } = {}) {
  const { writeFile: write, mkdir: mk } = await import('node:fs/promises');
  const subject = await f.floor.append({
    type: 'subject.posted',
    actor: 'scout',
    payload: { origin: 'scouted', title: 'campbell soup', why: 'The can.', sensitive: { flag: false, reason: null }, ...subjectPayload },
  });
  const started = await f.floor.append({ type: 'series.started', actor: 'studio-assistant', ref: subject.id, payload: { subjectId: subject.id, subjectTitle: 'campbell soup' } });
  const seriesId = started.id;
  const dir = join(f.root, 'archive', 'variants', seriesId);
  await mk(dir, { recursive: true });
  const techniques = ['halftone', 'grid-repeat'];
  for (const [i, v] of produced.entries()) {
    await write(join(dir, `${v}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, i]));
    await write(join(dir, `${v}.html`), `<html>${v}</html>`);
    await f.floor.append({
      type: 'variant.produced',
      actor: 'studio-assistant',
      ref: seriesId,
      payload: { seriesId, variant: v, technique: techniques[i % 2], temperature: 0.7, model: 'test/text', path: `archive/variants/${seriesId}/${v}.html`, png: `archive/variants/${seriesId}/${v}.png`, rendered: true },
    });
  }
  for (const v of failed) {
    await f.floor.append({ type: 'variant.failed', actor: 'renderer', ref: seriesId, payload: { seriesId, variant: v, technique: 'halftone', temperature: 1.1, requestedModel: 'test/text', stage: 'blank', error: 'uniform' } });
  }
  await f.floor.append({ type: 'series.completed', actor: 'studio-assistant', ref: seriesId, payload: { seriesId, subjectId: subject.id, produced, failed: failed.map((v) => ({ variant: v, stage: 'blank' })), contactSheet: `archive/variants/${seriesId}/index.html` } });
  return { subject, seriesId, dir };
}

/** Approve (or veto) variants of a seeded series, as the review page would. */
export async function decide(f, seriesId, verdicts) {
  const out = [];
  for (const [variant, verdict, note = null] of verdicts) {
    out.push(await f.floor.append({ type: 'review.decision', actor: 'human', ref: seriesId, payload: { seriesId, variant, verdict, note } }));
  }
  return out;
}

/** A fake renderer for the Printer: writes stub PNGs; `failHold` makes the later look fail. */
export function fakePrintRenderer({ failHold = null } = {}) {
  const calls = [];
  return {
    calls,
    async render(path, { pngPath }) {
      const { writeFile: write } = await import('node:fs/promises');
      calls.push(['render', path]);
      await write(pngPath(1), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
      return { ok: true, reason: null, shots: [{ seed: 1, png: pngPath(1) }], errors: [], blocked: [], readySignal: true, ms: 1 };
    },
    async hold(path, { pngPath, holdMs }) {
      const { writeFile: write } = await import('node:fs/promises');
      calls.push(['hold', path, holdMs]);
      await write(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]));
      if (failHold) return { ok: false, reason: failHold, png: pngPath, errors: failHold === 'error' ? ['ReferenceError: later is not defined'] : [], blank: failHold === 'blank', colors: 1, ms: 1 };
      return { ok: true, reason: null, png: pngPath, errors: [], blank: false, colors: 30, ms: 1 };
    },
  };
}
