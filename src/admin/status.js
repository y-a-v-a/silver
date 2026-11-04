// How the Factory is doing right now. Everything the Today page shows is derived here from the
// floor and a few plain checks, so a problem shows up as soon as it's on the record.
import { listSeries, isPendingReview } from '../agents/series-data.js';
import { pickSubjects } from '../shift.js';
import { readCanon } from '../canon.js';
import { createBudget } from '../budget.js';
import { OPENROUTER_BASE_URL } from '../llm.js';
import { usd } from './ui.js';

const HOUR = 3_600_000;

/** A shift is on the floor when it has started and not ended. A crash leaves no ending, so old ones don't count. */
export async function shiftInProgress(floor, { now = new Date(), maxHours = 2 } = {}) {
  const today = await floor.read({ type: 'shift.*' });
  const last = today.filter((e) => e.type === 'shift.started' || e.type === 'shift.ended').at(-1);
  return Boolean(last && last.type === 'shift.started' && now - Date.parse(last.ts) < maxHours * HOUR);
}

/** The next time the schedule will run a shift, as a local Date. */
export function nextShift(at, { now = new Date(), doneToday = false } = {}) {
  const [h, m] = at.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now || doneToday) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * The account's remaining credit, best effort. The admin never waits long for it: it answers
 * with what it knows, and asks again in the background at most every few minutes.
 * @param {{apiKey?: string, baseUrl?: string, fetch?: typeof globalThis.fetch, ttlMs?: number}} deps
 */
export function createCreditWatch({ apiKey, baseUrl = OPENROUTER_BASE_URL, fetch = globalThis.fetch, ttlMs = 5 * 60_000 }) {
  let known = null;
  let at = 0;
  let asking = null;
  async function ask() {
    const get = async (path) => {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) });
      return res.ok ? (await res.json()).data : null;
    };
    // /credits knows the account; a key that isn't allowed to read it can still read its own limit.
    const credits = await get('/credits').catch(() => null);
    if (typeof credits?.total_credits === 'number') return { remaining: credits.total_credits - (credits.total_usage ?? 0), total: credits.total_credits, source: 'account' };
    const key = await get('/key').catch(() => null);
    if (typeof key?.limit_remaining === 'number') return { remaining: key.limit_remaining, total: key.limit ?? null, source: 'key' };
    return key ? { remaining: null, total: null, source: 'key' } : null;
  }
  return {
    known: () => known,
    /** Whatever is known after at most `waitMs`; a refresh goes on in the background. */
    async get({ waitMs = 1200 } = {}) {
      if (!apiKey) return null;
      if (Date.now() - at > ttlMs && !asking) {
        at = Date.now();
        asking = ask()
          .then((v) => {
            known = v ?? known;
          })
          .catch(() => {})
          .finally(() => {
            asking = null;
          });
      }
      if (asking && !known) await Promise.race([asking, new Promise((r) => setTimeout(r, waitMs).unref())]);
      return known;
    },
  };
}

/**
 * @param {{config: object, floor: object, env: Record<string, string|undefined>, schedule?: object|null, credit?: object|null, now?: Date}} deps
 */
export async function readStatus({ config, floor, env = {}, schedule = null, credit = null, now = new Date() }) {
  const today = floor.today();
  const [series, canon, recentLines, ledger] = await Promise.all([
    listSeries(floor),
    readCanon(floor),
    floor.read({ shift: 'all', type: ['shift.started', 'shift.ended', 'llm.failed', 'record.pushed'] }),
    createBudget({ floor, dailyUsd: config.budget.dailyUsd, chatterShare: config.budget.chatterShare }).ledger(),
  ]);
  const shifts = recentLines.filter((e) => e.type === 'shift.ended' && !e.payload.dryRun);
  const lastShift = shifts.at(-1) ?? null;
  const doneToday = lastShift?.shift === today;
  const running = await shiftInProgress(floor, { now });
  const pending = series.filter(isPendingReview);
  const unlisted = pending.filter((s) => !s.shortlist && s.variants.some((v) => v.ok));
  const todaySeries = series.filter((s) => s.started.shift === today && !s.started.payload.dryRun);
  const next = await pickSubjects(floor, today, config.shift.seriesPerShift);
  const printable = canon.filter((w) => w.edition === null);

  const dayAgo = now.getTime() - 24 * HOUR;
  const failures = recentLines.filter((e) => e.type === 'llm.failed' && Date.parse(e.ts) >= dayAgo);
  const noCredit = failures.filter((e) => e.payload.status === 402 || /credits/i.test(e.payload.error ?? ''));

  /** @type {{level: 'bad'|'warn'|'info', text: string, href?: string, label?: string}[]} */
  const alerts = [];
  if (!env.OPENROUTER_API_KEY) alerts.push({ level: 'bad', text: 'No OpenRouter key: nothing can be made. Put OPENROUTER_API_KEY in .env, and the admin picks it up by itself.', href: '/system', label: 'System' });
  if (noCredit.length) {
    alerts.push({ level: 'bad', text: `OpenRouter refused ${noCredit.length} call${noCredit.length === 1 ? '' : 's'} in the last day for lack of credits${typeof credit?.remaining === 'number' ? ` (${usd(credit.remaining)} left)` : ''}: variants die and Warhol can't look. The account needs topping up (the key is shared with your other agents).`, href: 'https://openrouter.ai/settings/credits', label: 'Add credits' });
  } else if (failures.length >= 5) {
    alerts.push({ level: 'warn', text: `${failures.length} model calls failed in the last day.`, href: '/floor?type=llm.failed&shift=all', label: 'See them' });
  }
  const remaining = credit?.remaining;
  if (typeof remaining === 'number' && remaining < config.budget.dailyUsd && !noCredit.length) alerts.push({ level: 'warn', text: `Only ${usd(remaining)} of OpenRouter credit left, less than one day's cap.`, href: 'https://openrouter.ai/settings/credits', label: 'Add credits' });
  const thin = todaySeries.filter((s) => s.completed && s.variants.length && s.variants.filter((v) => v.ok).length / s.variants.length < 0.5);
  if (thin.length) alerts.push({ level: 'warn', text: `Today's series came out thin: ${thin.map((s) => `${s.variants.filter((v) => v.ok).length}/${s.variants.length}`).join(', ')} variants.`, href: `/series/${thin[0].seriesId}`, label: 'Look' });
  if (config.shift.paused) alerts.push({ level: 'info', text: 'The daily shift is paused. The schedule keeps firing, and nothing happens.', href: '/system', label: 'Unpause' });
  if (schedule && !schedule.installed) alerts.push({ level: 'info', text: 'The daily shift is not scheduled on this machine.', href: '/system', label: 'Schedule it' });
  if (schedule?.installed && schedule.mine && schedule.at !== config.shift.at) alerts.push({ level: 'warn', text: `The schedule runs at ${schedule.at}, the settings say ${config.shift.at}.`, href: '/system', label: 'Fix it' });
  const pushed = recentLines.filter((e) => e.type === 'record.pushed').at(-1);
  if (pushed?.payload.error) alerts.push({ level: 'warn', text: `The record's last backup didn't push: ${pushed.payload.error}` });
  if (unlisted.length) alerts.push({ level: 'info', text: `Warhol hasn't looked at ${unlisted.length} finished series.`, href: '/review', label: 'Ask him' });
  if (pending.length >= 20) alerts.push({ level: 'info', text: `${pending.length} series are waiting for review; the oldest is from ${pending[0].started.shift}.`, href: '/review', label: 'Clear the backlog' });

  return {
    today,
    running,
    lastShift,
    doneToday,
    nextAt: nextShift(config.shift.at, { now, doneToday }),
    paused: Boolean(config.shift.paused),
    ledger,
    cap: config.budget.dailyUsd,
    credit,
    pending,
    unlisted,
    todaySeries,
    next,
    canon,
    printable,
    alerts,
  };
}
