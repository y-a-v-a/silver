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
 * A fake fetch. `/models` serves MODELS_LIST; `/chat/completions` replies from a queue
 * whose entries are bodies, {status, body, headers}, Errors (thrown), or functions.
 */
export function fakeFetch(queue = []) {
  const requests = [];
  const fn = async (url, init = {}) => {
    if (url.endsWith('/models')) return Response.json({ data: MODELS_LIST });
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, headers: init.headers, body });
    if (!queue.length) throw new Error('fakeFetch: no queued reply');
    let next = queue.shift();
    if (typeof next === 'function') next = await next(body);
    if (next instanceof Error) throw next;
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
    models: { studio: ['test/text'], roles: { technician: 'test/text', warhol: 'test/vision', superstar: 'test/cheap' }, dryRun: 'test/cheap' },
    budget: { dailyUsd, chatterShare: 0.1 },
    paths: { roles: rolesDir, floor: join(root, 'floor'), archive: join(root, 'archive'), canon: join(root, 'canon') },
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
