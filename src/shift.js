// One daily shift: scouts -> superstars -> series -> Warhol's shortlists -> archivist.
// Idempotent per date: a second run the same day resumes where the first stopped and
// never duplicates work. A spent budget ends the shift cleanly, with the reason recorded.
// Printing happens outside the shift, when the human approves (the veto is async).
import { runScouts } from './agents/scouts.js';
import { runSuperstars } from './agents/superstars.js';
import { runSeries } from './agents/assistants.js';
import { pendingCommissions } from './agents/commissions.js';
import { retiredSubjects, claimedSubjects } from './agents/retire.js';
import { listSeries, isPendingReview } from './agents/series-data.js';
import { shortlistSeries } from './agents/warhol.js';
import { archiveShift } from './agents/archivist.js';

export class ShiftError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShiftError';
  }
}

const isBudget = (err) => err?.name === 'BudgetExhausted';

/**
 * Choose the subjects for today's series: commissions first (oldest first), then subjects a
 * superstar pushed, then today's scouted subjects in the Scout's order. Retired subjects and subjects that already have
 * a series are never picked (decisions 2026-09-24 and 2026-09-25). A real shift never
 * picks a dry run's subjects; a dry run may use either.
 * @returns {Promise<import('./floor.js').FloorEvent[]>}
 */
export async function pickSubjects(floor, shift, slots, { dryRun = false } = {}) {
  if (slots <= 0) return [];
  const retired = await retiredSubjects(floor);
  const claimed = claimedSubjects(await floor.read({ shift: 'all', type: 'series.started' }));
  const commissions = (await pendingCommissions(floor)).filter((s) => !claimed.has(s.id));
  const scouted = (await floor.read({ shift, type: 'subject.posted' })).filter((s) => s.payload.origin !== 'commission' && (dryRun || !s.payload.dryRun) && !claimed.has(s.id) && !retired.has(s.id));
  // A subject a superstar pushed onto the floor jumps the Scout's queue: that's the point of it.
  const pushed = scouted.filter((s) => s.payload.origin === 'superstar');
  return [...commissions, ...pushed, ...scouted.filter((s) => s.payload.origin !== 'superstar')].slice(0, slots);
}

/**
 * Run (or resume) today's shift.
 * @param {object} deps
 * @param {object} deps.config
 * @param {ReturnType<import('./floor.js').createFloor>} deps.floor
 * @param {{call: Function}} deps.llm
 * @param {ReturnType<import('./budget.js').createBudget>} deps.budget
 * @param {() => Promise<{render: Function, close: Function}>} deps.createRenderer
 * @param {typeof globalThis.fetch} [deps.fetch]           for the scouts' sources
 * @param {() => Promise<object>} [deps.reconcile]          best-effort ledger check
 * @param {(title: string, message: string) => Promise<boolean>} [deps.notify]
 * @param {(message: string) => Promise<object>} [deps.backup]  commit (and push) the record
 * @param {{dryRun?: boolean, again?: boolean}} [opts]
 */
export async function runShift({ config, floor, llm, budget, createRenderer, fetch, reconcile, notify, backup }, { dryRun = false, again = false } = {}) {
  const shift = floor.today();
  const today = await floor.read({ shift });
  // A dry run never stands in for the real shift, and vice versa.
  const sameKind = (e) => Boolean(e.payload?.dryRun) === dryRun;
  const ended = today.filter((e) => e.type === 'shift.ended' && sameKind(e)).at(-1);
  if (ended && !again) return { shift, status: 'already-done', ended };
  const resumed = today.some((e) => e.type === 'shift.started' && sameKind(e)) && !ended;

  const started = await floor.append({
    type: 'shift.started',
    actor: 'orchestrator',
    payload: { dryRun, resumed, again: Boolean(ended), budgetRemaining: await budget.remaining() },
  });

  const steps = [];
  const record = (step, status, detail = {}) => steps.push({ step, status, ...detail });
  let stoppedReason = null;
  const stop = (err) => {
    stoppedReason = err.message;
  };

  // 1. Scouts: once per day, per kind (a dry run's subjects don't count for the real shift).
  let pile = [];
  const scoutedToday = today.some((e) => e.type === 'subject.posted' && e.actor === 'scout' && sameKind(e));
  if (scoutedToday) record('scouts', 'skipped', { reason: 'already scouted today' });
  else {
    try {
      const r = await runScouts({ config, floor, llm, fetch }, { dryRun });
      pile = r.leftovers ?? [];
      record('scouts', r.posted.length ? 'done' : 'empty', { posted: r.posted.length, problems: r.problems, failedSources: r.report.filter((x) => !x.ok).map((x) => x.source) });
    } catch (err) {
      if (isBudget(err)) stop(err);
      record('scouts', 'failed', { error: err.message });
    }
  }

  // 2. Superstars: once per day, per kind, about the subjects waiting for a series. They may
  // stop on their own budget share (chatter), which never stops the shift.
  if (!stoppedReason) {
    const talkedToday = today.some((e) => e.type === 'chatter.posted' && e.actor.startsWith('superstar.') && sameKind(e));
    const waiting = await pickSubjects(floor, shift, Infinity, { dryRun });
    if (!(llm.roles?.superstars?.() ?? []).length) record('superstars', 'skipped', { reason: 'no superstars cast (roles/superstars/)' });
    else if (talkedToday) record('superstars', 'skipped', { reason: 'already talked today' });
    else if (!waiting.length) record('superstars', 'skipped', { reason: 'no subjects on the floor' });
    else {
      try {
        const r = await runSuperstars({ config, floor, llm, fetch }, { subjects: waiting, pile, dryRun });
        record('superstars', r.chatter.length ? 'done' : 'empty', {
          lines: r.chatter.length,
          proposed: r.proposed.map((e) => ({ id: e.id, by: e.payload.proposedBy, title: e.payload.title })),
          problems: r.problems,
          ...(r.stopped ? { stopped: r.stopped } : {}),
        });
      } catch (err) {
        if (isBudget(err)) stop(err);
        record('superstars', 'failed', { error: err.message });
      }
    }
  }

  // 3. Series: fill today's remaining slots.
  const seriesMade = [];
  if (!stoppedReason) {
    const startedToday = (await floor.read({ shift, type: 'series.started' })).filter(sameKind).length;
    const slots = config.shift.seriesPerShift - startedToday;
    const picks = await pickSubjects(floor, shift, slots, { dryRun });
    if (slots <= 0) record('series', 'skipped', { reason: `${startedToday} series already started today` });
    else if (!picks.length) record('series', 'empty', { reason: `no subjects waiting (${slots} slot${slots === 1 ? '' : 's'} free)` });
    else {
      const renderer = await createRenderer();
      try {
        for (const subject of picks) {
          const r = await runSeries({ config, floor, llm, renderer }, subject.id, { dryRun });
          seriesMade.push({ seriesId: r.seriesId, subjectId: subject.id, origin: subject.payload.origin, produced: r.results.filter((x) => x.ok).length, of: r.results.length });
          if (r.stoppedEarly) {
            stoppedReason = r.stoppedEarly;
            break;
          }
        }
      } catch (err) {
        if (isBudget(err)) stop(err);
        else record('series', 'failed', { error: err.message });
      } finally {
        await renderer.close();
      }
      if (!steps.some((s) => s.step === 'series')) record('series', 'done', { series: seriesMade });
    }
  }

  // 4. Warhol: shortlist today's finished series that have none yet.
  const shortlisted = [];
  if (!stoppedReason) {
    const todo = (await listSeries(floor)).filter((s) => s.started.shift === shift && sameKind(s.started) && s.completed && !s.shortlist);
    for (const s of todo) {
      try {
        const r = await shortlistSeries({ config, floor, llm }, s.seriesId);
        shortlisted.push({ seriesId: s.seriesId, picks: r.event.payload.picks.map((p) => p.variant) });
      } catch (err) {
        if (isBudget(err)) {
          stop(err);
          break;
        }
        record('shortlist', 'failed', { seriesId: s.seriesId, error: err.message });
      }
    }
    if (!steps.some((s) => s.step === 'shortlist')) record('shortlist', todo.length ? 'done' : 'skipped', todo.length ? { shortlisted } : { reason: 'nothing new to shortlist' });
  }
  if (stoppedReason) record('stopped', 'budget', { reason: stoppedReason });

  // 5. Archivist: the artifact check and manifest, then the diary (not for dry runs). It runs
  // even after a budget stop: the day still happened. Its own failures never fail the shift.
  try {
    const a = await archiveShift({ config, floor, llm }, { shift, dryRun });
    record('archivist', 'done', { manifest: a.manifest, missing: a.missing, diary: a.diary, problems: a.problems });
  } catch (err) {
    record('archivist', 'failed', { error: err.message });
  }

  let ledger = null;
  if (reconcile) {
    try {
      ledger = await reconcile();
    } catch (err) {
      ledger = { error: err.message };
    }
  }

  const waiting = (await listSeries(floor)).filter(isPendingReview).length;
  const spent = (await budget.ledger(shift)).total;
  const endedEvent = await floor.append({
    type: 'shift.ended',
    actor: 'orchestrator',
    ref: started.id,
    payload: { dryRun, steps, series: seriesMade, shortlisted, waitingForReview: waiting, spentUsd: spent, budgetRemaining: await budget.remaining(), stoppedReason, reconcile: ledger },
  });

  // The record (floor, archive, canon, taste) is committed and pushed after the shift has
  // ended, so the commit includes it. A failed push is recorded and retried next shift.
  let backedUp = null;
  if (backup) {
    try {
      backedUp = await backup(`Shift ${shift}${dryRun ? ' (dry run)' : ''}: ${seriesMade.length} series, ${waiting} waiting for review, $${spent.toFixed(2)}`);
    } catch (err) {
      backedUp = { committed: false, pushed: false, error: err.message };
    }
    await floor.append({ type: 'record.pushed', actor: 'archivist', ref: endedEvent.id, payload: { shift, ...backedUp } });
  }

  if (notify) {
    const message = stoppedReason
      ? `Stopped early: budget. ${waiting} series waiting for review.`
      : `${seriesMade.length} new series, ${waiting} waiting for review.`;
    await notify('Silver Factory', message).catch(() => false);
  }
  return { shift, status: stoppedReason ? 'stopped' : 'done', started, ended: endedEvent, steps, series: seriesMade, shortlisted, waiting, backup: backedUp };
}
