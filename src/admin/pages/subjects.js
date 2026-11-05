// Subjects: what the Factory is going to work on. Commission your own, push one to the front,
// take one off the table, or start a series right now with whatever you want to pin.
import { claimedSubjects, pinnedSubjects, pinSubject, retiredSubjects, retireSubject } from '../../agents/retire.js';
import { nextInLine } from '../status.js';
import { activeTechniques, techniqueWeight } from '../../settings.js';
import { action, ago, esc, messages, outLink, shortId, usd } from '../ui.js';
import { AdminError } from '../server.js';
import { computeStats, variantCost } from '../stats.js';
import { listSeries } from '../../agents/series-data.js';

const originLabel = { commission: 'yours', superstar: 'pushed by a superstar', archive: 'from the archive', scouted: 'scouted' };

function subjectRow(s, { pinned, claimed, retired, pos = null }) {
  const p = s.payload;
  return `<tr${retired ? ' class="off"' : ''}><td class="num">${pos ?? ''}</td><td class="wrap"><a href="/subjects/${esc(s.id)}">${esc(p.title)}</a>${p.sensitive?.flag ? ' <span class="chip bad">sensitive</span>' : ''}${pinned ? ' <span class="chip warn">pinned</span>' : ''}
    <div class="small muted">${esc(originLabel[p.origin] ?? p.origin ?? '')}${p.proposedBy ? ` (${esc(p.proposedBy)})` : ''} · ${esc(s.shift)}${p.why ? ` · ${esc(p.why.length > 140 ? `${p.why.slice(0, 139)}…` : p.why)}` : ''}</div></td>
    <td style="white-space:nowrap;text-align:right">${retired ? '<span class="tag">retired</span>' : claimed ? '<span class="tag">has a series</span>' : `${action(`/subjects/${s.id}/pin`, pinned ? 'Unpin' : 'Pin', { cls: 'quiet', fields: { pinned: pinned ? '0' : '1' }, stay: true })}<a class="btn" href="/subjects/${esc(s.id)}">Series…</a>`}</td></tr>`;
}

function commissionForm() {
  return `<form method="post" action="/subjects/commission" class="panel" id="commission"><h2>Commission a subject</h2>
  <div class="field"><label for="c-text">A headline, a thing, a URL</label><textarea id="c-text" name="text" rows="2" maxlength="4000" required></textarea></div>
  <div class="field"><label for="c-why">Your reason (optional)</label><input id="c-why" type="text" name="why" style="width:100%"></div>
  <div class="row"><button class="primary" name="now" value="0">Put it in the queue</button><button name="now" value="1">Make it now</button></div>
  <span class="help">The queue: it gets a series in the next shift, ahead of the Scout's picks. Now: the superstars talk, the assistants make a series, Warhol looks, right away.</span></form>`;
}

export function subjectsBody({ next, rest, pins, claimed, retired, msg, doneToday = false }) {
  const nextIds = new Set(next.map((s) => s.id));
  const lede = doneToday
    ? "Today's shift is done. The next one starts with whatever is pinned or commissioned, then takes what the Scout brings in that morning. Today's other subjects don't run unless you pin them, or make a series now."
    : "The shift makes a series of whatever is next in line. Pin anything to move it to the front; older subjects only run when pinned. A series you make by hand doesn't take a slot from the shift.";
  return `<div class="top"><div><h1>Subjects</h1><p class="lede">${esc(lede)}</p></div>
  <div class="row">${action('/jobs/start', 'Send the Scout out', { fields: { kind: 'scout' } })}${action('/jobs/start', 'Let the superstars talk', { fields: { kind: 'chatter' } })}</div></div>
${messages(msg)}
<div class="cols">
  <div>
    <h2>Next in line (${next.length})</h2>
    ${next.length ? `<div class="table-wrap"><table>${next.map((s, i) => subjectRow(s, { pinned: pins.has(s.id), pos: i + 1 })).join('')}</table></div>` : `<p class="muted">Nothing pinned or commissioned. ${doneToday ? "The next shift's series will be" : 'The series will be'} whatever the Scout brings in.</p>`}
    <h2>Also on the floor</h2>
    <div class="table-wrap"><table>${rest.filter((s) => !nextIds.has(s.id)).slice(0, 60).map((s) => subjectRow(s, { pinned: pins.has(s.id), claimed: claimed.has(s.id), retired: retired.has(s.id) })).join('')}</table></div>
  </div>
  <aside>${commissionForm()}</aside>
</div>`;
}

export function subjectBody({ subject, config, chatter, series, pinned, retired, claimed, msg, perVariant }) {
  const p = subject.payload;
  const techniques = Object.keys(config.techniques).sort();
  const active = new Set(activeTechniques(config));
  const est = perVariant ? ` At about ${usd(perVariant)} a variant, ${config.series.variants} variants is about ${usd(perVariant * config.series.variants)}.` : '';
  return `<div class="top"><div><a class="crumb" href="/subjects">← subjects</a><h1>${esc(p.title)}</h1>
  <div class="small muted">${esc(originLabel[p.origin] ?? p.origin ?? '')} · ${esc(subject.shift)} · ${esc(shortId(subject.id))}${p.url ? ` · ${outLink(p.url, 'source')}` : ''}${retired ? ` · <span class="warn">retired ${esc(retired.shift)}${retired.payload.reason ? `: ${esc(retired.payload.reason)}` : ''}</span>` : ''}</div></div>
  <div class="row">${retired ? '' : action(`/subjects/${subject.id}/pin`, pinned ? 'Unpin' : 'Pin to the front', { fields: { pinned: pinned ? '0' : '1' } })}${action('/jobs/start', 'Let the superstars talk', { fields: { kind: 'chatter', subject: subject.id, subjectTitle: p.title } })}</div></div>
${messages(msg)}
${p.sensitive?.flag ? `<p class="warn">Sensitive${p.sensitive.reason ? `: ${esc(p.sensitive.reason)}` : ''}.</p>` : ''}
<div class="cols">
  <div>
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}${p.scoutWhy ? `<p class="dim">Scout: ${esc(p.scoutWhy)}</p>` : ''}${p.image ? `<p class="quote small">Proposed image: ${esc(p.image)}</p>` : ''}
    ${retired ? '' : `<form method="post" action="/subjects/${esc(subject.id)}/series" class="panel"><h2>Make a series</h2>
      <p class="small muted">Leave everything alone and the series is dealt as usual: ${config.series.modelsPerSeries} models × ${config.series.temperatures.length} temperatures × ${config.series.techniquesPerSeries} techniques, every variant with its own dare and line.${esc(est)}</p>
      <div class="field"><label for="s-note">A note to every assistant on this series</label><textarea id="s-note" name="note" rows="2" maxlength="1000" placeholder="It should feel like the smell of rain on a car park. No words anywhere."></textarea></div>
      <details><summary>Pin the matrix</summary>
        <div class="grid-fields" style="margin-top:8px">
          <div class="field"><label for="s-tech">Procedures (none = dealt)</label><select id="s-tech" name="techniques" multiple size="9" style="width:100%">${techniques.map((t) => `<option value="${esc(t)}">${esc(t)}${active.has(t) ? (techniqueWeight(config, t) > 1 ? ' ★' : '') : ' (benched)'}</option>`).join('')}</select></div>
          <div class="field"><label for="s-model">Hands (none = dealt)</label><select id="s-model" name="models" multiple size="9" style="width:100%">${config.models.studio.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></div>
          <div><div class="field"><label for="s-var">Variants</label><input id="s-var" type="number" name="variants" min="1" max="48" value="${esc(config.series.variants)}"></div>
          <div class="field"><label for="s-temp">Temperatures</label><input id="s-temp" type="text" name="temperatures" value="" placeholder="${esc(config.series.temperatures.join(', '))}" style="width:100%"></div>
          <label class="check small"><input type="checkbox" name="noChatter" value="1"> Without the floor's chatter</label></div>
        </div>
        <div class="field"><label for="s-dare">One dare for every variant, instead of the deck</label><input id="s-dare" type="text" name="dare" list="dares" style="width:100%"><datalist id="dares">${(config.dares ?? []).map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
      </details>
      <div class="row" style="margin-top:10px"><button class="primary">Make the series</button><button name="dryRun" value="1">Dry run (2 cheap ones)</button></div></form>`}
    ${series.length ? `<h2>Series on this subject</h2><ul class="small" style="padding-left:18px;margin:0">${series.map((s) => `<li><a href="/series/${esc(s.seriesId)}">${esc(s.started.shift)}</a> · ${s.variants.filter((v) => v.ok).length}/${s.variants.length} produced${s.started.payload.dryRun ? ' · dry run' : ''}</li>`).join('')}</ul>` : ''}
    ${retired || claimed ? '' : `<details style="margin-top:18px"><summary>Take it off the table</summary><form method="post" action="/subjects/${esc(subject.id)}/retire"><div class="field"><label for="r-why">Why (optional)</label><input id="r-why" type="text" name="reason" style="width:100%"></div><button class="danger" data-confirm="Retire it">Retire this subject</button></form></details>`}
  </div>
  <aside><div class="panel"><h2>The floor</h2>
    ${chatter.map((e) => `<p class="floorline"><b>${esc(e.payload.persona ?? e.actor)}</b>: ${esc(e.payload.text)} <span class="tag">${esc(ago(e.ts))}</span></p>`).join('') || '<p class="muted">Nobody has said anything.</p>'}
    <form method="post" action="/subjects/${esc(subject.id)}/say" data-stay><label class="small muted" for="say">Say something (a line here can become a brief)</label><textarea id="say" name="text" rows="2" maxlength="280"></textarea><div class="buttons" style="margin-top:5px"><button>Say it</button></div></form>
  </div></aside>
</div>`;
}

/** @param {import('../server.js').App} app */
export function routes(app) {
  const subjectOf = async (c) => (await c.floor.read({ shift: 'all', type: 'subject.posted' })).find((e) => e.id === c.params.id) ?? null;

  app.get('/subjects', async (c) => {
    const [line, posted, starts, pins, retired] = await Promise.all([nextInLine(c.floor, c.config.shift?.seriesPerShift ?? 2), c.floor.read({ shift: 'all', type: 'subject.posted' }), c.floor.read({ shift: 'all', type: 'series.started' }), pinnedSubjects(c.floor), retiredSubjects(c.floor)]);
    const next = line.subjects;
    const claimed = claimedSubjects(starts);
    const rest = posted.filter((s) => !s.payload.dryRun).reverse().sort((a, b) => Number(claimed.has(a.id)) - Number(claimed.has(b.id)));
    const body = subjectsBody({ next, rest: [...line.all.filter((s) => !next.some((x) => x.id === s.id)), ...rest.filter((s) => !line.all.some((x) => x.id === s.id))], pins, claimed, retired, msg: c.msg, doneToday: line.doneToday });
    return c.page({ title: 'Subjects', active: 'subjects', body });
  });

  app.post('/subjects/commission', async (c) => {
    c.back = '/subjects';
    const form = await c.form();
    const text = form.get('text')?.trim();
    if (!text) throw new AdminError('a commission needs some text or a URL');
    const job = await c.jobs.enqueue('commission', { text, why: form.get('why')?.trim() || null, now: form.get('now') === '1' });
    return c.redirect(`/jobs/${job.id}`);
  });

  app.get('/subjects/:id', async (c) => {
    const subject = await subjectOf(c);
    if (!subject) return c.notFound(`no subject ${c.params.id}`);
    const [chatter, views, pins, retired] = await Promise.all([c.floor.read({ shift: 'all', type: 'chatter.posted', ref: subject.id }), listSeries(c.floor), pinnedSubjects(c.floor), retiredSubjects(c.floor)]);
    const series = views.filter((s) => s.subjectId === subject.id);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const body = subjectBody({ subject, config: c.config, chatter: chatter.filter((e) => !e.payload.dryRun), series, pinned: pins.has(subject.id), retired: retired.get(subject.id), claimed: series.some((s) => !s.started.payload.dryRun), msg: c.msg, perVariant: variantCost(computeStats(views, { since })) });
    return c.page({ title: subject.payload.title, active: 'subjects', body });
  });

  app.post('/subjects/:id/pin', async (c) => {
    c.back = '/subjects';
    const subject = await subjectOf(c);
    if (!subject) return c.notFound(`no subject ${c.params.id}`);
    const pinned = (await c.form()).get('pinned') !== '0';
    await pinSubject(c.floor, subject, pinned);
    return c.redirect(`/subjects`, { done: pinned ? `Pinned "${subject.payload.title}": it goes first in the next shift.` : `Unpinned "${subject.payload.title}".` });
  });

  app.post('/subjects/:id/retire', async (c) => {
    c.back = `/subjects/${c.params.id}`;
    const subject = await subjectOf(c);
    if (!subject) return c.notFound(`no subject ${c.params.id}`);
    await retireSubject(c.floor, subject, (await c.form()).get('reason'));
    return c.redirect('/subjects', { done: `Retired "${subject.payload.title}".` });
  });

  app.post('/subjects/:id/series', async (c) => {
    c.back = `/subjects/${c.params.id}`;
    const subject = await subjectOf(c);
    if (!subject) return c.notFound(`no subject ${c.params.id}`);
    const form = await c.form();
    const temperatures = (form.get('temperatures') ?? '').split(',').map((t) => t.trim()).filter(Boolean).map(Number);
    if (temperatures.some((t) => !(t >= 0 && t <= 2))) throw new AdminError('temperatures run from 0 to 2');
    const variants = Number(form.get('variants')) || null;
    const techniques = form.getAll('techniques');
    for (const t of techniques) if (!c.config.techniques[t]) throw new AdminError(`no technique "${t}" on the menu`);
    const models = form.getAll('models');
    const job = await c.jobs.enqueue('series', {
      subject: subject.id,
      subjectTitle: subject.payload.title,
      techniques,
      models,
      temperatures,
      dare: form.get('dare')?.trim() || null,
      note: form.get('note')?.trim() || null,
      variants: variants && variants !== c.config.series.variants ? variants : null,
      noChatter: form.has('noChatter'),
      dryRun: form.has('dryRun'),
    });
    return c.redirect(`/jobs/${job.id}`);
  });
}
