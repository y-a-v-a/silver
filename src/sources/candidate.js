// The common shape every scout source returns.

/**
 * @typedef {object} Candidate
 * @property {string} title       as the source published it; scouts never rewrite it
 * @property {string|null} url    where the ready-made lives
 * @property {string} snippet     short context: what the source says about it
 * @property {string} source      "google-trends", "hackernews", "reddit", "rss:<host>"
 * @property {string} fetchedAt   ISO timestamp
 * @property {Record<string, unknown>} meta  source-specific extras (traffic, score, feed, ...)
 */

/** @returns {Candidate} */
export function candidate({ title, url = null, snippet = '', source, fetchedAt = new Date().toISOString(), meta = {} }) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError(`${source}: candidate without a title`);
  return { title: title.trim(), url: url || null, snippet: snippet.trim(), source, fetchedAt, meta };
}
