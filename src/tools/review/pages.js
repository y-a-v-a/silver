// HTML for the review contact sheet. Plain server-rendered pages with forms: no framework,
// no build step, and they still work if JavaScript is off (the "play" button is a bonus).
import { isPendingReview } from '../../agents/series-data.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** URL of an archived file (path relative to the repo root, under archive/variants/). */
export const fileUrl = (rel) => `/files/${rel.split('/').slice(2).map(encodeURIComponent).join('/')}`;

const STYLE = `
  :root { color-scheme: dark; --bg: #111; --panel: #1a1a1a; --line: #2c2c2c; --fg: #ededed; --muted: #9a9a9a;
          --silver: #c9c9c9; --ok: #6fbf73; --bad: #e0584f; --pick: #f2d74e; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 16px 48px; background: var(--bg); color: var(--fg); font: 14px/1.45 Helvetica, Arial, sans-serif; }
  a { color: var(--silver); }
  h1 { font-size: 22px; margin: 0 0 6px; } h2 { font-size: 15px; margin: 24px 0 8px; color: var(--silver); text-transform: uppercase; letter-spacing: .06em; }
  .muted { color: var(--muted); } .small { font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .flash { background: #203020; border: 1px solid var(--ok); padding: 8px 12px; margin-bottom: 12px; }
  .error { background: #301c1c; border: 1px solid var(--bad); padding: 8px 12px; margin-bottom: 12px; }
  .warn { color: var(--bad); font-weight: bold; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; }
  @media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
  .panel { background: var(--panel); border: 1px solid var(--line); padding: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); display: flex; flex-direction: column; }
  .card.pick { border-color: var(--pick); } .card.approved { outline: 2px solid var(--ok); } .card.vetoed { opacity: .55; }
  .frame { position: relative; aspect-ratio: 1; background: #000; }
  .frame img, .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: cover; }
  .meta { padding: 8px 10px 0; font-size: 12px; color: var(--muted); }
  .badge { display: inline-block; font-size: 11px; padding: 1px 6px; border: 1px solid currentColor; margin-right: 4px; }
  .badge.pick { color: var(--pick); } .badge.ok { color: var(--ok); } .badge.bad { color: var(--bad); } .badge.off { color: var(--silver); }
  .note { padding: 6px 10px 0; font-style: italic; }
  form.decide { padding: 8px 10px 10px; display: grid; gap: 6px; margin-top: auto; }
  textarea { width: 100%; min-height: 38px; resize: vertical; background: #0d0d0d; color: var(--fg); border: 1px solid var(--line); padding: 6px; font: inherit; }
  .buttons { display: flex; gap: 6px; flex-wrap: wrap; }
  button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); background: #262626; color: var(--fg); cursor: pointer; }
  button.approve { border-color: var(--ok); } button.veto { border-color: var(--bad); }
  button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 2px solid var(--pick); outline-offset: 2px; }
  .table-wrap { overflow-x: auto; } .small { overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; } td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .chatter p { margin: 0 0 8px; } ul.failed { padding-left: 18px; }
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
<script>
  // "Play" swaps a screenshot for the live sketch, in place.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-live]');
    if (!b) return;
    e.preventDefault();
    const frame = b.closest('.card').querySelector('.frame');
    frame.innerHTML = '<iframe loading="lazy" title="live sketch"></iframe>';
    frame.querySelector('iframe').src = b.dataset.live;
    b.remove();
  });
</script>
</body>
</html>`;
}

const messages = ({ flash, error }) =>
  `${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}`;

/** The list of series: pending reviews first, then the recently closed ones. */
export function indexPage(all, msg = {}) {
  const pending = all.filter(isPendingReview).reverse();
  const closed = all.filter((s) => s.closed).reverse().slice(0, 20);
  const row = (s) => {
    const produced = s.variants.filter((v) => v.ok).length;
    const approved = [...s.decisions.values()].filter((d) => d.payload.verdict === 'approved').length;
    const title = s.subject?.payload.title ?? s.started.payload.subjectTitle ?? '(unknown subject)';
    const flag = s.subject?.payload.sensitive?.flag ? ' <span class="warn">sensitive</span>' : '';
    const warhol = s.shortlist ? `${s.shortlist.payload.picks.length} picked` : '<span class="muted">not yet</span>';
    return `<tr><td><a href="/series/${esc(s.seriesId)}">${esc(title)}</a>${flag}<div class="small muted">${esc(s.seriesId)} · ${esc(s.started.shift)}</div></td><td>${produced}/${s.variants.length}</td><td>${warhol}</td><td>${s.decisions.size} (${approved} approved)</td></tr>`;
  };
  const table = (rows) => `<div class="table-wrap"><table><thead><tr><th>Subject</th><th>Produced</th><th>Warhol</th><th>Decisions</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return layout(
    'Silver: review',
    `<div class="top"><h1>Review</h1><span class="muted">Nothing enters the canon without you.</span></div>
${messages(msg)}
<h2>Waiting for review (${pending.length})</h2>
${pending.length ? table(pending.map(row)) : '<p class="muted">Nothing waiting. Run <code>silver series</code> and <code>silver shortlist</code>.</p>'}
<h2>Recently closed</h2>
${closed.length ? table(closed.map(row)) : '<p class="muted">None yet.</p>'}`,
  );
}

/** One series: Warhol's shortlist, the floor's chatter, and every variant with its decision form. */
export function seriesPage(s, msg = {}, { works = new Map() } = {}) {
  const p = s.subject?.payload ?? {};
  const title = p.title ?? s.started.payload.subjectTitle ?? '(unknown subject)';
  const picks = new Map((s.shortlist?.payload.picks ?? []).map((pick, i) => [pick.variant, { ...pick, rank: i + 1 }]));
  const produced = s.variants.filter((v) => v.ok);
  const failed = s.variants.filter((v) => !v.ok);
  // Warhol's picks first, in his order; then the rest.
  produced.sort((a, b) => (picks.get(a.variant)?.rank ?? 99) - (picks.get(b.variant)?.rank ?? 99) || a.variant.localeCompare(b.variant));

  const card = (v) => {
    const pick = picks.get(v.variant);
    const decision = s.decisions.get(v.variant)?.payload;
    const cls = ['card', pick && 'pick', decision?.verdict].filter(Boolean).join(' ');
    const badges = [
      pick && `<span class="badge pick">Warhol #${pick.rank}</span>`,
      pick?.offTechnique && '<span class="badge off">off technique</span>',
      decision && `<span class="badge ${decision.verdict === 'approved' ? 'ok' : 'bad'}">${esc(decision.verdict)}</span>`,
      works.get(v.variant) && `<span class="badge ok">${works.get(v.variant).edition ? `No. ${String(works.get(v.variant).edition).padStart(3, '0')}` : 'printed'}</span>`,
    ].filter(Boolean).join('');
    const live = v.html ? fileUrl(v.html) : null;
    return `<article class="${cls}" id="${esc(v.variant)}">
  <div class="frame">${v.png ? `<img src="${esc(fileUrl(v.png))}" alt="${esc(`${v.variant}, ${v.technique}`)}" loading="lazy">` : '<p class="muted small">not rendered</p>'}</div>
  <div class="meta">${badges} <strong>${esc(v.variant)}</strong> · ${esc(v.technique)} · t${esc(v.temperature)} · ${esc(v.model ?? '')}
    ${live ? ` · <a href="${esc(live)}" target="_blank" rel="noopener">open</a> · <a href="#" data-live="${esc(live)}">play here</a>` : ''}</div>
  ${pick?.note ? `<p class="note">Warhol: ${esc(pick.note)}</p>` : ''}
  ${decision?.note ? `<p class="note">You: ${esc(decision.note)}</p>` : ''}
  <form class="decide" method="post" action="/series/${esc(s.seriesId)}/decide">
    <input type="hidden" name="variant" value="${esc(v.variant)}">
    <label class="small muted" for="note-${esc(v.variant)}">Note (goes into taste.md)</label>
    <textarea id="note-${esc(v.variant)}" name="note" maxlength="1000"></textarea>
    <div class="buttons">
      <button class="approve" name="verdict" value="approved">Approve</button>
      <button class="veto" name="verdict" value="vetoed">Veto</button>
    </div>
  </form>
</article>`;
  };

  const shortlist = s.shortlist
    ? `<div class="panel"><strong>Warhol</strong> picked ${s.shortlist.payload.picks.map((x) => esc(x.variant)).join(', ') || 'nothing'}.${s.shortlist.payload.rejects ? ` <span class="muted">The rest: ${esc(s.shortlist.payload.rejects)}</span>` : ''}</div>`
    : `<div class="panel muted">Warhol hasn't looked at this series yet: <code>silver shortlist ${esc(s.seriesId)}</code>. You can decide without him.</div>`;
  const chatter = s.chatter.length
    ? s.chatter.map((e) => `<p><strong>${esc(e.actor.replace(/^superstar\./, ''))}</strong>: ${esc(e.payload.text)}</p>`).join('')
    : '<p class="muted">The floor is quiet about this one.</p>';
  const whyLabel = p.origin === 'commission' ? 'Your note' : p.origin === 'superstar' ? `Pushed by ${p.proposedBy}` : 'Why';
  const notes = [p.why && `<p>${esc(whyLabel)}: ${esc(p.why)}</p>`, p.scoutWhy && `<p>Scout: ${esc(p.scoutWhy)}</p>`, s.started?.payload.chatter === false && '<p>Made without the floor\'s chatter (A/B).</p>'].filter(Boolean).join('');

  return layout(
    `Review: ${title}`,
    `<div class="top"><div><a href="/">← all series</a><h1>${esc(title)}</h1>
  <div class="small muted">series ${esc(s.seriesId)} · ${esc(s.started.shift)} · ${produced.length}/${s.variants.length} produced${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ''}</div></div>
  ${s.closed ? `<span class="muted">closed ${esc(s.closed.shift)}</span>` : `<form method="post" action="/series/${esc(s.seriesId)}/close"><button>Close this review</button></form>`}</div>
${messages(msg)}
${p.sensitive?.flag ? `<p class="warn" role="note">Sensitive subject${p.sensitive.reason ? `: ${esc(p.sensitive.reason)}` : ''}. Look twice before approving.</p>` : ''}
<p class="small muted">Real people's likenesses are judged here, case by case.</p>
<div class="layout">
  <main>
    ${notes}
    ${shortlist}
    <h2>Variants</h2>
    <div class="grid">${produced.map(card).join('\n')}</div>
    ${failed.length ? `<h2>Failed (${failed.length})</h2><ul class="failed small">${failed.map((v) => `<li><strong>${esc(v.variant)}</strong> ${esc(v.technique)} · ${esc(v.model ?? '')}: ${esc(v.reason)}${v.error ? ` <span class="muted">${esc(String(v.error).split('\n')[0].slice(0, 160))}</span>` : ''}</li>`).join('')}</ul>` : ''}
  </main>
  <aside class="panel chatter"><h2>The floor</h2>${chatter}</aside>
</div>`,
  );
}

export function notFoundPage(message) {
  return layout('Not found', `<p><a href="/">← all series</a></p><p class="error">${esc(message)}</p>`);
}
