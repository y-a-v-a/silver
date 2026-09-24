// Runs every configured scout source in parallel. A failing source is reported, not fatal:
// the floor is noisy by design, and one dead feed shouldn't cancel a shift.
import { googleTrends } from './google-trends.js';
import { hackerNews } from './hackernews.js';
import { reddit } from './reddit.js';
import { rssFeed, rssSourceName } from './rss.js';

/**
 * The sources the config enables, as named thunks.
 * @param {{sources: {rss: string[], trending: {googleTrendsGeo: string, hackernews: boolean, reddit: boolean}, itemsPerSource: number}}} config
 * @param {{fetch?: typeof globalThis.fetch}} [opts]
 * @returns {{name: string, run: () => Promise<import('./candidate.js').Candidate[]>}[]}
 */
export function enabledSources(config, { fetch } = {}) {
  const { rss, trending, itemsPerSource: limit } = config.sources;
  const sources = [];
  if (trending.googleTrendsGeo) sources.push({ name: 'google-trends', run: () => googleTrends({ geo: trending.googleTrendsGeo, limit, fetch }) });
  if (trending.hackernews) sources.push({ name: 'hackernews', run: () => hackerNews({ limit, fetch }) });
  if (trending.reddit) sources.push({ name: 'reddit', run: () => reddit({ limit, fetch }) });
  for (const url of rss) sources.push({ name: rssSourceName(url), run: () => rssFeed({ url, limit, fetch }) });
  return sources;
}

/**
 * @param {Parameters<typeof enabledSources>[0]} config
 * @param {{fetch?: typeof globalThis.fetch, only?: string[]}} [opts]  only: run just these source names
 * @returns {Promise<{candidates: import('./candidate.js').Candidate[], report: {source: string, ok: boolean, count: number, error?: string}[]}>}
 */
export async function gatherCandidates(config, { fetch, only } = {}) {
  let sources = enabledSources(config, { fetch });
  if (only?.length) sources = sources.filter((s) => only.some((o) => s.name === o || s.name.startsWith(`${o}:`)));
  const results = await Promise.allSettled(sources.map((s) => s.run()));
  const candidates = [];
  const report = results.map((r, i) => {
    const source = sources[i].name;
    if (r.status === 'rejected') return { source, ok: false, count: 0, error: r.reason?.message ?? String(r.reason) };
    candidates.push(...r.value);
    return { source, ok: true, count: r.value.length };
  });
  return { candidates, report };
}
