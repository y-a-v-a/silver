// The record, to read: the floor as it happens, the canon, the diary, every job and every
// model call. The floor and the canon are append-only, and nothing here edits them; a
// correction to a label goes through Fred Hughes and is a new event, like everything else.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { approvalsToPrint, posterOf, readCanon } from '../../canon.js';
import { listSeries } from '../../agents/series-data.js';
import { JOB_KINDS } from '../jobs.js';
import { AdminError, floorLine } from '../server.js';
import { action, ago, esc, greaseMark, messages, outLink, pad3, usd } from '../ui.js';

// ---------- the floor ----------

const GROUPS = [
  ['', 'Everything but costs'],
  ['subject.*', 'Subjects'],
  ['chatter.*', 'Chatter'],
  ['series.*', 'Series'],
  ['variant.*', 'Variants'],
  ['shortlist.*', 'Warhol'],
  ['review.*', 'Your decisions'],
  ['studio.*', 'Your changes'],
  ['work.*', 'The Printer'],
  ['edition.*', 'Editions'],
  ['llm.failed', 'Failed calls'],
  ['shift.*', 'Shifts'],
  ['cost.*', 'Costs'],
];

export function floorBody({ events, shifts, shift, type, actor, today, msg }) {
  const live = (shift === today || !shift) && !type && !actor;
  return `<div class="top"><div><h1>The floor</h1><p class="lede">Every event, as it happens. Append-only: nothing on it is ever changed.</p></div>
  <form method="get" action="/floor" class="row"><select name="shift" aria-label="Day"><option value="${esc(today)}">Today</option><option value="all"${shift === 'all' ? ' selected' : ''}>All days</option>${shifts.filter((s) => s !== today).reverse().slice(0, 60).map((s) => `<option${s === shift ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
  <select name="type" aria-label="Kind">${GROUPS.map(([v, l]) => `<option value="${esc(v)}"${v === type ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
  <input type="text" name="actor" value="${esc(actor)}" placeholder="actor" aria-label="Actor" style="width:9em"><button>Show</button></form></div>
${messages(msg)}
<ul class="events"${live ? ' data-live-floor' : ''}>${events.map((e) => {
    const l = floorLine(e);
    const link = e.type === 'cost.recorded' ? `/transcripts/${e.id}` : e.type === 'series.started' ? `/series/${e.id}` : e.payload?.seriesId ? `/series/${e.payload.seriesId}` : e.type === 'subject.posted' ? `/subjects/${e.id}` : null;
    return `<li class="${esc(l.cls)}"><span class="t">${esc(l.time)}</span><span class="ty">${esc(l.type)}</span><span class="wrap">${esc(l.actor)} · ${link ? `<a href="${esc(link)}">${esc(l.summary || 'open')}</a>` : esc(l.summary)}</span></li>`;
  }).join('') || '<li class="muted">Nothing here.</li>'}</ul>
${events.length >= 400 ? '<p class="small muted" style="margin-top:8px">The newest 400.</p>' : ''}`;
}

// ---------- transcripts ----------

const textOf = (content) => (typeof content === 'string' ? content : (content ?? []).map((p) => (p.type === 'text' ? p.text : `[${p.type}: ${String(p.image_url?.url ?? '').slice(0, 90)}]`)).join('\n'));

function transcriptBody(t, msg) {
  const req = t.request ?? {};
  const res = t.response ?? {};
  const choice = res.choices?.[0] ?? {};
  return `<div class="top"><div><a class="crumb" href="/floor?type=cost.*">← costs</a><h1>A call from ${esc(t.role)}</h1>
  <div class="small muted">${esc(t.startedAt)} · ${esc(res.model ?? req.model)} · t${esc(req.temperature)} · ${esc(res.usage?.prompt_tokens)} in, ${esc(res.usage?.completion_tokens)} out${typeof res.usage?.cost === 'number' ? ` · ${usd(res.usage.cost)}` : ''}${choice.finish_reason ? ` · ${esc(choice.finish_reason)}` : ''}</div></div>
  <a class="btn" href="/souls/${esc(t.role)}">Their soul</a></div>
${messages(msg)}
${(req.messages ?? []).map((m) => `<h2>${esc(m.role)}</h2><pre class="log" style="max-height:48vh">${esc(textOf(m.content))}</pre>`).join('')}
<h2>The reply</h2><pre class="log" style="max-height:60vh">${esc(choice.message?.content ?? '')}</pre>`;
}

// ---------- the canon ----------

export function canonBody({ works, waiting, msg, canDeploy, deployed }) {
  const released = works.filter((w) => w.edition !== null).reverse();
  const unreleased = works.filter((w) => w.edition === null);
  const posterUrl = (w) => `/canon-files/${posterOf(w).split('/').slice(1).map(encodeURIComponent).join('/')}`;
  return `<div class="top"><div><h1>The canon</h1><p class="lede">${released.length} signed editions. The numbers and signatures never change; a label can be corrected, and the old one stays on the floor.</p></div>
  <div class="row">${action('/jobs/start', waiting.length ? `Print ${waiting.length} waiting` : 'Publish', { fields: { kind: 'publish' }, cls: waiting.length ? 'primary' : '' })}${canDeploy ? action('/jobs/start', 'Redeploy the gallery', { fields: { kind: 'publish', redeploy: '1' } }) : ''}<a class="btn" href="/gallery/">The gallery</a></div></div>
${messages(msg)}
${canDeploy ? '' : '<p class="alert info" style="margin-bottom:12px"><span>Not deployed: there is no VERCEL_TOKEN in .env, so the gallery is only built locally.</span></p>'}
${deployed ? `<p class="small muted">Last deployed ${esc(ago(deployed.ts))}: ${outLink(deployed.payload.url, deployed.payload.url)} (${esc(deployed.payload.works)} works)</p>` : ''}
${unreleased.length ? `<h2>Printed, waiting for a label (${unreleased.length})</h2><p class="small muted">Fred Hughes numbers and labels them on the next publish.</p>` : ''}
<div class="sheet" style="margin-top:12px">
${released.map((w) => `<article class="card" id="no-${esc(w.edition)}">
  <div class="rebate"><span>▸ No. ${pad3(w.edition)}</span><span>${esc(w.technique)}</span></div>
  <div class="frame" style="cursor:default"><img src="${esc(posterUrl(w))}" alt="${esc(w.title)}" loading="lazy">${w.printCheck?.verdict === 'concern' ? greaseMark('pick') : ''}</div>
  <div class="meta"><strong>${esc(w.title)}</strong>${w.revisedAt ? ' <span class="tag">label revised</span>' : ''}</div>
  <p class="note small dim">${esc(w.wallText)}</p>
  ${w.printCheck?.verdict === 'concern' ? `<p class="note warhol small">Print check: ${esc(w.printCheck.note)}</p>` : ''}
  <details class="sendback"><summary>Correct the label</summary>
    <form method="post" action="/canon/${esc(w.edition)}/retitle">
      <div class="field"><label>Title<input type="text" name="title" value="${esc(w.title)}" style="width:100%"></label></div>
      <div class="field"><label>Wall text<textarea name="wall" rows="4">${esc(w.wallText)}</textarea></label></div>
      <div class="buttons"><button>Use my words</button></div>
      <div class="field" style="margin-top:8px"><label>Or tell Fred Hughes what's wrong<input type="text" name="note" style="width:100%"></label></div>
      <div class="buttons"><button name="fred" value="1">Let Fred rewrite it</button></div>
    </form></details>
</article>`).join('\n')}
</div>`;
}

// ---------- the diary ----------

/** Just enough markdown for the Archivist's entries, escaped first. */
export function diaryHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  return String(md).split(/\n\s*\n/).map((block) => {
    const t = block.trim();
    if (!t) return '';
    const h = t.match(/^#{1,4}\s+(.*)$/);
    if (h && !t.includes('\n')) return `<h3>${inline(h[1])}</h3>`;
    if (t.split('\n').every((l) => l.startsWith('- '))) return `<ul>${t.split('\n').map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

// ---------- jobs ----------

const jobState = (j) => `<span class="chip ${j.status === 'done' ? 'ok' : ['failed', 'lost'].includes(j.status) ? 'bad' : j.status === 'running' ? 'warn' : ''}">${j.status === 'running' ? '<span class="pulse"></span>' : ''}${esc(j.status)}</span>`;

const took = (j) => {
  if (!j.startedAt) return '';
  const end = j.finishedAt ? Date.parse(j.finishedAt) : Date.now();
  const s = Math.round((end - Date.parse(j.startedAt)) / 1000);
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
};

export function jobsBody({ jobs, msg }) {
  const open = jobs.filter((j) => ['running', 'queued'].includes(j.status));
  return `<div data-refresh-on-job></div><div class="top"><div><h1>Jobs</h1><p class="lede">Each one is a fresh <code>silver</code> process, so it runs the code and the souls as they are now, and a restart of this admin doesn't touch it. One at a time, because the budget can only hold inside one process.</p></div></div>
${messages(msg)}
${open.length ? '' : '<p class="muted">Nothing running.</p>'}
<div class="table-wrap"><table><thead><tr><th>Job</th><th>State</th><th class="num">Took</th><th class="num">When</th><th></th></tr></thead><tbody>
${jobs.map((j) => `<tr><td class="wrap"><a href="/jobs/${esc(j.id)}">${esc(j.title)}</a></td><td>${jobState(j)}</td><td class="num">${esc(took(j))}</td><td class="num">${esc(ago(j.startedAt ?? j.queuedAt))}</td><td>${['running', 'queued'].includes(j.status) ? action(`/jobs/${j.id}/cancel`, j.status === 'running' ? 'Stop' : 'Cancel', { cls: 'quiet', confirm: 'Really?' }) : ''}</td></tr>`).join('')}
</tbody></table></div>`;
}

function jobBody(job, log, msg) {
  const open = ['running', 'queued'].includes(job.status);
  return `<div class="top"><div><a class="crumb" href="/jobs">← jobs</a><h1>${esc(job.title)}</h1><div class="small muted"><code>silver ${esc(job.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '))}</code></div></div>
  <div class="row">${jobState(job)}${open ? action(`/jobs/${job.id}/cancel`, job.status === 'running' ? 'Stop it' : 'Cancel', { confirm: 'Really?' }) : ''}</div></div>
${messages(msg)}
${job.status === 'queued' ? '<p class="muted">Waiting for its turn.</p>' : ''}
${log.truncated ? '<p class="small muted">The start of the log is cut.</p>' : ''}
<pre class="log" data-log="/jobs/${esc(job.id)}/log" data-offset="${esc(log.size)}"${open ? ' data-follow="1"' : ''}>${esc(log.text) || (open ? '' : '(no output)')}</pre>
${!open && job.status === 'done' ? `<p class="small" style="margin-top:10px"><a href="/review">Review</a> · <a href="/">Today</a> · <a href="/floor">The floor</a></p>` : ''}`;
}

/** Only these can be started by a bare button; the rest have forms that fill them in. */
const BUTTONS = {
  shift: (f) => ({ dryRun: f.has('dryRun'), again: f.has('again'), force: f.has('force') }),
  scout: () => ({}),
  sources: () => ({}),
  chatter: (f) => ({ subject: f.get('subject') || null, subjectTitle: f.get('subjectTitle') || null }),
  diary: (f) => ({ date: f.get('date') || null, force: f.has('force') }),
  publish: (f) => ({ redeploy: f.has('redeploy') }),
};

/** @param {import('../server.js').App} app */
export function routes(app) {
  app.get('/floor', async (c) => {
    const q = c.url.searchParams;
    const today = c.floor.today();
    const shift = q.get('shift') || today;
    const type = q.get('type') ?? '';
    const actor = q.get('actor')?.trim() ?? '';
    const safeShift = shift === 'all' || /^\d{4}-\d{2}-\d{2}$/.test(shift) ? shift : today;
    const events = await c.floor.read({ shift: safeShift, ...(type ? { type } : {}), ...(actor ? { actor } : {}) });
    const shown = (type ? events : events.filter((e) => e.type !== 'cost.recorded')).slice(-400).reverse();
    return c.page({ title: 'The floor', active: 'floor', body: floorBody({ events: shown, shifts: await c.floor.shifts(), shift: safeShift, type, actor, today, msg: c.msg }) });
  });

  app.get('/transcripts/:id', async (c) => {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(c.params.id)) return c.notFound('no such call');
    let t;
    try {
      t = JSON.parse(await readFile(join(c.config.paths.archive, 'transcripts', `${c.params.id}.json`), 'utf8'));
    } catch {
      return c.notFound('no transcript for that call');
    }
    return c.page({ title: `A call from ${t.role}`, active: 'floor', body: transcriptBody(t, c.msg) });
  });

  app.get('/canon', async (c) => {
    const [works, views, published, deploys] = await Promise.all([readCanon(c.floor), listSeries(c.floor), c.floor.read({ shift: 'all', type: 'work.published' }), c.floor.read({ shift: 'all', type: 'site.deployed' })]);
    const body = canonBody({ works, waiting: approvalsToPrint(views, published), msg: c.msg, canDeploy: Boolean(c.extra.env?.VERCEL_TOKEN), deployed: deploys.at(-1) ?? null });
    return c.page({ title: 'The canon', active: 'canon', body });
  });

  app.post('/canon/:edition/retitle', async (c) => {
    c.back = '/canon';
    const edition = Number(c.params.edition);
    const form = await c.form(64 * 1024);
    const work = (await readCanon(c.floor)).find((w) => w.edition === edition);
    if (!work) return c.notFound(`no edition ${c.params.edition}`);
    if (form.has('fred')) {
      const job = await c.jobs.enqueue('retitle', { edition, note: form.get('note')?.trim() || null });
      return c.redirect(`/jobs/${job.id}`);
    }
    const title = form.get('title')?.trim();
    const wall = form.get('wall')?.trim();
    const options = { edition, ...(title && title !== work.title ? { title } : {}), ...(wall && wall !== work.wallText ? { wall } : {}) };
    if (!options.title && !options.wall) throw new AdminError('that label is the same as the one on the wall');
    const job = await c.jobs.enqueue('retitle', options);
    return c.redirect(`/jobs/${job.id}`);
  });

  app.get('/diary', async (c) => {
    const dir = join(c.config.paths.archive, 'diary');
    const names = (await readdir(dir).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().reverse();
    if (!names.length) return c.page({ title: 'The diary', active: 'diary', body: `<h1>The diary</h1>${messages(c.msg)}<p class="muted">Nothing yet: the Archivist writes at the end of each shift.</p>` });
    return c.redirect(`/diary/${names[0].slice(0, 10)}`);
  });

  app.get('/diary/:date', async (c) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.params.date)) return c.notFound('no such day');
    const dir = join(c.config.paths.archive, 'diary');
    const days = (await readdir(dir).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).map((n) => n.slice(0, 10)).sort().reverse();
    let text;
    try {
      text = await readFile(join(dir, `${c.params.date}.md`), 'utf8');
    } catch {
      return c.notFound(`no diary for ${c.params.date}`);
    }
    const at = days.indexOf(c.params.date);
    const body = `<div class="top"><div><h1>The diary</h1><p class="lede">Andy's morning call to Pat Hackett, typed up by the Archivist.</p></div><form method="get" class="row" action="/diary"><select aria-label="Day" name="d" data-go>${days.map((d) => `<option value="/diary/${d}"${d === c.params.date ? ' selected' : ''}>${d}</option>`).join('')}</select></form></div>
    ${messages(c.msg)}
    <article class="diary">${diaryHtml(text)}</article>
    <div class="pager" style="max-width:68ch">${days[at + 1] ? `<a href="/diary/${days[at + 1]}">← ${days[at + 1]}</a>` : '<span></span>'}${days[at - 1] ? `<a href="/diary/${days[at - 1]}">${days[at - 1]} →</a>` : '<span></span>'}</div>`;
    return c.page({ title: `Diary ${c.params.date}`, active: 'diary', body });
  });

  app.get('/jobs', async (c) => c.page({ title: 'Jobs', active: 'jobs', body: jobsBody({ jobs: await c.jobs.list(), msg: c.msg }) }));

  app.post('/jobs/start', async (c) => {
    c.back = '/';
    const form = await c.form();
    const kind = form.get('kind');
    if (!BUTTONS[kind] || !JOB_KINDS[kind]) throw new AdminError(`no job "${kind}"`);
    const job = await c.jobs.enqueue(kind, BUTTONS[kind](form));
    return c.redirect(`/jobs/${job.id}`);
  });

  app.get('/jobs/:id', async (c) => {
    const job = await c.jobs.read(c.params.id);
    if (!job) return c.notFound(`no job ${c.params.id}`);
    return c.page({ title: job.title, active: 'jobs', body: jobBody(job, await c.jobs.logOf(job), c.msg) });
  });

  app.get('/jobs/:id/log', async (c) => {
    const job = await c.jobs.read(c.params.id);
    if (!job) return c.json({ error: 'no such job' }, 404);
    const offset = Number(c.url.searchParams.get('offset')) || 0;
    const log = await c.jobs.logOf(job, { offset });
    return c.json({ text: log.text, size: log.size, ended: !['queued', 'running'].includes(job.status) });
  });

  app.post('/jobs/:id/cancel', async (c) => {
    c.back = `/jobs/${c.params.id}`;
    const job = await c.jobs.cancel(c.params.id);
    return c.redirect(`/jobs/${job.id}`, { done: 'Stopping it. A stopped shift resumes where it stopped the next time it runs.' });
  });
}
