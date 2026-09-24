// `silver floor`: read (or follow) the event log.
import { createFactory } from '../factory.js';
import { formatEvent } from '../lib/format.js';

export default async function floorCommand(_args, opts, ctx) {
  const { floor } = await createFactory();
  const shift = opts.shift ?? floor.today();
  const out = (e) => ctx.stdout.write((opts.json ? JSON.stringify(e) : formatEvent(e)) + '\n');

  if (opts.follow) {
    if (shift === 'all') throw new Error('--follow needs a single shift, not "all"');
    const ac = new AbortController();
    process.once('SIGINT', () => ac.abort());
    for await (const e of floor.tail({ shift, type: opts.type, signal: ac.signal })) {
      if (opts.actor === undefined || e.actor === opts.actor) out(e);
    }
    return;
  }

  const events = await floor.read({ shift, type: opts.type, actor: opts.actor });
  if (!events.length && !opts.json) {
    ctx.stderr.write(`the floor is quiet (shift ${shift}${opts.type ? `, type ${opts.type}` : ''})\n`);
    return;
  }
  for (const e of events) out(e);
}
