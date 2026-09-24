// `silver series <subject>`: produce one series of variants for a subject.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { createFactory } from '../factory.js';
import { runSeries } from '../agents/assistants.js';
import { summarise } from '../budget.js';
import { usd, plural } from '../lib/format.js';

export default async function seriesCommand([subjectRef], opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const llm = await factory.llm();
  const num = (v, name) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
    return n;
  };

  let renderer = null;
  if (opts.render) {
    const { createRenderer } = await import('../tools/render.js');
    renderer = await createRenderer();
  }
  let result;
  try {
    result = await runSeries({ config: factory.config, floor: factory.floor, llm, renderer }, subjectRef, {
      variants: num(opts.variants, 'variants'),
      concurrency: num(opts.concurrency, 'concurrency'),
      dryRun: Boolean(opts.dryRun),
    });
  } finally {
    await renderer?.close();
  }

  const costs = summarise((await factory.floor.read({ shift: 'all', type: 'cost.recorded' })).filter((e) => e.ref === result.seriesId));
  const sheet = join(factory.config.root, result.completed.payload.contactSheet);

  if (opts.json) {
    ctx.stdout.write(JSON.stringify({ seriesId: result.seriesId, subject: result.subject.id, results: result.results, usd: costs.total, contactSheet: sheet }, null, 2) + '\n');
  } else {
    ctx.stdout.write(`series ${result.seriesId}: ${result.subject.payload.title}\n`);
    ctx.stdout.write(`  techniques ${result.matrix.techniques.join(', ')}; models ${result.matrix.models.join(', ')}\n\n`);
    for (const r of result.results) {
      const status = r.ok ? (r.png ? 'ok    ' : 'ok*   ') : `${r.reason}`.padEnd(6);
      ctx.stdout.write(`  ${r.variant}  ${status} ${r.technique.padEnd(26)} ${r.model ?? r.requestedModel ?? ''} t${r.temperature}${r.ok ? '' : `  ${String(r.error ?? '').split('\n')[0].slice(0, 90)}`}\n`);
    }
    const produced = result.results.filter((r) => r.ok).length;
    ctx.stdout.write(`\n${produced}/${result.results.length} produced, ${plural(costs.calls, 'call')}, ${usd(costs.total)}\n`);
    if (!renderer) ctx.stdout.write('(* not rendered: --no-render)\n');
    if (result.stoppedEarly) ctx.stderr.write(`stopped early: ${result.stoppedEarly}\n`);
    ctx.stdout.write(`contact sheet: ${sheet}\n`);
  }
  if (opts.open) execFile('open', [sheet], () => {});
  if (!result.results.some((r) => r.ok)) process.exitCode = 1;
}
