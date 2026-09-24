// News RSS/Atom feeds from the config. Each feed is its own source, "rss:<host>".
import Parser from 'rss-parser';
import { fetchText, htmlToText, clip } from './http.js';
import { candidate } from './candidate.js';

const parser = new Parser();

/** "rss:bbci.co.uk" for https://feeds.bbci.co.uk/... */
export function rssSourceName(url) {
  const host = new URL(url).hostname.replace(/^(www|feeds|rss)\./, '');
  return `rss:${host}`;
}

export async function parseFeed(xml, { url, limit, fetchedAt = new Date().toISOString() }) {
  const feed = await parser.parseString(xml);
  const source = rssSourceName(url);
  return feed.items
    .filter((item) => item.title)
    .slice(0, limit)
    .map((item) =>
      candidate({
        title: htmlToText(item.title),
        url: item.link ?? null,
        snippet: clip(item.contentSnippet ?? htmlToText(item.content ?? ''), 300),
        source,
        fetchedAt,
        meta: { feed: feed.title ?? null, published: item.isoDate ?? null },
      }),
    );
}

/**
 * @param {{url: string, limit: number, fetch?: typeof globalThis.fetch}} opts
 */
export async function rssFeed({ url, limit, fetch }) {
  return parseFeed(await fetchText(url, { fetch }), { url, limit });
}
