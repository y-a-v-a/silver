// The contact sheet: the one narrow gate. Nothing enters the canon without you.
import { isPendingReview } from '../../agents/series-data.js';
import { closeReview, recordDecision, ReviewError } from '../../agents/review.js';
import { sayOnFloor } from '../../agents/superstars.js';
import { readCanon } from '../../canon.js';
import { action, esc, fileUrl, greaseMark, messages, outLink, pad3, shortId } from '../ui.js';

const PER_PAGE = 20;

const titleOf = (s) => s.subject?.payload.title ?? s.started.payload.subjectTitle ?? '(unknown subject)';

function matchesQuery(s, q) {
  if (!q) return true;
  const hay = [titleOf(s), s.seriesId, s.started.shift, ...s.variants.map((v) => v.technique)].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** The frames a series shows in the list: Warhol's picks first, then whatever else came out. */
function stripOf(s, n = 8) {
  const picks = (s.shortlist?.payload.picks ?? []).map((p) => p.variant);
  const out = s.variants.filter((v) => v.ok && v.png);
  const rank = (v) => (picks.includes(v.variant) ? picks.indexOf(v.variant) : 99);
  return out.sort((a, b) => rank(a) - rank(b) || a.variant.localeCompare(b.variant)).slice(0, n);
}

function row(s) {
  const produced = s.variants.filter((v) => v.ok).length;
  const approved = [...s.decisions.values()].filter((d) => d.payload.verdict === 'approved').length;
  const flag = s.subject?.payload.sensitive?.flag ? ' <span class="warn">sensitive</span>' : '';
  const warhol = s.shortlist ? `${s.shortlist.payload.picks.length} picked` : '<span class="chip warn">Warhol hasn’t looked</span>';
  const picks = new Set((s.shortlist?.payload.picks ?? []).map((p) => p.variant));
  const frames = stripOf(s).map((v) => {
    const d = s.decisions.get(v.variant)?.payload.verdict;
    return `<a href="/series/${esc(s.seriesId)}#${esc(v.variant)}" title="${esc(`${v.variant} · ${v.technique}`)}"><img src="${esc(fileUrl(v.png))}" alt="" loading="lazy">${picks.has(v.variant) ? greaseMark('pick') : ''}${d === 'approved' ? greaseMark('ok') : d === 'vetoed' ? greaseMark('no') : ''}</a>`;
  });
  return `<div class="strip-row">
  <div>
    <h3><a href="/series/${esc(s.seriesId)}">${esc(titleOf(s))}</a>${flag}</h3>
    <div class="small muted">${esc(s.started.shift)} · ${produced}/${s.variants.length} produced · ${warhol}${s.decisions.size ? ` · ${s.decisions.size} decided (${approved} approved)` : ''}</div>
    <div class="tag">${esc([...new Set(s.variants.map((v) => v.technique))].slice(0, 3).join(', '))}</div>
  </div>
  <div class="strip">${frames.join('') || '<div class="none">nothing came out</div>'}</div>
</div>`;
}

/**
 * The list of series.
 * @param {object[]} all    every series, oldest first
 * @param {{flash?: string, error?: string}} msg
 * @param {{show?: string, q?: string, page?: number}} [opts]
 */
export function reviewBody(all, msg = {}, { show = 'waiting', q = '', page = 1 } = {}) {
  const pending = all.filter(isPendingReview);
  const closed = all.filter((s) => s.closed);
  const unlisted = pending.filter((s) => !s.shortlist && s.variants.some((v) => v.ok));
  const pool = (show === 'closed' ? closed : show === 'all' ? all : pending).filter((s) => matchesQuery(s, q)).reverse();
  const pages = Math.max(1, Math.ceil(pool.length / PER_PAGE));
  const at = Math.min(Math.max(1, page), pages);
  const shown = pool.slice((at - 1) * PER_PAGE, at * PER_PAGE);
  const link = (extra) => {
    const u = new URLSearchParams({ ...(show !== 'waiting' ? { show } : {}), ...(q ? { q } : {}), ...extra });
    return `/review${u.size ? `?${u}` : ''}`;
  };
  const tab = (id, label, n) => `<a href="/review${id === 'waiting' ? '' : `?show=${id}`}"${show === id ? ' aria-current="page"' : ''}>${label} (${n})</a>`;
  const oldest = pending[0]?.started.shift;
  return `<div class="top"><div><h1>Review</h1><p class="lede">Nothing enters the canon without you. Approving prints it, signs it and puts it in the gallery.</p></div>
  <form method="get" action="/review" class="row">${show !== 'waiting' ? `<input type="hidden" name="show" value="${esc(show)}">` : ''}<input type="search" name="q" value="${esc(q)}" placeholder="Subject, technique, date" aria-label="Search"><button>Find</button></form></div>
${messages(msg)}
<div class="tabs">${tab('waiting', 'Waiting for review', pending.length)}${tab('closed', 'Recently closed', closed.length)}${tab('all', 'Everything', all.length)}</div>
${shown.length ? shown.map(row).join('\n') : `<p class="muted">${q ? 'Nothing matches that.' : show === 'closed' ? 'None yet.' : 'Nothing waiting. Run the shift, or make a series from Subjects.'}</p>`}
${pages > 1 ? `<div class="pager">${at > 1 ? `<a href="${esc(link({ page: at - 1 }))}">← newer</a>` : '<span></span>'}<span>page ${at} of ${pages}</span>${at < pages ? `<a href="${esc(link({ page: at + 1 }))}">older →</a>` : '<span></span>'}</div>` : ''}
${show === 'waiting' && (pending.length > 5 || unlisted.length) ? `<div class="cols even" style="margin-top:28px">
  ${unlisted.length ? `<div class="panel"><h3>${unlisted.length} series Warhol hasn’t looked at</h3><p class="small muted">Usually a call that failed during the shift. He looks at them one at a time, a few cents each.</p>${action('/review/shortlist-all', `Ask Warhol to look at ${unlisted.length === 1 ? 'it' : `all ${unlisted.length}`}`)}</div>` : ''}
  ${pending.length > 5 ? `<form method="post" action="/review/close-before" class="panel"><h3>Clear the backlog</h3>
    <p class="small muted">Close every waiting review from before a date. Decisions you already made stay, the variants stay in the archive, and any of them can still be approved from its page.</p>
    <div class="row"><input type="date" name="before" value="2026-10-23" min="${esc(oldest)}" aria-label="Before"><button data-confirm="Close them all?">Close the older ones</button></div>
    <span class="help">2026-10-23 is the day the studio stopped making pop-art.</span></form>` : ''}
</div>` : ''}`;
}

/** How a variant was made: the assistant's own note, the line it took as its brief, and its dare. */
function making(v) {
  const rows = [
    v.note && ['made', v.note],
    v.brief && [`${v.brief.from}'s line${v.brief.stray ? ' (about something else)' : ''}`, `“${v.brief.text}”`],
    v.dare && ['dare', v.dare],
    v.humanNote && ['you asked', v.humanNote],
  ].filter(Boolean);
  return rows.length ? `<dl class="making">${rows.map(([k, val]) => `<div><dt>${esc(k)}:</dt> <dd>${esc(val)}</dd></div>`).join('')}</dl>` : '';
}

/** One series: Warhol's shortlist, the floor's chatter, and every variant with its decision form. */
export function seriesBody(s, msg = {}, { works = new Map(), running = null } = {}) {
  const p = s.subject?.payload ?? {};
  const title = titleOf(s);
  const picks = new Map((s.shortlist?.payload.picks ?? []).map((pick, i) => [pick.variant, { ...pick, rank: i + 1 }]));
  const produced = s.variants.filter((v) => v.ok);
  const failed = s.variants.filter((v) => !v.ok);
  // Warhol's picks first, in his order, each followed by its second pull; then the rest.
  const rank = (v) => picks.get(v.variant)?.rank ?? (v.pullOf ? (picks.get(v.pullOf)?.rank ?? 99) + 0.5 : 99);
  produced.sort((a, b) => rank(a) - rank(b) || a.variant.localeCompare(b.variant));
  const sendBack = `/series/${s.seriesId}/pull`;

  const card = (v) => {
    const pick = picks.get(v.variant);
    const decision = s.decisions.get(v.variant)?.payload;
    const work = works.get(v.variant);
    const cls = ['card', pick && 'pick', decision?.verdict].filter(Boolean).join(' ');
    const badges = [
      pick && `<span class="badge pick">Warhol #${pick.rank}</span>`,
      pick?.offTechnique && '<span class="badge off">off technique</span>',
      v.pullOf && `<span class="badge pull">second pull of ${esc(v.pullOf)}</span>`,
      decision && `<span class="badge ${decision.verdict === 'approved' ? 'ok' : 'bad'}">${esc(decision.verdict)}</span>`,
      work && `<span class="badge ed">${work.edition ? `No. ${pad3(work.edition)}` : 'printed'}</span>`,
    ].filter(Boolean).join('');
    const live = v.html ? fileUrl(v.html) : null;
    return `<article class="${cls}" id="${esc(v.variant)}"${live ? ` data-sketch="${esc(live)}"` : ''}>
  <div class="rebate"><span>▸ ${esc(v.variant)}</span><span>${esc(v.technique)}</span></div>
  <div class="frame">${v.png ? `<img src="${esc(fileUrl(v.png))}" alt="${esc(`${v.variant}, ${v.technique}`)}" loading="lazy">` : '<p class="empty">not rendered</p>'}${pick ? greaseMark('pick') : ''}${decision?.verdict === 'approved' ? greaseMark('ok') : decision?.verdict === 'vetoed' ? greaseMark('no') : ''}</div>
  <div class="meta">${badges} <strong>${esc(v.variant)}</strong> · ${esc(v.technique)} · t${esc(v.temperature)} · ${esc(v.model ?? '')}
    ${live ? ` · <a href="${esc(live)}" target="_blank" rel="noopener">open</a> · <a href="#" data-live="${esc(live)}">play here</a>` : ''}</div>
  ${making(v)}
  ${pick?.note ? `<p class="note warhol">Warhol: ${esc(pick.note)}</p>` : ''}
  ${v.pullOf && !pick && picks.get(v.pullOf)?.note ? `<p class="note warhol">Sent back by Warhol: ${esc(picks.get(v.pullOf).note)}</p>` : ''}
  ${decision?.note ? `<p class="note you">You: ${esc(decision.note)}</p>` : ''}
  <form class="decide" method="post" action="/series/${esc(s.seriesId)}/decide" data-stay>
    <input type="hidden" name="variant" value="${esc(v.variant)}">
    <label class="small muted" for="note-${esc(v.variant)}">Note (goes into taste.md)</label>
    <textarea id="note-${esc(v.variant)}" name="note" maxlength="1000"></textarea>
    <div class="buttons">
      <button class="approve" name="verdict" value="approved">Approve</button>
      <button class="veto" name="verdict" value="vetoed">Veto</button>
    </div>
  </form>
  ${v.png ? `<details class="sendback"><summary>Send it back</summary>
    <form method="post" action="${esc(sendBack)}"><input type="hidden" name="variant" value="${esc(v.variant)}">
    <textarea name="note" maxlength="1000" placeholder="What should be pushed? (Goes to the hand that made it.)" aria-label="What should be pushed"></textarea>
    <button>Pull it again</button> <span class="small muted">about ${esc(v.pullCost ?? '$0.10')}</span></form></details>` : ''}
</article>`;
  };

  const steer = s.started.payload.steer;
  const shortlist = s.shortlist
    ? `<div class="panel"><strong>Warhol</strong> picked ${s.shortlist.payload.picks.map((x) => esc(x.variant)).join(', ') || 'nothing'}.${s.shortlist.payload.rejects ? ` <span class="muted">The rest: ${esc(s.shortlist.payload.rejects)}</span>` : ''}</div>`
    : `<div class="panel spread"><span class="muted">Warhol hasn't looked at this series yet. You can decide without him.</span>${produced.length ? action(`/series/${s.seriesId}/shortlist`, 'Ask Warhol') : ''}</div>`;
  const chatter = s.chatter.length
    ? s.chatter.map((e) => `<p class="floorline"><strong>${esc((e.payload.persona ?? e.actor).replace(/^superstar\./, ''))}</strong>: ${esc(e.payload.text)}</p>`).join('')
    : '<p class="muted">The floor is quiet about this one.</p>';
  const whyLabel = p.origin === 'commission' ? 'Your note' : p.origin === 'superstar' ? `Pushed by ${p.proposedBy}` : 'Why';
  const notes = [
    p.why && `<p>${esc(whyLabel)}: ${esc(p.why)}</p>`,
    p.scoutWhy && `<p>Scout: ${esc(p.scoutWhy)}</p>`,
    s.started?.payload.chatter === false && "<p>Made without the floor's chatter (A/B).</p>",
    s.started.payload.direction && `<p class="quote">From you to the studio: ${esc(s.started.payload.direction)}</p>`,
    steer && (steer.techniques || steer.models || steer.dare) && `<p class="small muted">Pinned: ${esc([steer.techniques?.join(', '), steer.models?.join(', '), steer.dare].filter(Boolean).join(' · '))}</p>`,
  ].filter(Boolean).join('');
  const approvedN = [...s.decisions.values()].filter((d) => d.payload.verdict === 'approved').length;

  return `<div class="top"><div><a class="crumb" href="/review">← all series</a><h1>${esc(title)}</h1>
  <div class="small muted">series ${esc(shortId(s.seriesId))} · ${esc(s.started.shift)} · ${produced.length}/${s.variants.length} produced${p.url ? ` · ${outLink(p.url, 'source')}` : ''}</div></div>
  ${s.closed ? `<span class="muted">closed ${esc(s.closed.shift)}</span>` : `<form method="post" action="/series/${esc(s.seriesId)}/close"><button>Close this review</button></form>`}</div>
${messages(msg)}
${p.sensitive?.flag ? `<p class="warn" role="note">Sensitive subject${p.sensitive.reason ? `: ${esc(p.sensitive.reason)}` : ''}. Look twice before approving.</p>` : ''}
<div class="cols">
  <div>
    ${notes}
    ${shortlist}
    <div class="toolbar"><span class="small muted"><kbd>j</kbd> <kbd>k</kbd> move · <kbd>enter</kbd> look · <kbd>a</kbd> approve · <kbd>x</kbd> veto · <kbd>n</kbd> note · <kbd>p</kbd> play</span><span class="small muted">${approvedN} approved · ${s.decisions.size - approvedN} vetoed</span></div>
    <div class="sheet">${produced.map(card).join('\n')}</div>
    ${failed.length ? `<h2>Failed (${failed.length})</h2><ul class="failed">${failed.map((v) => `<li><strong>${esc(v.variant)}</strong> ${esc(v.technique)} · ${esc(v.model ?? '')}: ${esc(v.reason)}${v.error ? ` <span class="muted">${esc(String(v.error).split('\n')[0].slice(0, 160))}</span>` : ''}</li>`).join('')}</ul>` : ''}
  </div>
  <aside>
    <div class="panel"><h2>The floor</h2>${chatter}
      ${s.subject ? `<form method="post" action="/subjects/${esc(s.subject.id)}/say" data-stay><input type="hidden" name="back" value="/series/${esc(s.seriesId)}"><label class="small muted" for="say">Say something (an assistant may take it as a brief next time)</label><textarea id="say" name="text" maxlength="280" rows="2"></textarea><div class="buttons" style="margin-top:5px"><button>Say it</button></div></form>` : ''}
    </div>
    ${s.subject ? `<div class="panel"><h2>Another go</h2><p class="small muted">A new series on the same subject, with whatever you pin.</p><a class="btn" href="/subjects/${esc(s.subject.id)}">New series on this subject</a>
      ${s.shortlist && produced.length ? `<div style="margin-top:8px">${action(`/series/${s.seriesId}/shortlist`, 'Let Warhol look again', { fields: { force: '1' }, cls: 'quiet' })}</div>` : ''}</div>` : ''}
    <p class="small muted">Real people's likenesses are judged here, case by case.</p>
  </aside>
</div>`;
}

export const lightbox = `<dialog class="light"><div class="light-in"><div class="light-stage"></div><div class="light-side"></div></div></dialog>`;

/** @param {import('../server.js').App} app */
export function routes(app) {
  const findView = async (c, id) => (await c.series()).find((s) => s.seriesId === id) ?? null;

  app.get('/review', async (c) => {
    const page = Number(c.url.searchParams.get('page')) || 1;
    return c.page({ title: 'Review', active: 'review', body: reviewBody(await c.series(), c.msg, { show: c.url.searchParams.get('show') ?? 'waiting', q: c.url.searchParams.get('q') ?? '', page }) });
  });

  app.post('/review/close-before', async (c) => {
    c.back = '/review';
    const before = (await c.form()).get('before') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new ReviewError('pick a date');
    const old = (await c.series()).filter((s) => isPendingReview(s) && s.started.shift < before);
    for (const s of old) await closeReview({ floor: c.floor }, s, { note: `Bulk close: everything from before ${before}` });
    return c.redirect('/review', { done: `Closed ${old.length} review${old.length === 1 ? '' : 's'} from before ${before}.` });
  });

  app.post('/review/shortlist-all', async (c) => {
    c.back = '/review';
    const todo = (await c.series()).filter((s) => isPendingReview(s) && !s.shortlist && s.variants.some((v) => v.ok));
    for (const s of todo) await c.jobs.enqueue('shortlist', { series: s.seriesId, subjectTitle: titleOf(s) });
    return c.redirect('/jobs', { done: `Warhol has ${todo.length} series to look at.` });
  });

  app.get('/series/:id', async (c) => {
    const view = await findView(c, c.params.id);
    if (!view) return c.notFound(`no series ${c.params.id}`);
    const works = new Map((await readCanon(c.floor)).filter((w) => w.seriesId === view.seriesId).map((w) => [w.variant, w]));
    return c.page({ title: titleOf(view), active: 'review', body: seriesBody(view, c.msg, { works }), after: lightbox });
  });

  app.post('/series/:id/decide', async (c) => {
    const view = await findView(c, c.params.id);
    if (!view) return c.notFound(`no series ${c.params.id}`);
    const back = `/series/${encodeURIComponent(view.seriesId)}`;
    c.back = back;
    const form = await c.form();
    const { event, duplicate } = await recordDecision({ config: c.config, floor: c.floor }, view, { variant: form.get('variant'), verdict: form.get('verdict'), note: form.get('note') ?? '' });
    const printing = !duplicate && event.payload.verdict === 'approved' && app.onApproved;
    if (printing) await app.onApproved();
    const said = `${event.payload.variant} ${event.payload.verdict}${duplicate ? ' (already recorded)' : ''}.${printing ? ' Printing and publishing in the background.' : ''}`;
    return c.redirect(`${back}?done=${encodeURIComponent(said)}#${encodeURIComponent(event.payload.variant)}`);
  });

  app.post('/series/:id/close', async (c) => {
    const view = await findView(c, c.params.id);
    if (!view) return c.notFound(`no series ${c.params.id}`);
    c.back = `/series/${encodeURIComponent(view.seriesId)}`;
    const form = await c.form();
    await closeReview({ floor: c.floor }, view, { note: form.get('note') ?? '' });
    return c.redirect('/review', { done: `Closed the review of "${titleOf(view)}".` });
  });

  app.post('/series/:id/shortlist', async (c) => {
    const view = await findView(c, c.params.id);
    if (!view) return c.notFound(`no series ${c.params.id}`);
    c.back = `/series/${encodeURIComponent(view.seriesId)}`;
    const form = await c.form();
    const job = await c.jobs.enqueue('shortlist', { series: view.seriesId, subjectTitle: titleOf(view), force: form.has('force') });
    return c.redirect(`/jobs/${job.id}`);
  });

  app.post('/series/:id/pull', async (c) => {
    const view = await findView(c, c.params.id);
    if (!view) return c.notFound(`no series ${c.params.id}`);
    c.back = `/series/${encodeURIComponent(view.seriesId)}`;
    const form = await c.form();
    const variant = form.get('variant');
    if (!view.variants.some((v) => v.variant === variant && v.ok)) throw new ReviewError(`${variant} didn't come out, so there's nothing to pull again`);
    const job = await c.jobs.enqueue('pull', { series: view.seriesId, variant, note: form.get('note')?.trim() || null, again: view.variants.some((v) => v.pullOf === variant), subjectTitle: titleOf(view) });
    return c.redirect(`/jobs/${job.id}`);
  });

  app.post('/subjects/:id/say', async (c) => {
    const form = await c.form();
    const back = form.get('back')?.startsWith('/') ? form.get('back') : `/subjects/${c.params.id}`;
    c.back = back;
    const subject = (await c.floor.read({ shift: 'all', type: 'subject.posted' })).find((e) => e.id === c.params.id);
    if (!subject) return c.notFound(`no subject ${c.params.id}`);
    await sayOnFloor(c.floor, subject, form.get('text'));
    return c.redirect(back, { done: 'Said on the floor.' });
  });
}
