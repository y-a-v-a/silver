// System: the machine room. Is everything connected, where does the money go, what can and
// can't be changed from here, and the restart button.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { summarise } from '../../budget.js';
import { auditModels } from '../../model-audit.js';
import { loadRoles } from '../../roles.js';
import { recordStatus } from '../../record.js';
import { reconcile, fetchKeyUsage } from '../../reconcile.js';
import { readOverlay, writeOverlay } from '../../settings.js';
import { applySettings } from '../store.js';
import { recordChange } from '../souls.js';
import { AdminError } from '../server.js';
import { action, ago, esc, messages, usd } from '../ui.js';

const exec = promisify(execFile);

/** What belongs where, and why it isn't all in the browser. */
const WHERE = [
  ['Souls, cast of superstars', '<a href="/souls">Souls</a>', 'Markdown in roles/. Revisions kept in the record.'],
  ['Direction, the pace, the matrix, the hands, procedures, dares, sources, budget', '<a href="/studio">Studio</a>', 'Goes in direction.md and studio.json, over silver.config.js.'],
  ['What you like', '<a href="/taste">Taste</a>', 'The top of taste.md.'],
  ['What gets made next', '<a href="/subjects">Subjects</a>', 'Commissions, pins, retirements, pinned series.'],
  ['Whether a work is signed', '<a href="/review">Review</a>', 'Yours alone. No setting can turn this gate off.'],
  ['Labels on released editions', '<a href="/canon">Canon</a>', 'A correction is a new event. The number and the signature never change.'],
];
const NOT_HERE = [
  ['API keys and tokens', '.env. They are never shown in a page, written to a log or sent anywhere but their own service. Save the file and the admin restarts by itself.'],
  ['The floor, the archive, the signatures', 'Append-only by design (principle 3): the record is raw material. There is no delete, here or anywhere.'],
  ['Paths, this port, the deploy provider', 'silver.config.js and env. Moving them from here could strand the record or lock you out of this page.'],
  ['The code', 'Your editor. When you save, the admin checks that it still parses, then restarts on it; jobs always start from the code as it is.'],
  ['Which events a role reads and writes, whether it sends images, its output format', 'The role file, by hand. The code relies on them, so a slip would break the role in ways the editor can\'t catch.'],
];

async function gitInfo(root) {
  try {
    const run = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim();
    const [branch, commit, dirty, ahead] = await Promise.all([run('rev-parse', '--abbrev-ref', 'HEAD'), run('log', '-1', '--format=%h %s'), run('status', '--porcelain', '--', 'src', 'roles', 'silver.config.js'), run('rev-list', '--count', '@{u}..HEAD').catch(() => null)]);
    return { branch, commit, dirty: dirty ? dirty.split('\n').length : 0, ahead };
  } catch {
    return null;
  }
}

function moneyTable(ledger) {
  const rows = Object.entries(ledger.byRole).sort((a, b) => b[1].usd - a[1].usd);
  if (!rows.length) return '<p class="muted">No calls today.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Role</th><th class="num">Calls</th><th class="num">Spent</th></tr></thead><tbody>${rows.map(([role, r]) => `<tr><td><a href="/souls/${esc(role)}">${esc(role)}</a></td><td class="num">${r.calls}</td><td class="num">${usd(r.usd)}</td></tr>`).join('')}</tbody></table></div>`;
}

/** @param {import('../server.js').App} app */
export function routes(app) {
  let audit = null;

  app.get('/system', async (c) => {
    const { config } = c;
    const env = c.extra.env ?? {};
    const [schedule, record, git, shiftDay, overlay, chromium, costs] = await Promise.all([
      c.extra.schedule?.status(config).catch(() => null),
      recordStatus(config).catch(() => null),
      gitInfo(config.root),
      c.floor.read({ type: 'cost.recorded' }),
      readOverlay(config.root).catch((err) => ({ __error: err.message })),
      import('playwright').then(({ chromium: ch }) => access(ch.executablePath()).then(() => true, () => false)).catch(() => false),
      c.floor.read({ shift: 'all', type: 'cost.recorded' }),
    ]);
    const credit = await c.extra.credit?.get().catch(() => null);
    const ledger = summarise(shiftDay);
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = costs.filter((e) => e.shift.startsWith(month)).reduce((s, e) => s + (e.payload.usd ?? 0), 0);
    const check = (ok, yes, no) => `<span class="chip ${ok ? 'ok' : 'bad'}">${esc(ok ? yes : no)}</span>`;
    const scheduleLine = !schedule
      ? ''
      : !schedule.installed
        ? 'Not installed.'
        : schedule.mine
          ? `Every day at ${esc(schedule.at)}.`
          : `Installed for another checkout: ${esc(schedule.root)}.`;
    const body = `<div class="top"><div><h1>System</h1><p class="lede">This admin runs on this machine only and needs no login: it listens on 127.0.0.1, and refuses other hosts and origins.</p></div>
    <div class="row">${app.extra.restart ? action('/system/restart', 'Restart the admin', { confirm: 'Yes, restart' }) : '<span class="small muted">Running without a supervisor: restart it by hand.</span>'}</div></div>
${messages(c.msg)}
<div class="cols even">
  <div class="panel"><h2>Connections</h2>
    <table><tbody>
      <tr><td>OpenRouter key</td><td>${check(Boolean(env.OPENROUTER_API_KEY), 'set', 'missing')}</td><td class="small muted">${credit && typeof credit.remaining === 'number' ? `${usd(credit.remaining)} left${credit.source === 'key' ? ' on this key' : ''}` : 'in .env'}</td></tr>
      <tr><td>Vercel token</td><td>${check(Boolean(env.VERCEL_TOKEN), 'set', 'missing')}</td><td class="small muted">${env.VERCEL_TOKEN ? `project ${esc(config.deploy.project)}` : 'the gallery stays local until it\'s in .env'}</td></tr>
      <tr><td>Headless browser</td><td>${check(chromium, 'installed', 'missing')}</td><td class="small muted">${chromium ? 'renders the sketches' : 'run npm run setup'}</td></tr>
      <tr><td>The record</td><td>${check(Boolean(record?.exists), 'kept', 'not set up')}</td><td class="small muted wrap">${record?.exists ? `${esc(record.commits)} commits${record.remote ? `, pushed to ${esc(record.remote.replace(/^.*:/, ''))}` : ', local only'}${record.dirty ? ', changes since the last shift' : ''}` : 'silver init-record'}</td></tr>
      ${git ? `<tr><td>The code</td><td><span class="chip">${esc(git.branch)}</span></td><td class="small muted wrap">${esc(git.commit)}${git.dirty ? ` · ${git.dirty} file${git.dirty === 1 ? '' : 's'} not committed` : ''}${git.ahead && git.ahead !== '0' ? ` · ${esc(git.ahead)} ahead of its remote` : ''}</td></tr>` : ''}
    </tbody></table>
  </div>
  <div class="panel" id="schedule"><h2>The daily shift</h2>
    <p>${scheduleLine} ${config.shift.paused ? '<span class="chip warn">paused</span>' : ''}</p>
    <div class="row">
      ${action('/system/pause', config.shift.paused ? 'Unpause the shift' : 'Pause the shift', { fields: { paused: config.shift.paused ? '0' : '1' }, cls: config.shift.paused ? 'primary' : '' })}
      ${c.extra.schedule ? (schedule?.installed && schedule.mine ? `${schedule.at !== config.shift.at ? action('/system/schedule', `Move it to ${config.shift.at}`, { fields: { do: 'install' } }) : ''}${action('/system/schedule', 'Remove the schedule', { fields: { do: 'remove' }, cls: 'quiet', confirm: 'Really remove it?' })}` : action('/system/schedule', 'Install the schedule', { fields: { do: 'install' } })) : ''}
    </div>
    <p class="small muted" style="margin-top:8px">The time is in <a href="/studio#pace">Studio</a>. A shift only runs once a day; start another from <a href="/">Today</a>.</p>
  </div>
</div>
<div class="cols even">
  <div class="panel" id="money"><h2>The money <small>${usd(thisMonth)} recorded this month</small></h2>${moneyTable(ledger)}
    <div class="row" style="margin-top:8px">${action('/system/reconcile', 'Compare with what OpenRouter billed', { cls: 'quiet' })}</div></div>
  <div class="panel" id="audit"><h2>The models <small>do they exist, and can they see?</small></h2>
    ${audit ? (audit.problems.length ? `<ul class="failed">${audit.problems.map((p) => `<li class="warn">${esc(p)}</li>`).join('')}</ul>` : `<p><span class="chip ok">all ${audit.rows.length} fine</span> <span class="small muted">checked ${esc(ago(audit.at))}</span></p>`) : '<p class="small muted">Not checked since this admin started.</p>'}
    ${action('/system/audit', 'Check them against OpenRouter', { cls: 'quiet' })}</div>
</div>
<div class="panel"><h2>What changes where</h2>
  <div class="table-wrap"><table><tbody>${WHERE.map(([what, where, how]) => `<tr><td>${esc(what)}</td><td>${where}</td><td class="small muted">${esc(how)}</td></tr>`).join('')}</tbody></table></div>
  <h2>Not from this page, on purpose</h2>
  <div class="table-wrap"><table><tbody>${NOT_HERE.map(([what, why]) => `<tr><td>${esc(what)}</td><td class="small muted">${esc(why)}</td></tr>`).join('')}</tbody></table></div>
</div>
<div class="panel"><h2>Your settings <small><code>studio.json</code>, over <code>silver.config.js</code></small></h2>
  ${overlay.__error ? `<p class="error">${esc(overlay.__error)}</p>` : Object.keys(overlay).length ? `<pre class="log" style="max-height:300px">${esc(JSON.stringify(overlay, null, 2))}</pre>` : '<p class="small muted">Nothing set: everything comes from the config file.</p>'}
  ${Object.keys(overlay).length ? `<div style="margin-top:8px">${action('/system/reset-settings', 'Back to the config file, all of it', { cls: 'quiet', confirm: 'Yes, forget them all' })}</div>` : ''}
</div>`;
    return c.page({ title: 'System', active: 'system', body });
  });

  app.post('/system/pause', async (c) => {
    c.back = '/system';
    const paused = (await c.form()).get('paused') === '1';
    await applySettings({ config: c.config, floor: c.floor, ...(app.extra.rawConfig ? { rawConfig: app.extra.rawConfig } : {}) }, { 'shift.paused': paused ? true : undefined }, { summary: paused ? 'the daily shift: paused' : 'the daily shift: back on' });
    return c.redirect('/system#schedule', { done: paused ? 'Paused. The schedule still fires, and nothing runs.' : 'The shift is back on.' });
  });

  app.post('/system/reset-settings', async (c) => {
    c.back = '/system';
    await writeOverlay(c.config.root, {});
    await recordChange(c.floor, { what: 'settings', target: 'studio.json', summary: 'every setting, back to the config file' });
    return c.redirect('/system', { done: 'Everything comes from silver.config.js again.' });
  });

  app.post('/system/schedule', async (c) => {
    c.back = '/system#schedule';
    if (!app.extra.schedule) throw new AdminError('no schedule on this machine');
    const what = (await c.form()).get('do');
    if (what === 'remove') {
      await app.extra.schedule.remove();
      return c.redirect('/system#schedule', { done: 'Removed. The shift no longer runs by itself.' });
    }
    await app.extra.schedule.install();
    return c.redirect('/system#schedule', { done: `The shift runs every day at ${c.config.shift.at}.` });
  });

  app.post('/system/restart', async (c) => {
    c.back = '/system';
    if (!app.extra.restart) throw new AdminError('running without a supervisor: restart it by hand');
    c.redirect('/system', { done: 'Restarted.' });
    setTimeout(() => app.extra.restart(), 150);
  });

  app.post('/system/audit', async (c) => {
    c.back = '/system#audit';
    const pricing = app.extra.pricing;
    const roles = await loadRoles({ dir: c.config.paths.roles, models: c.config.models });
    const result = await auditModels(c.config, roles.list(), (m) => pricing.get(m));
    if (!(await pricing.all()).length) throw new AdminError("couldn't reach OpenRouter's catalogue");
    audit = { ...result, at: new Date().toISOString() };
    return c.redirect('/system#audit', result.problems.length ? { error: `${result.problems.length} problem${result.problems.length === 1 ? '' : 's'} with the models.` } : { done: 'All the models check out.' });
  });

  app.post('/system/reconcile', async (c) => {
    c.back = '/system#money';
    const env = c.extra.env ?? {};
    let billed;
    try {
      billed = await fetchKeyUsage({ apiKey: env.OPENROUTER_API_KEY, baseUrl: env.OPENROUTER_BASE_URL || undefined });
    } catch (err) {
      throw new AdminError(err.message);
    }
    const r = reconcile(await c.floor.read({ shift: 'all', type: 'cost.recorded' }), billed);
    return c.redirect('/system#money', { done: `UTC day ${r.utcDay}: ${usd(r.day.ledger)} recorded, ${usd(r.day.billed)} billed. All time: ${usd(r.total.ledger)} recorded, ${usd(r.total.billed)} billed. The key is shared with your other agents, so the billed figure can be higher.` });
  });
}
