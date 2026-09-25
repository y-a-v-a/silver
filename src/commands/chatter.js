// `silver chatter [subject...]`: the superstars talk, by hand. Mostly for tuning the personas;
// the shift runs them itself after the Scouts.
import { createFactory } from '../factory.js';
import { runSuperstars } from '../agents/superstars.js';
import { findSubject } from '../agents/assistants.js';
import { pickSubjects } from '../shift.js';
import { shortId } from './subjects.js';

export default async function chatterCommand(refs, opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const { config, floor } = factory;

  if (opts.list) {
    const subjects = new Map((await floor.read({ shift: 'all', type: 'subject.posted' })).map((e) => [e.id, e]));
    const chatter = (await floor.read({ shift: 'all', type: 'chatter.posted' })).reverse().slice(0, 40);
    if (opts.json) return void ctx.stdout.write(JSON.stringify(chatter, null, 2) + '\n');
    for (const e of chatter) ctx.stdout.write(`${e.shift}  ${(e.payload.persona ?? e.actor).padEnd(7)} on ${subjects.get(e.ref)?.payload.title ?? e.ref}\n    ${e.payload.text}\n`);
    return;
  }

  const subjects = refs?.length
    ? await Promise.all(refs.map((r) => findSubject(floor, r)))
    : await pickSubjects(floor, floor.today(), Infinity, { dryRun: Boolean(opts.dryRun) });
  if (!subjects.length) throw new Error('no subjects waiting today; name one: silver chatter <subject>');

  const result = await runSuperstars({ config, floor, llm: await factory.llm() }, { subjects, dryRun: Boolean(opts.dryRun), only: opts.only });
  if (opts.json) return void ctx.stdout.write(JSON.stringify(result, null, 2) + '\n');
  const titles = new Map(subjects.map((s) => [s.id, s.payload.title]));
  for (const e of result.chatter) ctx.stdout.write(`${e.payload.persona.padEnd(7)} on ${titles.get(e.ref)}\n    ${e.payload.text}\n`);
  for (const e of result.proposed) ctx.stdout.write(`\n${e.payload.proposedBy} pushed a subject: ${e.payload.title} (${shortId(e.id)})\n    ${e.payload.why ?? ''}\n`);
  for (const p of result.problems) ctx.stderr.write(`problem: ${p}\n`);
  if (result.stopped) ctx.stderr.write(`stopped: ${result.stopped}\n`);
}
