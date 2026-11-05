// The admin's page frame and small components. Pages are server-rendered strings with plain
// forms: no framework and no build step, and they work with JavaScript off.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A URL that came in from outside (a feed, a model) as an href: http(s) only, so that a
 * javascript: link on the floor can't become a click on this page.
 * @returns {string|null}
 */
export function safeHref(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? String(url) : null;
  } catch {
    return null;
  }
}

/** A link to an outside URL, or just the text when the URL isn't one we'd follow. */
export const outLink = (url, label) => {
  const href = safeHref(url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
};

/** URL of an archived file (path relative to the repo root, under archive/variants/). */
export const fileUrl = (rel) => `/files/${rel.split('/').slice(2).map(encodeURIComponent).join('/')}`;

export const usd = (n) => `$${(n ?? 0).toFixed(Math.abs(n ?? 0) < 1 && n !== 0 ? 3 : 2)}`;
export const pad3 = (n) => String(n).padStart(3, '0');
export const shortId = (id) => String(id).slice(-8);

export function timeOf(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "3 min ago", "yesterday", "12 Oct". */
export function ago(iso, now = new Date()) {
  const then = new Date(iso);
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86_400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 172_800) return 'yesterday';
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export const messages = ({ flash, error } = {}) => `${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ''}${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}`;

export const percent = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);

/** A tiny form that posts one action, as a button. No JavaScript needed; `confirm` arms it first. */
export function action(url, label, { fields = {}, cls = '', confirm = null, stay = false } = {}) {
  const hidden = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<form method="post" action="${esc(url)}" class="inline"${stay ? ' data-stay' : ''} style="display:inline">${hidden}<button${cls ? ` class="${esc(cls)}"` : ''}${confirm ? ` data-confirm="${esc(confirm)}"` : ''}>${esc(label)}</button></form>`;
}

/** A labelled number/text input. `set`: this value overrides the config file. */
export function field(name, label, value, { type = 'text', help = '', step = null, min = null, max = null, set = false, attrs = '' } = {}) {
  const extra = [step !== null && `step="${step}"`, min !== null && `min="${min}"`, max !== null && `max="${max}"`, attrs].filter(Boolean).join(' ');
  return `<div class="field"><label for="f-${esc(name)}">${esc(label)}${set ? '<span class="set-dot" title="Changed here; differs from silver.config.js">●</span>' : ''}</label>
<input id="f-${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${extra}>${help ? `<span class="help">${esc(help)}</span>` : ''}</div>`;
}

const NAV = [
  [
    ['today', '/', 'Today'],
    ['review', '/review', 'Review'],
    ['subjects', '/subjects', 'Subjects'],
    ['studio', '/studio', 'Studio'],
    ['souls', '/souls', 'Souls'],
    ['taste', '/taste', 'Taste'],
  ],
  [
    ['floor', '/floor', 'Floor'],
    ['canon', '/canon', 'Canon'],
    ['diary', '/diary', 'Diary'],
    ['gallery', '/gallery/', 'Gallery'],
  ],
  [
    ['jobs', '/jobs', 'Jobs'],
    ['system', '/system', 'System'],
  ],
];

/** Grease pencil: wobbly marks with a little grit in the line. Drawn once, used everywhere. */
const DEFS = `<svg class="defs" aria-hidden="true" focusable="false">
<filter id="grease" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="7" result="wobble"/><feDisplacementMap in="SourceGraphic" in2="wobble" scale="5"/></filter>
<symbol id="m-circle" viewBox="0 0 100 100" preserveAspectRatio="none"><path vector-effect="non-scaling-stroke" d="M52 4C24 2 5 21 4 49c-1 28 19 47 47 47 27 0 46-19 45-47C95 22 74 5 47 6 34 7 22 12 15 21"/></symbol>
<symbol id="m-cross" viewBox="0 0 100 100" preserveAspectRatio="none"><path vector-effect="non-scaling-stroke" d="M9 8C32 34 66 67 93 93M90 6C62 31 34 64 7 94"/></symbol>
<symbol id="m-tick" viewBox="0 0 100 100"><path vector-effect="non-scaling-stroke" d="M12 55c10 9 19 21 26 33C51 57 68 30 92 10"/></symbol>
</svg>`;

/** Grease pencil over a frame. kind: ok (circled), no (crossed out), pick (Warhol's tick). */
export const greaseMark = (kind) => {
  const symbol = { ok: 'm-circle', no: 'm-cross', pick: 'm-tick' }[kind];
  return `<svg class="mark ${kind}" aria-hidden="true" stroke="currentColor" stroke-width="${kind === 'pick' ? 4 : 3.5}" filter="url(#grease)"><use href="#${symbol}"/></svg>`;
};

/**
 * @param {object} page
 * @param {string} page.title
 * @param {string} [page.active]    nav id
 * @param {string} page.body
 * @param {{counts?: Record<string, number>, spent?: number, cap?: number, running?: string|null, boot?: string}} [page.shell]
 * @param {string} [page.after]     markup outside the main column (dialogs)
 */
export function layout({ title, active, body, shell = {}, after = '' }) {
  const counts = shell.counts ?? {};
  const nav = NAV.map((group) => `<ul class="nav">${group.map(([id, href, label]) => `<li><a href="${href}"${id === active ? ' aria-current="page"' : ''}><span>${label}</span>${counts[id] ? `<span class="n">${counts[id]}</span>` : ''}</a></li>`).join('')}</ul>`).join('');
  const budget = shell.cap ? `<div>${usd(shell.spent ?? 0)} of ${usd(shell.cap)} today</div><div class="bar${(shell.spent ?? 0) / shell.cap > 0.8 ? ' hot' : ''}"><i style="width:${Math.min(100, percent(shell.spent ?? 0, shell.cap))}%"></i></div>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="silver-boot" content="${esc(shell.boot ?? '')}">
<title>${esc(title)} · Silver</title>
<link rel="stylesheet" href="/assets/admin.css?v=${esc(shell.boot ?? '')}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230a0a09'/%3E%3Cpath d='M6 23c5 4 16 4 19-1 3-6-17-6-15-13 2-5 13-5 16 0' fill='none' stroke='%23d8d8d2' stroke-width='3.4' stroke-linecap='round'/%3E%3C/svg%3E">
</head>
<body>
${DEFS}
<div class="shell">
<nav class="rail" aria-label="Sections">
  <a class="brand" href="/"><b>Silver</b><small>the back room</small></a>
  ${nav}
  <div class="rail-foot">${budget}<div data-rail-job>${shell.running ? `<span class="pulse"></span>${esc(shell.running)}` : ''}</div></div>
</nav>
<main class="main" id="main">
${body}
</main>
</div>
${after}
<script src="/assets/admin.js?v=${esc(shell.boot ?? '')}" defer></script>
</body>
</html>`;
}
