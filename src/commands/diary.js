// `silver diary [date]`: read the Archivist's diary, or have today's entry written now.
import { createFactory } from '../factory.js';
import { readDiary, writeDiary } from '../agents/archivist.js';

export default async function diaryCommand([date], opts, ctx) {
  const factory = await createFactory();
  const { config, floor } = factory;
  const shift = date ?? floor.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shift)) throw new Error(`"${shift}" is not a date (YYYY-MM-DD)`);
  if (opts.write) {
    const r = await writeDiary({ config, floor, llm: await factory.llm() }, { shift, force: Boolean(opts.force) });
    if (r.skipped) ctx.stderr.write(`not written: ${r.skipped}${r.skipped === 'already written' ? ' (use --force to rewrite)' : ''}\n`);
  }
  try {
    ctx.stdout.write(await readDiary(config, shift));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const written = (await floor.read({ shift: 'all', type: 'diary.written' })).map((e) => e.payload.shift);
    ctx.stderr.write(`no diary entry for ${shift}${written.length ? ` (entries: ${written.join(', ')})` : ''}; write one with: silver diary --write\n`);
  }
}
