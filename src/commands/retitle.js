// `silver retitle <No.>`: correct a released edition's label, then republish the gallery.
import { createFactory } from '../factory.js';
import { retitleEdition, RetitleError } from '../agents/hughes.js';
import { republish } from './republish.js';

export default async function retitleCommand([ref], opts, ctx) {
  const edition = Number(String(ref).replace(/^No\.?\s*/i, ''));
  if (!Number.isInteger(edition) || edition < 1) throw new RetitleError(`"${ref}" is not an edition number (e.g. 16 or 016)`);
  const factory = await createFactory();
  const { config, floor } = factory;
  const llm = await factory.llm();
  const event = await retitleEdition({ config, floor, llm }, { edition, title: opts.title, wallText: opts.wall, note: opts.note });
  const p = event.payload;
  ctx.stdout.write(`No. ${String(p.edition).padStart(3, '0')} corrected\n  title: ${p.title}\n  wall:  ${p.wallText}\n`);
  if (opts.publish) await republish({ config, floor, llm }, ctx);
}
