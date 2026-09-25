// The review server: `silver review` serves the contact sheet on 127.0.0.1 only.
// GET  /                       pending and closed series
// GET  /series/:id             one series: Warhol's picks, variants, decision forms
// POST /series/:id/decide      approve or veto a variant   (form: variant, verdict, note)
// POST /series/:id/close       close the review
// GET  /files/<series>/<file>  archived screenshots and sketches
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { listSeries } from '../../agents/series-data.js';
import { recordDecision, closeReview, ReviewError } from '../../agents/review.js';
import { indexPage, seriesPage, notFoundPage } from './pages.js';
import { readCanon } from '../../canon.js';

const TYPES = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
const MAX_BODY = 16 * 1024;

async function readForm(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ReviewError('request too large', 413);
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

/**
 * @param {{config: object, floor: object, onApproved?: () => void}} deps
 *   onApproved: called after each new approval (the publish pipeline runs from here)
 */
export function createReviewServer({ config, floor, onApproved }) {
  const variantsDir = resolve(config.paths.archive, 'variants');
  let port = null;

  const send = (res, status, body, type = 'text/html; charset=utf-8', headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  };
  const redirect = (res, location) => send(res, 303, '', 'text/plain', { Location: location });

  /** Forms may only be posted from this page itself: no cross-site posts from other tabs. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin';
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  }

  async function findView(id) {
    return (await listSeries(floor)).find((s) => s.seriesId === id) ?? null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    const msg = { flash: url.searchParams.get('done'), error: url.searchParams.get('error') };

    if (req.method === 'GET' && parts.length === 0) return send(res, 200, indexPage(await listSeries(floor), msg));

    if (req.method === 'GET' && parts[0] === 'series' && parts.length === 2) {
      const view = await findView(parts[1]);
      if (!view) return send(res, 404, notFoundPage(`no series ${parts[1]}`));
      const works = new Map((await readCanon(floor)).filter((w) => w.seriesId === view.seriesId).map((w) => [w.variant, w]));
      return send(res, 200, seriesPage(view, msg, { works }));
    }

    if (req.method === 'GET' && parts[0] === 'files') {
      // Only files under archive/variants/, never anywhere else.
      const rel = parts.slice(1).map(decodeURIComponent);
      const path = resolve(variantsDir, ...rel);
      if (!path.startsWith(variantsDir + sep) || !TYPES[extname(path)]) return send(res, 404, 'not found', 'text/plain');
      try {
        return send(res, 200, await readFile(path), TYPES[extname(path)]);
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
    }

    if (req.method === 'POST' && parts[0] === 'series' && parts.length === 3 && ['decide', 'close'].includes(parts[2])) {
      if (!sameOrigin(req)) return send(res, 403, 'cross-origin form posts are not accepted', 'text/plain');
      const view = await findView(parts[1]);
      if (!view) return send(res, 404, notFoundPage(`no series ${parts[1]}`));
      const back = `/series/${encodeURIComponent(view.seriesId)}`;
      try {
        const form = await readForm(req);
        if (parts[2] === 'close') {
          await closeReview({ floor }, view, { note: form.note });
          return redirect(res, `/?done=${encodeURIComponent(`Closed the review of "${view.subject?.payload.title ?? view.seriesId}".`)}`);
        }
        const { event, duplicate } = await recordDecision({ config, floor }, view, { variant: form.variant, verdict: form.verdict, note: form.note });
        const printing = !duplicate && event.payload.verdict === 'approved' && onApproved;
        if (printing) onApproved();
        const said = `${event.payload.variant} ${event.payload.verdict}${duplicate ? ' (already recorded)' : ''}.${printing ? ' Printing and publishing in the background.' : ''}`;
        return redirect(res, `${back}?done=${encodeURIComponent(said)}#${encodeURIComponent(event.payload.variant)}`);
      } catch (err) {
        if (!(err instanceof ReviewError)) throw err;
        if (err.status === 413) return send(res, 413, err.message, 'text/plain');
        return redirect(res, `${back}?error=${encodeURIComponent(err.message)}`);
      }
    }

    return send(res, req.method === 'GET' ? 404 : 405, notFoundPage('nothing here'));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 500, notFoundPage(`server error: ${err.message}`)));
  });

  return {
    server,
    /** Listen on 127.0.0.1 only. Port 0 picks a free port. */
    listen(wanted = config.review.port) {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(wanted, '127.0.0.1', () => {
          port = server.address().port;
          resolveListen(`http://127.0.0.1:${port}`);
        });
      });
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

