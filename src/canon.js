// The canon: every signed work, derived from the floor (work.published + edition.released).
// canon/canon.json is a cache of that view, rewritten after each change; the floor is the truth.
import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** sha256 over the sketch, Warhol's note and the human approval: what "signed" means here. */
export function signature({ sketch, warholNote, approvalId }) {
  return createHash('sha256').update(sketch).update('\0').update(warholNote ?? '').update('\0').update(approvalId).digest('hex');
}

const slug = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'untitled';

/** A stable, readable, unique id: subject slug, variant, and the end of the series id. */
export const canonIdFor = ({ subjectTitle, variant, seriesId }) => `${slug(subjectTitle)}-${variant}-${seriesId.slice(-6).toLowerCase()}`;

/**
 * Approved variants that have no work yet, oldest approval first. The latest decision per
 * variant counts, so a variant approved and later vetoed is not printed.
 * @param {import('./agents/series-data.js').SeriesView[]} views
 * @param {object[]} published  work.published events
 */
export function approvalsToPrint(views, published) {
  const done = new Set(published.map((e) => `${e.payload.seriesId}/${e.payload.variant}`));
  const todo = [];
  for (const s of views) {
    for (const [variant, decision] of s.decisions) {
      if (decision.payload.verdict !== 'approved' || done.has(`${s.seriesId}/${variant}`)) continue;
      const v = s.variants.find((x) => x.variant === variant);
      if (!v?.ok || !v.html) continue;
      todo.push({ series: s, variant: v, approval: decision, pick: s.shortlist?.payload.picks.find((p) => p.variant === variant) ?? null });
    }
  }
  return todo.sort((a, b) => a.approval.id.localeCompare(b.approval.id));
}

/**
 * The canon from the floor: one entry per work.published, with its edition when released.
 * @param {object[]} events  work.published and edition.released events
 */
export function buildCanon(events) {
  const works = new Map();
  for (const e of events) {
    if (e.type === 'work.published') works.set(e.payload.canonId, { ...e.payload, publishedAt: e.ts, workEventId: e.id, edition: null });
  }
  for (const e of events) {
    if (e.type !== 'edition.released') continue;
    const w = works.get(e.payload.canonId);
    if (w) Object.assign(w, { edition: e.payload.edition, title: e.payload.title, wallText: e.payload.wallText, releasedAt: e.ts });
  }
  return [...works.values()].sort((a, b) => (a.edition ?? Infinity) - (b.edition ?? Infinity) || a.publishedAt.localeCompare(b.publishedAt));
}

export async function readCanon(floor) {
  return buildCanon(await floor.read({ shift: 'all', type: ['work.published', 'edition.released'] }));
}

/** Rewrite canon/canon.json atomically (write, then rename). */
export async function writeCanonJson(config, canon) {
  const path = join(config.paths.canon, 'canon.json');
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ generated: new Date().toISOString(), works: canon }, null, 2) + '\n');
  await rename(tmp, path);
  return path;
}
