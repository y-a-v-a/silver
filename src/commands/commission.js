// `silver commission "<text or URL>"`: bring your own subject to the floor.
import { createFactory } from '../factory.js';
import { postCommission, pendingCommissions, CommissionError } from '../agents/commissions.js';
import { clock, plural, usd } from '../lib/format.js';
import { runSeries } from '../agents/assistants.js';
import { summarise } from '../budget.js';

export default async function commissionCommand([input], opts, ctx) {
  const factory = await createFactory();
  const { floor } = factory;

  if (opts.list) {
    const pending = await pendingCommissions(floor);
    if (!pending.length) ctx.stderr.write('no commissions waiting for a series\n');
    for (const e of pending) ctx.stdout.write(`${e.shift} ${clock(e.ts)}  ${e.id}  ${e.payload.title}\n`);
    return;
  }
  if (input === undefined) throw new CommissionError('give the commission as text or a URL (or use --list)');

  const llm = opts.annotate ? await factory.llm() : undefined;
  const { event, repeatOf, annotation } = await postCommission({ floor, llm }, input, { why: opts.why, annotate: opts.annotate });
  const p = event.payload;
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(event, null, 2) + '\n');
  } else {
    ctx.stdout.write(`commissioned: ${p.title}\n  subject ${event.id}\n`);
    if (p.url) {
      const page = p.snapshot.page;
      ctx.stdout.write(page?.error ? `  snapshot failed (${page.error}); the URL is kept\n` : `  snapshot: ${page?.contentType ?? 'unknown'}${page?.text ? `, ${page.text.length} chars of text` : ''}\n`);
    }
  }
  if (!opts.json && annotation?.ok) {
    if (p.sensitive.flag) ctx.stdout.write(`  SENSITIVE${p.sensitive.reason ? `: ${p.sensitive.reason}` : ''}\n`);
    if (p.scoutWhy) ctx.stdout.write(`  scout: ${p.scoutWhy}\n`);
    if (p.image) ctx.stdout.write(`  image: ${p.image}\n`);
  }
  if (annotation && !annotation.ok) ctx.stderr.write(`note: the Scout could not annotate it (${annotation.error}); posted without notes\n`);
  if (repeatOf) ctx.stderr.write(`note: this repeats ${repeatOf.id} from ${repeatOf.shift} ("${repeatOf.payload.title}"). Posted anyway; repetition is allowed.\n`);
  if (!opts.now) {
    ctx.stderr.write('queued: it gets a series in the next shift\n');
    return;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    ctx.stderr.write('note: --now needs OPENROUTER_API_KEY; the commission is queued for the next shift instead\n');
    return;
  }
  // --now (decision 2026-09-24): chatter + series + shortlist. The series exists now;
  // superstar chatter (phase 6) and Warhol's shortlist (phase 4) join when they are built.
  ctx.stderr.write('--now: producing the series (chatter and shortlist join in phases 6 and 4)\n');
  const { createRenderer } = await import('../tools/render.js');
  const renderer = await createRenderer();
  let series;
  try {
    series = await runSeries({ config: factory.config, floor, llm: await factory.llm(), renderer }, event.id);
  } finally {
    await renderer.close();
  }
  const produced = series.results.filter((r) => r.ok).length;
  const costs = summarise((await floor.read({ shift: 'all', type: 'cost.recorded' })).filter((e) => e.ref === series.seriesId));
  ctx.stdout.write(`series ${series.seriesId}: ${produced}/${series.results.length} produced, ${plural(costs.calls, 'call')}, ${usd(costs.total)}\n`);
  ctx.stdout.write(`contact sheet: ${factory.config.root}/${series.completed.payload.contactSheet}\n`);
}
