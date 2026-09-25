#!/usr/bin/env node
// `silver`: the Factory's command line. Commands are declared in commands/registry.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { COMMANDS, NOT_IMPLEMENTED_EXIT } from './commands/registry.js';
import { ROOT } from './config.js';
import { loadDotEnv } from './lib/env.js';

const EXPECTED_ERRORS = new Set([
  'ConfigError',
  'RoleError',
  'TemplateError',
  'LlmError',
  'LlmOutputError',
  'BudgetExhausted',
  'EventError',
  'CommissionError',
  'SeriesError',
  'ExtractError',
  'ReleaseError',
  'RetireError',
  'ShortlistError',
  'SeriesNotFound',
  'ReviewError',
  'ReconcileError',
  'ShiftError',
  'ScheduleError',
  'DeployError',
  'PublishBusy',
  'RetitleError',
  'RecordError',
  'DiaryError',
]);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * Build the commander program. Exported so tests can inspect it without spawning.
 * @param {{stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, commands?: import('./commands/registry.js').CommandSpec[]}} [io]
 */
export function buildProgram({ stdout = process.stdout, stderr = process.stderr, commands = COMMANDS } = {}) {
  const ctx = { stdout, stderr, root: ROOT };
  const program = new Command()
    .name('silver')
    .description('The Silver Factory: a multi-agent Warhol Factory for generative internet art')
    .version(pkg.version)
    .showHelpAfterError()
    .configureOutput({ writeOut: (s) => stdout.write(s), writeErr: (s) => stderr.write(s) });

  for (const spec of commands) {
    const cmd = program.command(spec.args ? `${spec.name} ${spec.args}` : spec.name);
    cmd.description(spec.load ? spec.description : `${spec.description} [phase ${spec.phase}]`);
    for (const [flags, desc, def] of spec.options ?? []) cmd.option(flags, desc, def);
    cmd.action(async (...params) => {
      // commander passes: ...positionalArgs, opts, command
      const command = params.pop();
      const opts = params.pop();
      if (!spec.load) {
        stderr.write(`silver ${spec.name}: not built yet (ACTIONS.md phase ${spec.phase})\n`);
        process.exitCode = NOT_IMPLEMENTED_EXIT;
        return;
      }
      const { default: run } = await spec.load();
      await run(params, opts, { ...ctx, command });
    });
  }
  return program;
}

async function main() {
  loadDotEnv(join(ROOT, '.env'));
  await buildProgram().parseAsync(process.argv);
}

// Run only when executed directly, not when imported by tests.
if (import.meta.main) {
  main().catch((err) => {
    // Expected failures get a one-line message; anything else is a bug and gets a stack.
    console.error(`silver: ${EXPECTED_ERRORS.has(err?.name) ? err.message : (err?.stack ?? err)}`);
    process.exit(1);
  });
}
