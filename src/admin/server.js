// The admin: `silver admin` serves the Factory's back room on this machine only. It needs no
// login, because nothing outside this machine can reach it: it binds to 127.0.0.1, refuses
// any other Host header (DNS rebinding), and refuses form posts from any other origin. The
// sketches it shows were written by models, so they're served in a sandbox and never get the
// powers of the pages around them.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { listSeries, isPendingReview } from '../agents/series-data.js';
import { readCanon } from '../canon.js';
import { createBudget } from '../budget.js';
import { summarizeEvent } from '../lib/format.js';
import { esc, layout, messages, timeOf } from './ui.js';
import { nextInLine } from './status.js';
import { routes as reviewRoutes } from './pages/review.js';
import { routes as todayRoutes } from './pages/today.js';
import { routes as subjectRoutes } from './pages/subjects.js';
import { routes as studioRoutes } from './pages/studio.js';
import { routes as soulRoutes } from './pages/souls.js';
import { routes as tasteRoutes } from './pages/taste.js';
import { routes as recordRoutes } from './pages/record.js';
import { routes as systemRoutes } from './pages/system.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const TYPES = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const MAX_FORM = 16 * 1024;
export const LOCAL_NAME = 'silver.localhost';

/** Errors a person can act on: they go back to the form as a message, not to a stack trace. */
const EXPECTED = new Set(['ReviewError', 'SoulError', 'SoulConflict', 'JobError', 'RetireError', 'ChatterError', 'SeriesError', 'SeriesNotFound', 'SettingsError', 'CommissionError', 'PullError', 'ConfigError', 'ScheduleError', 'RetitleError', 'AdminError']);

/** Refused here, whatever a page does: everything but this machine's own pages. */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'";
/** A sketch runs in an opaque origin even when opened on its own: it can't touch the admin. */
const SKETCH_CSP = 'sandbox allow-scripts';

export class AdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
  }
}

/**
 * @typedef {object} AdminDeps
 * @property {object} config                    the config at start (and for tests, always)
 * @property {object} floor
 * @property {ReturnType<import('./jobs.js').createJobs>} [jobs]
 * @property {() => Promise<object>} [getConfig]  the config as it is now: re-read per request, so settings count at once
 * @property {() => void|Promise<void>} [onApproved]  called after each new approval (prints and publishes)
 * @property {{list: () => object[]}} [notices]   things the supervisor wants shown
 * @property {string} [boot]                     this process's id; the browser reloads when it changes
 * @property {object} [extra]                    what the page modules need beyond these: env, pricing, credits, schedule, restart, rawConfig
 */

/** @param {AdminDeps} deps */
export function createAdminServer({ config: startConfig, floor, jobs = null, getConfig = async () => startConfig, onApproved, notices = { list: () => [] }, boot = randomBytes(6).toString('hex'), extra = {} }) {
  const variantsDir = resolve(startConfig.paths.archive, 'variants');
  const siteDir = resolve(startConfig.paths.site);
  const canonDir = resolve(startConfig.paths.canon);
  let port = null;
  /** @type {{method: string, parts: string[], handler: Function}[]} */
  const table = [];
  const add = (method, pattern, handler) => table.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  const app = { get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h), onApproved, extra, boot };

  for (const register of [todayRoutes, reviewRoutes, subjectRoutes, studioRoutes, soulRoutes, tasteRoutes, recordRoutes, systemRoutes]) register(app);

  const hosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${LOCAL_NAME}:${port}`]);

  /** Forms may only be posted from these pages: no cross-site posts, and no sandboxed sketches. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (origin === 'null') return false;
    if (!origin) return !site || site === 'same-origin';
    try {
      return hosts().has(new URL(origin).host);
    } catch {
      return false;
    }
  }

  const send = (res, status, body, type = 'text/html; charset=utf-8', headers = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': CSP, ...headers });
    res.end(body);
  };

  /** What every page frame shows: the counts in the rail, the day's money, the job running now. */
  async function shellFor(config) {
    const out = { boot, counts: {}, spent: 0, cap: config.budget.dailyUsd, running: null };
    const [series, ledger, open, canon, waiting] = await Promise.all([
      listSeries(floor),
      createBudget({ floor, dailyUsd: config.budget.dailyUsd, chatterShare: config.budget.chatterShare }).ledger(),
      jobs?.open() ?? [],
      readCanon(floor),
      nextInLine(floor, Infinity).then((l) => l.all.length),
    ]);
    out.counts.review = series.filter(isPendingReview).length;
    out.counts.subjects = waiting;
    out.counts.canon = canon.filter((w) => w.edition !== null).length;
    out.counts.jobs = open.length;
    out.spent = ledger.total;
    const running = open.find((j) => j.status === 'running');
    out.running = running?.title ?? null;
    return out;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (!hosts().has(req.headers.host ?? '')) return send(res, 403, 'this address is not served here', 'text/plain');
    const parts = url.pathname.split('/').filter(Boolean);
    const config = await getConfig();

    // ---------- files ----------
    if (req.method === 'GET' && parts[0] === 'assets') {
      const path = resolve(ASSETS, ...parts.slice(1).map(decodeURIComponent));
      if (!path.startsWith(ASSETS + sep) || !TYPES[extname(path)]) return send(res, 404, 'not found', 'text/plain');
      try {
        return send(res, 200, await readFile(path), TYPES[extname(path)]);
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
    }
    if (req.method === 'GET' && parts[0] === 'files') {
      // Only files under archive/variants/, never anywhere else.
      let rel;
      try {
        rel = parts.slice(1).map(decodeURIComponent);
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
      const path = resolve(variantsDir, ...rel);
      if (!path.startsWith(variantsDir + sep) || !TYPES[extname(path)]) return send(res, 404, 'not found', 'text/plain');
      try {
        return send(res, 200, await readFile(path), TYPES[extname(path)], extname(path) === '.html' ? { 'Content-Security-Policy': SKETCH_CSP } : {});
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
    }
    if (req.method === 'GET' && parts[0] === 'gallery') {
      // The built gallery, exactly as it would deploy.
      if (url.pathname === '/gallery') return send(res, 301, '', 'text/plain', { Location: '/gallery/' });
      let path;
      try {
        path = resolve(siteDir, ...parts.slice(1).map(decodeURIComponent));
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
      if (path !== siteDir && !path.startsWith(siteDir + sep)) return send(res, 404, 'not found', 'text/plain');
      if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
      if (path.split(sep).includes('.vercel') || !TYPES[extname(path)]) return send(res, 404, 'not found', 'text/plain');
      try {
        // Every page of the gallery runs in the sandbox, not just the sketches: it's a static site
        // holding text and code from models, and this is the admin's origin. (A check on the name
        // wouldn't do: this filesystem also finds "Sketch.html".)
        return send(res, 200, await readFile(path), TYPES[extname(path)], { 'Content-Security-Policy': SKETCH_CSP });
      } catch {
        if (!parts.slice(1).length) return send(res, 200, await page({ title: 'Gallery', active: 'gallery', body: '<h1>Gallery</h1><p class="muted">Not built yet. Run Publish from Today.</p>' }, config), undefined);
        return send(res, 404, 'not found', 'text/plain');
      }
    }

    if (req.method === 'GET' && parts[0] === 'canon-files') {
      // A signed work's poster and sketch.
      let path;
      try {
        path = resolve(canonDir, ...parts.slice(1).map(decodeURIComponent));
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
      if (!path.startsWith(canonDir + sep) || !['.png', '.html'].includes(extname(path))) return send(res, 404, 'not found', 'text/plain');
      try {
        return send(res, 200, await readFile(path), TYPES[extname(path)], extname(path) === '.html' ? { 'Content-Security-Policy': SKETCH_CSP } : {});
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
    }

    // ---------- pages ----------
    const route = table.find((r) => r.method === req.method && r.parts.length === parts.length && r.parts.every((p, i) => p.startsWith(':') || p === parts[i]));
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, 'cross-origin form posts are not accepted', 'text/plain');
    const msg = { flash: url.searchParams.get('done'), error: url.searchParams.get('error') };

    async function page(p, cfg = config, status = 200) {
      const noticeList = notices.list();
      const body = noticeList.length ? `<div class="alerts">${noticeList.map((n) => `<p class="alert ${esc(n.level ?? 'bad')}"><span>${esc(n.text)}</span></p>`).join('')}</div>${p.body}` : p.body;
      return layout({ ...p, body, shell: await shellFor(cfg) });
    }

    if (!route) {
      const known = table.some((r) => r.parts.length === parts.length && r.parts.every((p, i) => p.startsWith(':') || p === parts[i]));
      return send(res, known ? 405 : 404, await page({ title: 'Not found', body: notFoundBody('nothing here') }));
    }
    const params = {};
    route.parts.forEach((p, i) => {
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
    });

    let formPromise = null;
    const c = {
      req,
      res,
      url,
      params,
      msg,
      config,
      floor,
      jobs,
      app,
      extra,
      back: null,
      /** The body of a posted form. A form with big text fields names a bigger limit. */
      form(limit = MAX_FORM) {
        formPromise ??= readForm(req, limit);
        return formPromise;
      },
      series: () => listSeries(floor),
      /** A whole page in the frame. */
      page: async (p, status = 200) => send(res, status, await page(p, config)),
      json: (value, status = 200) => send(res, status, JSON.stringify(value), 'application/json'),
      text: (value, status = 200) => send(res, status, value, 'text/plain; charset=utf-8'),
      redirect(location, { done, error } = {}) {
        const q = done ? `done=${encodeURIComponent(done)}` : error ? `error=${encodeURIComponent(error)}` : '';
        const [path, hash] = location.split('#');
        return send(res, 303, '', 'text/plain', { Location: `${path}${q ? `${path.includes('?') ? '&' : '?'}${q}` : ''}${hash ? `#${hash}` : ''}` });
      },
      notFound: async (message) => send(res, 404, await page({ title: 'Not found', body: notFoundBody(message) }, config)),
    };

    try {
      return await route.handler(c);
    } catch (err) {
      if (err.status === 413) return send(res, 413, err.message, 'text/plain');
      if (!EXPECTED.has(err.name)) throw err;
      if (req.method === 'GET') return send(res, err.status === 404 ? 404 : 400, await page({ title: 'Not here', body: notFoundBody(err.message) }, config));
      return c.redirect(c.back ?? '/', { error: err.message });
    }
  }

  // ---------- the wire: live events for every open page ----------
  const clients = new Set();
  let lastFloorId = null;
  let jobSeen = new Map();
  let ticking = false;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      if (jobs) {
        await jobs.pump();
        const open = await jobs.open();
        const nowOpen = new Map(open.map((j) => [j.id, j]));
        const ended = [];
        for (const id of jobSeen.keys()) {
          if (!nowOpen.has(id)) {
            const job = await jobs.read(id);
            if (job) ended.push({ id, title: job.title, status: job.status });
          }
        }
        const running = open.find((j) => j.status === 'running')?.title ?? null;
        const changed = ended.length || open.length !== jobSeen.size || [...nowOpen].some(([id, j]) => jobSeen.get(id)?.status !== j.status);
        jobSeen = nowOpen;
        if (changed) broadcast('jobs', { running, ended });
      }
      if (clients.size) {
        const fresh = await floor.read({ since: lastFloorId ?? undefined });
        if (lastFloorId === null) lastFloorId = fresh.at(-1)?.id ?? '0';
        else {
          for (const e of fresh) {
            lastFloorId = e.id;
            if (e.type !== 'cost.recorded') broadcast('floor', floorLine(e));
          }
        }
      } else lastFloorId = null;
    } catch {
      // The wire is a bonus. A bad moment (a half-written line) is retried on the next tick.
    } finally {
      ticking = false;
    }
  }
  function broadcast(event, data) {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  let timer = null;

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/events') {
      if (!hosts().has(req.headers.host ?? '')) return send(res, 403, 'this address is not served here', 'text/plain');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(`event: hello\ndata: ${JSON.stringify({ boot })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    handle(req, res).catch((err) => send(res, 500, `<!doctype html><title>Server error</title><pre>${esc(err.stack ?? err.message)}</pre>`));
  });

  return {
    server,
    app,
    /** Listen on 127.0.0.1 only. Port 0 picks a free port. */
    listen(wanted = startConfig.review.port) {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(wanted, '127.0.0.1', () => {
          port = server.address().port;
          timer = setInterval(tick, 1200);
          timer.unref();
          resolveListen(`http://127.0.0.1:${port}`);
        });
      });
    },
    close: () =>
      new Promise((r) => {
        clearInterval(timer);
        for (const res of clients) res.end();
        clients.clear();
        server.close(() => r());
        server.closeIdleConnections();
        // A request in flight gets a moment to finish; a keep-alive connection doesn't hold us up.
        setTimeout(() => server.closeAllConnections(), 400).unref();
      }),
  };
}

/** A floor event as one line in a list. */
export function floorLine(e) {
  const cls = [e.type === 'llm.failed' || e.type === 'variant.failed' ? 'fail' : '', e.actor === 'human' ? 'human' : ''].filter(Boolean).join(' ');
  return { id: e.id, time: timeOf(e.ts), type: e.type, actor: e.actor, summary: summarizeEvent(e, 160), cls };
}

async function readForm(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AdminError('request too large', 413);
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function notFoundBody(message) {
  return `<p><a class="crumb" href="/">← today</a></p>${messages({ error: message })}`;
}
