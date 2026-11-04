// Taste: your own words at the top of taste.md (Warhol reads them before every shortlist) and
// what your decisions say. The decision log is the record: it can be read here, never edited.
import { listSeries } from '../../agents/series-data.js';
import { readTaste } from '../../lib/taste.js';
import { saveTaste, tasteHash } from '../store.js';
import { listRevisions, readRevision } from '../souls.js';
import { computeStats } from '../stats.js';
import { esc, messages, percent } from '../ui.js';

function evidence(title, map, { label, href = null, limit = 14, note = '' }) {
  const rows = [...map.entries()].filter(([, r]) => r.approved + r.vetoed + r.picked > 0).sort((a, b) => b[1].approved - a[1].approved || b[1].picked - a[1].picked).slice(0, limit);
  if (!rows.length) return '';
  return `<h2>${esc(title)}${note ? ` <small>${esc(note)}</small>` : ''}</h2><div class="table-wrap"><table><thead><tr><th>${esc(label)}</th><th class="num">Made</th><th class="num">Picked</th><th class="num">Approved</th><th class="num">Vetoed</th></tr></thead><tbody>
  ${rows.map(([name, r]) => `<tr><td class="wrap">${href?.(name) ? `<a href="${esc(href(name))}">${esc(name)}</a>` : esc(name)}</td><td class="num">${r.made}</td><td class="num">${r.picked}</td><td class="num">${r.approved}</td><td class="num">${r.vetoed}</td></tr>`).join('')}
  </tbody></table></div>`;
}

export function tasteBody({ header, entries, stats, agreement, msg, promptEntries, menu = [], baseHash = '', revisions = [] }) {
  const recent = entries.slice(-30).reverse();
  return `<div class="top"><div><h1>Taste</h1><p class="lede">Warhol reads this before every shortlist, with your last ${esc(promptEntries)} decisions. Say what you want from him here; what you want from everyone else goes in <a href="/studio#direction">Direction</a>.</p></div></div>
${messages(msg)}
<div class="cols">
  <div>
    <form method="post" action="/taste" data-guard class="panel"><input type="hidden" name="baseHash" value="${esc(baseHash)}"><label class="label" for="header">In your own words</label>
    <textarea id="header" name="header" rows="12" class="code">${esc(header)}</textarea>
    <div class="row" style="margin-top:8px"><button class="primary">Save</button><span class="small muted">Only the part above the decision log. Warhol reads it next time he looks.${revisions.length ? ` <a href="/history/taste/${esc(revisions[0].id)}">Earlier versions (${revisions.length})</a>` : ''}</span></div></form>
    <h2>Your decisions <small>the last ${recent.length} of ${entries.length}. Append-only: to change your mind, decide again on the variant's page.</small></h2>
    <div class="small dim">${recent.map((l) => `<p style="margin:0 0 4px;overflow-wrap:anywhere">${esc(l.replace(/^- /, ''))}</p>`).join('') || '<p class="muted">None yet.</p>'}</div>
  </div>
  <aside>
    ${agreement.total ? `<div class="panel"><h2>You and Warhol</h2><p>Of your ${agreement.total} approvals, he had picked <strong>${agreement.picked}</strong> (${percent(agreement.picked, agreement.total)}%).</p>${agreement.vetoedPicks ? `<p class="small muted">You vetoed ${agreement.vetoedPicks} of his picks.</p>` : ''}</div>` : ''}
    ${evidence('Whose lines', stats.superstars, { label: 'Superstar' })}
  </aside>
</div>
<div class="cols even">
  <div>${evidence('Procedures', stats.techniques, { label: 'Procedure', href: (n) => (menu.includes(n) ? `/studio#t-${n}` : null), note: 'all time; unlinked ones have left the menu' })}</div>
  <div>${evidence('Hands', stats.models, { label: 'Model' })}</div>
</div>`;
}

/** @param {import('../server.js').App} app */
export function routes(app) {
  const tastePage = async (c, typed = null, status = 200) => {
    const [{ header, entries }, views] = await Promise.all([readTaste(c.config.paths.taste), listSeries(c.floor)]);
    const agreement = { total: 0, picked: 0, vetoedPicks: 0 };
    for (const s of views) {
      const picks = new Set((s.shortlist?.payload.picks ?? []).map((p) => p.variant));
      for (const [variant, d] of s.decisions) {
        if (d.payload.verdict === 'approved') {
          agreement.total++;
          if (picks.has(variant)) agreement.picked++;
        } else if (picks.has(variant)) agreement.vetoedPicks++;
      }
    }
    return c.page({ title: 'Taste', active: 'taste', body: tasteBody({ header: typed ?? header, entries, stats: computeStats(views), agreement, msg: c.msg, promptEntries: c.config.review.tasteEntriesInPrompt, menu: Object.keys(c.config.techniques), baseHash: await tasteHash(c.config), revisions: await listRevisions(c.config, 'taste', 'taste') }) }, status);
  };
  app.get('/taste', (c) => tastePage(c));

  // What the admin kept when it overwrote the direction or your words.
  const KINDS = { taste: ['taste', 'Your words', '/taste'], direction: ['direction', 'The direction', '/studio#direction'] };
  app.get('/history/:kind/:rev', async (c) => {
    const kind = KINDS[c.params.kind];
    if (!kind) return c.notFound('nothing kept under that name');
    const text = await readRevision(c.config, kind[0], kind[0], c.params.rev);
    const all = await listRevisions(c.config, kind[0], kind[0]);
    const body = `<div class="top"><div><a class="crumb" href="${esc(kind[2])}">← back</a><h1>${esc(kind[1])}, as they were</h1><p class="lede">Copy back what you want to keep.</p></div></div>
    <div class="cols"><pre class="log">${esc(text)}</pre><aside><h2>Earlier versions</h2><ul class="vars">${all.map((v) => `<li><a href="/history/${esc(c.params.kind)}/${esc(v.id)}"${v.id === c.params.rev ? ' aria-current="true"' : ''}>${esc(new Date(v.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</a></li>`).join('')}</ul></aside></div>`;
    return c.page({ title: kind[1], active: kind[0] === 'taste' ? 'taste' : 'studio', body });
  });

  app.post('/taste', async (c) => {
    c.back = '/taste';
    const form = await c.form(256 * 1024);
    let changed;
    try {
      ({ changed } = await saveTaste({ config: c.config, floor: c.floor }, form.get('header') ?? '', { baseHash: form.get('baseHash') }));
    } catch (err) {
      if (!['TextConflict', 'SettingsError'].includes(err.name)) throw err;
      c.msg = { error: err.errors?.join('; ') ?? err.message };
      return tastePage(c, form.get('header') ?? '', 409);
    }
    return c.redirect('/taste', { done: changed ? 'Saved. Warhol reads it next time he looks.' : 'Nothing changed.' });
  });
}
