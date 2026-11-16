// The direct line to Anthropic. Claude models run on the Anthropic API when ANTHROPIC_API_KEY
// is set, so they draw on Anthropic credits; OpenRouter stays the route for every other model
// and the fallback for these (src/llm.js decides, retries and falls back).
//
// The rest of the Factory speaks one dialect: OpenRouter's chat-completions request and reply.
// This file translates that request into a Messages API call and the reply back, so roles,
// transcripts, the ledger and the admin never need to know which line a call took.
import Anthropic from '@anthropic-ai/sdk';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/** Statuses worth another try on the same line. 529 is Anthropic's "overloaded". */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/**
 * The Anthropic model id for an OpenRouter slug, or null when the model isn't Anthropic's.
 * OpenRouter writes versions with a dot (anthropic/claude-opus-5.5), Anthropic with a dash
 * (claude-opus-5-5). Variant slugs (":thinking", ":beta") are OpenRouter's own and stay there.
 * @param {string} slug
 * @returns {string|null}
 */
export function anthropicModelId(slug) {
  const m = /^anthropic\/(claude-[a-z0-9.-]+)$/i.exec(slug ?? '');
  return m ? m[1].toLowerCase().replaceAll('.', '-') : null;
}

/**
 * The effort level for an OpenRouter `reasoning` field. Current Claude models think adaptively
 * and take neither a thinking-token budget nor "off", so a budget becomes the effort level
 * whose share of max_tokens it comes closest to, and "off" becomes the lowest level.
 * @param {{effort?: string, max_tokens?: number, enabled?: boolean}|undefined} reasoning
 * @param {number} maxTokens
 * @returns {'low'|'medium'|'high'|undefined}  undefined leaves the model's default
 */
export function effortFor(reasoning, maxTokens) {
  if (!reasoning) return undefined;
  if (reasoning.enabled === false) return 'low';
  if (typeof reasoning.max_tokens === 'number') {
    const share = reasoning.max_tokens / maxTokens;
    return share <= 0.3 ? 'low' : share <= 0.65 ? 'medium' : 'high';
  }
  return reasoning.effort;
}

/** One chat-completions content part as a Messages API content block. */
function toBlock(part) {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'image_url') {
    const url = part.image_url?.url ?? '';
    const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (data) return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
    return { type: 'image', source: { type: 'url', url } };
  }
  throw new TypeError(`cannot send a "${part.type}" part to Anthropic`);
}

const textOf = (content) => (typeof content === 'string' ? content : content.map((p) => p.text ?? '').join(''));

/**
 * Translate a chat-completions body into Messages API parameters.
 *
 * Left behind on purpose: `temperature` (the API rejects sampling parameters on current
 * models), and OpenRouter's own fields (`usage`, `models`, `reasoning`, which becomes effort).
 * @param {object} body  what src/llm.js would send to OpenRouter
 */
export function toAnthropicRequest(body) {
  const model = anthropicModelId(body.model);
  if (!model) throw new TypeError(`"${body.model}" is not an Anthropic model`);
  const system = body.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content));
  const params = {
    model,
    max_tokens: body.max_tokens,
    messages: body.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(toBlock) })),
  };
  if (system.length) params.system = system.join('\n\n');
  const effort = effortFor(body.reasoning, body.max_tokens);
  if (effort) params.output_config = { effort };
  return params;
}

/** Anthropic stop reasons in the vocabulary the Factory already reads (`length`, `stop`, ...). */
const FINISH = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', refusal: 'content_filter' };

/**
 * Translate a Messages API reply into a chat-completions body. The model keeps the slug it was
 * asked for by, so the ledger and the price list see one name per model whichever line it took.
 * Thinking is left out of the content, as OpenRouter leaves it out; its tokens are counted.
 * @param {import('@anthropic-ai/sdk').Anthropic.Message} message
 * @param {string} slug  the OpenRouter slug the call was made under
 */
export function fromAnthropicMessage(message, slug) {
  const usage = message.usage ?? {};
  const text = (message.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return {
    id: message.id,
    model: slug,
    provider: 'Anthropic',
    choices: [
      {
        finish_reason: FINISH[message.stop_reason] ?? message.stop_reason ?? null,
        native_finish_reason: message.stop_reason ?? null,
        message: { role: 'assistant', content: text },
      },
    ],
    usage: {
      // Cached tokens are input too. (Nothing here asks for caching, but the count stays honest.)
      prompt_tokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      completion_tokens: usage.output_tokens ?? 0,
      completion_tokens_details: { reasoning_tokens: usage.output_tokens_details?.thinking_tokens ?? 0 },
    },
  };
}

/**
 * @param {object} deps
 * @param {string} deps.apiKey
 * @param {string} [deps.baseUrl]
 * @param {typeof globalThis.fetch} [deps.fetch]
 * @param {number} [deps.timeoutMs]
 */
export function createAnthropicTransport({ apiKey, baseUrl = ANTHROPIC_BASE_URL, fetch = globalThis.fetch, timeoutMs = 300_000 }) {
  // src/llm.js owns the retries, so every attempt lands in the transcript's attempt log.
  // The key is passed in, never looked up: no other credential on this machine is borrowed.
  const client = new Anthropic({ apiKey, baseURL: baseUrl, fetch, maxRetries: 0, timeout: timeoutMs });

  /**
   * One attempt. Streamed, so a long generation can't idle a connection to death; the reply is
   * taken whole at the end. Resolves to `{data, native}` or `{failure}`, like OpenRouter's line.
   * @param {object} body  chat-completions body
   */
  async function once(body) {
    const started = Date.now();
    const params = toAnthropicRequest(body);
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const message = await client.messages.stream(params, { signal }).finalMessage();
      // The transcript keeps what went over this line and what came back. The system prompt and
      // the messages are the request's own, word for word, so they aren't written out twice.
      const { system: _system, messages: _messages, ...sent } = params;
      return { data: fromAnthropicMessage(message, body.model), native: { request: sent, response: message } };
    } catch (err) {
      if (signal.aborted) {
        return { failure: { status: null, message: `timed out after ${Math.round((Date.now() - started) / 1000)}s`, retryable: true, retryAfter: null } };
      }
      if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
        const says = err.headers?.get('x-should-retry');
        return {
          failure: {
            status: err.status,
            message: err.error?.error?.message ?? err.message,
            retryable: says === 'true' || (says !== 'false' && RETRYABLE.has(err.status)),
            retryAfter: err.headers?.get('retry-after') ?? null,
          },
        };
      }
      // No status: the connection failed, or the stream broke off or reported an error midway.
      const said = err instanceof Anthropic.APIError ? err.error?.error : null;
      const cause = err.cause instanceof Error ? ` (${err.cause.name}: ${err.cause.message})` : '';
      const message = said?.message ? `the reply broke off (${said.type ?? 'error'}: ${said.message})` : `${err.name}: ${err.message}${cause}`;
      return { failure: { status: null, message, retryable: true, retryAfter: null } };
    }
  }

  /** Does the account behind the key know this model? null when the question couldn't be asked. */
  async function hasModel(slug) {
    const id = anthropicModelId(slug);
    if (!id) return false;
    try {
      await client.models.retrieve(id, { timeout: 15_000 });
      return true;
    } catch (err) {
      if (err instanceof Anthropic.NotFoundError) return false;
      return null;
    }
  }

  return { once, hasModel };
}
