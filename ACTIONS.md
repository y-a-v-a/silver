# Silver: actions

The build plan for the Silver Factory in Node.js, derived from [ARCHITECTURE.md](ARCHITECTURE.md). Work top to bottom; each phase ends in something runnable.

## Decisions (resolved)

| Question | Decision |
|---|---|
| Who is Warhol? | A **Warhol agent shortlists and signs; the human holds a veto**. Nothing enters the canon without human approval. |
| Medium | **Generative p5.js sketches**, one self-contained HTML file per variant |
| Runtime | **OpenRouter API** (OpenAI-compatible `/chat/completions`) via native `fetch`, so every role can run on a different model |
| Tempo | **One daily shift**, triggered by macOS `launchd` |
| User input | **Two paths**: `silver commission "<text or URL>"` for the human's own subjects, plus autonomous scouting during the shift |
| Scout sources | **Trending lists** (Google Trends RSS, Hacker News, Reddit r/all) and **news RSS** (configurable feed list) |
| Veto UI | **Local web contact sheet** (`silver review`) showing live sketches, Warhol's picks and notes, with approve/veto buttons |
| Deploy | **Vercel**, static gallery, `vercel deploy --prod` |
| Series size | **12 variants per series** from roughly 3 models × 2 temperatures × 2 techniques |
| Budget | **$5/day hard cap** on OpenRouter spend |
| v1 scope | Superstars are live. The Technician has a role file, but its tools are hand-built in v1. |
| Fred Hughes | **Numbered editions + RSS/Atom feed**, plus a title and wall text for each work |
| Warhol's taste | **Learns from vetoes** through an append-only `taste.md` |
| Archivist | **Deterministic code** that records everything, plus an **end-of-shift LLM diary** (Pat Hackett style) |
| Data in git | **Kept out** (decided 2026-09-24). `floor/`, `archive/`, `canon/` and `taste.md` stay on local disk, gitignored. The repo holds code, roles, config and docs. |
| Sensitive subjects | **Exclude + flag** (2026-09-24). The Scout may pick disasters, but never suicide, children or named private victims. Other sensitive subjects carry a `sensitive` flag and show a warning on the contact sheet. |
| Real people's likenesses | **Case by case at the veto** (2026-09-24). No rule in the roles; the human decides per work. |
| Backup of the local record | **Private data repo** (2026-09-24). A separate private GitHub repo (e.g. `silver-record`) that the Archivist commits to and pushes after each shift. |
| Licence | **MIT for the code, CC BY 4.0 for the artworks** (2026-09-24). |
| Source language / region | **Keep the mix** (2026-09-24): English + Dutch feeds, Google Trends `US`. |
| Gallery language | **English** (2026-09-24). Titles and wall text are English, including for Dutch subjects. |
| Commissions vs the series cap | **Fill the slots, the rest waits** (2026-09-24). Commissions take `seriesPerShift` slots first (oldest first); the rest roll over to the next shift. `--now` is for anything urgent. |
| `commission --now` | **Chatter + series + shortlist** (2026-09-24). The superstars react, the assistants produce the series, and Warhol shortlists it, so the work lands on the contact sheet right away. |
| Scout annotates commissions | **Yes, never overwriting the human's `--why`** (2026-09-24). One cheap Scout call adds its own `why` and `image`, marked as the Scout's. |
| Repeat subjects | **7-day window** (2026-09-24). A scouted subject may return after 7 days (configurable); commissions may always repeat. |
| Reddit | **Keep r/all for now** (2026-09-24). Switch to curated subreddits if NSFW shows up. |
| Studio pool: DeepSeek | **Replace with Qwen 3.8 Flash** (2026-09-25). DeepSeek v4.1 Flash produced 2/12; its providers ignore every thinking limit. Verify Qwen with `silver models` and a dry-run series first. |
| Studio pool: Sonnet | **Keep in rotation** (2026-09-25), despite ~$0.056 per variant (6–13× the others). |
| p5 version | **Stay on p5 1.11.13** for v1 (2026-09-25). Revisit 2.x after v1. |
| Spend missing from the ledger | **`silver cost --reconcile`** (2026-09-25): compare the ledger with OpenRouter's `/api/v1/key` usage and report the gap, also in the end-of-shift summary. |
| Subjects from before the exclusion rule | **Retire event** (2026-09-25): a new `subject.retired` event and `silver subjects --retire <id>`. Retired subjects are hidden from `latest`, `--open` and the shift. |
| Technique adherence | **Drift, and Warhol notes it** (2026-09-25). Off-technique variants are kept, and Warhol's review mentions it; the human judges at the veto. |
| Screenshots per variant for Warhol | **1 per variant** (2026-09-25): seed 1, about 12 images per review. |
| What gets published | **Every approval** (2026-09-25). Each approved variant becomes a signed, numbered edition on the gallery; there is no separate signing step. "The more the merrier": mass and repetition are the point. |

## Stack

- Node 24, ESM, plain JavaScript with JSDoc types. No build step.
- Minimal dependencies:
  - `gray-matter`: role file frontmatter
  - `rss-parser`: news and Google Trends feeds
  - `commander`: the CLI
  - `ulid`: event ids
  - `playwright`: headless render and screenshot of sketches
  - `vercel`: deploy CLI, as a dev dependency
- No database. The floor is JSONL and everything else is files on local disk (runtime data is not in git).
- Secrets in `.env`: `OPENROUTER_API_KEY`, `VERCEL_TOKEN`.

## Repository layout

```
silver/
  ARCHITECTURE.md
  ACTIONS.md
  silver.config.js          # models, budget, feeds, series matrix, shift settings
  roles/                    # the "system prompts": one markdown file per role
    scout.md
    studio-assistant.md
    warhol.md
    printer.md
    fred-hughes.md
    archivist.md
    technician.md
    superstars/
      brigid.md
      ondine.md
      viva.md
  taste.md                  # append-only log of human approve/veto notes; read by Warhol (local only)
  process-log.jsonl         # build progress, one line per finished task
  bin/                      # setup.sh, log-progress.js
  src/
    cli.js                  # `silver` entry point
    commands/               # one module per CLI command + registry.js
    config.js               # loads and validates silver.config.js
    factory.js              # wires config, floor, budget, pricing, roles, llm
    events.js               # event types + envelope validation
    floor.js                # append/read/subscribe to the event log
    llm.js                  # OpenRouter client, cost tracking, transcript capture
    pricing.js              # model prices/capabilities from OpenRouter /models
    model-audit.js          # `silver models`
    roles.js                # loads roles/*.md → { meta, systemPrompt }
    budget.js               # daily ledger, hard cap
    shift.js                # orchestrates one daily shift
    lib/                    # jsonl, dedupe, snapshot, format, env, process-log
    agents/
      scouts.js
      commissions.js
      superstars.js
      assistants.js
      warhol.js
      printer.js
      hughes.js
      archivist.js
    sources/
      index.js              # gatherCandidates: all sources in parallel
      http.js               # UA, timeouts, htmlToText
      candidate.js
      google-trends.js
      hackernews.js
      reddit.js
      rss.js
    tools/                  # the Technician's workbench (hand-built in v1)
      p5-template.html
      render.js             # Playwright: run sketch, catch errors, screenshot
      contact-sheet/        # local review web app
  # --- runtime data: local disk only, gitignored (floor/, archive/, canon/, taste.md) ---
  floor/                    # YYYY-MM-DD.jsonl, append-only, never edited
  archive/
    transcripts/            # every LLM request+response, by event id
    variants/<series-id>/   # every sketch + screenshot, including rejects
    diary/                  # Archivist's daily entries (YYYY-MM-DD.md)
  canon/
    canon.json              # signed works, edition numbers, hashes
    works/<canon-id>/       # final sketch, poster PNG, wall text
  site/                     # generated static gallery → Vercel (gitignored, rebuilt)
  launchd/
    com.silver.shift.plist
```

## Role file format

Each role is a markdown file. The body is the system prompt, and the frontmatter holds its runtime settings. Code never hardcodes a prompt.

```markdown
---
id: warhol
name: Warhol
model: <openrouter model slug>      # must be vision-capable for Warhol
temperature: 0.4
reads: [series.completed, chatter.posted]
emits: [shortlist.proposed]
max_tokens: 2000
output: json                        # json | text
vision: true                        # optional: the role sends images
reasoning: low                      # optional: off | low | medium | high, or a number = hard thinking-token budget
---

You are Andy Warhol at the Factory. You did not make these; your assistants did.
Your job is to choose. ...

## Output
Return JSON: { "picks": [{ "variant_id": "...", "note": "..." }], "rejects_note": "..." }
```

Rules:
- `roles.js` validates the frontmatter and fails loudly if a field is missing or unknown.
- `model_role: <role>` (optional) makes a role use another role's config model, e.g. `roles/scout-annotate.md` runs on the Scout's model. It is exclusive with `model`.
- Reasoning tokens count against `max_tokens`. A reasoning model can spend all of them thinking and return an empty reply, so set `reasoning` (use `off` for chatter) and leave enough headroom. Effort levels are only advisory for some models (DeepSeek spent a full 8,000-token budget thinking at `low` on the studio brief), so use a number where it matters: `reasoning: 2000` caps thinking at 2,000 tokens.
- The prompt body may use `{{placeholders}}` (e.g. `{{taste}}`, `{{subject}}`, `{{floor_excerpt}}`), which are filled at call time.
- Superstars share one frontmatter shape and differ only in voice. A new persona means adding a new file, with no code change.
- Principle 6 (blurry roles): each role prompt says it *may* step outside its role, and the orchestrator accepts off-role events such as a superstar posting a `subject.posted`.

## Floor events

Envelope, one JSON object per line:

```json
{ "id": "01J…", "ts": "2026-09-23T09:00:00Z", "shift": "2026-09-23", "type": "subject.posted", "actor": "scout", "ref": null, "payload": {} }
```

Event types, extending the draft list in ARCHITECTURE.md:

| Event | Actor | Payload |
|---|---|---|
| `shift.started` / `shift.ended` | orchestrator | budget remaining, counts |
| `subject.posted` | scout, superstar, **human** (commission) | `origin: scouted\|commission\|archive`, `title`, `url`, `source`, `why` (why it is a ready-made), `image` (the image it suggests), `snapshot: {snippet, fetchedAt, meta, page}`. `ref` points at the Scout call (or at the earlier subject a commission repeats). |
| `chatter.posted` | superstar | persona id, text, ref |
| `tool.released` | technician | tool name, version (in v1, emitted manually when a template changes) |
| `series.started` | assistant | `subjectId` (this claims the subject; commissions without one are pending), technique list, model matrix |
| `variant.produced` | assistant | series id, path, model, temperature, technique, seed |
| `variant.failed` | renderer | series id, error (kept in the archive, since failures are material) |
| `series.completed` | orchestrator | series id, variant ids, contact-sheet path |
| `shortlist.proposed` | Warhol agent | picks with notes, reject note |
| `review.decision` | **human** | variant id, approved\|vetoed, note (this also appends to `taste.md`) |
| `work.published` | printer | canon id, edition, URL, render hash |
| `edition.released` | Fred Hughes | work id, channel (`site`, `rss`), edition number |
| `cost.recorded` | llm client | model, tokens, USD, ref |
| `llm.failed` | llm client | role, model, error, attempts, reason (`empty`, `invalid-json`) |
| `diary.written` | archivist | path |
| `subject.retired` | **human** | `subjectId`, reason. Hides the subject from `latest`, `subjects --open` and the shift; the subject itself stays on the floor (Phase 3b). |

---

## Phase 0: scaffold ✅

- [x] `npm init`, set `"type": "module"`, add a `bin` entry for `silver` → `src/cli.js`
- [x] Install the dependencies listed above, plus `npx playwright install chromium` (wrapped in `npm run setup`)
- [x] `.env.example`, `.gitignore` (ignore `.env`, `site/`, `node_modules`)
- [x] `git init`. ~~The floor, archive, and canon **are committed** (the record is the work).~~ **Reversed on 2026-09-24:** runtime data stays out of git. `test/layout.test.js` now fails if any of it is tracked.
- [x] `silver.config.js` with:
  - [x] `models`: a studio pool of 4 OpenRouter slugs across providers, a default model per role, and a cheap model for chatter and dry runs
  - [x] `budget.dailyUsd: 5`
  - [x] `series.variants: 12`, `series.temperatures: [0.7, 1.1]`, plus `modelsPerSeries: 3` and `techniquesPerSeries: 2`. The technique menu is a top-level `techniques` map.
  - [x] `shift.seriesPerShift: 2`, `shift.subjectsPerShift: 6`
  - [x] `sources.rss: [...]`, `sources.trending: { googleTrendsGeo, hackernews: true, reddit: true }`
- [x] In ARCHITECTURE.md, mark the four open decisions as resolved and link to this file

Also added along the way:

- `src/config.js` validates the whole config in one pass (`silver config --check`)
- A command registry in `src/commands/registry.js`. Every planned command is listed with its phase, and unbuilt commands exit 2.
- `src/lib/jsonl.js`, append-only JSONL helpers that the floor will reuse in Phase 1
- `process-log.jsonl` + `bin/log-progress.js` to track the build
- README, a `node:test` suite, and GitHub Actions CI

**Done when:** `silver --help` prints the command list. ✅

## Phase 1: the floor, the LLM client, roles, budget ✅

- [x] `floor.js`: `append(event)`, `read({ shift, type, since })`, and `tail()` (async iterator used by the contact sheet). Append only, with no update or delete API. `read` also filters by `actor` and `ref`, and accepts `shift: 'all'` and `prefix.*` type patterns.
- [x] `llm.js`: `call(role, { vars, messages, images })` →
  - [x] POST to `https://openrouter.ai/api/v1/chat/completions` with the role's model, temperature, and system prompt
  - [x] Request usage accounting so each response reports its cost, then emit `cost.recorded`
  - [x] Save the full request and response to `archive/transcripts/<event-id>.json`. Base64 images are reduced to a fingerprint, since the images themselves are archived with the variants.
  - [x] Retry with backoff on 429/5xx. When `output: json` returns unparseable JSON, retry once with a repair message, and if that also fails, record the failure and move on (`llm.failed` + `LlmOutputError`). Empty replies are handled the same way.
  - [x] Support image input (base64 PNG) for Warhol's review. The role must declare `vision: true`.
- [x] `budget.js`: a daily ledger built from `cost.recorded` events. `check(estimateUsd)` / `reserve(estimateUsd)` throw `BudgetExhausted`. Chatter has its own share of the cap, and reservations are serialised so parallel calls can't overspend. (Catching it at the end of a shift is Phase 8.)
- [x] `roles.js`: load and validate `roles/**/*.md`, and render placeholders
- [x] `silver floor [--shift date|all] [--type t] [--actor a] [--follow] [--json]`: pretty-prints the log
- [x] `silver cost [--shift date|all] [--json]`: spend for each role and model

Also added along the way:

- `src/pricing.js`: OpenRouter's public `/models`, used for pre-call estimates and as a fallback cost
- `silver models`: checks every configured model exists on OpenRouter and that image roles are on vision models
- The `reasoning` frontmatter field and the `llm.failed` event (see above)
- `SILVER_ROOT`, `SILVER_CONFIG` and `OPENROUTER_BASE_URL` env hooks, used by the end-to-end tests
- `roles/technician.md`, written ahead of Phase 3 so `ping` had a real role

**Done when:** a throwaway `silver ping <role>` makes one call, and the floor shows `cost.recorded` with the transcript in the archive. ✅ The first real call was `silver ping technician` on 2026-09-24 (claude-sonnet-5, $0.00136).

## Phase 2: Scouts and commissions ✅

- [x] Write `roles/scout.md` (Latow/Geldzahler): *find, don't invent*; judge whether an item is a true ready-made (mass-produced, widely seen, emotionally loaded or banal); output subject cards as JSON. The Scout picks by candidate number, so titles are never rewritten. `why` must use only facts from the source, and `image` may be imagined.
- [x] Source adapters, each returning `{ title, url, snippet, source, fetchedAt }` (plus `meta`):
  - [x] `google-trends.js` (daily trending RSS for a configured geo; the lead news link becomes the url)
  - [x] `hackernews.js` (front page, via the official Firebase API)
  - [x] `reddit.js`: **changed.** `/r/all/top.json` answers 403 without OAuth (checked 2026-09-24), so it uses the public Atom feed `/r/all/top/.rss?t=day` and takes the post's own target from its `[link]` anchor
  - [x] `rss.js` (configured news feeds; each is its own source `rss:<host>`)
- [x] `agents/scouts.js`: fetch all sources → dedupe against subjects already on the floor → the Scout LLM picks `subjectsPerShift` → emit `subject.posted` with a text snapshot, so the subject survives link rot
  - Dedupe: normalised URL (tracking params stripped), normalised title, or titles sharing ≥ 75% of their words (Jaccard)
  - Snapshot (`src/lib/snapshot.js`): og title, description and image, plus up to 2,000 characters of article text. It never throws, and failures such as paywall 403s are recorded on the card.
- [x] `silver commission "<text | URL>" [--now]`: emits `subject.posted` with `origin: commission`. Commissions **always get a series** in the next shift, ahead of scouted subjects. `--now` runs a mini-shift for just that subject. **Partly done:** since Phase 4, `--now` produces and renders the series and has Warhol shortlist it right away. Superstar chatter joins when Phase 6 is built. Without an API key it queues and says so. Also added `--why <note>` and `--list` (commissions still waiting for a series).
- [x] `silver scout`: runs the scouts on their own (useful for tuning). Options: `--count`, `--source`, `--list` (no model call), `--no-snapshot`, `--dry-run`, `--json`.

**Done when:** `silver scout` posts ~6 subject cards to the floor, each showing a "why it's a ready-made" line that makes sense. ✅ The first live run on 2026-09-24 posted 6 cards for $0.0086. Its notes embellished facts, which led to the facts-only rule; the rerun stayed factual.

## Phase 2b: follow-ups from the 2026-09-24 decisions

- [x] **Sensitive subjects:** add the exclusion rule to `roles/scout.md` (no suicide, no children, no named private victims), plus a `sensitive: {flag, reason}` field per pick. `validatePicks` carries it onto the subject card (`payload.sensitive`).
- [x] **Repeat window:** add `sources.repeatAfterDays: 7` to the config (validated). Dedupe against the floor only looks at subjects posted within the window, and the Scout's "recent subjects" list uses the same window.
- [x] **Scout annotates commissions:** after `postCommission`, one Scout call (a small prompt section in `roles/scout.md`, or a separate `roles/scout-annotate.md`) adds `scoutWhy` and `image`. The human's `why` is never overwritten. A failed call leaves the commission as it is and is recorded as `llm.failed`. `--no-annotate` skips it.
- [x] **Licence:** add `LICENSE` (MIT, code) and `LICENSE-ARTWORKS.md` (CC BY 4.0, works), set `"license": "MIT"` in `package.json`, and add a README section.

## Phase 3: Technician tools and Studio assistants ✅

- [x] Write `roles/technician.md` (done in Phase 1). It is used in v1 only for its voice: when a template changes, the human runs `silver release <tool>` and the Technician writes the release note as a `tool.released` event.
- [x] `silver release <tool>` (`agents/technician.js`): tools are `p5-template`, `renderer` and `contact-sheet`. The version is the file's content hash, and releasing the same version twice needs `--force`. Changes come from `--changes` or the file's git log.
- [x] `tools/p5-template.html` (in `src/tools/`, built by `src/tools/template.js`): a single file that loads p5 from a pinned CDN version (**p5 1.11.13**, kept for v1 by decision 2026-09-25) with an injected `// SKETCH` block
  - [x] Seeds from `?seed=` (`randomSeed` + `noiseSeed`), so screenshots are reproducible while a normal load still drifts. `Math.random` is seeded too (mulberry32).
  - [x] Fixed canvas size (e.g. 1080×1080), with a `window.__silverReady` flag set after N frames (30), or right after `setup()` for sketches without `draw()`. `?freeze=1` stops the loop at that frame.
  - [x] Embeds the title and subject as a comment/metadata, with no visible UI chrome (a `silver-meta` JSON script tag, escaped against `</script>`)
- [x] `tools/render.js` (Playwright):
  - [x] Loads the sketch, collects console errors, waits for `__silverReady` or a timeout. It stops waiting at the first uncaught error. p5 is served from `node_modules`, and all other network is blocked and reported.
  - [x] Takes a screenshot at seed 1 (and optionally seeds 2 and 3, for a small grid)
  - [x] Blank-canvas check: near-uniform pixels count as a failure (the dominant colour covers ≥ 99.5% of a 96×96 sample)
  - [x] Emits `variant.failed` on error or blank output, otherwise returns the PNG path. The renderer returns `{ok, reason, shots, errors, blocked}`, and the assistants agent emits the event.
- [x] Write `roles/studio-assistant.md` (Malanga/Smith): turn a subject into a p5 sketch in a given **technique**; serial repetition, silkscreen logic (flat colour fields, registration offset, grids of repeats, photo-to-halftone); output only the sketch body. No external assets (the renderer blocks the network, and published works shouldn't depend on outside links), `random()`/`noise()` for all variation, complete by frame 30, real people shown through type, silhouettes or objects.
- [x] A technique menu in config, e.g. `grid-repeat`, `misregistered-silkscreen`, `halftone`, `camouflage`, `death-and-disaster-tint`, `screen-test-portrait`. Each is one line of guidance injected into the prompt. (Done in Phase 0: the top-level `techniques` map in `silver.config.js`.)
- [x] `agents/assistants.js`: for each subject selected in this shift → `series.started` → run the 12-cell matrix (models × temperatures × techniques) in parallel, with a concurrency limit → write to `archive/variants/<series>/<variant>.html` → render → `variant.produced` / `variant.failed` → `series.completed` with a generated contact sheet. Failures are recorded with a stage (`llm`, `extract`, `error`, `blank`, `no-canvas`, `timeout`, `budget`); an unparseable reply is kept as `<variant>.reply.txt`. A spent budget stops new work, and the unstarted cells are recorded. The matrix and extraction live in `agents/studio.js`, and the static contact sheet in `tools/contact-sheet.js`.
- [x] **Keep the drift:** assistants do not get to see each other's variants within a series. Each one gets the subject plus the recent floor chatter only.

- [x] `silver series <subject>` (id, unique id suffix, or `latest`; `--dry-run`, `--variants`, `--no-render`, `--open`) and `silver subjects` (short ids, commission/sensitive markers, series count)

**Done when:** `silver series <subject-id>` produces a folder of 12 sketches with screenshots, and broken ones are recorded rather than dropped. ✅ There were three live series on 2026-09-24:

| Series | Subject | Produced | Cost | Notes |
|---|---|---|---|---|
| `01M3AFN63F28M769GJ5MSTFC1P` | dunkin free coffee code | 7/12 | $0.05 | DeepSeek timed out (misreported as "HTTP 200") and returned empty at 8k tokens; led to the timeout and body-error fixes |
| `01M3AG01ZPYAXJ8ECDMSYHKTYA` | 78$ sushi arrived like this | 9/12 | $0.27 | DeepSeek again returned empty at 8k; led to `max_tokens: 16000` |
| `01M3AGEEMAFBXZ7K9P0YYN2PSY` | NGV employee stole $8m for phones | 9/12 | $0.11 | Every cell replied; failures were 2 DeepSeek truncations and 1 runtime error |

Per model across all three: Gemini 3.8 Flash 8/8 ($0.010/call), GPT-6 Luna Pro 11/12 ($0.004/call), Claude Sonnet 5 4/4 ($0.056/call), DeepSeek v4.1 Flash 2/12 ($0.009/call). DeepSeek is being replaced by Qwen 3.8 Flash (decision 2026-09-25, Phase 3b).

Also added in Phase 3:

- `silver commission --now` produces the series immediately (chatter and shortlist to follow in Phases 6 and 4)
- `reasoning` in role frontmatter may be a number: a thinking-token budget (advisory in practice: several providers ignore it)
- The Technician's release notes use the tool's own header and a facts-only rule (the first live notes invented features)

## Phase 3b: follow-ups from the 2026-09-25 decisions ✅

- [x] **Replace DeepSeek with Qwen 3.8 Flash** in `models.studio`: check it with `silver models`, run one dry-run series on it, and record the result here. **Result (2026-09-25):** `silver models` OK. The dry-run series `01M3BTRDR1GHPGNZX56FZJ6DXP` (4 variants, Qwen only) produced **3/4** for $0.0069 ($0.0017/call) in 49s. The one failure was `fill('#hex', alpha)`, which p5 1.x rejects and which GPT-6 Luna Pro had also hit, so the Studio assistant's brief now shows the correct pattern.
- [x] **Retire subjects:** add a `subject.retired` event type (payload `subjectId`, `reason`, actor `human`) and `silver subjects --retire <id> [--reason ...]`. `findSubject('latest')`, `subjects --open` and `pendingCommissions` skip retired subjects. `silver subjects` marks them. Then retire the two subjects from before the exclusion rule (the US Navy suicide attempts and the UN photos of slain children). **Done 2026-09-25:** `HFC44P1D` and `DG602VC4` are retired. An explicit `silver series <id>` of a retired subject is refused too.

## Phase 4: Warhol and the contact sheet (veto) ✅

- [x] `taste.md` (`src/lib/taste.js`): starts with a short hand-written header of what the human likes and dislikes. After that it is append-only: one entry per human decision, with date, variant, verdict, and note.
- [x] Write `roles/warhol.md`: terse, flat, deadpan; chooses the piece, never makes it; judges *seriality and surface*, not effort. Its `{{taste}}` placeholder receives the last N entries of `taste.md`. Output: 1–3 picks per series with a one-line note each, plus a note for the rejects.
- [x] `agents/warhol.js`: on `series.completed`, sends the screenshots (vision) and the sketch metadata (not the full code, which would bias it toward code quality) → `shortlist.proposed`
  - [x] **One screenshot per variant** (seed 1), so about 12 images per review (decision 2026-09-25)
  - [x] Warhol's notes say when a variant ignored its assigned technique (`offTechnique` per pick). Such variants are kept as drift and judged at the veto (decision 2026-09-25).
  - [x] `silver shortlist [series|latest|unlisted]`. Warhol sees images, techniques and temperatures, never code or model names. Series views come from `agents/series-data.js`, shared with the review server and the shift. First live shortlist (NGV series, 2026-09-25): $0.06 for 9 images on Opus 5.5, in voice ("Gee, it's a mugshot of a product.").
- [x] `tools/contact-sheet/` (built as `src/tools/review/`: `server.js`, `pages.js`, plus `agents/review.js`): a small `node:http` server, with no framework, bound to 127.0.0.1, with cross-origin form posts refused
  - [x] `silver review` starts it on `localhost:4747` and opens the browser
  - [x] One page per series: a grid of **live** sketches in iframes, with Warhol's picks highlighted and his notes shown. Screenshots by default, with "play here" swapping in the live sketch, since twelve live p5 canvases at once are heavy.
  - [x] The Floor chatter for that subject is shown in a side column
  - [x] Each pick has Approve / Veto and an optional note field. Posting a decision emits `review.decision` and appends to `taste.md`.
  - [x] The human may also approve a variant Warhol did **not** pick (the veto works both ways)
  - [x] Pending reviews persist across shifts until they are decided (a series stays pending until "Close this review" posts `review.decision` with `verdict: closed`; the latest decision per variant wins)
  - [x] Subjects with `payload.sensitive.flag` show a visible warning and the reason (decision 2026-09-24)
  - [x] Real people's likenesses are judged here, case by case: no automated rule (decision 2026-09-24)
- [x] Rejected and vetoed variants stay in `archive/`, since nothing is ever deleted

**Done when:** after a shift, `silver review` shows Warhol's shortlist, and approving one emits the decision and grows `taste.md`. ✅ The first live shortlist (NGV series) shows on `silver review` with Warhol's notes, checked in headless Chromium at desktop and phone widths. Approve, veto and close are covered by tests against the real server. **The first real approval is left to you**, since that veto is yours.

## Phase 5: Printer, Fred Hughes, Vercel

- [x] Write `roles/printer.md`. The Printer is mostly code; the LLM is used only for a final "print check" (does the sketch hold up at full size, and does it run for more than 60s without degrading?). It may send the piece back as a floor event, but it cannot un-sign it.
- [x] `agents/printer.js`, run on `review.decision: approved` (the latest decision per variant counts; nothing is printed twice):
  - [x] Copies the sketch to `canon/works/<canon-id>/sketch.html`. The template only seeds when `?seed=` is given, so the published piece drifts on every load as built. Canon ids are readable: `<subject-slug>-<variant>-<series tail>`.
  - [x] Renders a poster PNG (fixed seed) for thumbnails and OG images, falling back to the review screenshot. It also holds the piece `printer.holdSeconds` (10s rather than the planned 60s) and looks again (`later.png`).
  - [x] **Signature:** sha256 of the sketch source + Warhol's note + the human approval event id, stored in `canon.json` (`src/canon.js`; `canon.json` is a cache rebuilt from the floor)
  - [x] Emits `work.published`. The print check flags but never blocks: `printCheck.verdict` is `ok`, `concern` or `unchecked`, and an error or blank frame while running is always a concern, whatever the model says.
- [x] Write `roles/fred-hughes.md`: the business side: a title (Warhol-flat: "Silver Car Crash (Double Disaster)"-style), short wall text, edition number. **Always in English**, also for Dutch subjects, and wall text quotes at most a headline, never article text.
- [x] `agents/hughes.js`: assigns sequential edition numbers, writes the wall text, regenerates the site, emits `edition.released`. Numbering is gap-free in signing order; a failed call leaves the work unreleased for the next publish. Regenerating the site is the publish pipeline's job.
- [x] Static site generator `src/site.js` → `site/` (only released editions; rebuilt from scratch, keeping `site/.vercel`):
  - [x] `index.html`: the canon as a grid of posters, newest first
  - [x] `works/<id>/`: the live sketch, full-bleed, with wall text below (plus the edition number, technique, source headline link, signature excerpt, previous/next links, and OG tags once `deploy.siteUrl` is set)
  - [x] `feed.xml`: an Atom feed of the editions (stable `tag:` ids; absolute links once `deploy.siteUrl` is set)
  - [x] A CC BY 4.0 notice on every work page and in the feed (decision 2026-09-24)
- [ ] Deploy with `vercel deploy site --prod --token $VERCEL_TOKEN --yes`. Record the URL in `work.published`.
- [ ] `silver publish`: rebuilds and redeploys by hand

**Done when:** approving a variant in the contact sheet results in a live Vercel URL and a new feed entry.

## Phase 6: Superstars

- [ ] Write 3 persona files in `roles/superstars/` (e.g. Brigid: tape-recorder gossip; Ondine: amphetamine monologue; Viva: withering commentary). Each is **cast talent**: a strong voice with opinions about the subjects.
- [ ] `agents/superstars.js`: after the Scouts, each superstar reads the shift's subjects and recent chatter → 1–3 `chatter.posted` events, and occasionally a `subject.posted` (blurry roles)
- [ ] Run chatter on the cheap model and cap it per shift in the budget
- [ ] The chatter goes into the assistants' prompts (`{{floor_excerpt}}`) and appears on the contact sheet

**Done when:** series visibly change when the chatter changes (A/B the same subject with and without chatter once).

## Phase 7: Archivist

- [ ] `agents/archivist.js` (code): after each shift, checks that every event has its transcript or artifact, writes a shift manifest and a summary of the shift. It does **not** commit to git, since data stays out of the repo (see the backup decision below).
- [ ] Write `roles/archivist.md` (Billy Name / Pat Hackett): writes a diary entry from the day's floor (who said what, what got made, what died) → `archive/diary/YYYY-MM-DD.md` → `diary.written`
- [ ] **Backup** (decision 2026-09-24): `floor/`, `archive/`, `canon/` and `taste.md` form their own git repo, pushed to a **private** GitHub repo (e.g. `silver-record`). At the end of each shift the Archivist commits with a shift summary and pushes. If the push fails, it is recorded and retried next shift, without failing the shift. Setup: `silver init-record` creates the repo (confirming before creating anything on GitHub).
- [ ] **Feedback loop** (principle 3): Scouts treat the diary and the reject pile as an extra source, with `origin: archive`, and at most one archive subject per shift

**Done when:** a diary entry exists for each shift, and an archive-origin subject appears within a week.

## Phase 8: the daily shift and launchd ✅ (installed 2026-09-25; first unattended run 2026-09-26 09:00)

- [x] `src/shift.js`: `shift.started` → scouts → superstars → pick subjects (commissions first, then scouted) → assistants (N series) → Warhol shortlists → archivist → `shift.ended`
  - [x] Commissions fill the `seriesPerShift` slots first, oldest first. The rest wait for the next shift (decision 2026-09-24).
  - [x] `silver commission --now` runs a mini-shift for one subject: superstar chatter → series → Warhol shortlist (decision 2026-09-24). Chatter is still pending Phase 6.
  - [x] Idempotent per date: running it twice on one day continues the shift without duplicating it
  - [x] Stops cleanly on `BudgetExhausted` and records the reason
  - [x] Skips retired subjects (`subject.retired`, Phase 3b)
  - [x] The end-of-shift summary includes the reconcile gap (below)
  - [x] A dry run never stands in for the real shift: dry-run `shift.ended` events, series slots and subject claims only count for other dry runs, so testing never uses up the day
  - [x] Printing happens **outside** the shift, at the moment of human approval, because the veto is async
- [x] `silver shift [--dry-run] [--again] [--no-notify] [--json]`: dry-run uses the cheapest model and 2 variants. Superstars (Phase 6) and the Archivist (Phase 7) are recorded as skipped steps until they exist.
- [x] `silver cost --reconcile` (decision 2026-09-25, `src/reconcile.js`): compare the ledger's total with OpenRouter's `/api/v1/key` usage over the same period and report the gap (billed calls that never reached `cost.recorded`, such as timed-out replies)
- [x] A macOS notification at the end of a shift (`osascript -e 'display notification …'`) saying "N series waiting for review"
- [x] `launchd/com.silver.shift.plist`: `StartCalendarInterval` (e.g. 09:00), absolute paths to `node` and the repo, and logs to `archive/logs/`. The plist is generated with this machine's absolute paths by `src/schedule.js` (`silver install-schedule --print` shows it) rather than kept as a static file in the repo.
- [x] `silver install-schedule`: copies the plist to `~/Library/LaunchAgents/` and runs `launchctl bootstrap`. `silver uninstall-schedule` reverses it. Install refuses unless `.env` has `OPENROUTER_API_KEY` (launchd jobs don't inherit the shell's variables); `--force` overrides.
- [x] Document that if the Mac is asleep at the scheduled time, launchd runs the job on wake (in `src/schedule.js`, the install output and the README; if the Mac is switched off, that day's shift is skipped)

**Done when:** the Mac runs a shift unattended overnight, the notification appears, and the review → publish flow works the next morning. **Partly verified:**
- **Verified:** `silver shift --dry-run` ran live on 2026-09-25 (6 subjects, 1 series, 1 shortlist, reconcile OK, about 2 minutes). The tests cover full, repeated, resumed, budget-stopped and dry-run shifts.
- **Open:** the unattended run needs `silver install-schedule`, which I didn't run: it schedules daily spending, and `.env` doesn't hold the key yet (see the open questions).
- **Open:** "publish" is Phase 5, so for now the morning flow ends at approval.

## Later (not v1)

- The Technician goes live: an agent that proposes and writes new techniques and templates, gated by `tool.released`
- More sources: product catalogs (the soup cans), Wikipedia most-read
- Social channels for Fred Hughes (Bluesky/Mastodon)
- Image-model techniques (photo-silkscreen) alongside p5
- Continuous tempo: floor subscribers instead of a sequential shift

## Decisions taken on 2026-09-24

The open decisions from Phases 0–2 were answered on 2026-09-24. They are summarised in the decisions table at the top, and the resulting work is in **Phase 2b** and the later phases. For the record, each question and the options that were considered:

1. **Sensitive subjects:** real, recent victims (the Scout had picked Navy suicide attempts and photos of slain children). *Chosen:* exclude suicide, children and named private victims, and flag other sensitive subjects. *Considered:* keep open, flag only, exclude only.
2. **Copyrighted text in a public repo:** resolved earlier the same day. Data stays out of git, and the history was rewritten and force-pushed. *Remainder:* GitHub serves the orphaned commits `20a76a8` and `b8187bd` by hash until its own GC runs, and GitHub Support can purge them sooner. The gallery quotes at most a headline.
3. **Real people's likenesses:** *Chosen:* case by case at the veto. *Considered:* public figures only; no real faces.
4. **Source language / region:** *Chosen:* keep the English + Dutch mix with US Trends. *Considered:* add NL Trends, switch to NL, English only. **Gallery language:** *Chosen:* English. *Considered:* source language, Dutch, bilingual.
5. **Commissions vs the series cap:** *Chosen:* commissions fill the slots first and the rest waits. *Considered:* all commissions always; a separate cap.
6. **Scout annotates commissions:** *Chosen:* yes, never overwriting the human's `--why`. *Considered:* image line only; no.
7. **`--now`:** *Chosen:* chatter + series + shortlist. *Considered:* series only; series + shortlist.
8. **Repeat subjects:** *Chosen:* a 7-day window for scouted subjects; commissions always allowed. *Considered:* forever, 30 days, 90 days.
9. **Reddit NSFW:** *Chosen:* keep r/all for now and switch if NSFW appears. *Considered:* curated subreddits now; drop Reddit.
10. **Licence:** *Chosen:* MIT for code, CC BY 4.0 for artworks. *Considered:* CC BY-NC for works; all rights reserved for works; stay UNLICENSED.
11. **Backup of the local record:** *Chosen:* a private data repo pushed by the Archivist. *Considered:* Time Machine only, a sync folder or rsync, tarballs.

## Decisions taken on 2026-09-25

The open points from the Phase 2b/3 night shift were answered on 2026-09-25. They are summarised in the decisions table at the top, and the resulting work is in **Phase 3b**, Phase 4 and Phase 8. For the record:

1. **DeepSeek in the studio pool.** It produced 2/12 across three live series (Gemini 8/8, GPT-6 Luna Pro 11/12, Sonnet 4/4). It thinks for 8k–15k tokens on the studio brief, and its providers (Alibaba, AtlasCloud, Relace, NextBit) ignore `reasoning.effort` and `reasoning.max_tokens`, even with `provider.require_parameters`. *Chosen:* replace it with Qwen 3.8 Flash, keeping four different houses for drift. *Considered:* Kimi K3 (strong, but priced like Sonnet), a 3-model pool, keeping DeepSeek.
2. **Sonnet's cost share.** About $0.056 per variant, 6–13× the others; ~$0.27 for a series with Sonnet against ~$0.05–0.11 without. *Chosen:* keep it in rotation. *Considered:* writing roles only; at most one slot per series (which is already the case).
3. **p5 1.x vs 2.x.** *Chosen:* stay on 1.11.13 for v1. *Considered:* move to 2.x now.
4. **Subjects from before the exclusion rule.** *Chosen:* a `subject.retired` event with `silver subjects --retire`. *Considered:* skip subjects posted before a date; leave it to the veto.
5. **Technique adherence.** *Chosen:* keep off-technique variants as drift, with Warhol noting it. *Considered:* pure drift; re-prompting after a vision check.
6. **Spend that never reaches the ledger.** *Chosen:* `silver cost --reconcile` against OpenRouter's key usage. *Considered:* the budget reading real usage before each call; ignoring it.
7. **Screenshots per variant for Warhol.** *Chosen:* 1 (seed 1). *Considered:* 3 seeds per variant; 1, plus 3 for his picks.

New open questions go here as they come up.

## Open questions from the 2026-09-25 day shift (Phases 3b, 4 and 8)

1. **Install the daily schedule?** **Done 2026-09-25:** installed by the owner at 11:09 and loaded in launchd (`com.silver.shift`, daily at 09:00). `.env` holds the key, and a check with an empty environment (as launchd runs it) reached OpenRouter. The first unattended run is 2026-09-26 at 09:00. Everything is built. To start:
   - put `OPENROUTER_API_KEY=...` in `.env` (launchd doesn't see your shell's variables; today the key lives only in your shell),
   - then run `silver install-schedule`.

   It runs `silver shift` daily at `shift.at` (09:00) and spends real money within the $5 cap: about $0.30–0.60 a day at 2 series plus shortlists. If the Mac is asleep at 09:00, the shift runs on wake; if it's off, that day is skipped.
   - *Questions:* install now, or after a first real (non-dry-run) shift by hand? Is 09:00 right?

2. **Write your taste.** `taste.md` exists as a template (it appears on the first `silver review`). Warhol reads its header before every shortlist, together with your latest decisions. Until you write your likes and dislikes, he only has his own taste.

3. **An all-time reconcile gap of $0.38.** OpenRouter billed $0.92 on this key; the ledger holds $0.53. Known causes: my direct `curl` tests (under $0.10), one test in a throwaway folder, and three DeepSeek timeouts.
   - *Question:* was this key also used outside Silver this month? If so, the gap is expected, and a dedicated key for Silver would make `--reconcile` exact.

4. **Unshortlisted series from before Phase 4.** The shift only shortlists *today's* series, so the four earlier series (three real, one dry run) have no Warhol shortlist. `silver shortlist <id>` does them by hand, at about $0.06 each on Opus.
   - *Options:* (a) leave them; (b) shortlist the backlog once, by hand; (c) have the shift also shortlist any unlisted series from the last N days.
   - *Recommendation:* (b) now, then (a).

5. **Dry-run scouting posts real subjects.** A dry-run shift scouts with the cheap model, and its picks are real subject cards on the floor. The next real shift then skips scouting that day, because scouts run once a day. Dry-run series and shift ends are already kept separate.
   - *Options:* (a) keep it: they're real subjects, just picked by a cheaper Scout; (b) mark dry-run subjects so the real shift scouts anyway and the series picker ignores them.
   - *Recommendation:* (b) if you plan to dry-run often on days the real shift also runs.

6. **Node path in the schedule.** The plist pins the absolute path of the `node` binary that installed it (`/usr/local/bin/node` here). If you upgrade Node through a version manager and that path changes, re-run `silver install-schedule`. No decision needed; this is a note.
