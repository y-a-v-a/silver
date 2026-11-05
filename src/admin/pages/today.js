// Today: what happened, what's wrong, what's next. The first thing you see, and most days
// the only thing you need.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { action, ago, esc, fileUrl, greaseMark, messages, outLink, percent, usd } from '../ui.js';
import { floorLine } from '../server.js';
import { readStatus } from '../status.js';

function stat(key, value, sub = '', href = null) {
  const inner = `<div class="k">${esc(key)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
  return href ? `<a class="stat" href="${esc(href)}">${inner}</a>` : `<div class="stat">${inner}</div>`;
}

export function alertsHtml(alerts) {
  if (!alerts.length) return '';
  return `<div class="alerts">${alerts
    .map((a) => {
      const out = a.href?.startsWith('http');
      const link = a.href ? (out ? outLink(a.href, a.label ?? 'Open') : `<a href="${esc(a.href)}">${esc(a.label ?? 'Open')}</a>`) : '';
      return `<p class="alert ${esc(a.level)}"><span>${esc(a.text)}</span>${link ? `<span class="act">${link}</span>` : ''}</p>`;
    })
    .join('')}</div>`;
}

const stepDetail = (s) =>
  s.reason ?? s.error ??
  (s.posted !== undefined
    ? `${s.posted} subjects${s.failedSources?.length ? `; ${s.failedSources.length} sources failed` : ''}`
    : s.lines !== undefined
      ? `${s.lines} lines${s.proposed?.length ? `; ${s.proposed[0].by} pushed “${s.proposed[0].title}”` : ''}`
      : s.series
        ? `${s.series.map((x) => `${x.produced}/${x.of}`).join(', ')} produced`
        : s.shortlisted
          ? `${s.shortlisted.length} shortlisted`
          : s.pulls
            ? `${s.pulls.filter((x) => x.ok).length} of ${s.pulls.length} pulled again`
            : s.manifest
              ? `${s.diary?.path && !s.diary.skipped ? 'diary written' : `no diary: ${s.diary?.skipped ?? 'failed'}`}${s.missing ? `; ${s.missing} artifacts missing` : ''}`
              : '');

/** Failed steps that repeat (one per series) read as one line. */
function steps(list) {
  const out = [];
  for (const s of list) {
    const last = out.at(-1);
    if (last && last.step === s.step && last.status === s.status && last.error === s.error) last.times = (last.times ?? 1) + 1;
    else out.push({ ...s });
  }
  return out.map((s) => `<div class="step"><span>${esc(s.step)}</span><span class="st ${esc(s.status)}">${esc(s.status)}${s.times ? ` ×${s.times}` : ''}</span><span class="dim wrap">${esc(stepDetail(s))}</span></div>`).join('');
}

const miniStrip = (s) => {
  const picks = new Set((s.shortlist?.payload.picks ?? []).map((p) => p.variant));
  const frames = s.variants.filter((v) => v.ok && v.png).sort((a, b) => Number(picks.has(b.variant)) - Number(picks.has(a.variant))).slice(0, 8);
  return `<div class="strip-row"><div><h3><a href="/series/${esc(s.seriesId)}">${esc(s.subject?.payload.title ?? s.started.payload.subjectTitle ?? s.seriesId)}</a></h3><div class="small muted">${s.variants.filter((v) => v.ok).length}/${s.variants.length} produced · ${s.shortlist ? `${s.shortlist.payload.picks.length} picked` : 'Warhol hasn’t looked'}</div><div class="tag">${esc((s.started.payload.techniques ?? []).join(', '))}</div></div>
  <div class="strip">${frames.map((v) => `<a href="/series/${esc(s.seriesId)}#${esc(v.variant)}"><img src="${esc(fileUrl(v.png))}" alt="" loading="lazy">${picks.has(v.variant) ? greaseMark('pick') : ''}</a>`).join('') || '<div class="none">nothing came out</div>'}</div></div>`;
};

const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function todayBody(st, { msg = {}, chatter = [], floorEvents = [], diary = null, open = [] } = {}) {
  const spent = st.ledger.total;
  const shiftValue = st.running ? 'Running' : st.doneToday ? 'Done' : st.paused ? 'Paused' : 'Not yet';
  const shiftSub = st.running
    ? 'on the floor now'
    : st.paused
      ? 'nothing runs by itself'
      : `next at ${clock(st.nextAt)}${st.nextAt.getDate() !== new Date().getDate() ? ' tomorrow' : ''}`;
  const credit = st.credit;
  const credits = credit && typeof credit.remaining === 'number' ? stat('OpenRouter credit', usd(credit.remaining), credit.source === 'key' ? 'on this key' : 'on the account') : '';
  // After the shift, another round only does something when the day still has series slots.
  const runLabel = st.running ? null : !st.doneToday ? "Run today's shift" : st.slotsFree ? `Make the ${st.slotsFree} series still open today` : null;
  const runFields = { ...(st.doneToday ? { again: '1' } : {}), force: '1' };
  const busy = st.running || open.some((j) => j.kind === 'shift');
  const nextList = st.next.length
    ? `<ol class="small" style="margin:0;padding-left:18px">${st.next.map((s) => `<li><a href="/subjects/${esc(s.id)}">${esc(s.payload.title)}</a> <span class="muted">${esc(s.payload.origin)}</span></li>`).join('')}</ol>`
    : `<p class="small muted">Nothing pinned or commissioned: the ${st.doneToday ? "next shift's series" : 'series'} will be whatever the Scout brings in.</p>`;

  return `<div data-refresh-on-job></div>
<div class="top"><div><h1>${esc(new Date(`${st.today}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</h1></div>
  <div class="row">
    ${runLabel && !busy ? action('/jobs/start', runLabel, { fields: { kind: 'shift', ...runFields }, cls: 'primary', confirm: `Yes, up to ${usd(st.cap - spent)}` }) : ''}
    ${!busy ? action('/jobs/start', 'Dry run', { fields: { kind: 'shift', dryRun: '1' } }) : ''}
    <a class="btn" href="/subjects#commission">Commission</a>
    ${st.doneToday && !st.slotsFree ? '<a class="btn" href="/subjects">Make another series</a>' : ''}
  </div></div>
${messages(msg)}
${alertsHtml(st.alerts)}
<div class="stats">
  ${stat('Shift', esc(shiftValue), esc(shiftSub))}
  ${stat('Spent today', usd(spent), `of ${usd(st.cap)} · ${st.ledger.calls} calls<div class="bar${spent / st.cap > 0.8 ? ' hot' : ''}" style="margin-top:5px"><i style="width:${Math.min(100, percent(spent, st.cap))}%"></i></div>`, '/system#money')}
  ${credits}
  ${stat('Waiting for you', String(st.pending.length), st.pending.length ? 'series' : 'nothing', '/review')}
  ${stat('Next in line', String(st.next.length), 'subjects', '/subjects')}
  ${stat('Canon', String(st.canon.filter((w) => w.edition !== null).length), 'editions', '/canon')}
</div>
<div class="cols">
  <div>
    <h2>Today's series</h2>
    ${st.todaySeries.length ? st.todaySeries.map(miniStrip).join('') : '<p class="muted">None yet today.</p>'}
    ${st.lastShift ? `<h2>The last shift <small>${esc(st.lastShift.shift)}, ${esc(ago(st.lastShift.ts))} · ${usd(st.lastShift.payload.spentUsd)}</small></h2><div>${steps(st.lastShift.payload.steps ?? [])}</div>` : ''}
    ${diary ? `<h2>The diary <small><a href="/diary/${esc(diary.date)}">${esc(diary.date)}</a></small></h2><p class="quote small">${esc(diary.excerpt)}</p>` : ''}
  </div>
  <aside>
    <h2>Next in line${st.doneToday ? ' <small>for the next shift</small>' : ''}</h2>
    ${nextList}
    ${chatter.length ? `<h2>On the floor today</h2>${chatter.map((e) => `<p class="floorline"><b>${esc(e.payload.persona ?? e.actor)}</b>: ${esc(e.payload.text)}</p>`).join('')}` : ''}
    <h2>Just now <small><a href="/floor">the floor</a></small></h2>
    <ul class="events" data-live-floor style="font-size:12px">${floorEvents.map((l) => `<li class="${esc(l.cls)}" style="grid-template-columns:40px minmax(0,1fr)"><span class="t">${esc(l.time)}</span><span class="wrap"><span class="ty">${esc(l.type)}</span> ${esc(l.summary)}</span></li>`).join('') || '<li class="muted">Quiet.</li>'}</ul>
  </aside>
</div>`;
}

/** @param {import('../server.js').App} app */
export function routes(app) {
  app.get('/', async (c) => {
    const schedule = await c.extra.schedule?.status(c.config).catch(() => null);
    const credit = await c.extra.credit?.get().catch(() => null);
    const st = await readStatus({ config: c.config, floor: c.floor, env: c.extra.env ?? {}, schedule, credit });
    const events = await c.floor.read();
    const chatter = events.filter((e) => e.type === 'chatter.posted' && !e.payload.dryRun).sort(() => 0.5 - Math.random()).slice(0, 5);
    const floorEvents = events.filter((e) => e.type !== 'cost.recorded').slice(-12).reverse().map(floorLine);
    let diary = null;
    const written = (await c.floor.read({ shift: 'all', type: 'diary.written' })).at(-1);
    if (written) {
      const text = await readFile(join(c.config.root, written.payload.path), 'utf8').catch(() => '');
      const para = text.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith('#'));
      if (para) diary = { date: written.payload.shift, excerpt: para.length > 420 ? `${para.slice(0, 419)}…` : para };
    }
    const open = (await c.jobs?.open()) ?? [];
    return c.page({ title: 'Today', active: 'today', body: todayBody(st, { msg: c.msg, chatter, floorEvents, diary, open }) });
  });
}

