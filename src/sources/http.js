// Shared HTTP for scout sources: an honest User-Agent, a timeout, and clear errors.

export const USER_AGENT = 'silver-factory/0.1 (+https://github.com/y-a-v-a/silver)';

export class SourceError extends Error {
  constructor(message, { url, status } = {}) {
    super(message);
    this.name = 'SourceError';
    this.url = url;
    this.status = status;
  }
}

/**
 * @param {string} url
 * @param {{fetch?: typeof globalThis.fetch, timeoutMs?: number, accept?: string}} [opts]
 * @returns {Promise<Response>}
 */
async function get(url, { fetch = globalThis.fetch, timeoutMs = 15_000, accept = '*/*' } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new SourceError(`${url}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`, { url });
  }
  if (!res.ok) throw new SourceError(`${url}: HTTP ${res.status}`, { url, status: res.status });
  return res;
}

export async function fetchText(url, opts) {
  return (await get(url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5', ...opts })).text();
}

export async function fetchJson(url, opts) {
  const res = await get(url, { accept: 'application/json', ...opts });
  try {
    return await res.json();
  } catch {
    throw new SourceError(`${url}: response is not JSON`, { url });
  }
}

/** Plain text from an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export function htmlToText(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

export const clip = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
};
