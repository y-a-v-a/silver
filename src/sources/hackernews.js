// Hacker News front page, via the official Firebase API.
import { fetchJson, htmlToText, clip } from './http.js';
import { candidate } from './candidate.js';

export const HN_API = 'https://hacker-news.firebaseio.com/v0';
const hnItemUrl = (id) => `https://news.ycombinator.com/item?id=${id}`;

/** Map one HN item to a candidate (null for dead/deleted/non-stories). Exported for tests. */
export function hnCandidate(item, fetchedAt = new Date().toISOString()) {
  if (!item || item.dead || item.deleted || item.type !== 'story' || !item.title) return null;
  const counts = `${item.score ?? 0} points, ${item.descendants ?? 0} comments on Hacker News.`;
  const text = item.text ? ` ${clip(htmlToText(item.text), 200)}` : '';
  return candidate({
    title: item.title,
    url: item.url ?? hnItemUrl(item.id),
    snippet: counts + text,
    source: 'hackernews',
    fetchedAt,
    meta: { score: item.score ?? 0, comments: item.descendants ?? 0, discussion: hnItemUrl(item.id) },
  });
}

/**
 * @param {{limit: number, fetch?: typeof globalThis.fetch, concurrency?: number}} opts
 */
export async function hackerNews({ limit, fetch, concurrency = 8 }) {
  const ids = (await fetchJson(`${HN_API}/topstories.json`, { fetch })).slice(0, limit);
  const items = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      // One missing item shouldn't sink the whole source.
      items[i] = await fetchJson(`${HN_API}/item/${ids[i]}.json`, { fetch }).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  const fetchedAt = new Date().toISOString();
  return items.map((item) => hnCandidate(item, fetchedAt)).filter(Boolean);
}
