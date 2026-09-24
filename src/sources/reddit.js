// Reddit r/all, top of the day. Uses the public Atom feed: the JSON API answers 403
// without OAuth (checked 2026-09-24), the feed does not.
import Parser from 'rss-parser';
import { fetchText } from './http.js';
import { candidate } from './candidate.js';

export const REDDIT_URL = 'https://www.reddit.com/r/all/top/.rss?t=day';
const parser = new Parser();

/** The post's own target: the "[link]" anchor in the entry HTML. Exported for tests. */
export function redditTarget(html = '') {
  const m = html.match(/<a href="([^"]+)">\s*\[link\]\s*<\/a>/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

export async function parseReddit(xml, { limit, fetchedAt = new Date().toISOString() }) {
  const feed = await parser.parseString(xml);
  return feed.items.slice(0, limit).map((e) => {
    const subreddit = e.contentSnippet?.match(/\bto\s+(r\/[\w]+)/)?.[1] ?? null;
    const author = e.author?.replace(/^\/u\//, 'u/') ?? null;
    return candidate({
      title: e.title,
      url: redditTarget(e.content) ?? e.link,
      snippet: `Top of r/all today${subreddit ? `, from ${subreddit}` : ''}${author ? `, posted by ${author}` : ''}.`,
      source: 'reddit',
      fetchedAt,
      meta: { subreddit, author, discussion: e.link, published: e.isoDate ?? null },
    });
  });
}

/**
 * @param {{limit: number, fetch?: typeof globalThis.fetch}} opts
 */
export async function reddit({ limit, fetch }) {
  return parseReddit(await fetchText(`${REDDIT_URL}&limit=${limit}`, { fetch }), { limit });
}
