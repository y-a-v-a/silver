// Wires the Factory's parts together. Roles and the LLM client load lazily, so commands
// that only read the floor keep working without an API key or with a broken role file.
import { loadConfigFromEnv } from './config.js';
import { createFloor } from './floor.js';
import { createBudget } from './budget.js';
import { createPricing } from './pricing.js';
import { loadRoles } from './roles.js';
import { createLlm, OPENROUTER_BASE_URL } from './llm.js';

/**
 * @param {{env?: Record<string, string|undefined>, fetch?: typeof globalThis.fetch, dryRun?: boolean, llm?: object}} [opts]
 */
export async function createFactory({ env = process.env, fetch = globalThis.fetch, dryRun = false, llm: llmOpts = {} } = {}) {
  const config = await loadConfigFromEnv(env);
  const baseUrl = env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL;
  const floor = createFloor({ dir: config.paths.floor });
  const budget = createBudget({ floor, dailyUsd: config.budget.dailyUsd, chatterShare: config.budget.chatterShare });
  const pricing = createPricing({ baseUrl, fetch });

  let rolesP;
  const roles = () => (rolesP ??= loadRoles({ dir: config.paths.roles, models: config.models }));

  let llmP;
  const llm = () =>
    (llmP ??= roles().then((r) =>
      createLlm({ config, floor, roles: r, budget, pricing, apiKey: env.OPENROUTER_API_KEY, baseUrl, fetch, dryRun, ...llmOpts }),
    ));

  return { config, floor, budget, pricing, roles, llm };
}
