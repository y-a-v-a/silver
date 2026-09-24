// Checks every configured model against OpenRouter's live catalogue: does it exist,
// what does it cost, and can it see images where a role needs to.

/** Config roles that always send images (ACTIONS.md: Warhol reviews screenshots, the Printer checks prints). */
export const VISION_ROLES = Object.freeze(['warhol', 'printer']);

/**
 * @typedef {object} AuditRow
 * @property {string} use          what the model is used for, e.g. "studio", "role warhol", "file superstars/brigid.md"
 * @property {string} model
 * @property {boolean} exists
 * @property {boolean|null} vision  null when the model is unknown
 * @property {boolean} needsVision
 * @property {number|null} promptPerM      USD per million prompt tokens
 * @property {number|null} completionPerM  USD per million completion tokens
 * @property {string[]} problems
 */

/**
 * @param {{models: {studio: string[], roles: Record<string, string>, dryRun: string}}} config
 * @param {import('./roles.js').Role[]} roleList   loaded role files (may be empty)
 * @param {(model: string) => Promise<import('./pricing.js').ModelInfo|null>} lookup
 * @returns {Promise<{rows: AuditRow[], problems: string[]}>}
 */
export async function auditModels(config, roleList, lookup) {
  /** @type {{use: string, model: string, needsVision: boolean}[]} */
  const uses = [
    ...config.models.studio.map((model) => ({ use: 'studio', model, needsVision: false })),
    ...Object.entries(config.models.roles).map(([role, model]) => ({ use: `role ${role}`, model, needsVision: VISION_ROLES.includes(role) })),
    { use: 'dry-run', model: config.models.dryRun, needsVision: false },
  ];
  for (const role of roleList) {
    // A role file matters here only when it sets its own model or needs vision.
    const configured = role.group === 'superstar' ? config.models.roles.superstar : config.models.roles[role.id];
    const model = role.model ?? configured ?? (role.id === 'studio-assistant' ? config.models.studio[0] : undefined);
    if (!model) continue;
    if (role.model || role.vision) uses.push({ use: `file ${role.file}`, model, needsVision: role.vision });
  }

  const rows = [];
  for (const { use, model, needsVision } of uses) {
    const info = await lookup(model);
    const problems = [];
    if (!info) problems.push(`${use}: "${model}" is not on OpenRouter`);
    else if (needsVision && !info.vision) problems.push(`${use}: "${model}" cannot take images, but this role sends them`);
    rows.push({
      use,
      model,
      exists: Boolean(info),
      vision: info ? info.vision : null,
      needsVision,
      promptPerM: info ? info.prompt * 1e6 : null,
      completionPerM: info ? info.completion * 1e6 : null,
      problems,
    });
  }
  return { rows, problems: rows.flatMap((r) => r.problems) };
}
