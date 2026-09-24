// Google Trends: what people typed into a search box today, with the news behind it.
import Parser from 'rss-parser';
import { fetchText, clip } from './http.js';
import { candidate } from './candidate.js';

export const trendsUrl = (geo) => `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;

const parser = new Parser({
  customFields: {
    item: [
      ['ht:approx_traffic', 'traffic'],
      ['ht:picture', 'picture'],
      ['ht:news_item', 'newsItems', { keepArray: true }],
    ],
  },
});

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Parse the trending RSS into candidates. Exported for tests. */
export async function parseTrends(xml, { limit, fetchedAt = new Date().toISOString() }) {
  const feed = await parser.parseString(xml);
  return feed.items.slice(0, limit).map((item) => {
    const news = (item.newsItems ?? []).map((n) => ({
      title: first(n['ht:news_item_title']),
      url: first(n['ht:news_item_url']),
      source: first(n['ht:news_item_source']),
    }));
    const lead = news.find((n) => n.url) ?? null;
    const headlines = news
      .filter((n) => n.title)
      .slice(0, 2)
      .map((n) => `"${n.title}"${n.source ? ` (${n.source})` : ''}`);
    return candidate({
      title: item.title,
      url: lead?.url ?? null,
      snippet: clip(`${item.traffic ?? '?'} searches.${headlines.length ? ` In the news: ${headlines.join('; ')}.` : ''}`, 300),
      source: 'google-trends',
      fetchedAt,
      meta: { traffic: item.traffic ?? null, picture: item.picture ?? null, news },
    });
  });
}

/**
 * @param {{geo: string, limit: number, fetch?: typeof globalThis.fetch}} opts
 */
export async function googleTrends({ geo, limit, fetch }) {
  return parseTrends(await fetchText(trendsUrl(geo), { fetch }), { limit });
}
