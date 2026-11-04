// Studio: how the works get made, and the place to steer it. A standing note per audience,
// the pace of the shift, the matrix, the hands, the procedures, the dare deck and the sources.
// Everything here lands in studio.json or direction.md and counts from the next shift or job: there is
// nothing to restart. Next to each control sits what the record says about it.
import { getPath, activeTechniques, readOverlay, techniqueWeight } from '../../settings.js';
import { loadRawConfig } from '../../config.js';
import { listSeries } from '../../agents/series-data.js';
import { AUDIENCES, readDirection } from '../../lib/direction.js';
import { applySettings, directionHash, saveDirection } from '../store.js';
import { listRevisions } from '../souls.js';
import { computeStats, shiftCost, variantCost } from '../stats.js';
import { AdminError } from '../server.js';
import { esc, field, messages, percent, usd } from '../ui.js';

const WHO = {
  scouts: ['The Scout', 'What to look out for in the news. A steer: the Scout still only picks from what the sources bring in.', 'Things that are the wrong size. Anything about water. No more tech news this week.'],
  superstars: ['The superstars', 'What they hear when you walk through the floor. Their lines become the briefs, so this reaches the work sideways.', 'Be crueller. Talk about what things smell like.'],
  studio: ['The studio assistants', 'Read by every assistant on every series. This is the most direct way to bend the work.', 'Less text on the canvas. Think of one object at the wrong scale. Bigger marks.'],
  warhol: ['Warhol', 'What he looks for when he shortlists, next to your taste.', 'Pick the ugly one if it holds. Ignore anything that looks like a screensaver.'],
};

const WEIGHTS = [
  [0, 'Bench'],
  [1, 'In rotation'],
  [2, 'Favoured'],
  [3, 'Favoured ×3'],
];

const rate = (r) => {
  const total = r.made + r.failed;
  return total ? `${percent(r.failed, total)}%` : '–';
};

function directionSection(direction, { baseHash, revisions = [] }) {
  return `<form method="post" action="/studio/direction" data-guard id="direction" class="panel">
  <input type="hidden" name="baseHash" value="${esc(baseHash)}">
  <h2>Direction <small>what you're after right now, per audience. It counts from the next shift or job.</small></h2>
  <div class="cols four">
  ${AUDIENCES.map((a) => `<div class="field"><label for="d-${a}"><strong>${esc(WHO[a][0])}</strong></label><textarea id="d-${a}" name="${a}" rows="4" placeholder="${esc(WHO[a][2])}">${esc(direction[a])}</textarea><span class="help">${esc(WHO[a][1])}</span></div>`).join('')}
  </div>
  <div class="spread"><button class="primary">Save the direction</button>${revisions.length ? `<a class="small muted" href="/history/direction/${esc(revisions[0].id)}">Earlier versions (${revisions.length})</a>` : ''}</div></form>`;
}

function paceSection(c, set, forecast) {
  const s = c.shift;
  return `<form method="post" action="/studio/settings/pace" class="panel" id="pace"><h2>The shift <small>${forecast ? `recent shifts cost about ${usd(forecast)}` : ''}</small></h2>
  <div class="grid-fields">
  ${field('at', 'Runs at', s.at, { type: 'time', set: set('shift.at') })}
  ${field('seriesPerShift', 'Series per shift', s.seriesPerShift, { type: 'number', min: 1, max: 20, set: set('shift.seriesPerShift'), help: 'The biggest lever on cost.' })}
  ${field('subjectsPerShift', 'Subjects the Scout posts', s.subjectsPerShift, { type: 'number', min: 1, max: 40, set: set('shift.subjectsPerShift') })}
  ${field('maxArchiveSubjectsPerShift', 'From the reject pile, at most', s.maxArchiveSubjectsPerShift, { type: 'number', min: 0, max: 20, set: set('shift.maxArchiveSubjectsPerShift') })}
  ${field('dailyUsd', 'Daily budget, USD', c.budget.dailyUsd, { type: 'number', step: 0.5, min: 0.5, set: set('budget.dailyUsd'), help: 'A hard cap: calls are refused above it.' })}
  ${field('chatterShare', 'Chatter may use (share)', c.budget.chatterShare, { type: 'number', step: 0.05, min: 0, max: 1, set: set('budget.chatterShare') })}
  ${field('linesPerShift', 'Lines per superstar', c.superstars.linesPerShift, { type: 'number', min: 0, max: 10, set: set('superstars.linesPerShift'), help: '0 silences the floor. The lines are the briefs.' })}
  ${field('proposeChance', 'Chance a superstar may push a subject', c.superstars.proposeChance, { type: 'number', step: 0.01, min: 0, max: 1, set: set('superstars.proposeChance') })}
  ${field('secondPulls', 'Second pulls per series', c.series.secondPulls ?? 0, { type: 'number', min: 0, max: 3, set: set('series.secondPulls'), help: "How many of Warhol's picks go back to their maker." })}
  ${field('tasteEntriesInPrompt', 'Decisions Warhol remembers', c.review.tasteEntriesInPrompt, { type: 'number', min: 0, max: 500, set: set('review.tasteEntriesInPrompt') })}
  ${field('holdSeconds', 'Print check holds for, seconds', c.printer.holdSeconds, { type: 'number', min: 0, max: 300, set: set('printer.holdSeconds') })}
  </div>
  <div class="spread"><button class="primary">Save</button><button class="quiet" name="reset" value="1" data-confirm="Back to silver.config.js?">Reset to the config file</button></div></form>`;
}

function matrixSection(c, set, perVariant) {
  const s = c.series;
  return `<form method="post" action="/studio/settings/matrix" class="panel" data-matrix id="matrix"><h2>The matrix <small>what a series is made of</small></h2>
  <div class="grid-fields">
  ${field('variants', 'Variants', s.variants, { type: 'number', min: 1, max: 96, set: set('series.variants') })}
  ${field('modelsPerSeries', 'Hands per series', s.modelsPerSeries, { type: 'number', min: 1, max: c.models.studio.length, set: set('series.modelsPerSeries') })}
  ${field('temperatures', 'Temperatures', s.temperatures.join(', '), { set: set('series.temperatures'), help: 'Comma-separated, 0 to 2.' })}
  ${field('techniquesPerSeries', 'Procedures per series', s.techniquesPerSeries, { type: 'number', min: 1, max: 12, set: set('series.techniquesPerSeries') })}
  ${field('concurrency', 'At the same time', s.concurrency, { type: 'number', min: 1, max: 16, set: set('series.concurrency'), help: 'Keeps the Mac usable for your other agents.' })}
  </div>
  <p data-matrix-out class="small dim"></p>
  ${perVariant ? `<p class="small muted">At about ${usd(perVariant)} a variant over the last 30 days, a series like this costs about ${usd(perVariant * s.variants)}, and ${c.shift.seriesPerShift} of them ${usd(perVariant * s.variants * c.shift.seriesPerShift)} before Warhol and the second pulls.</p>` : ''}
  <div class="spread"><button class="primary">Save</button><button class="quiet" name="reset" value="1" data-confirm="Back to silver.config.js?">Reset to the config file</button></div></form>`;
}

function modelsSection(c, set, stats, catalogue) {
  const info = new Map(catalogue.map((m) => [m.id, m]));
  const price = (id) => {
    const m = info.get(id);
    if (!m) return catalogue.length ? '<span class="chip bad">not on OpenRouter</span>' : '';
    return `<span class="tag">$${(m.prompt * 1e6).toFixed(2)} / $${(m.completion * 1e6).toFixed(2)}</span>`;
  };
  const row = (id, inPool) => {
    const r = stats.models.get(id);
    return `<tr><td><label class="check"><input type="checkbox" name="studio" value="${esc(id)}"${inPool ? ' checked' : ''}> <span class="wrap">${esc(id)}</span></label></td><td>${price(id)}</td><td class="num">${r?.made ?? 0}</td><td class="num">${r ? rate(r) : '–'}</td><td class="num">${r?.priced ? usd(r.usd / r.priced) : '–'}</td><td class="num">${r?.picked ?? 0}</td><td class="num">${r?.approved ?? 0}</td></tr>`;
  };
  const others = [...stats.models.keys()].filter((m) => !c.models.studio.includes(m)).sort((a, b) => (stats.models.get(b).made - stats.models.get(a).made));
  const roleKeys = Object.keys(c.models.roles);
  return `<form method="post" action="/studio/settings/models" class="panel" id="models"><h2>The hands <small>the studio pool, drawn from per series. Prices per million tokens in / out; figures from the last 30 days.</small></h2>
  <div class="table-wrap"><table><thead><tr><th>Model</th><th>Price</th><th class="num">Made</th><th class="num">Died</th><th class="num">Per variant</th><th class="num">Picked</th><th class="num">Approved</th></tr></thead><tbody>
  ${c.models.studio.map((m) => row(m, true)).join('')}${others.slice(0, 8).map((m) => row(m, false)).join('')}
  </tbody></table></div>
  <div class="field" style="margin-top:10px"><label for="m-add">Add a hand</label><input id="m-add" type="text" name="add" list="catalogue" placeholder="provider/model" style="width:min(100%,380px)"><datalist id="catalogue">${catalogue.map((m) => `<option value="${esc(m.id)}">`).join('')}</datalist></div>
  <details><summary>Who runs on what (roles, dry run, fallbacks)</summary>
  <div class="grid-fields" style="margin-top:8px">
  ${roleKeys.map((r) => field(`role.${r}`, r, c.models.roles[r], { set: set(`models.roles.${r}`), attrs: 'list="catalogue"', help: info.size && ['warhol', 'printer'].includes(r) ? `Must see images${info.get(c.models.roles[r])?.vision === false ? ': THIS ONE CANNOT' : ''}.` : ['warhol', 'printer'].includes(r) ? 'Must see images.' : '' })).join('')}
  ${field('dryRun', 'Dry runs', c.models.dryRun, { set: set('models.dryRun'), attrs: 'list="catalogue"' })}
  </div>
  <div class="field"><label for="m-fb">Fallbacks: one per line, <code>model: fallback, fallback</code></label><textarea id="m-fb" class="code" name="fallbacks" rows="4">${esc(Object.entries(c.models.fallbacks ?? {}).map(([m, list]) => `${m}: ${list.join(', ')}`).join('\n'))}</textarea></div>
  </details>
  <div class="spread" style="margin-top:8px"><button class="primary">Save</button><button class="quiet" name="reset" value="1" data-confirm="Back to silver.config.js?">Reset to the config file</button></div></form>`;
}

function techniquesSection(c, stats, raw) {
  const names = Object.keys(c.techniques).sort((a, b) => techniqueWeight(c, b) - techniqueWeight(c, a) || a.localeCompare(b));
  const active = activeTechniques(c).length;
  const row = (name) => {
    const w = techniqueWeight(c, name);
    const r = stats.techniques.get(name);
    const custom = raw.techniques?.[name] === undefined;
    const edited = !custom && raw.techniques[name] !== c.techniques[name];
    return `<tr${w === 0 ? ' class="off"' : ''} id="t-${esc(name)}"><td style="min-width:0"><details><summary><strong style="color:var(--ink)">${esc(name)}</strong>${custom ? ' <span class="chip warn">yours</span>' : edited ? ' <span class="chip warn">edited</span>' : ''}</summary>
      <form method="post" action="/studio/techniques/${encodeURIComponent(name)}"><textarea name="guidance" rows="4" aria-label="What the assistant is told">${esc(c.techniques[name])}</textarea><div class="buttons" style="margin-top:5px"><button name="action" value="save">Save</button>${custom ? '<button class="quiet" name="action" value="remove" data-confirm="Take it off the menu?">Remove</button>' : edited ? '<button class="quiet" name="action" value="restore">Back to the original</button>' : ''}</div></form></details></td>
      <td class="num">${r?.made ?? 0}</td><td class="num">${r ? rate(r) : '–'}</td><td class="num">${r?.picked ?? 0}</td><td class="num">${r?.approved ?? 0}</td>
      <td><form method="post" action="/studio/techniques/${encodeURIComponent(name)}" data-stay><input type="hidden" name="action" value="weight"><select name="weight" aria-label="Weight of ${esc(name)}" data-autosubmit>${WEIGHTS.map(([v, l]) => `<option value="${v}"${v === w ? ' selected' : ''}>${l}</option>`).join('')}</select><noscript><button>Set</button></noscript></form></td></tr>`;
  };
  return `<div class="panel" id="procedures"><h2>The procedures <small>${active} of ${names.length} in rotation. Open one to read or rewrite what the assistant is told.</small></h2>
  <div class="table-wrap"><table><thead><tr><th>Procedure</th><th class="num">Made</th><th class="num">Died</th><th class="num">Picked</th><th class="num">Approved</th><th>Deal it</th></tr></thead><tbody>${names.map(row).join('')}</tbody></table></div>
  <details style="margin-top:12px"><summary>Add a procedure</summary><form method="post" action="/studio/techniques" style="margin-top:6px">
    <div class="field"><label for="t-name">Name (kebab-case)</label><input id="t-name" type="text" name="name" placeholder="carbon-paper" pattern="[a-z0-9]+(-[a-z0-9]+)*" required></div>
    <div class="field"><label for="t-guide">What the assistant is told</label><textarea id="t-guide" name="guidance" rows="4" required placeholder="A process, not a style: describe the machine or the hand, and how it goes wrong. No artist names: they produce copies of the artist."></textarea></div>
    <button>Add it to the menu</button></form></details></div>`;
}

function daresSection(c, set) {
  const dares = c.dares ?? [];
  return `<form method="post" action="/studio/dares" class="panel" id="dares"><h2>The dare deck <small>${dares.length} cards, one dealt to each variant. One card per line.</small></h2>
  <textarea name="dares" rows="12" data-guard-field aria-label="The dare deck">${esc(dares.join('\n'))}</textarea>
  <div class="spread" style="margin-top:8px"><button class="primary">Save the deck</button>${set('dares') ? '<button class="quiet" name="reset" value="1" data-confirm="Back to the original deck?">Reset to the config file</button>' : ''}</div></form>`;
}

function sourcesSection(c, set) {
  const t = c.sources.trending;
  return `<form method="post" action="/studio/settings/sources" class="panel" id="sources"><h2>The sources <small>where the Scout looks</small></h2>
  <div class="field"><label for="s-rss">News feeds, one per line${set('sources.rss') ? '<span class="set-dot">●</span>' : ''}</label><textarea id="s-rss" class="code" name="rss" rows="${Math.max(4, c.sources.rss.length + 1)}">${esc(c.sources.rss.join('\n'))}</textarea></div>
  <div class="grid-fields">
  <label class="check"><input type="checkbox" name="hackernews" value="1"${t.hackernews ? ' checked' : ''}> Hacker News</label>
  <label class="check"><input type="checkbox" name="reddit" value="1"${t.reddit ? ' checked' : ''}> Reddit r/all</label>
  ${field('googleTrendsGeo', 'Google Trends country', t.googleTrendsGeo, { attrs: 'maxlength="2" style="width:4em"', set: set('sources.trending.googleTrendsGeo') })}
  ${field('itemsPerSource', 'Items per source', c.sources.itemsPerSource, { type: 'number', min: 1, max: 500, set: set('sources.itemsPerSource') })}
  ${field('repeatAfterDays', 'A subject may return after, days', c.sources.repeatAfterDays, { type: 'number', min: 1, max: 3650, set: set('sources.repeatAfterDays') })}
  </div>
  <div class="spread"><button class="primary">Save</button><button class="quiet" name="reset" value="1" data-confirm="Back to silver.config.js?">Reset to the config file</button></div></form>`;
}

/** Pricing shouldn't hold a page up: with no answer in time, the prices just aren't shown yet. */
const catalogueOf = (pricing, ms = 1500) => (pricing ? Promise.race([pricing.all().catch(() => []), new Promise((r) => setTimeout(() => r([]), ms).unref())]) : []);

const parseNumber = (v, name) => {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n)) throw new AdminError(`${name} must be a number`);
  return n;
};

const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** @param {import('../server.js').App} app */
export function routes(app) {
  const rawConfig = () => (app.extra.rawConfig ?? (() => loadRawConfig()))();
  const deps = (c) => ({ config: c.config, floor: c.floor, rawConfig });
  const LIMIT = 256 * 1024;

  const studioPage = async (c) => {
    const [views, direction, overlay, raw, catalogue, shifts] = await Promise.all([listSeries(c.floor), readDirection(c.config.root), readOverlay(c.config.root), rawConfig(), catalogueOf(c.extra.pricing), c.floor.read({ shift: 'all', type: 'shift.ended' })]);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const stats = computeStats(views, { since });
    const set = (path) => getPath(overlay, path) !== undefined;
    const typed = c.typedDirection ?? direction;
    const body = `<div class="top"><div><h1>Studio</h1><p class="lede">How the works get made. Everything here counts from the next shift or job, with nothing to restart; one already running finishes as it began. A <span class="set-dot" style="margin:0">●</span> means it differs from <code>silver.config.js</code>. To steer one series, go through <a href="/subjects">Subjects</a>.</p></div></div>
${messages(c.msg)}
<div class="tabs" role="navigation"><a href="#direction">Direction</a><a href="#pace">The shift</a><a href="#matrix">The matrix</a><a href="#models">The hands</a><a href="#procedures">Procedures</a><a href="#dares">Dares</a><a href="#sources">Sources</a></div>
${directionSection(typed, { baseHash: await directionHash(c.config.root), revisions: await listRevisions(c.config, 'direction', 'direction') })}
${paceSection(c.config, set, shiftCost(shifts))}
${matrixSection(c.config, set, variantCost(stats))}
${modelsSection(c.config, set, stats, catalogue)}
${techniquesSection(c.config, stats, raw)}
${daresSection(c.config, set)}
${sourcesSection(c.config, set)}`;
    return c.page({ title: 'Studio', active: 'studio', body }, c.status ?? 200);
  };
  app.get('/studio', studioPage);

  app.post('/studio/direction', async (c) => {
    c.back = '/studio#direction';
    const form = await c.form(LIMIT);
    const typed = Object.fromEntries(AUDIENCES.map((a) => [a, form.get(a) ?? '']));
    let changed;
    try {
      ({ changed } = await saveDirection(deps(c), typed, { baseHash: form.get('baseHash') }));
    } catch (err) {
      // What was typed stays in the boxes, whether it was refused or overtaken.
      if (!['TextConflict', 'SettingsError'].includes(err.name)) throw err;
      Object.assign(c, { typedDirection: typed, status: 409, msg: { error: err.errors?.join('; ') ?? err.message } });
      return studioPage(c);
    }
    return c.redirect('/studio#direction', { done: changed.length ? `Saved. The ${changed.join(', ')} hear it from the next shift or job.` : 'Nothing changed.' });
  });

  const done = (changed) => (changed.length ? `Saved: ${changed.length} setting${changed.length === 1 ? '' : 's'} changed. Counts from the next shift or job.` : 'Nothing changed.');

  /** @type {Record<string, {paths: string[], read: (form: URLSearchParams, c: object) => Record<string, unknown>}>} */
  const SECTIONS = {
    pace: {
      paths: ['shift.at', 'shift.seriesPerShift', 'shift.subjectsPerShift', 'shift.maxArchiveSubjectsPerShift', 'budget.dailyUsd', 'budget.chatterShare', 'superstars.linesPerShift', 'superstars.proposeChance', 'series.secondPulls', 'review.tasteEntriesInPrompt', 'printer.holdSeconds'],
      read: (f) => ({
        'shift.at': f.get('at'),
        'shift.seriesPerShift': parseNumber(f.get('seriesPerShift'), 'Series per shift'),
        'shift.subjectsPerShift': parseNumber(f.get('subjectsPerShift'), 'Subjects'),
        'shift.maxArchiveSubjectsPerShift': parseNumber(f.get('maxArchiveSubjectsPerShift'), 'The reject pile'),
        'budget.dailyUsd': parseNumber(f.get('dailyUsd'), 'The daily budget'),
        'budget.chatterShare': parseNumber(f.get('chatterShare'), 'The chatter share'),
        'superstars.linesPerShift': parseNumber(f.get('linesPerShift'), 'Lines per superstar'),
        'superstars.proposeChance': parseNumber(f.get('proposeChance'), 'The chance'),
        'series.secondPulls': parseNumber(f.get('secondPulls'), 'Second pulls'),
        'review.tasteEntriesInPrompt': parseNumber(f.get('tasteEntriesInPrompt'), 'Decisions'),
        'printer.holdSeconds': parseNumber(f.get('holdSeconds'), 'The hold'),
      }),
    },
    matrix: {
      paths: ['series.variants', 'series.modelsPerSeries', 'series.temperatures', 'series.techniquesPerSeries', 'series.concurrency'],
      read: (f) => ({
        'series.variants': parseNumber(f.get('variants'), 'Variants'),
        'series.modelsPerSeries': parseNumber(f.get('modelsPerSeries'), 'Hands'),
        'series.temperatures': (f.get('temperatures') ?? '').split(',').map((t) => t.trim()).filter(Boolean).map(Number),
        'series.techniquesPerSeries': parseNumber(f.get('techniquesPerSeries'), 'Procedures'),
        'series.concurrency': parseNumber(f.get('concurrency'), 'Concurrency'),
      }),
    },
    models: {
      paths: ['models.studio', 'models.roles', 'models.dryRun', 'models.fallbacks'],
      read: (f, c) => {
        const studio = [...new Set([...f.getAll('studio'), ...lines(f.get('add'))])];
        const roles = Object.fromEntries(Object.keys(c.config.models.roles).map((r) => [r, f.get(`role.${r}`)?.trim() || c.config.models.roles[r]]));
        const fallbacks = {};
        for (const line of lines(f.get('fallbacks'))) {
          const at = line.indexOf(': ');
          if (at === -1) throw new AdminError(`a fallback line looks like "model: other, other", not "${line}"`);
          fallbacks[line.slice(0, at).trim()] = line.slice(at + 2).split(',').map((m) => m.trim()).filter(Boolean);
        }
        return { 'models.studio': studio, 'models.roles': roles, 'models.dryRun': f.get('dryRun')?.trim() || c.config.models.dryRun, 'models.fallbacks': fallbacks };
      },
    },
    sources: {
      paths: ['sources.rss', 'sources.trending', 'sources.itemsPerSource', 'sources.repeatAfterDays'],
      read: (f) => ({
        'sources.rss': lines(f.get('rss')),
        'sources.trending': { googleTrendsGeo: (f.get('googleTrendsGeo') ?? '').trim().toUpperCase(), hackernews: f.has('hackernews'), reddit: f.has('reddit') },
        'sources.itemsPerSource': parseNumber(f.get('itemsPerSource'), 'Items per source'),
        'sources.repeatAfterDays': parseNumber(f.get('repeatAfterDays'), 'The repeat window'),
      }),
    },
  };

  app.post('/studio/settings/:section', async (c) => {
    const section = SECTIONS[c.params.section];
    if (!section) return c.notFound(`no section ${c.params.section}`);
    const anchor = c.params.section;
    c.back = `/studio#${anchor}`;
    const form = await c.form(LIMIT);
    const changes = form.has('reset') ? Object.fromEntries(section.paths.map((p) => [p, undefined])) : section.read(form, c);
    const { changed } = await applySettings(deps(c), changes);
    // The schedule's plist holds the time itself, so it follows the setting.
    let scheduleNote = null;
    if (changed.includes('shift.at') && app.extra.schedule?.sync) {
      try {
        scheduleNote = await app.extra.schedule.sync();
      } catch (err) {
        return c.redirect(`/studio#${anchor}`, { error: `Saved, but the schedule didn't move: ${err.message}` });
      }
    }
    return c.redirect(`/studio#${anchor}`, { done: scheduleNote ? `${done(changed)} ${scheduleNote}` : done(changed) });
  });

  app.post('/studio/techniques', async (c) => {
    c.back = '/studio#procedures';
    const form = await c.form(LIMIT);
    const name = form.get('name')?.trim() ?? '';
    const guidance = form.get('guidance')?.trim() ?? '';
    if (c.config.techniques[name]) throw new AdminError(`"${name}" is already on the menu`);
    await applySettings(deps(c), { [`techniques.${name}`]: guidance }, { summary: `the menu: a new procedure, ${name}` });
    return c.redirect(`/studio#t-${name}`, { done: `"${name}" is on the menu.` });
  });

  app.post('/studio/techniques/:name', async (c) => {
    const name = c.params.name;
    c.back = `/studio#t-${name}`;
    if (!c.config.techniques[name]) return c.notFound(`no technique "${name}"`);
    const form = await c.form(LIMIT);
    const act = form.get('action');
    const weights = c.config.steering?.techniques ?? {};
    if (act === 'weight') {
      const weight = parseNumber(form.get('weight'), 'The weight');
      const next = { ...weights };
      if (weight === 1) delete next[name];
      else next[name] = weight;
      const label = WEIGHTS.find(([v]) => v === weight)?.[1] ?? weight;
      await applySettings(deps(c), { 'steering.techniques': Object.keys(next).length ? next : undefined }, { summary: `${name}: ${String(label).toLowerCase()}` });
      return c.redirect(`/studio#t-${name}`, { done: `${name}: ${String(label).toLowerCase()}.` });
    }
    if (act === 'remove') {
      const raw = await rawConfig();
      if (raw.techniques?.[name] !== undefined) throw new AdminError(`${name} comes with the Factory: put it on the bench instead`);
      const next = { ...weights };
      delete next[name];
      await applySettings(deps(c), { [`techniques.${name}`]: undefined, 'steering.techniques': Object.keys(next).length ? next : undefined }, { summary: `the menu: ${name} is gone` });
      return c.redirect('/studio#procedures', { done: `${name} is off the menu.` });
    }
    if (act === 'restore') {
      await applySettings(deps(c), { [`techniques.${name}`]: undefined }, { summary: `${name}: back to the original` });
      return c.redirect(`/studio#t-${name}`, { done: `${name} is back to the original.` });
    }
    await applySettings(deps(c), { [`techniques.${name}`]: form.get('guidance')?.trim() ?? '' }, { summary: `what the assistants are told about ${name}` });
    return c.redirect(`/studio#t-${name}`, { done: `Saved. ${name} reads differently from the next series.` });
  });

  app.post('/studio/dares', async (c) => {
    c.back = '/studio#dares';
    const form = await c.form(LIMIT);
    const { changed } = await applySettings(deps(c), { dares: form.has('reset') ? undefined : [...new Set(lines(form.get('dares')))] }, { summary: 'the dare deck' });
    return c.redirect('/studio#dares', { done: changed.length ? 'The deck is reshuffled.' : 'Nothing changed.' });
  });
}
