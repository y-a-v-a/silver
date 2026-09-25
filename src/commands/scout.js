// `silver scout`: run the scouts on their own and post subject cards.
import { createFactory } from '../factory.js';
import { gatherCandidates } from '../sources/index.js';
import { runScouts } from '../agents/scouts.js';
import { plural } from '../lib/format.js';

function printReport(report, out) {
  for (const r of report) out.write(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.source.padEnd(22)} ${r.ok ? plural(r.count, 'item') : r.error}\n`);
}

export default async function scoutCommand(_args, opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const only = opts.source?.length ? opts.source : undefined;

  if (opts.list) {
    // Tuning aid: show what the sources offer, without calling a model or posting.
    const { candidates, report } = await gatherCandidates(factory.config, { only });
    printReport(report, ctx.stderr);
    for (const c of candidates) ctx.stdout.write(`(${c.source}) ${c.title}\n    ${c.url ?? '-'}\n`);
    return;
  }

  const count = opts.count === undefined ? undefined : Number(opts.count);
  if (count !== undefined && !(Number.isInteger(count) && count > 0)) throw new Error('--count must be a positive integer');

  const result = await runScouts({ config: factory.config, floor: factory.floor, llm: await factory.llm() }, { count, only, snapshot: opts.snapshot, dryRun: Boolean(opts.dryRun) });
  if (opts.json) {
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  ctx.stderr.write('sources\n');
  printReport(result.report, ctx.stderr);
  ctx.stderr.write(`${plural(result.candidates, 'candidate')}, ${result.duplicates} already seen, ${result.shown} shown to the Scout\n\n`);
  for (const e of result.posted) {
    const p = e.payload;
    const flag = p.sensitive?.flag ? `  SENSITIVE${p.sensitive.reason ? `: ${p.sensitive.reason}` : ''}\n` : '';
    ctx.stdout.write(`* ${p.title}  (${p.source})\n${flag}  why:   ${p.why}\n${p.image ? `  image: ${p.image}\n` : ''}  ${p.url ?? ''}\n\n`);
  }
  if (result.note) ctx.stdout.write(`scout's note: ${result.note}\n`);
  for (const p of result.problems) ctx.stderr.write(`problem: ${p}\n`);
  ctx.stderr.write(`posted ${plural(result.posted.length, 'subject')}\n`);
  if (!result.posted.length) process.exitCode = 1;
}
