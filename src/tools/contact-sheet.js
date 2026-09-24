// A static contact sheet for one series: every variant's screenshot in a grid, with its
// technique, model and temperature, and the failures shown as failures (they are material).
// The interactive review sheet (Phase 4) builds on the same data.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {{seriesId: string, subject: {id: string, title: string, why?: string|null, sensitive?: {flag: boolean, reason: string|null}}, variants: object[]}} series
 *   variants: {variant, technique, model, temperature, ok, html?, png?, reason?, error?} with paths relative to the sheet
 * @returns {string}
 */
export function buildContactSheet({ seriesId, subject, variants }) {
  const produced = variants.filter((v) => v.ok).length;
  const cells = variants
    .map((v) => {
      const label = `${esc(v.variant)} · ${esc(v.technique)} · ${esc(v.model)} · t${esc(v.temperature)}`;
      const body = v.ok
        ? `<a href="${esc(v.html)}"><img src="${esc(v.png)}" alt="${esc(v.variant)}" loading="lazy"></a>`
        : `<div class="failed"><strong>${esc(v.reason ?? 'failed')}</strong><span>${esc(v.error ?? '')}</span>${v.html ? `<a href="${esc(v.html)}">sketch</a>` : ''}</div>`;
      return `<figure class="${v.ok ? 'ok' : 'bad'}">${body}<figcaption>${label}</figcaption></figure>`;
    })
    .join('\n');
  const warning = subject.sensitive?.flag
    ? `<p class="sensitive">Sensitive subject${subject.sensitive.reason ? `: ${esc(subject.sensitive.reason)}` : ''}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contact sheet: ${esc(subject.title)}</title>
<style>
  :root { color-scheme: dark; --bg: #111; --fg: #eee; --muted: #999; --bad: #e0584f; --silver: #c0c0c0; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.4 Helvetica, Arial, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 8px; color: var(--muted); }
  .sensitive { color: var(--bad); font-weight: bold; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
  figure { margin: 0; background: #1b1b1b; border: 1px solid #2a2a2a; }
  figure.bad { border-color: var(--bad); }
  img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  .failed { aspect-ratio: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 12px; box-sizing: border-box; color: var(--bad); overflow: hidden; }
  .failed span { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .failed a { color: var(--silver); }
  figcaption { padding: 6px 8px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>${esc(subject.title)}</h1>
<p>Series ${esc(seriesId)} · ${produced} of ${variants.length} produced${subject.why ? ` · ${esc(subject.why)}` : ''}</p>
${warning}
<div class="grid">
${cells}
</div>
</body>
</html>
`;
}
