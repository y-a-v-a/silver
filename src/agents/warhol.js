// Warhol: looks at one screenshot per produced variant (decision 2026-09-25) and proposes
// a shortlist for the human's review. He sees the images and the techniques, never the
// code or the model names: he judges the surface, not the effort or the brand.
import { join } from 'node:path';
import { findSeries } from './series-data.js';
import { tasteForPrompt } from '../lib/taste.js';

export const MAX_PICKS = 3;

export class ShortlistError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShortlistError';
  }
}

/** The variant list Warhol reads, numbered in image order. */
export function describeVariants(variants) {
  return variants.map((v, i) => `Image ${i + 1} = ${v.variant} · technique: ${v.technique} · temperature ${v.temperature}`).join('\n');
}

/**
 * Check Warhol's reply against the variants he was shown.
 * @returns {{picks: {variant: string, note: string, offTechnique: boolean}[], rejects: string|null, problems: string[]}}
 */
export function validateShortlist(json, shown, maxPicks = MAX_PICKS) {
  const problems = [];
  const ids = new Set(shown.map((v) => v.variant));
  const raw = Array.isArray(json?.picks) ? json.picks : null;
  if (!raw) return { picks: [], rejects: null, problems: ['reply has no "picks" array'] };
  const picks = [];
  for (const [i, p] of raw.entries()) {
    const variant = typeof p?.variant === 'string' ? p.variant.trim().toLowerCase() : null;
    if (!variant || !ids.has(variant)) problems.push(`pick ${i + 1}: ${JSON.stringify(p?.variant)} is not one of the variants shown`);
    else if (picks.some((x) => x.variant === variant)) problems.push(`pick ${i + 1}: ${variant} picked twice`);
    else if (picks.length >= maxPicks) problems.push(`pick ${i + 1}: more than ${maxPicks} picks, dropped`);
    else picks.push({ variant, note: typeof p.note === 'string' ? p.note.trim() : '', offTechnique: p.offTechnique === true });
  }
  const rejects = typeof json.rejects === 'string' && json.rejects.trim() ? json.rejects.trim() : null;
  return { picks, rejects, problems };
}

/**
 * Ask Warhol for a shortlist of one series and post it as shortlist.proposed.
 * @param {{config: object, floor: object, llm: {call: Function}}} deps
 * @param {string} seriesRef   id, id suffix, "latest" or "unlisted"
 * @param {{force?: boolean}} [opts]
 */
export async function shortlistSeries({ config, floor, llm }, seriesRef, { force = false } = {}) {
  const series = await findSeries(floor, seriesRef);
  if (!series.completed) throw new ShortlistError(`series ${series.seriesId} is not complete yet`);
  if (series.shortlist && !force) throw new ShortlistError(`series ${series.seriesId} already has a shortlist; use --force for another`);

  const shown = series.variants.filter((v) => v.ok && v.png);
  const base = { seriesId: series.seriesId, subjectId: series.subject?.id ?? series.started.payload.subjectId };
  if (!shown.length) {
    const event = await floor.append({ type: 'shortlist.proposed', actor: 'warhol', ref: series.seriesId, payload: { ...base, picks: [], rejects: 'Nothing came out. Gee.', shown: [], callId: null } });
    return { series, event, problems: ['no rendered variants to look at'] };
  }

  const p = series.subject?.payload ?? {};
  // A scouted subject's `why` is the Scout's; a commission's `why` is the human's.
  const whyLabel = p.origin === 'commission' ? "The human's note" : 'Why it is a ready-made';
  const subject = [
    `**${p.title ?? series.started.payload.subjectTitle}**`,
    p.why && `${whyLabel}: ${p.why}`,
    p.scoutWhy && `The Scout's note: ${p.scoutWhy}`,
    p.sensitive?.flag && `Sensitive subject${p.sensitive.reason ? `: ${p.sensitive.reason}` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
  const chatter = series.chatter.length ? series.chatter.slice(-12).map((e) => `- ${e.actor}: ${e.payload.text}`).join('\n') : '(nothing)';

  const res = await llm.call('warhol', {
    vars: {
      subject,
      chatter,
      taste: await tasteForPrompt(config.paths.taste, config.review.tasteEntriesInPrompt),
      variants: describeVariants(shown),
      max_picks: String(MAX_PICKS),
    },
    prompt: `Here are the ${shown.length} variants, in order. Choose. Reply with JSON only.`,
    images: shown.map((v) => join(config.root, v.png)),
    ref: series.seriesId,
  });
  const { picks, rejects, problems } = validateShortlist(res.json, shown);
  const event = await floor.append({
    type: 'shortlist.proposed',
    actor: 'warhol',
    ref: series.seriesId,
    payload: { ...base, picks, rejects, shown: shown.map((v) => v.variant), problems, callId: res.id },
  });
  return { series, event, problems };
}
