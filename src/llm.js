// OpenRouter client. Every call runs as a role: the role file supplies the system prompt,
// model and settings. Every completed exchange is archived as a transcript and costed
// on the floor (`cost.recorded`, same id as the transcript). Failures are recorded
// (`llm.failed`) and thrown, so the caller can move on.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { monotonicFactory } from 'ulid';
import { render } from './roles.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export const REPAIR_PROMPT =
  'Your previous reply was not valid JSON. Reply again with only the JSON value: no prose, no code fences.';

export class LlmError extends Error {
  /** @param {string} message @param {{status?: number, code?: string, attempts?: object[]}} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = 'LlmError';
    Object.assign(this, info);
  }
}

/** The model answered, but not in a usable form (empty, or not JSON after one repair). */
export class LlmOutputError extends LlmError {
  constructor(message, info) {
    super(message, info);
    this.name = 'LlmOutputError';
  }
}

/**
 * Pull a JSON value out of a model reply: plain JSON, fenced JSON, or the outermost
 * {...} / [...] embedded in prose.
 * @param {string} text
 */
export function parseJsonReply(text) {
  const trimmed = text.trim();
  const attempts = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fence) attempts.push(fence[1]);
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) attempts.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new SyntaxError('no JSON value found in reply');
}

/** Backoff for retry `attempt` (0-based): Retry-After if given, else exponential with jitter. */
export function backoffMs(attempt, retryAfter, { baseMs = 1000, maxMs = 60_000, random = Math.random } = {}) {
  if (retryAfter !== null && retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(maxMs, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(maxMs, Math.max(0, date - Date.now()));
  }
  return Math.min(maxMs, baseMs * 2 ** attempt + Math.floor(random() * 250));
}

/** OpenRouter's `reasoning` request field for a role's reasoning setting. */
export function reasoningParam(level) {
  if (level === undefined) return undefined;
  return level === 'off' ? { enabled: false } : { effort: level };
}

/**
 * Normalise image inputs to data URLs, remembering their source for the transcript.
 * @param {(string|{path: string})[]} images  file paths or data: URLs
 */
async function loadImages(images) {
  return Promise.all(
    images.map(async (img) => {
      const src = typeof img === 'string' ? img : img.path;
      if (src.startsWith('data:')) return { url: src, source: 'inline' };
      const mime = MIME[extname(src).toLowerCase()];
      if (!mime) throw new LlmError(`unsupported image type: ${src}`);
      return { url: `data:${mime};base64,${(await readFile(src)).toString('base64')}`, source: src };
    }),
  );
}

/**
 * Replace base64 image payloads with a short fingerprint so transcripts stay small.
 * The images themselves are archived elsewhere (variants/).
 */
export function redactImages(value, sources = new Map()) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v !== 'string' || !v.startsWith('data:') || !v.includes(';base64,')) return v;
      const [head, data] = v.split(';base64,');
      const sha = createHash('sha256').update(data).digest('hex').slice(0, 16);
      const source = sources.get(v);
      const bytes = (data.length * 3) / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
      return `${head};base64,<omitted ${bytes} bytes sha256:${sha}${source ? ` from ${source}` : ''}>`;
    }),
  );
}

/**
 * @param {object} deps
 * @param {import('./config.js').SilverConfig & {paths: {archive: string}, root: string}} deps.config
 * @param {ReturnType<import('./floor.js').createFloor>} deps.floor
 * @param {Awaited<ReturnType<import('./roles.js').loadRoles>>} deps.roles
 * @param {ReturnType<import('./budget.js').createBudget>} deps.budget
 * @param {ReturnType<import('./pricing.js').createPricing>} deps.pricing
 * @param {string} [deps.apiKey]
 * @param {string} [deps.baseUrl]
 * @param {typeof globalThis.fetch} [deps.fetch]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.maxRetries]
 * @param {number} [deps.timeoutMs]
 * @param {boolean} [deps.dryRun]     use config.models.dryRun for every call
 * @param {() => Date} [deps.now]
 */
export function createLlm({
  config,
  floor,
  roles,
  budget,
  pricing,
  apiKey,
  baseUrl = OPENROUTER_BASE_URL,
  fetch = globalThis.fetch,
  sleep = (ms) => delay(ms),
  maxRetries = 3,
  timeoutMs = 180_000,
  dryRun = false,
  now = () => new Date(),
}) {
  const transcriptsDir = join(config.paths.archive, 'transcripts');
  const nextId = monotonicFactory();

  /** POST once per attempt; retry transient failures. Returns the parsed body and attempt log. */
  async function post(body) {
    const attempts = [];
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      let res;
      let data;
      let failure;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/y-a-v-a/silver',
            'X-Title': 'Silver Factory',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        data = await res.json().catch(() => null);
        // OpenRouter may return 200 with an error body when the upstream provider fails.
        const status = data?.error ? Number(data.error.code) || res.status : res.status;
        if (res.ok && !data?.error && data) return { data, attempts: [...attempts, { status, ms: Date.now() - started }] };
        failure = { status, message: data?.error?.message ?? `HTTP ${res.status}`, retryable: RETRYABLE.has(status) };
      } catch (err) {
        failure = { status: null, message: `${err.name}: ${err.message}`, retryable: true };
      }
      attempts.push({ status: failure.status, error: failure.message, ms: Date.now() - started });
      if (!failure.retryable || attempt >= maxRetries) {
        throw new LlmError(`OpenRouter request failed: ${failure.message}`, { status: failure.status, attempts });
      }
      await sleep(backoffMs(attempt, res?.headers?.get?.('retry-after') ?? null));
    }
  }

  async function saveTranscript(id, record, imageSources) {
    await mkdir(transcriptsDir, { recursive: true });
    const path = join(transcriptsDir, `${id}.json`);
    await writeFile(path, JSON.stringify(redactImages(record, imageSources), null, 2) + '\n');
    return relative(config.root, path);
  }

  async function recordFailure(role, model, ref, error, extra = {}) {
    await floor.append({
      type: 'llm.failed',
      actor: role.actor,
      ref,
      payload: { role: role.id, model, error: error.message, status: error.status ?? null, attempts: error.attempts ?? [], ...extra },
    });
  }

  /**
   * One completion round: reserve budget, POST, archive, cost. Returns the raw reply.
   */
  async function round({ role, model, body, ref, imageCount, imageSources }) {
    // Measure text only: images are priced per image, not by their base64 length.
    const promptChars = JSON.stringify(redactImages(body.messages)).length;
    const estimate = await pricing.estimate(model, { promptChars, maxTokens: body.max_tokens, images: imageCount });
    const release = await budget.reserve(estimate, { chatter: role.group === 'superstar' });
    try {
      const startedAt = now().toISOString();
      let result;
      try {
        result = await post(body);
      } catch (err) {
        await recordFailure(role, model, ref, err);
        throw err;
      }
      const { data, attempts } = result;
      const id = nextId(now().getTime());
      const usage = data.usage ?? {};
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      let usd = typeof usage.cost === 'number' ? usage.cost : null;
      const estimated = usd === null;
      if (estimated) usd = (await pricing.costOf(model, { promptTokens, completionTokens, images: imageCount })) ?? estimate;
      const choice = data.choices?.[0] ?? {};
      const content = typeof choice.message?.content === 'string' ? choice.message.content : '';

      const transcript = await saveTranscript(
        id,
        { id, startedAt, finishedAt: now().toISOString(), role: role.id, actor: role.actor, ref, request: body, response: data, attempts },
        imageSources,
      );
      await floor.append({
        id,
        type: 'cost.recorded',
        actor: role.actor,
        ref,
        payload: {
          role: role.id,
          group: role.group,
          model: data.model ?? model,
          requestedModel: model,
          provider: data.provider ?? null,
          generationId: data.id ?? null,
          promptTokens,
          completionTokens,
          reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
          usd,
          estimated,
          finishReason: choice.finish_reason ?? null,
          transcript,
        },
      });
      return { id, content, data, usd, model: data.model ?? model, finishReason: choice.finish_reason ?? null, transcript };
    } finally {
      release();
    }
  }

  /**
   * Call a model as `roleId`.
   * @param {string} roleId
   * @param {object} [opts]
   * @param {Record<string, unknown>} [opts.vars]     fills the role's {{placeholders}}
   * @param {string} [opts.prompt]                    appended as a user message
   * @param {{role: 'user'|'assistant', content: string}[]} [opts.messages]
   * @param {(string|{path: string})[]} [opts.images] attached to the last user message
   * @param {string} [opts.model]                     overrides the role's model
   * @param {number} [opts.temperature]               overrides the role's temperature
   * @param {number} [opts.maxTokens]
   * @param {string|null} [opts.ref]                  floor event this call responds to
   * @param {boolean} [opts.strict]                   missing vars throw (default) or render as [name]
   */
  async function call(roleId, { vars = {}, prompt, messages = [], images = [], model, temperature, maxTokens, ref = null, strict = true } = {}) {
    if (!apiKey) throw new LlmError('OPENROUTER_API_KEY is not set (put it in .env or your shell)');
    const role = roles.get(roleId);
    const chosenModel = dryRun ? config.models.dryRun : (model ?? roles.modelFor(role));
    if (images.length && !role.vision) throw new LlmError(`role "${role.id}" sends images but its frontmatter lacks vision: true`);

    const convo = [...messages];
    if (prompt !== undefined) convo.push({ role: 'user', content: prompt });
    const lastUser = convo.findLastIndex((m) => m.role === 'user');
    if (lastUser === -1) throw new LlmError('a call needs a prompt or at least one user message');

    const loaded = await loadImages(images);
    const imageSources = new Map(loaded.map((i) => [i.url, i.source]));
    if (loaded.length) {
      const text = convo[lastUser].content;
      convo[lastUser] = {
        role: 'user',
        content: [{ type: 'text', text }, ...loaded.map((i) => ({ type: 'image_url', image_url: { url: i.url } }))],
      };
    }

    const body = {
      model: chosenModel,
      messages: [{ role: 'system', content: render(role.body, vars, { strict }) }, ...convo],
      temperature: temperature ?? role.temperature,
      max_tokens: maxTokens ?? role.maxTokens,
      usage: { include: true },
    };
    const reasoning = reasoningParam(role.reasoning);
    if (reasoning) body.reasoning = reasoning;

    const ctx = { role, model: chosenModel, imageCount: loaded.length, imageSources };
    const first = await round({ ...ctx, body, ref });
    const rounds = [first];

    if (!first.content.trim()) {
      const err = new LlmOutputError(`empty reply (finish_reason: ${first.finishReason ?? 'unknown'})`, { rounds });
      await recordFailure(role, chosenModel, first.id, err, { reason: 'empty', finishReason: first.finishReason });
      throw err;
    }
    if (role.output !== 'json') return { ...first, json: undefined, rounds };

    try {
      return { ...first, json: parseJsonReply(first.content), rounds };
    } catch {
      // One repair round, as a continuation of the same conversation.
    }
    const repairBody = {
      ...body,
      messages: [...body.messages, { role: 'assistant', content: first.content }, { role: 'user', content: REPAIR_PROMPT }],
    };
    const second = await round({ ...ctx, body: repairBody, ref: first.id });
    rounds.push(second);
    try {
      return { ...second, json: parseJsonReply(second.content), rounds };
    } catch {
      const err = new LlmOutputError('reply was not valid JSON, even after one repair', { rounds });
      await recordFailure(role, chosenModel, second.id, err, { reason: 'invalid-json' });
      throw err;
    }
  }

  return { call };
}
