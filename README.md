# Silver

A multi-agent studio for internet art, modelled on how Andy Warhol's Factory actually ran. Upstream, production is cheap, noisy and collective. Downstream, there is one narrow point of selection and signature.

Each day the Factory runs a **shift**:

1. **Scouts** pull ready-made subjects from trending lists and news feeds, and you can add your own subjects as commissions.
2. **Superstars**, persona agents, chatter about the subjects.
3. **Studio assistants** turn each subject into a *series* of 12 generative p5.js sketches across several models, temperatures and techniques. The drift between them is kept on purpose.
4. **Warhol**, an agent, shortlists from each series.
5. **You** approve or veto the shortlist on a local contact sheet. Nothing enters the canon without you.
6. The **Printer** signs and deploys the approved works to a static gallery on Vercel, and **Fred Hughes** numbers the editions and publishes the feed.

Everything is recorded, including drafts, chatter and rejects, and the record feeds back in as raw material. The record lives on local disk and is **not committed to git**: this repository holds code, roles and config only.

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: the roles, the floor, a work's lifecycle, and the design principles.
- **[ACTIONS.md](ACTIONS.md)**: the resolved decisions and the phased build plan.

## Status

Early construction. **Phases 0–5 and 8 are done**:
- The floor (the event log) records everything.
- The OpenRouter client runs as any role, archives transcripts and costs every call.
- The daily budget cap is enforced.
- The Scouts pull ready-made subjects from Google Trends, Hacker News, Reddit and news RSS, and you can commission your own.
- The Studio assistants turn a subject into a series of 12 p5.js sketches across models, temperatures and techniques. Each sketch is rendered headless and checked for errors and blank canvases, and every series gets a contact sheet.
- Warhol shortlists each series from its screenshots, and you approve or veto on a local review page. Every decision goes into `taste.md`, which Warhol reads next time.
- `silver shift` runs the whole day (scouts → series → shortlists) and can be scheduled with launchd.
- Every approval is printed into the canon (signed, print-checked), given an edition number, an English title and wall text by Fred Hughes, and published to a static gallery with an Atom feed, deployed to Vercel.

The superstars (Phase 6) and the Archivist, with its backup, (Phase 7) don't exist yet. `silver --help` lists every planned command, each tagged with the ACTIONS.md phase that builds it, and a command that isn't built yet exits with code 2.

See [`process-log.jsonl`](process-log.jsonl) for a task-by-task log of the build (`npm run log:list`).

## Commands (so far)

```sh
npx silver config [--check]      # resolved configuration / validate it
npx silver models                # every configured model: on OpenRouter? price? can it see images?
npx silver ping technician       # one real call as a role: prints the reply, cost and transcript path
npx silver floor [-f]            # today's events (or --shift YYYY-MM-DD|all, --type, --actor, --json)
npx silver cost                  # spend by role and by model against the $5/day cap
npx silver scout                 # post today's subject cards (--list to just browse the sources)
npx silver commission "<text|URL>" [--why ...] [--now]   # bring your own subject; --now makes its series right away
npx silver subjects [--open]     # subjects with short ids
npx silver series <id|latest>    # 12 variants + screenshots + a contact sheet (--dry-run: 2 cheap ones)
npx silver release <tool>        # the Technician announces a changed tool
npx silver shortlist [series]    # Warhol picks from a finished series (default: the newest without a shortlist)
npx silver review                # the review page on http://127.0.0.1:4747: approve, veto, close
npx silver shift [--dry-run]     # the whole day: scouts, series (commissions first), shortlists
npx silver publish [--no-deploy] # print approvals, release editions, rebuild site/, deploy to Vercel
npx silver publish --redeploy    # deploy even when the canon hasn't changed
npx silver retitle 16 --note "…" # correct an edition's label (or --title/--wall by hand); same number
npx silver cost --reconcile      # the ledger against what OpenRouter actually billed
npx silver subjects --retire <id> --reason "..."   # take a subject off the table
```

## Running the daily shift

1. Put your key in `.env`: `OPENROUTER_API_KEY=...`. The scheduled job doesn't see your shell's variables.
2. Try a cheap round first: `npx silver shift --dry-run`.
3. Install the schedule: `npx silver install-schedule` (`--print` shows the launchd plist first).

The shift runs daily at `shift.at` (09:00) and sends a macOS notification when it's done. If the Mac is asleep at that time, it runs when the Mac wakes; if the Mac is off, that day is skipped. Logs go to `archive/logs/`. Running `silver shift` again the same day does nothing (`--again` runs another round), and an interrupted shift resumes where it stopped. A dry run never counts as the real shift. `npx silver uninstall-schedule` removes the job.

Decisions taken so far are in the table at the top of [ACTIONS.md](ACTIONS.md#decisions-resolved); new open questions are collected at its bottom.

## Requirements

- Node.js 24 or newer
- macOS, for the launchd schedule. Everything else is cross-platform.
- An [OpenRouter](https://openrouter.ai/keys) API key and a [Vercel](https://vercel.com/account/tokens) token (not used until later phases)

## Getting started

```sh
git clone git@github.com:y-a-v-a/silver.git
cd silver
npm run setup          # npm deps, headless Chromium, .env from .env.example
npx silver --help      # or: npm run silver -- --help
npx silver config      # show the resolved configuration
```

Fill in `.env` with your keys. Existing shell environment variables take precedence over `.env`.

## Configuration

All tunables live in [`silver.config.js`](silver.config.js):

- `models`: the studio model pool and a default model per role (OpenRouter slugs)
- `budget`: the daily spend cap ($5)
- `series`: the variant matrix. 12 variants = 3 models × 2 temperatures × 2 techniques.
- `techniques`: the technique menu (grid-repeat, misregistered silkscreen, halftone, …)
- `shift`, `sources`, `review`, `deploy`, `paths`

`npx silver config --check` validates the file and reports every problem at once. `npx silver models` checks the model slugs against OpenRouter's live catalogue.

Environment variables:

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Required for any LLM call |
| `VERCEL_TOKEN` | Deploys (Phase 5) |
| `SILVER_BUDGET_DAILY_USD` | Overrides `budget.dailyUsd` |
| `SILVER_REVIEW_PORT` | Overrides `review.port` |
| `SILVER_ROOT` | Directory that `paths` resolve against (default: this repo) |
| `SILVER_CONFIG` | Alternative config file |
| `OPENROUTER_BASE_URL` | Alternative API endpoint (used by the tests' mock server) |

Roles are markdown files in `roles/`: the body is the role's system prompt, and the frontmatter holds its model and settings (temperature, `max_tokens`, `output: json|text`, `vision`, `reasoning`). Files in `roles/superstars/` are superstars. See [ACTIONS.md → Role file format](ACTIONS.md#role-file-format).

## npm scripts

| Script | What it does |
|---|---|
| `npm run setup` | One-shot setup for a fresh clone (`bin/setup.sh`) |
| `npm run silver -- <cmd>` | Run the CLI |
| `npm test` | Full test suite (`node:test`), including a headless Chromium smoke test |
| `npm run test:fast` | Same, but skips the browser test |
| `npm run test:watch` | Tests in watch mode |
| `npm run check` | Validate the config, then run the fast tests |
| `npm run log -- --phase N --task "…" --summary "…"` | Append an entry to `process-log.jsonl` |
| `npm run log:list [-- --phase N]` | Print the process log |

## Layout

```
silver.config.js   configuration
src/cli.js         the `silver` command; commands are declared in src/commands/registry.js
src/config.js      config loader and validator
src/floor.js       the event log: append, read, tail
src/events.js      event types and envelope validation
src/roles.js       role file loader and {{placeholder}} rendering
src/llm.js         OpenRouter client: transcripts, costing, retries, JSON repair
src/budget.js      daily ledger and caps
src/pricing.js     model prices and capabilities from OpenRouter
src/factory.js     wires the parts together for commands
src/sources/       scout sources: Google Trends, Hacker News, Reddit, RSS
src/agents/        scouts, commissions, studio assistants, technician, Warhol, review, retire, printer, Fred Hughes
src/shift.js       the daily shift
src/schedule.js    the launchd job
src/reconcile.js   ledger vs OpenRouter billing
src/canon.js       the canon (signed works), derived from the floor
src/publish.js     print → editions → site → deploy
src/site.js        the static gallery and feed
src/deploy.js      Vercel
src/tools/         the Technician's workbench: p5 template, headless renderer, contact sheet, review server
src/lib/           shared helpers (append-only JSONL, process log, .env, formatting, dedupe, page snapshots)
bin/               project scripts (setup, process log)
roles/             role system prompts (markdown)
floor/             the event log, one JSONL file per shift (append-only, local only)
archive/           transcripts, every variant including rejects, the Archivist's diary (local only)
canon/             signed works (local only; published through the site)
site/              the generated gallery (gitignored, rebuilt on publish)
test/              node:test suites
```

## Licence

- **Code** (everything in this repository): [MIT](LICENSE)
- **Artworks** (the signed works the Factory publishes): [CC BY 4.0](LICENSE-ARTWORKS.md). This covers the Factory's own contribution only, not the third-party subjects, brands or likenesses a work may depict.

