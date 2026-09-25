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
  :root { --bg: #d8d8d6; --fg: #111; --muted: #4a4a4a; --line: #b8b8b5; color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 Helvetica, Arial, sans-serif; }
  a { color: inherit; }
  header, footer, main { padding: 20px 16px; max-width: 1400px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
  h1 { font-size: 26px; letter-spacing: .04em; text-transform: uppercase; margin: 0; }
  header p { margin: 0; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; }
  .grid a { text-decoration: none; display: block; }
  .grid img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; background: #bbb; }
  .grid span { display: block; margin-top: 6px; font-size: 13px; }
  .grid small { color: var(--muted); }
  .work { display: grid; gap: 20px; }
  .frame { width: min(100%, 88vh); aspect-ratio: 1; margin: 0 auto; background: #000; }
  .frame iframe { width: 100%; height: 100%; border: 0; display: block; }
  .label { max-width: 640px; margin: 0 auto; }
  .label h2 { font-size: 22px; margin: 0 0 4px; }
  .label .meta { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
  .label .wall { font-size: 16px; }
  .label code { font-size: 11px; overflow-wrap: anywhere; }
  nav.pager { display: flex; justify-content: space-between; gap: 16px; width: 100%; max-width: 640px; margin: 0 auto; }
  footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  a:focus-visible { outline: 2px solid var(--fg); outline-offset: 3px; }
`;

function page({ title, description, body, image, path, siteUrl }) {
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
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${og}
<link rel="alternate" type="application/atom+xml" title="Silver Factory editions" href="/feed.xml">
<style>${STYLE}</style>
</head>
<body>
<header><h1><a href="/">Silver Factory</a></h1><p>Ready-mades from the news, printed in series. <a href="/feed.xml">Feed</a></p></header>
${body}
<footer>
  <p>Works are licensed <a href="${LICENCE_URL}" rel="license">CC BY 4.0</a>, which covers the Factory's own contribution, not the subjects, brands or likenesses they depict. Code: <a href="${REPO_URL}">MIT, on GitHub</a>.</p>
</footer>
</body>
</html>
`;
}

function indexPage(works, siteUrl) {
  const items = [...works]
    .reverse()
    .map((w) => `<a href="/works/${esc(w.canonId)}/"><img src="/works/${esc(w.canonId)}/poster.png" alt="${esc(w.title)}" loading="lazy"><span>${esc(w.title)} <small>· No. ${pad(w.edition)}</small></span></a>`)
    .join('\n');
  const body = works.length ? `<main><div class="grid">\n${items}\n</div></main>` : '<main><p>Nothing signed yet.</p></main>';
  return page({ title: 'Silver Factory', description: `${works.length} editions of ready-mades from the news.`, body, image: works.length ? `/works/${works.at(-1).canonId}/poster.png` : null, path: '/', siteUrl });
}

function workPage(w, prev, next, siteUrl) {
  const source = w.sourceUrl ? `<a href="${esc(w.sourceUrl)}" rel="nofollow noopener">${esc(w.subjectTitle)}</a>` : esc(w.subjectTitle);
  const body = `<main class="work">
  <div class="frame"><iframe src="sketch.html" title="${esc(w.title)} (live)" loading="eager"></iframe></div>
  <div class="label">
    <h2>${esc(w.title)}</h2>
    <p class="meta">No. ${pad(w.edition)} · ${esc(w.technique)} · signed ${esc(w.publishedAt.slice(0, 10))}${w.revisedAt ? ` · label revised ${esc(w.revisedAt.slice(0, 10))}` : ''}</p>
    <p class="wall">${esc(w.wallText)}</p>
    <p class="meta">After: ${source}</p>
    <p class="meta">Live: every visit prints it again. <a href="sketch.html">Full screen</a> · <a href="${LICENCE_URL}" rel="license">CC BY 4.0</a> · signature <code>${esc(w.signature.slice(0, 16))}…</code></p>
  </div>
  <nav class="pager">${prev ? `<a href="/works/${esc(prev.canonId)}/">← No. ${pad(prev.edition)}</a>` : '<span></span>'}${next ? `<a href="/works/${esc(next.canonId)}/">No. ${pad(next.edition)} →</a>` : '<span></span>'}</nav>
</main>`;
  return page({ title: `${w.title} · Silver Factory No. ${pad(w.edition)}`, description: w.wallText, body, image: `/works/${w.canonId}/poster.png`, path: `/works/${w.canonId}/`, siteUrl });
}

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
  await writeFile(join(dir, 'feed.xml'), atomFeed(works, siteUrl));
  await writeFile(join(dir, 'vercel.json'), JSON.stringify({ trailingSlash: true, headers: [{ source: '/feed.xml', headers: [{ key: 'Content-Type', value: 'application/atom+xml; charset=utf-8' }] }] }, null, 2) + '\n');
  return { dir, works: works.length };
}
