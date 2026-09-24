// A text snapshot of a web page, so a subject survives link rot: title, description,
// lead image and the start of the readable text. Never throws; failures are recorded.
import { USER_AGENT, htmlToText, decodeEntities } from '../sources/http.js';

/**
 * @typedef {object} Snapshot
 * @property {string} url
 * @property {string|null} finalUrl      after redirects
 * @property {string|null} contentType
 * @property {string|null} title
 * @property {string|null} description
 * @property {string|null} image         og:image
 * @property {string|null} text          readable text, clipped
 * @property {string} fetchedAt
 * @property {string} [error]
 */

function meta(html, key) {
  // <meta property="og:title" content="..."> in either attribute order.
  const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${key}["']`, 'i');
  const m = html.match(re1) ?? html.match(re2);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/** Pull the readable parts out of an HTML document. Exported for tests. */
export function extractPage(html, { maxChars = 2000 } = {}) {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = meta(html, 'og:title') ?? (titleTag ? htmlToText(titleTag) : null);
  const description = meta(html, 'og:description') ?? meta(html, 'description');
  const image = meta(html, 'og:image');
  const body =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
    html.match(/<body[\s\S]*?<\/body>/i)?.[0] ??
    html;
  const cleaned = body.replace(/<(nav|header|footer|aside|form|svg|figure)[\s\S]*?<\/\1>/gi, ' ');
  const text = htmlToText(cleaned);
  // Keep paragraph breaks: the assistants read this, and structure helps.
  const clipped = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
  return { title: title || null, description, image, text: clipped || null };
}

/**
 * @param {string} url
 * @param {{fetch?: typeof globalThis.fetch, timeoutMs?: number, maxChars?: number}} [opts]
 * @returns {Promise<Snapshot>}
 */
export async function snapshotPage(url, { fetch = globalThis.fetch, timeoutMs = 15_000, maxChars = 2000 } = {}) {
  const base = { url, finalUrl: null, contentType: null, title: null, description: null, image: null, text: null, fetchedAt: new Date().toISOString() };
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
  } catch (err) {
    return { ...base, error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
  const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? null;
  const snap = { ...base, finalUrl: res.url || url, contentType };
  if (!res.ok) return { ...snap, error: `HTTP ${res.status}` };
  if (!contentType?.includes('html')) {
    // An image or video is itself the ready-made; there is no text to keep.
    await res.body?.cancel().catch(() => {});
    return snap;
  }
  const html = await res.text().catch(() => '');
  return { ...snap, ...extractPage(html, { maxChars }) };
}
