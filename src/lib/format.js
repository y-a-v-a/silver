// Terminal formatting for floor events and money.

export const usd = (n) => `$${(n ?? 0).toFixed(n !== 0 && Math.abs(n) < 0.01 ? 5 : 2)}`;
export const int = (n) => (n ?? 0).toLocaleString('en-US');

export function truncate(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** Local HH:MM:SS for an ISO timestamp. */
export function clock(iso) {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** One-line, human summary of an event's payload. */
export function summarizeEvent(e, width = 90) {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'cost.recorded':
      return `${usd(p.usd)}${p.estimated ? '~' : ''}  ${p.model}  ${int(p.promptTokens)} in / ${int(p.completionTokens)} out`;
    case 'llm.failed':
      return truncate(`${p.model}: ${p.reason ? `[${p.reason}] ` : ''}${p.error}`, width);
    case 'subject.posted':
      return truncate(p.title ?? p.url ?? JSON.stringify(p), width);
    case 'chatter.posted':
      return truncate(p.text ?? JSON.stringify(p), width);
    default:
      return truncate(Object.keys(p).length ? JSON.stringify(p) : '', width);
  }
}

/** A full floor line: time, type, actor, summary. */
export function formatEvent(e) {
  return `${clock(e.ts)}  ${e.type.padEnd(18)} ${e.actor.padEnd(18)} ${summarizeEvent(e)}`.trimEnd();
}

/** Render rows as left-aligned columns (numbers right-aligned). */
export function table(rows, { indent = '  ' } = {}) {
  if (!rows.length) return '';
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows
    .map((r) =>
      indent +
      r
        .map((cell, i) => {
          const s = String(cell);
          return /^[$\d,.~%-]+$/.test(s) && i > 0 ? s.padStart(widths[i]) : s.padEnd(widths[i]);
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}
