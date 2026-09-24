// Builds a self-contained variant HTML file from the Technician's p5 template.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const P5_VERSION = '1.11.13';
export const P5_URL = `https://cdn.jsdelivr.net/npm/p5@${P5_VERSION}/lib/p5.min.js`;
export const CANVAS = Object.freeze({ width: 1080, height: 1080 });
export const READY_FRAMES = 30;

export const TEMPLATE_PATH = new URL('./p5-template.html', import.meta.url);
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8');
/** Short content hash of the template: its version, as announced by `silver release`. */
export const TEMPLATE_VERSION = createHash('sha256').update(TEMPLATE).digest('hex').slice(0, 10);

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Inside an HTML comment, "--" would end it early.
const escapeComment = (s) => escapeHtml(s).replace(/--/g, '- -');
// Inside <script>, a literal "</script" (any case) would close the element.
const escapeScript = (s) => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
// JSON inside <script>: escaping every "<" as \u003c is inert in HTML and still valid JSON.
const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * @param {{sketch: string, meta: {title: string, subject?: {id?: string, title?: string}} & Record<string, unknown>}} input
 * @returns {string} the complete HTML document
 */
export function buildSketchHtml({ sketch, meta }) {
  if (typeof sketch !== 'string' || !sketch.trim()) throw new TypeError('buildSketchHtml needs sketch code');
  if (!meta?.title) throw new TypeError('buildSketchHtml needs meta.title');
  const values = {
    TITLE: escapeComment(meta.title),
    SUBJECT: escapeComment(meta.subject?.title ?? ''),
    TEMPLATE_VERSION,
    META_JSON: escapeJson({ ...meta, template: TEMPLATE_VERSION, p5: P5_VERSION }),
    P5_URL,
    READY_FRAMES: String(READY_FRAMES),
    WIDTH: String(CANVAS.width),
    HEIGHT: String(CANVAS.height),
    SKETCH: escapeScript(sketch.trim()),
  };
  // One pass, so a token that appears inside the sketch or meta is never re-expanded.
  return TEMPLATE.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, key) => (key in values ? values[key] : m));
}

/** Read the metadata back out of a built variant. */
export function readSketchMeta(html) {
  const m = html.match(/<script type="application\/json" id="silver-meta">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
