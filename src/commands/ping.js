// `silver ping <role>`: one real call as a role, to check the key, the model and the
// whole record path (transcript + cost.recorded on the floor).
import { createFactory } from '../factory.js';
import { usd, int } from '../lib/format.js';

export const DEFAULT_PING_PROMPT =
  'Sound check from the floor. Introduce yourself in one or two sentences, in character. ' +
  'If your instructions expect details you have not been given, improvise.';

export default async function pingCommand([roleId], opts, ctx) {
  const factory = await createFactory({ dryRun: Boolean(opts.dryRun) });
  const llm = await factory.llm();
  // Placeholders the ping can't fill render as [name], so any role can be pinged as-is.
  const res = await llm.call(roleId, { prompt: opts.prompt ?? DEFAULT_PING_PROMPT, model: opts.model, strict: false });
  const cost = (await factory.floor.read({ type: 'cost.recorded' })).find((e) => e.id === res.id);
  const p = cost?.payload ?? {};
  const out = opts.json
    ? JSON.stringify({ id: res.id, content: res.content, model: res.model, usd: res.usd, transcript: res.transcript }) + '\n'
    : [
        res.content.trim(),
        '',
        `-- ${res.model} via ${p.provider ?? '?'}: ${usd(res.usd)}${p.estimated ? ' (estimated)' : ''},` +
          ` ${int(p.promptTokens)} in / ${int(p.completionTokens)} out` +
          (p.reasoningTokens ? ` (${int(p.reasoningTokens)} reasoning)` : ''),
        `-- event ${res.id}, transcript ${res.transcript}`,
        '',
      ].join('\n');
  ctx.stdout.write(out);
}
