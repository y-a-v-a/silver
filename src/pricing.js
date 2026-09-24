// Model prices and capabilities from OpenRouter's public /models endpoint.
// Used to estimate a call's cost before it is made (for budget reservations),
// and as a fallback when a response carries no usage.cost.

/**
 * @typedef {object} ModelInfo
 * @property {string} id
 * @property {number} prompt       USD per prompt token
 * @property {number} completion   USD per completion token (includes reasoning)
 * @property {number} image        USD per input image
 * @property {number} request      USD per request
 * @property {boolean} vision      accepts image input
 * @property {number|null} contextLength
 */

/** Rough prompt size: ~3.5 characters per token for English prose and code. */
export const CHARS_PER_TOKEN = 3.5;

/** @returns {ModelInfo} */
export function toModelInfo(m) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    id: m.id,
    prompt: num(m.pricing?.prompt),
    completion: num(m.pricing?.completion),
    image: num(m.pricing?.image),
    request: num(m.pricing?.request),
    vision: (m.architecture?.input_modalities ?? []).includes('image'),
    contextLength: m.context_length ?? null,
  };
}

/**
 * @param {{baseUrl?: string, fetch?: typeof globalThis.fetch}} [opts]
 */
export function createPricing({ baseUrl = 'https://openrouter.ai/api/v1', fetch = globalThis.fetch } = {}) {
  /** @type {Promise<Map<string, ModelInfo>|null>|null} */
  let loading = null;

  /** Fetch the model list once. Resolves to null when unavailable, so estimates degrade to 0. */
  function load() {
    loading ??= (async () => {
      try {
        const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return null;
        const { data } = await res.json();
        return new Map(data.map((m) => [m.id, toModelInfo(m)]));
      } catch {
        return null;
      }
    })();
    return loading;
  }

  /** @returns {Promise<ModelInfo|null>} */
  async function get(model) {
    return (await load())?.get(model) ?? null;
  }

  /**
   * Upper-bound estimate: the whole max_tokens budget is assumed to be used.
   * @param {string} model
   * @param {{promptChars: number, maxTokens: number, images?: number}} size
   */
  async function estimate(model, { promptChars, maxTokens, images = 0 }) {
    const info = await get(model);
    if (!info) return 0;
    return (
      Math.ceil(promptChars / CHARS_PER_TOKEN) * info.prompt + maxTokens * info.completion + images * info.image + info.request
    );
  }

  /** Cost from actual token counts, for responses without usage.cost. */
  async function costOf(model, { promptTokens = 0, completionTokens = 0, images = 0 }) {
    const info = await get(model);
    if (!info) return null;
    return promptTokens * info.prompt + completionTokens * info.completion + images * info.image + info.request;
  }

  return { load, get, estimate, costOf };
}
