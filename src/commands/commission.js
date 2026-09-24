// `silver commission "<text or URL>"`: bring your own subject to the floor.
import { createFactory } from '../factory.js';
import { postCommission, pendingCommissions, CommissionError } from '../agents/commissions.js';
import { clock } from '../lib/format.js';

export default async function commissionCommand([input], opts, ctx) {
  const { floor } = await createFactory();

  if (opts.list) {
    const pending = await pendingCommissions(floor);
    if (!pending.length) ctx.stderr.write('no commissions waiting for a series\n');
    for (const e of pending) ctx.stdout.write(`${e.shift} ${clock(e.ts)}  ${e.id}  ${e.payload.title}\n`);
    return;
  }
  if (input === undefined) throw new CommissionError('give the commission as text or a URL (or use --list)');

  const { event, repeatOf } = await postCommission({ floor }, input, { why: opts.why });
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
  if (repeatOf) ctx.stderr.write(`note: this repeats ${repeatOf.id} from ${repeatOf.shift} ("${repeatOf.payload.title}"). Posted anyway; repetition is allowed.\n`);
  ctx.stderr.write(
    opts.now
      ? 'note: --now needs the studio (ACTIONS.md phase 3); the commission is queued for the next shift instead\n'
      : 'queued: it gets a series in the next shift\n',
  );
}
