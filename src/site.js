// The gallery: a static site built from the canon. Only released editions are shown.
// site/ is rebuilt from scratch every time, except site/.vercel (the Vercel project link).
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { posterOf, readCanon } from './canon.js';

export const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const REPO_URL = 'https://github.com/y-a-v-a/silver';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(3, '0');

const STYLE = `
  :root { --bg: #0b0b0a; --panel: #151513; --fg: #ece8df; --muted: #8f8c83; --line: #2b2a26; --edge: #d6a03c; --red: #ef4a30; color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration-color: #55524a; text-underline-offset: 2px; }
  a:hover { text-decoration-color: var(--red); }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--edge); outline-offset: 2px; }
  code { font: 11px ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
  .mono { font: 11px/1.4 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .04em; }
  header.top { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; padding: 14px 16px; border-bottom: 1px solid var(--line); }
  .mark { font-weight: 800; font-size: 22px; letter-spacing: -.035em; text-decoration: none; background: linear-gradient(100deg, #8d8d88 0%, #f5f5f0 22%, #9c9c97 41%, #efefea 63%, #7b7b76 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  header.top nav { display: flex; gap: 14px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
  .lede { padding: 28px 16px 22px; max-width: 58ch; color: #c9c5bb; font-size: 17px; line-height: 1.4; margin: 0; }
  .filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 16px 14px; }
  .filters button { font: 11px ui-monospace, Menlo, monospace; background: none; border: 1px solid var(--line); color: var(--muted); padding: 2px 8px; cursor: pointer; }
  .filters button:hover { color: var(--fg); border-color: #55524a; }
  .filters button[aria-pressed="true"] { color: var(--fg); border-color: var(--red); }
  .wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 2px; background: #000; }
  .wall a { display: block; position: relative; text-decoration: none; background: #000; overflow: hidden; }
  .wall img { display: block; width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; transition: opacity .2s; }
  .wall .cap { position: absolute; inset: auto 0 0 0; padding: 26px 10px 8px; background: linear-gradient(transparent, #000d); opacity: 0; transition: opacity .15s; font-size: 13px; line-height: 1.25; }
  .wall .cap small { display: block; margin-top: 2px; color: var(--edge); font: 11px ui-monospace, Menlo, monospace; }
  .wall a:hover .cap, .wall a:focus-visible .cap { opacity: 1; }
  @media (hover: none) { .wall .cap { opacity: 1; } }
  .wall a[hidden] { display: none; }
  .work { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 380px); gap: 0; min-height: calc(100vh - 56px); }
  .frame { background: #000; display: flex; align-items: center; justify-content: center; padding: 2vmin; min-width: 0; }
  .frame iframe { width: min(100%, calc(100vh - 56px - 4vmin)); aspect-ratio: 1; border: 0; display: block; background: #000; }
  .label { padding: 22px 20px; border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .label h2 { font-size: 24px; line-height: 1.15; letter-spacing: -.015em; margin: 2px 0 6px; overflow-wrap: anywhere; }
  .label .edition { color: var(--edge); }
  .label .meta { color: var(--muted); font-size: 13px; margin: 0 0 8px; overflow-wrap: anywhere; }
  .label .wall-text { font-size: 16px; margin: 0 0 14px; }
  .label .said { margin: 0 0 10px; padding-left: 10px; border-left: 2px solid var(--red); font-size: 14px; color: #c9c5bb; }
  nav.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: auto; padding-top: 18px; font-size: 13px; }
  @media (max-width: 860px) { .work { grid-template-columns: minmax(0, 1fr); min-height: 0; } .frame iframe { width: 100%; } .label { border-left: 0; border-top: 1px solid var(--line); } }
  .prose { max-width: 62ch; padding: 28px 16px 40px; }
  .prose h1 { font-size: 30px; line-height: 1.1; letter-spacing: -.02em; margin: 0 0 14px; }
  .prose h2 { font: 11px ui-monospace, Menlo, monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--edge); margin: 26px 0 8px; }
  .prose li { margin-bottom: 6px; }
  footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; padding: 14px 16px; }
  footer p { margin: 0; max-width: 80ch; }
`;

/** On the wall: filter by procedure. Everything is visible without it. */
const WALL_SCRIPT = `(() => {
  const works = [...document.querySelectorAll('.wall a')];
  const buttons = [...document.querySelectorAll('.filters button')];
  for (const b of buttons) b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.technique;
    for (const x of buttons) x.setAttribute('aria-pressed', String(x.dataset.technique === on));
    for (const w of works) w.hidden = Boolean(on) && w.dataset.technique !== on;
  });
})();`;

/** On a work: the arrow keys walk the wall. */
const WORK_SCRIPT = `document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = e.key === 'ArrowLeft' ? document.querySelector('[rel=prev]') : e.key === 'ArrowRight' ? document.querySelector('[rel=next]') : null;
  if (a) location.href = a.href;
});`;

/** @param {{root?: string}} o  root: the way back to the top of the site, so it works in any directory */
function page({ title, description, body, image, path, siteUrl, root = './', script = '' }) {
  const abs = (p) => (siteUrl ? new URL(p, siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`).href : null);
  const og = [
    `<meta property="og:title" content="${esc(title)}">`,
    description && `<meta property="og:description" content="${esc(description)}">`,
    image && abs(image) && `<meta property="og:image" content="${esc(abs(image))}">`,
    abs(path) && `<link rel="canonical" href="${esc(abs(path))}">`,
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0b0a">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${og}
<link rel="alternate" type="application/atom+xml" title="Silver Factory editions" href="${root}feed.xml">
<style>${STYLE}</style>
</head>
<body>
<header class="top"><h1 style="margin:0;font-size:inherit"><a class="mark" href="${root}">Silver Factory</a></h1><nav><a href="${root}">The wall</a><a href="${root}about/">How it's made</a><a href="${root}feed.xml">Feed</a></nav></header>
${body}
<footer>
  <p>Works are licensed <a href="${LICENCE_URL}" rel="license">CC BY 4.0</a>, which covers the Factory's own contribution, not the subjects, brands or likenesses they depict. Code: <a href="${REPO_URL}">MIT, on GitHub</a>.</p>
</footer>
${script ? `<script>${script}</script>` : ''}
</body>
</html>
`;
}

function indexPage(works, siteUrl) {
  const items = [...works]
    .reverse()
    .map((w) => `<a href="works/${esc(w.canonId)}/" data-technique="${esc(w.technique)}"><img src="works/${esc(w.canonId)}/poster.png" alt="${esc(w.title)}" width="1080" height="1080" loading="lazy" decoding="async"><span class="cap">${esc(w.title)}<small>No. ${pad(w.edition)} · ${esc(w.technique)}</small></span></a>`)
    .join('\n');
  const counts = new Map();
  for (const w of works) counts.set(w.technique, (counts.get(w.technique) ?? 0) + 1);
  const filters = counts.size > 1 ? `<div class="filters">${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<button type="button" data-technique="${esc(t)}" aria-pressed="false">${esc(t)} ${n}</button>`).join('')}</div>` : '';
  const lede = works.length ? `<p class="lede">${works.length} edition${works.length === 1 ? '' : 's'}. Ready-mades from the news, printed in series by machines that disagree, chosen by one that's bored and signed by a person.</p>` : '';
  const body = works.length ? `<main>${lede}${filters}<div class="wall">\n${items}\n</div></main>` : '<main class="prose"><p>Nothing signed yet.</p></main>';
  return page({ title: 'Silver Factory', description: `${works.length} editions of ready-mades from the news.`, body, image: works.length ? `works/${works.at(-1).canonId}/poster.png` : null, path: '', siteUrl, script: filters ? WALL_SCRIPT : '' });
}

/** Whoever said the line a work was made from, as it reads on a label. */
function saidBy(brief) {
  const who = brief.from === 'the human' ? 'the human' : brief.from.charAt(0).toUpperCase() + brief.from.slice(1);
  return `From a line ${esc(who)} said on the floor${brief.stray ? ' about something else' : ''}: “${esc(brief.text)}”`;
}

/** A link from outside the Factory, only if it goes somewhere a link should go. */
const safeUrl = (url) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
};

function workPage(w, prev, next, siteUrl) {
  const url = safeUrl(w.sourceUrl);
  const source = url ? `<a href="${esc(url)}" rel="nofollow noopener">${esc(w.subjectTitle)}</a>` : esc(w.subjectTitle);
  const body = `<main class="work">
  <div class="frame"><iframe src="sketch.html" title="${esc(w.title)} (live)" sandbox="allow-scripts" loading="eager"></iframe></div>
  <div class="label">
    <p class="mono edition" style="margin:0">No. ${pad(w.edition)} · ${esc(w.technique)}</p>
    <h2>${esc(w.title)}</h2>
    <p class="wall-text">${esc(w.wallText)}</p>
    ${w.brief ? `<p class="said">${saidBy(w.brief)}</p>` : ''}
    ${w.dare ? `<p class="meta">Dare: ${esc(w.dare)}</p>` : ''}
    <p class="meta">After: ${source}</p>
    <p class="meta">Signed ${esc(w.publishedAt.slice(0, 10))}${w.revisedAt ? ` · label revised ${esc(w.revisedAt.slice(0, 10))}` : ''}</p>
    <p class="meta">Live: every visit prints it again. <a href="sketch.html" rel="noopener">Full screen</a> · <a href="${LICENCE_URL}" rel="license">CC BY 4.0</a><br>signature <code>${esc(w.signature.slice(0, 16))}…</code></p>
    <nav class="pager">${prev ? `<a rel="prev" href="../${esc(prev.canonId)}/">← No. ${pad(prev.edition)}</a>` : '<span></span>'}${next ? `<a rel="next" href="../${esc(next.canonId)}/">No. ${pad(next.edition)} →</a>` : '<span></span>'}</nav>
  </div>
</main>`;
  return page({ title: `${w.title} · Silver Factory No. ${pad(w.edition)}`, description: w.wallText, body, image: `works/${w.canonId}/poster.png`, path: `works/${w.canonId}/`, siteUrl, root: '../../', script: WORK_SCRIPT });
}

function aboutPage(works, siteUrl) {
  const procedures = new Set(works.map((w) => w.technique)).size;
  const body = `<main class="prose">
  <h1>A factory that doesn't look like its namesake.</h1>
  <p>The Silver Factory is a studio of software agents modelled on how Andy Warhol's Factory ran: cheap, noisy and collective upstream, one narrow point of selection and signature downstream. It borrows the way of working, and none of the look. There's no pop art here.</p>
  <h2>Each day</h2>
  <ol>
    <li><strong>Scouts</strong> pull ready-made subjects from trending lists and news feeds.</li>
    <li><strong>Superstars</strong>, persona agents, talk about them. Their lines get taken literally.</li>
    <li><strong>Studio assistants</strong> turn each subject into twelve sketches, across different models, temperatures and procedures, each with its own dare card and its own line from the floor. They never see each other's. The drift between them is kept on purpose.</li>
    <li><strong>Warhol</strong>, an agent, looks at the pictures and nothing else, picks a few, and sends his favourite back for a second pull.</li>
    <li><strong>A person</strong> approves or vetoes. Nothing gets here without that.</li>
    <li><strong>The Printer</strong> signs it, and <strong>Fred Hughes</strong> numbers it and writes its label.</li>
  </ol>
  <h2>What's on the wall</h2>
  <p>${works.length} edition${works.length === 1 ? '' : 's'}${procedures ? ` in ${procedures} procedure${procedures === 1 ? '' : 's'}` : ''}. Each is a small program that draws itself again on every visit, so no two looks are quite the same. The early ones are from before the studio dropped the pop-art menu in October 2026; the record stays as it is.</p>
  <h2>Everything is recorded</h2>
  <p>Drafts, chatter, rejects and every model call are kept, and the reject pile feeds back in as raw material. The code is <a href="${REPO_URL}">on GitHub</a>.</p>
</main>`;
  return page({ title: "How it's made · Silver Factory", description: 'A studio of software agents, one person with a veto, and no pop art.', body, path: 'about/', siteUrl, root: '../' });
}

const notFound = () => page({ title: 'Not here · Silver Factory', body: '<main class="prose"><h1>Not on the wall.</h1><p><a href="/">Back to the wall</a></p></main>', path: '404.html', siteUrl: null, root: '/' });

/** Atom feed of the editions, newest first. Ids are tag: URIs, stable whatever the domain. */
export function atomFeed(works, siteUrl) {
  const base = siteUrl ? (siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`) : '/';
  const link = (p) => (siteUrl ? new URL(p, base).href : p);
  const touched = (w) => w.revisedAt ?? w.releasedAt;
  const updated = works.reduce((max, w) => (touched(w) > max ? touched(w) : max), '1970-01-01T00:00:00Z');
  const entries = [...works]
    .reverse()
    .map((w) => `  <entry>
    <id>tag:silver-factory,2026:${esc(w.canonId)}</id>
    <title>${esc(`No. ${pad(w.edition)}: ${w.title}`)}</title>
    <link rel="alternate" type="text/html" href="${esc(link(`works/${w.canonId}/`))}"/>
    <published>${esc(w.releasedAt)}</published>
    <updated>${esc(touched(w))}</updated>
    <summary>${esc(w.wallText)}</summary>
    <content type="html">${esc(`<p><img src="${link(`works/${w.canonId}/poster.png`)}" alt="${esc(w.title)}"></p><p>${esc(w.wallText)}</p>`)}</content>
    <rights>CC BY 4.0 (${LICENCE_URL})</rights>
  </entry>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:silver-factory,2026:canon</id>
  <title>Silver Factory: editions</title>
  <link rel="alternate" type="text/html" href="${esc(link(''))}"/>
  <link rel="self" type="application/atom+xml" href="${esc(link('feed.xml'))}"/>
  <author><name>Silver Factory</name></author>
  <updated>${esc(updated)}</updated>
  <rights>Works: CC BY 4.0 (${LICENCE_URL})</rights>
${entries}
</feed>
`;
}

/** Empty site/ except the Vercel project link. */
async function clean(dir) {
  await mkdir(dir, { recursive: true });
  for (const name of await readdir(dir)) if (name !== '.vercel') await rm(join(dir, name), { recursive: true, force: true });
}

/**
 * Build site/ from the canon.
 * @param {{config: object, floor: object}} deps
 * @returns {Promise<{dir: string, works: number}>}
 */
export async function buildSite({ config, floor }) {
  const dir = config.paths.site;
  const siteUrl = config.deploy.siteUrl ?? null;
  const works = (await readCanon(floor)).filter((w) => w.edition !== null);
  await clean(dir);
  for (const [i, w] of works.entries()) {
    const out = join(dir, 'works', w.canonId);
    await mkdir(out, { recursive: true });
    await copyFile(join(config.root, w.sketch), join(out, 'sketch.html'));
    await copyFile(join(config.root, posterOf(w)), join(out, 'poster.png'));
    await writeFile(join(out, 'index.html'), workPage(w, works[i - 1], works[i + 1], siteUrl));
  }
  await writeFile(join(dir, 'index.html'), indexPage(works, siteUrl));
  await mkdir(join(dir, 'about'), { recursive: true });
  await writeFile(join(dir, 'about', 'index.html'), aboutPage(works, siteUrl));
  await writeFile(join(dir, '404.html'), notFound());
  await writeFile(join(dir, 'feed.xml'), atomFeed(works, siteUrl));
  await writeFile(join(dir, 'vercel.json'), JSON.stringify({ trailingSlash: true, headers: [{ source: '/feed.xml', headers: [{ key: 'Content-Type', value: 'application/atom+xml; charset=utf-8' }] }] }, null, 2) + '\n');
  return { dir, works: works.length };
}
