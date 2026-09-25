// The Superstars: cast talent on the floor. After the Scouts, each superstar reads the day's
// subjects and what the others already said, and posts a few lines of chatter about them.
// The chatter reaches the assistants' prompts ({{floor_excerpt}}), Warhol's review and the
// contact sheet. Now and then one superstar is shown the Scout's leftovers and may push one
// of them onto the floor as a subject (blurry roles, ARCHITECTURE principle 6).
import { normalizeSensitive } from './scouts.js';
import { snapshotPage } from '../lib/snapshot.js';

export const MAX_LINE = 280;
const MAX_SUBJECTS = 10;
const FLOOR_LINES = 16;

/** The house rules, sent with every superstar call; the persona files hold only the voice. */
export const HOUSE_RULES = `House rules:
- Talk about the subjects on the floor, by their number. Opinions, jokes, gossip and associations are yours to make; facts are not. Don't state names, numbers, dates or events that aren't in the cards, and don't sharpen a vague number ("hundreds of thousands" stays that, never "half a million").
- Public figures are fair game as public figures. Nothing sexual about real people, no slurs, and nothing mocking victims, children, suicide or private people.
- Each line at most two or three sentences.`;

const FORMAT = `Reply with JSON only:
{"lines": [{"subject": <number>, "text": "..."}], "propose": null}

If you were shown a pile and one item in it is a better ready-made than anything on the floor, you may push it: "propose": {"pile": <P-number>, "why": "one line on why it belongs on the floor", "sensitive": {"flag": false, "reason": null}}. Most days, leave "propose" null. Never propose suicide or self-harm, children, or named private victims.`;

/** Subjects as numbered cards. */
export function formatSubjects(subjects) {
  return subjects
    .map((s, i) => {
      const p = s.payload;
      const bits = [`[${i + 1}] ${p.title}`, p.source && `(${p.source}${p.origin === 'commission' ? ', a commission' : ''})`].filter(Boolean).join(' ');
      const notes = [p.why && `why: ${p.why}`, p.scoutWhy && `scout: ${p.scoutWhy}`, p.image && `image: ${p.image}`, p.snapshot?.snippet && `snippet: ${String(p.snapshot.snippet).slice(0, 240)}`].filter(Boolean);
      return [bits, ...notes.map((n) => `    ${n}`)].join('\n');
    })
    .join('\n');
}

/** Recent chatter about these subjects, oldest first, with the subject's number. */
export function formatFloor(chatter, subjects) {
  const index = new Map(subjects.map((s, i) => [s.id, i + 1]));
  const lines = chatter.filter((e) => index.has(e.ref)).slice(-FLOOR_LINES);
  return lines.length ? lines.map((e) => `- ${e.actor.replace(/^superstar\./, '')} on [${index.get(e.ref)}]: ${e.payload.text}`).join('\n') : '(nobody has said anything yet)';
}

export function formatPile(pile) {
  return pile.length ? pile.map((c, i) => `[P${i + 1}] (${c.source}) ${c.title}${c.snippet ? `\n    ${String(c.snippet).slice(0, 200)}` : ''}`).join('\n') : '(nothing: the pile is not yours today)';
}

/**
 * Check a superstar's reply.
 * @returns {{lines: {subject: number, text: string}[], proposal: {pile: number, why: string, sensitive: object}|null, problems: string[]}}
 */
export function validateChatter(json, { subjects, maxLines, pileSize }) {
  const problems = [];
  const lines = [];
  const raw = Array.isArray(json?.lines) ? json.lines : [];
  if (!Array.isArray(json?.lines)) problems.push('reply has no "lines" array');
  for (const l of raw) {
    const n = Number(l?.subject);
    const text = typeof l?.text === 'string' ? l.text.replace(/\s+/g, ' ').trim() : '';
    if (!Number.isInteger(n) || n < 1 || n > subjects) problems.push(`line about unknown subject ${JSON.stringify(l?.subject)}`);
    else if (!text) problems.push(`empty line about subject ${n}`);
    else if (lines.length >= maxLines) problems.push(`more than ${maxLines} lines; the rest were dropped`);
    else lines.push({ subject: n, text: text.length > MAX_LINE ? text.slice(0, MAX_LINE - 1) + '…' : text });
  }
  let proposal = null;
  const p = json?.propose;
  if (p) {
    const idx = Number(String(p.pile ?? '').replace(/^P/i, ''));
    if (!pileSize) problems.push('proposed from a pile it was not shown');
    else if (!Number.isInteger(idx) || idx < 1 || idx > pileSize) problems.push(`proposed unknown pile item ${JSON.stringify(p.pile)}`);
    else proposal = { pile: idx, why: typeof p.why === 'string' && p.why.trim() ? p.why.trim() : null, sensitive: normalizeSensitive(p.sensitive) };
  }
  return { lines, proposal, problems };
}

/**
 * Let every superstar talk, one after another, so later ones hear the earlier ones.
 * @param {object} deps
 * @param {object} deps.config
 * @param {ReturnType<import('../floor.js').createFloor>} deps.floor
 * @param {{call: Function, roles: object}} deps.llm
 * @param {typeof globalThis.fetch} [deps.fetch]      for snapshots of proposed subjects
 * @param {object} opts
 * @param {object[]} opts.subjects                     subject.posted events to talk about
 * @param {object[]} [opts.pile]                       the Scout's leftover candidates
 * @param {boolean} [opts.dryRun]
 * @param {() => number} [opts.rng]
 * @param {string[]} [opts.only]                       superstar ids
 * @param {boolean} [opts.snapshot]
 * @returns {Promise<{chatter: object[], proposed: object[], problems: string[], stopped: string|null}>}
 */
export async function runSuperstars({ config, floor, llm, fetch = globalThis.fetch }, { subjects, pile = [], dryRun = false, rng = Math.random, only, snapshot = true }) {
  const result = { chatter: [], proposed: [], problems: [], stopped: null };
  const cast = (llm.roles?.superstars?.() ?? []).filter((r) => !only || only.includes(r.id));
  const onFloor = subjects.slice(0, MAX_SUBJECTS);
  const maxLines = config.superstars.linesPerShift;
  if (!cast.length || !onFloor.length || maxLines === 0) return result;

  // At most one superstar a shift sees the pile, and only some days.
  const offered = pile.slice(0, config.superstars.pileSize);
  const pileHolder = offered.length && rng() < config.superstars.proposeChance ? cast[Math.floor(rng() * cast.length)].id : null;
  const ids = new Set(onFloor.map((s) => s.id));

  for (const role of cast) {
    const kind = (e) => dryRun || !e.payload.dryRun;
    const chatter = (await floor.read({ shift: 'all', type: 'chatter.posted' })).filter((e) => ids.has(e.ref) && kind(e));
    const myPile = role.id === pileHolder ? offered : [];
    let res;
    try {
      res = await llm.call(role.id, {
        vars: { subjects: formatSubjects(onFloor), floor: formatFloor(chatter, onFloor), pile: formatPile(myPile), lines: String(maxLines) },
        prompt: `${HOUSE_RULES}\n\n${FORMAT}`,
      });
    } catch (err) {
      if (err.name === 'BudgetExhausted' && err.scope === 'chatter') {
        result.stopped = err.message;
        break;
      }
      if (err.name === 'BudgetExhausted') throw err;
      result.problems.push(`${role.id}: ${err.message}`);
      continue;
    }
    const { lines, proposal, problems } = validateChatter(res.json, { subjects: onFloor.length, maxLines, pileSize: myPile.length });
    result.problems.push(...problems.map((p) => `${role.id}: ${p}`));
    for (const line of lines) {
      result.chatter.push(
        await floor.append({
          type: 'chatter.posted',
          actor: role.actor,
          ref: onFloor[line.subject - 1].id,
          payload: { persona: role.id, text: line.text, callId: res.id, ...(dryRun ? { dryRun: true } : {}) },
        }),
      );
    }
    if (proposal) {
      const c = myPile[proposal.pile - 1];
      const page = snapshot && c.url ? await snapshotPage(c.url, { fetch }) : null;
      result.proposed.push(
        await floor.append({
          type: 'subject.posted',
          actor: role.actor,
          ref: res.id,
          payload: {
            origin: 'superstar',
            proposedBy: role.id,
            title: c.title,
            url: c.url ?? null,
            source: c.source,
            why: proposal.why,
            image: null,
            sensitive: proposal.sensitive,
            snapshot: { snippet: c.snippet ?? null, fetchedAt: c.fetchedAt ?? null, meta: c.meta ?? null, page },
            ...(dryRun ? { dryRun: true } : {}),
          },
        }),
      );
    }
  }
  return result;
}
