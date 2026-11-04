// Souls: the role files. Each one is a system prompt and a few settings, and this is where
// they're read and rewritten. A saved soul counts from the next call: every shift and job reads
// the files from disk when it starts. The files stay plain markdown in roles/, so an edit in
// a text editor shows up here, and the two can't overwrite each other.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { placeholdersIn, REASONING } from '../../roles.js';
import { compactDiff, hasChanges, lineDiff } from '../../lib/diff.js';
import { LOCKED_FIELDS, varsFor } from '../contract.js';
import { ago, esc, field, messages, usd } from '../ui.js';
import { benchedSuperstars, benchSuperstar, castSuperstar, checkSoul, composeSoul, listRevisions, listSouls, readRevision, readSoul, recallSuperstar, saveSoul, splitSoul } from '../souls.js';

const LIMIT = 512 * 1024;

/** What a role runs on, and why: its own setting, another role's, or the config's. */
function modelOf(role, config) {
  if (role.model) return { model: role.model, from: 'set here' };
  if (role.group === 'superstar') return { model: config.models.roles.superstar, from: 'the superstars’ model' };
  if (['studio-assistant', 'second-pull'].includes(role.id)) return { model: `${config.models.studio.length} hands`, from: 'dealt from the studio pool' };
  const key = role.modelRole ?? role.id;
  return { model: config.models.roles[key] ?? '(none)', from: key === role.id ? 'from Studio' : `${key}’s model` };
}

function soulCard(s, config) {
  if (!s.role) return `<a class="soul" href="/souls/${esc(s.id)}"><h3>${esc(s.id)} <span class="chip bad">broken</span></h3><p class="x">${esc(s.errors[0])}</p></a>`;
  const m = modelOf(s.role, config);
  return `<a class="soul" href="/souls/${esc(s.id)}"><h3>${esc(s.role.name)}</h3><p class="x">${esc(s.role.body.replace(/\s+/g, ' ').slice(0, 220))}</p><div class="tag wrap">${esc(m.model)} · t${esc(s.role.temperature)} · ${esc(ago(s.mtime))}</div></a>`;
}

export function soulsBody({ souls, benched, config, msg }) {
  const stars = souls.filter((s) => s.group === 'superstar');
  const staff = souls.filter((s) => s.group !== 'superstar');
  return `<div class="top"><div><h1>Souls</h1><p class="lede">Who they are and what they're told. Each is a markdown file in <code>roles/</code>; save one here or in your editor and it counts from the next call.</p></div></div>
${messages(msg)}
<h2>The superstars <small>their lines become the briefs</small></h2>
<div class="soul-grid">${stars.map((s) => soulCard(s, config)).join('')}
  <form method="post" action="/souls/cast" class="soul" style="cursor:default"><h3>Cast someone new</h3>
    <div class="row" style="margin:6px 0"><input type="text" name="name" placeholder="Name" aria-label="Name" required style="flex:1 1 90px;min-width:0"><input type="text" name="id" placeholder="file-name" aria-label="File name" pattern="[a-z0-9]+(-[a-z0-9]+)*" required style="flex:1 1 90px;min-width:0"></div>
    <textarea name="voice" rows="2" placeholder="How do they talk? What do they notice?" aria-label="Their voice"></textarea>
    <div style="margin-top:6px"><button>Cast them</button></div></form>
</div>
${benched.length ? `<h2>On the bench</h2><div class="row">${benched.map((b) => `<form method="post" action="/souls/recall"><input type="hidden" name="id" value="${esc(b.id)}"><button>Bring ${esc(b.name)} back</button></form>`).join('')}</div>` : ''}
<h2>The Factory</h2>
<div class="soul-grid">${staff.map((s) => soulCard(s, config)).join('')}</div>`;
}

function varsList(id, group, body) {
  const known = varsFor(id, group);
  if (!known) return '';
  const used = placeholdersIn(body);
  return `<h2>What it's handed</h2><ul class="vars">${Object.entries(known).map(([name, what]) => `<li data-var="${esc(name)}"${used.includes(name) ? '' : ' class="unused"'}><code>{{${esc(name)}}}</code> ${esc(what)}</li>`).join('')}</ul><p class="small muted" style="margin-top:6px">Struck through: not in the text right now. Anything else in double braces would stop the role, so it can't be saved.</p>`;
}

export function diffHtml(diff) {
  return `<div class="diff">${compactDiff(diff, 3).map((d) => (d.op === 'skip' ? `<div class="skip">… ${d.count} lines the same …</div>` : `<div class="${d.op}">${d.op === 'add' ? '+ ' : d.op === 'del' ? '- ' : '  '}${esc(d.text)}</div>`)).join('')}</div>`;
}

const parseSetting = (v) => {
  const t = String(v ?? '').trim();
  return t === '' ? undefined : t;
};

/**
 * @param {object} o
 * @param {object} o.soul
 * @param {object} o.config
 * @param {string} [o.text]        the body as typed, when a save was refused
 * @param {object} [o.settings]    the settings as typed, when a save was refused
 * @param {string[]} [o.problems]
 * @param {object|null} [o.conflict]
 */
export function soulBody({ soul, config, msg = {}, revisions = [], last = null, text = null, rawText = null, settings = null, problems = [], warnings = [], conflict = null }) {
  const { body } = splitSoul(soul.raw);
  const r = soul.role;
  const value = (key, fallback) => settings?.[key] ?? fallback ?? '';
  const m = r ? modelOf(r, config) : { model: '', from: '' };
  const locked = r ? [['id', r.id], ['output', r.output], ['vision', String(r.vision)], ...(r.modelRole ? [['model_role', r.modelRole]] : []), ['reads', r.reads.join(', ')], ['emits', r.emits.join(', ')]] : [];
  const reasoning = value('reasoning', r?.reasoning);
  return `<div class="top"><div><a class="crumb" href="/souls">← souls</a><h1>${esc(r?.name ?? soul.id)}</h1>
  <div class="small muted"><code>roles/${esc(soul.file)}</code> · last changed ${esc(ago(soul.mtime))}${r ? ` · runs on ${esc(m.model)} (${esc(m.from)})` : ''}</div></div>
  <div class="row">${soul.group === 'superstar' && r ? `<form method="post" action="/souls/${esc(soul.id)}/audition"><button>Audition</button></form><form method="post" action="/souls/${esc(soul.id)}/bench"><button class="quiet" data-confirm="Send them home?">Bench</button></form>` : ''}</div></div>
${messages(msg)}
${soul.errors.length ? `<p class="error" role="alert">This file doesn't load, so this role can't run until it's fixed:\n${esc(soul.errors.join('\n'))}</p>` : ''}
${problems.length ? `<p class="error" role="alert">Not saved:\n${esc(problems.join('\n'))}</p>` : ''}
${warnings.map((w) => `<p class="alert warn">${esc(w)}</p>`).join('')}
${conflict ? `<div class="panel"><h2>The file changed on disk while you were editing</h2><p class="small">Someone (probably your editor) saved a newer version. Your text is still in the box below. The difference between the two:</p>${diffHtml(lineDiff(conflict.raw, rawText ?? composeSoul(conflict.raw, { body: text ?? body })))}<p class="small muted" style="margin-top:8px">Saving again replaces the newer version with yours; that version is kept in the history.</p></div>` : ''}
${!r ? `<form method="post" action="/souls/${esc(soul.id)}" class="editor" data-guard>
  <input type="hidden" name="baseHash" value="${esc(soul.hash)}">
  <label class="label" for="raw">The whole file, frontmatter and all</label>
  <textarea class="code body" id="raw" name="raw" spellcheck="false">${esc(rawText ?? soul.raw)}</textarea>
  <div class="row" style="margin-top:8px"><button class="primary">Save</button></div>
</form>` : `<form method="post" action="/souls/${esc(soul.id)}" class="editor" data-guard data-soul="/souls/${esc(soul.id)}/check">
  <input type="hidden" name="baseHash" value="${esc(conflict ? conflict.hash : soul.hash)}">
  <div class="cols">
    <div>
      <label class="label" for="body">The soul: their system prompt</label>
      <textarea class="code body" id="body" name="body" spellcheck="false">${esc(text ?? body)}</textarea>
      <div class="check-result" aria-live="polite"></div>
      <div class="row" style="margin-top:8px"><button class="primary" name="action" value="save">Save</button><span class="small muted"><kbd>⌘S</kbd> counts from the next call; nothing restarts.</span></div>
    </div>
    <aside>
      <h2 style="margin-top:0">Settings</h2>
      ${field('name', 'Name', value('name', r?.name))}
      ${field('temperature', 'Temperature', value('temperature', r?.temperature), { type: 'number', step: 0.05, min: 0, max: 2, help: ['studio-assistant', 'second-pull'].includes(soul.id) ? 'The series deals its own temperatures; this is only a default.' : '' })}
      ${field('max_tokens', 'Max tokens', value('max_tokens', r?.maxTokens), { type: 'number', min: 1 })}
      <div class="field"><label for="f-reasoning">Thinking</label><input id="f-reasoning" name="reasoning" list="reasoning-levels" value="${esc(reasoning)}" placeholder="provider default"><datalist id="reasoning-levels">${REASONING.map((l) => `<option value="${l}">`).join('')}</datalist><span class="help">off, low, medium, high, or a hard token budget like 2000.</span></div>
      ${r?.modelRole || ['studio-assistant', 'second-pull'].includes(soul.id) ? '' : field('model', 'Its own model', value('model', r?.model), { help: `Empty: ${m.from} (${m.model}).` })}
      <details><summary>Fixed by the code</summary><dl class="making">${locked.map(([k, v]) => `<div><dt>${esc(k)}:</dt> <dd>${esc(v)}</dd><br><span class="tag">${esc(LOCKED_FIELDS[k] ?? '')}</span></div>`).join('')}</dl></details>
      ${varsList(soul.id, soul.group, text ?? body)}
    </aside>
  </div>
</form>`}
<div class="cols" style="margin-top:22px">
  <div>
    ${last ? `<h2>Last time it ran <small>${esc(ago(last.ts))} · ${esc(last.model)} · ${usd(last.usd)} · <a href="/transcripts/${esc(last.id)}">the whole call</a></small></h2>${last.reply ? `<pre class="log" style="max-height:280px">${esc(last.reply)}</pre>` : ''}` : ''}
  </div>
  <aside>
    <h2>Earlier versions</h2>
    ${revisions.length ? `<ul class="vars">${revisions.slice(0, 20).map((v) => `<li><a href="/souls/${esc(soul.id)}/history/${esc(v.id)}">${esc(new Date(v.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</a></li>`).join('')}</ul>` : '<p class="small muted">None yet. Each save keeps the version it replaces. Edits made elsewhere are in git.</p>'}
  </aside>
</div>`;
}

/** @param {import('../server.js').App} app */
export function routes(app) {
  const deps = (c) => ({ config: c.config, floor: c.floor });

  app.get('/souls', async (c) => {
    const body = soulsBody({ souls: await listSouls(c.config), benched: await benchedSuperstars(c.config), config: c.config, msg: c.msg });
    return c.page({ title: 'Souls', active: 'souls', body });
  });

  app.post('/souls/cast', async (c) => {
    c.back = '/souls';
    const form = await c.form(LIMIT);
    const soul = await castSuperstar(deps(c), { id: form.get('id'), name: form.get('name'), voice: form.get('voice') });
    return c.redirect(`/souls/${soul.id}`, { done: `${soul.role.name} is on the floor from the next shift. Give them a voice.` });
  });

  app.post('/souls/recall', async (c) => {
    c.back = '/souls';
    const soul = await recallSuperstar(deps(c), (await c.form()).get('id'));
    return c.redirect(`/souls/${soul.id}`, { done: `${soul.role?.name ?? soul.id} is back.` });
  });

  /** The last real call of a role: what it said, from its transcript. */
  async function lastCall(c, id) {
    const cost = (await c.floor.read({ shift: 'all', type: 'cost.recorded' })).filter((e) => e.payload.role === id).at(-1);
    if (!cost) return null;
    let reply = null;
    try {
      const t = JSON.parse(await readFile(join(c.config.root, cost.payload.transcript), 'utf8'));
      reply = t.response?.choices?.[0]?.message?.content ?? null;
    } catch {
      // A missing transcript doesn't stop the page; the Archivist reports it.
    }
    return { id: cost.id, ts: cost.ts, model: cost.payload.model, usd: cost.payload.usd, reply: reply && reply.length > 3000 ? `${reply.slice(0, 2999)}…` : reply };
  }

  const pageFor = async (c, soul, extra = {}, status = 200) =>
    c.page({ title: soul.role?.name ?? soul.id, active: 'souls', body: soulBody({ soul, config: c.config, msg: c.msg, revisions: await listRevisions(c.config, 'roles', soul.id), last: await lastCall(c, soul.id), ...extra }) }, status);

  app.get('/souls/:id', async (c) => pageFor(c, await readSoul(c.config, c.params.id)));

  /** The file the form describes: the current file with these settings and this body. */
  function proposed(soul, form) {
    const settings = {};
    for (const key of ['name', 'temperature', 'max_tokens', 'reasoning', 'model']) {
      if (!form.has(key)) continue;
      const v = parseSetting(form.get(key));
      settings[key] = key === 'reasoning' || key === 'temperature' || key === 'max_tokens' ? (v !== undefined && /^-?[\d.]+$/.test(v) ? Number(v) : v) : v;
    }
    if (settings.name === undefined) delete settings.name;
    return composeSoul(soul.raw, { settings, body: form.get('body') ?? '' });
  }

  app.post('/souls/:id/check', async (c) => {
    const soul = await readSoul(c.config, c.params.id);
    const form = await c.form(LIMIT);
    const raw = proposed(soul, form);
    const { errors, warnings } = checkSoul(raw, { id: soul.id, group: soul.group, file: soul.file, previous: soul.raw });
    return c.json({ errors, warnings, used: placeholdersIn(splitSoul(raw).body), stale: form.get('baseHash') !== soul.hash });
  });

  app.post('/souls/:id', async (c) => {
    const soul = await readSoul(c.config, c.params.id);
    const form = await c.form(LIMIT);
    const typed = Object.fromEntries(['name', 'temperature', 'max_tokens', 'reasoning', 'model'].map((k) => [k, form.get(k) ?? '']));
    // A file that doesn't load is edited whole; there are no settings to read out of it.
    const raw = form.has('raw') ? String(form.get('raw')).replace(/\r\n/g, '\n') : proposed(soul, form);
    try {
      const r = await saveSoul(deps(c), soul.id, { raw, baseHash: form.get('baseHash') });
      if (!r.changed) return c.redirect(`/souls/${soul.id}`, { done: 'Nothing changed.' });
      if (r.warnings.length) return pageFor(c, r.soul, { warnings: r.warnings, msg: { flash: 'Saved. It counts from the next call. But look:' } });
      return c.redirect(`/souls/${soul.id}`, { done: 'Saved. It counts from the next call.' });
    } catch (err) {
      // The text stays in the box: nothing typed is ever lost to a refusal.
      if (err.name === 'SoulConflict') return pageFor(c, err.current, { conflict: err.current, text: form.get('body'), rawText: form.get('raw'), settings: typed }, 409);
      if (err.name === 'SoulError') return pageFor(c, soul, { problems: err.problems, text: form.get('body'), rawText: form.get('raw'), settings: typed }, 422);
      throw err;
    }
  });

  app.post('/souls/:id/bench', async (c) => {
    c.back = `/souls/${c.params.id}`;
    const soul = await benchSuperstar(deps(c), c.params.id);
    return c.redirect('/souls', { done: `${soul.role?.name ?? soul.id} has left the floor. The file is safe in the record.` });
  });

  app.post('/souls/:id/audition', async (c) => {
    c.back = `/souls/${c.params.id}`;
    const soul = await readSoul(c.config, c.params.id);
    const job = await c.jobs.enqueue('audition', { role: soul.id });
    return c.redirect(`/jobs/${job.id}`);
  });

  app.get('/souls/:id/history/:rev', async (c) => {
    const soul = await readSoul(c.config, c.params.id);
    const old = await readRevision(c.config, 'roles', soul.id, c.params.rev);
    const diff = lineDiff(old, soul.raw);
    const body = `<div class="top"><div><a class="crumb" href="/souls/${esc(soul.id)}">← ${esc(soul.role?.name ?? soul.id)}</a><h1>An earlier version</h1><p class="lede">What changed between this version and the current one.</p></div>
    <form method="post" action="/souls/${esc(soul.id)}/history/${esc(c.params.rev)}"><input type="hidden" name="baseHash" value="${esc(soul.hash)}"><button class="primary" data-confirm="Yes, go back">Go back to this version</button></form></div>
    ${messages(c.msg)}${hasChanges(diff) ? diffHtml(diff) : '<p class="muted">The same as the current text.</p>'}`;
    return c.page({ title: 'An earlier version', active: 'souls', body });
  });

  app.post('/souls/:id/history/:rev', async (c) => {
    c.back = `/souls/${c.params.id}`;
    const old = await readRevision(c.config, 'roles', c.params.id, c.params.rev);
    const form = await c.form();
    await saveSoul(deps(c), c.params.id, { raw: old, baseHash: form.get('baseHash'), summary: `${c.params.id}'s soul, back to an earlier version` });
    return c.redirect(`/souls/${c.params.id}`, { done: 'Back to that version. The one it replaced is in the history.' });
  });
}
