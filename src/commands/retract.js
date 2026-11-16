// `silver retract <No.>`: take a signed work off the gallery and out of the feed, then republish.
// Its number stays empty and the record keeps everything. `--undo` puts it back.
import { createFactory } from '../factory.js';
import { readCanon, workName } from '../canon.js';
import { reinstateWork, retractWork, RetractError } from '../agents/retract.js';
import { republish } from './republish.js';

const day = (iso) => String(iso).slice(0, 10);

export default async function retractCommand([ref], opts, ctx) {
  const factory = await createFactory();
  const { config, floor } = factory;

  if (opts.list) {
    const gone = (await readCanon(floor)).filter((w) => w.retracted);
    if (opts.json) return void ctx.stdout.write(JSON.stringify(gone, null, 2) + '\n');
    if (!gone.length) return void ctx.stderr.write('nothing is retracted\n');
    for (const w of gone) ctx.stdout.write(`${workName(w).padEnd(8)}  ${day(w.retracted.at)}  ${w.title ?? w.subjectTitle ?? ''}${w.retracted.reason ? `  (${w.retracted.reason})` : ''}\n`);
    return;
  }
  if (opts.undo && opts.reason !== undefined) throw new RetractError('--reason goes with a retraction; --undo takes none');

  const { event, work } = opts.undo ? await reinstateWork({ config, floor }, { ref }) : await retractWork({ config, floor }, { ref, reason: opts.reason });
  if (opts.json) ctx.stdout.write(JSON.stringify(event, null, 2) + '\n');
  else {
    const name = workName(work);
    const label = work.title ? `: "${work.title}"` : ` (${work.subjectTitle ?? 'untitled'}, ${work.variant})`;
    if (opts.undo) ctx.stdout.write(work.edition !== null ? `${name} is back on the wall${label}\n` : `${name} is reinstated${label}; Fred Hughes numbers and labels it on the next publish\n`);
    else ctx.stdout.write(work.edition !== null ? `${name} retracted${label}. It comes off the gallery and out of the feed; No. ${String(work.edition).padStart(3, '0')} stays empty.\n` : `${name} retracted before it had a number${label}: Fred Hughes won't label it.\n`);
  }
  // A work that never had a number was never on the gallery, so retracting it changes nothing
  // there. Asked of the canon as it is now: Fred Hughes may have numbered it a moment ago.
  const now = (await readCanon(floor)).find((w) => w.canonId === work.canonId);
  const changesGallery = opts.undo || now?.edition !== null;
  if (opts.publish && changesGallery) await republish({ config, floor, llm: await factory.llm() }, opts.json ? { stdout: ctx.stderr, stderr: ctx.stderr } : ctx);
}
