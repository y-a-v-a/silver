// `silver audition <superstar> [subject]`: try a persona without touching the floor. It's one
// real call on the superstar's own model with their own soul; the only trace is its cost.
import { createFactory } from '../factory.js';
import { chatterPrompt, formatFloor, formatPile, formatSubjects, validateChatter } from '../agents/superstars.js';
import { findSubject } from '../agents/assistants.js';
import { pickSubjects } from '../shift.js';
import { readDirection } from '../lib/direction.js';
import { usd } from '../lib/format.js';

export default async function auditionCommand([roleId, subjectRef], opts, ctx) {
  const factory = await createFactory();
  const { config, floor } = factory;
  const llm = await factory.llm();
  const role = llm.roles.get(roleId);
  let subjects = subjectRef ? [await findSubject(floor, subjectRef)] : (await pickSubjects(floor, floor.today(), 5));
  if (!subjects.length) subjects = (await floor.read({ shift: 'all', type: 'subject.posted' })).filter((s) => !s.payload.dryRun).slice(-3);
  if (!subjects.length) throw new Error('no subjects on the floor to talk about yet');
  const chatter = await floor.read({ shift: 'all', type: 'chatter.posted' });
  const res = await llm.call(role.id, {
    vars: { subjects: formatSubjects(subjects), floor: formatFloor(chatter, subjects), pile: formatPile([]), lines: String(config.superstars.linesPerShift) },
    prompt: chatterPrompt((await readDirection(config.root)).superstars),
  });
  const { lines, problems } = validateChatter(res.json, { subjects: subjects.length, maxLines: config.superstars.linesPerShift, pileSize: 0 });
  if (opts.json) return void ctx.stdout.write(JSON.stringify({ lines, problems, usd: res.usd, model: res.model }, null, 2) + '\n');
  ctx.stdout.write(`${role.name}, on ${res.model}:\n\n`);
  for (const l of lines) ctx.stdout.write(`on "${subjects[l.subject - 1].payload.title}"\n  ${l.text}\n\n`);
  for (const p of problems) ctx.stderr.write(`problem: ${p}\n`);
  ctx.stdout.write(`-- ${usd(res.usd)}. Nothing went on the floor but the cost. Temperature ${role.temperature}.\n`);
}
