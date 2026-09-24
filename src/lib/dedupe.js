// Deduplication of scout candidates, within a batch and against subjects already on the floor.
// Two candidates are the same subject if their normalised URL or normalised title matches.

const TRACKING = /^(utm_|at_|mc_|fbclid$|gclid$|dclid$|yclid$|igshid$|smid$|smtyp$|ref$|ref_src$|cmpid$|ocid$|__twitter_impression$)/i;

/**
 * Canonical form of a URL for comparison: https, no www., no fragment, no tracking
 * params, sorted query, no trailing slash. Unparseable input yields null.
 * @param {string|null|undefined} url
 */
export function normalizeUrl(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '';
  return `https://${host}${path}${query}`;
}

/**
 * Canonical form of a title: lowercase, no diacritics, no punctuation, single spaces.
 * Titles shorter than 3 words are not used for matching (too many false positives).
 * @param {string|null|undefined} title
 */
export function normalizeTitle(title) {
  if (!title) return null;
  const t = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return t.split(' ').length >= 3 ? t : null;
}

/** Comparison keys for anything with a title and url. */
export function keysOf({ title, url }) {
  const keys = [];
  const u = normalizeUrl(url);
  const t = normalizeTitle(title);
  if (u) keys.push(`url:${u}`);
  if (t) keys.push(`title:${t}`);
  return keys;
}

/** Keys of every subject already posted, from subject.posted events. */
export function subjectKeys(events) {
  const keys = new Set();
  for (const e of events) {
    if (e.type !== 'subject.posted') continue;
    for (const k of keysOf(e.payload ?? {})) keys.add(k);
  }
  return keys;
}

/**
 * Split candidates into fresh ones and duplicates. The first of several equal
 * candidates in the batch wins. `seen` is not modified.
 * @template {{title: string, url: string|null}} T
 * @param {T[]} candidates
 * @param {Set<string>} [seen]
 * @returns {{fresh: T[], duplicates: T[]}}
 */
export function dedupe(candidates, seen = new Set()) {
  const taken = new Set(seen);
  const fresh = [];
  const duplicates = [];
  for (const c of candidates) {
    const keys = keysOf(c);
    if (keys.some((k) => taken.has(k))) {
      duplicates.push(c);
      continue;
    }
    keys.forEach((k) => taken.add(k));
    fresh.push(c);
  }
  return { fresh, duplicates };
}
