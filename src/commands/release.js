// `silver release <tool>`: the Technician announces a changed tool on the floor.
import { createFactory } from '../factory.js';
import { releaseTool, TOOLS } from '../agents/technician.js';

export default async function releaseCommand([tool], opts, ctx) {
  if (opts.list) {
    for (const [name, file] of Object.entries(TOOLS)) ctx.stdout.write(`${name.padEnd(14)} ${file}\n`);
    return;
  }
  const factory = await createFactory();
  const event = await releaseTool({ config: factory.config, floor: factory.floor, llm: await factory.llm() }, tool, { changes: opts.changes, force: opts.force });
  const p = event.payload;
  ctx.stdout.write(`${p.tool} ${p.version}${p.previous ? ` (was ${p.previous})` : ''}\n\n${p.note}\n`);
}
