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
reasoning: low                      # optional: off | low | medium | high
---

You are Andy Warhol at the Factory. You did not make these; your assistants did.
Your job is to choose. ...

## Output
Return JSON: { "picks": [{ "variant_id": "...", "note": "..." }], "rejects_note": "..." }
```

Rules:
- `roles.js` validates the frontmatter and fails loudly if a field is missing or unknown.
- `model_role: <role>` (optional) makes a role use another role's config model, e.g. `roles/scout-annotate.md` runs on the Scout's model. It is exclusive with `model`.
- Reasoning tokens count against `max_tokens`. A reasoning model can spend all of them thinking and return an empty reply, so set `reasoning` (use `off` for chatter) and leave enough headroom.
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
- [x] `silver commission "<text | URL>" [--now]`: emits `subject.posted` with `origin: commission`. Commissions **always get a series** in the next shift, ahead of scouted subjects. `--now` runs a mini-shift for just that subject. **Partly done:** `--now` needs the studio (Phase 3), so for now it queues and says so. Once built, it runs chatter + series + shortlist (see Phase 8). Also added `--why <note>` and `--list` (commissions still waiting for a series).
- [x] `silver scout`: runs the scouts on their own (useful for tuning). Options: `--count`, `--source`, `--list` (no model call), `--no-snapshot`, `--dry-run`, `--json`.

**Done when:** `silver scout` posts ~6 subject cards to the floor, each showing a "why it's a ready-made" line that makes sense. ✅ The first live run on 2026-09-24 posted 6 cards for $0.0086. Its notes embellished facts, which led to the facts-only rule; the rerun stayed factual.

## Phase 2b: follow-ups from the 2026-09-24 decisions

- [x] **Sensitive subjects:** add the exclusion rule to `roles/scout.md` (no suicide, no children, no named private victims), plus a `sensitive: {flag, reason}` field per pick. `validatePicks` carries it onto the subject card (`payload.sensitive`).
- [x] **Repeat window:** add `sources.repeatAfterDays: 7` to the config (validated). Dedupe against the floor only looks at subjects posted within the window, and the Scout's "recent subjects" list uses the same window.
- [x] **Scout annotates commissions:** after `postCommission`, one Scout call (a small prompt section in `roles/scout.md`, or a separate `roles/scout-annotate.md`) adds `scoutWhy` and `image`. The human's `why` is never overwritten. A failed call leaves the commission as it is and is recorded as `llm.failed`. `--no-annotate` skips it.
- [ ] **Licence:** add `LICENSE` (MIT, code) and `LICENSE-ARTWORKS.md` (CC BY 4.0, works), set `"license": "MIT"` in `package.json`, and add a README section.

## Phase 3: Technician tools and Studio assistants

- [x] Write `roles/technician.md` (done in Phase 1). It is used in v1 only for its voice: when a template changes, the human runs `silver release <tool>` and the Technician writes the release note as a `tool.released` event.
- [ ] `tools/p5-template.html`: a single file that loads p5 from a pinned CDN version with an injected `// SKETCH` block
  - [ ] Seeds from `?seed=` (`randomSeed` + `noiseSeed`), so screenshots are reproducible while a normal load still drifts
  - [ ] Fixed canvas size (e.g. 1080×1080), with a `window.__silverReady` flag set after N frames
  - [ ] Embeds the title and subject as a comment/metadata, with no visible UI chrome
- [ ] `tools/render.js` (Playwright):
  - [ ] Loads the sketch, collects console errors, waits for `__silverReady` or a timeout
  - [ ] Takes a screenshot at seed 1 (and optionally seeds 2 and 3, for a small grid)
  - [ ] Blank-canvas check: near-uniform pixels count as a failure
  - [ ] Emits `variant.failed` on error or blank output, otherwise returns the PNG path
- [ ] Write `roles/studio-assistant.md` (Malanga/Smith): turn a subject into a p5 sketch in a given **technique**; serial repetition, silkscreen logic (flat colour fields, registration offset, grids of repeats, photo-to-halftone); output only the sketch body.
- [x] A technique menu in config, e.g. `grid-repeat`, `misregistered-silkscreen`, `halftone`, `camouflage`, `death-and-disaster-tint`, `screen-test-portrait`. Each is one line of guidance injected into the prompt. (Done in Phase 0: the top-level `techniques` map in `silver.config.js`.)
- [ ] `agents/assistants.js`: for each subject selected in this shift → `series.started` → run the 12-cell matrix (models × temperatures × techniques) in parallel, with a concurrency limit → write to `archive/variants/<series>/<variant>.html` → render → `variant.produced` / `variant.failed` → `series.completed` with a generated contact sheet
- [ ] **Keep the drift:** assistants do not get to see each other's variants within a series. Each one gets the subject plus the recent floor chatter only.

**Done when:** `silver series <subject-id>` produces a folder of 12 sketches with screenshots, and broken ones are recorded rather than dropped.

## Phase 4: Warhol and the contact sheet (veto)

- [ ] `taste.md`: starts with a short hand-written header of what the human likes and dislikes. After that it is append-only: one entry per human decision, with date, variant, verdict, and note.
- [ ] Write `roles/warhol.md`: terse, flat, deadpan; chooses the piece, never makes it; judges *seriality and surface*, not effort. Its `{{taste}}` placeholder receives the last N entries of `taste.md`. Output: 1–3 picks per series with a one-line note each, plus a note for the rejects.
- [ ] `agents/warhol.js`: on `series.completed`, sends the screenshots (vision) and the sketch metadata (not the full code, which would bias it toward code quality) → `shortlist.proposed`
- [ ] `tools/contact-sheet/`: a small `node:http` server, with no framework
  - [ ] `silver review` starts it on `localhost:4747` and opens the browser
  - [ ] One page per series: a grid of **live** sketches in iframes, with Warhol's picks highlighted and his notes shown
  - [ ] The Floor chatter for that subject is shown in a side column
  - [ ] Each pick has Approve / Veto and an optional note field. Posting a decision emits `review.decision` and appends to `taste.md`.
  - [ ] The human may also approve a variant Warhol did **not** pick (the veto works both ways)
  - [ ] Pending reviews persist across shifts until they are decided
  - [ ] Subjects with `payload.sensitive.flag` show a visible warning and the reason (decision 2026-09-24)
  - [ ] Real people's likenesses are judged here, case by case: no automated rule (decision 2026-09-24)
- [ ] Rejected and vetoed variants stay in `archive/`, since nothing is ever deleted

**Done when:** after a shift, `silver review` shows Warhol's shortlist, and approving one emits the decision and grows `taste.md`.

## Phase 5: Printer, Fred Hughes, Vercel

- [ ] Write `roles/printer.md`. The Printer is mostly code; the LLM is used only for a final "print check" (does the sketch hold up at full size, and does it run for more than 60s without degrading?). It may send the piece back as a floor event, but it cannot un-sign it.
- [ ] `agents/printer.js`, run on `review.decision: approved`:
  - [ ] Copies the sketch to `canon/works/<canon-id>/`, removes the dev seed so the published piece drifts on every load
  - [ ] Renders a poster PNG (fixed seed) for thumbnails and OG images
  - [ ] **Signature:** sha256 of the sketch source + Warhol's note + the human approval event id, stored in `canon.json`
  - [ ] Emits `work.published`
- [ ] Write `roles/fred-hughes.md`: the business side: a title (Warhol-flat: "Silver Car Crash (Double Disaster)"-style), short wall text, edition number. **Always in English**, also for Dutch subjects, and wall text quotes at most a headline, never article text.
- [ ] `agents/hughes.js`: assigns sequential edition numbers, writes the wall text, regenerates the site, emits `edition.released`
- [ ] Static site generator `src/site.js` → `site/`:
  - [ ] `index.html`: the canon as a grid of posters, newest first
  - [ ] `works/<id>/`: the live sketch, full-bleed, with wall text below
  - [ ] `feed.xml`: an Atom feed of the editions
  - [ ] A CC BY 4.0 notice on every work page and in the feed (decision 2026-09-24)
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

## Phase 8: the daily shift and launchd

- [ ] `src/shift.js`: `shift.started` → scouts → superstars → pick subjects (commissions first, then scouted) → assistants (N series) → Warhol shortlists → archivist → `shift.ended`
  - [ ] Commissions fill the `seriesPerShift` slots first, oldest first. The rest wait for the next shift (decision 2026-09-24).
  - [ ] `silver commission --now` runs a mini-shift for one subject: superstar chatter → series → Warhol shortlist (decision 2026-09-24)
  - [ ] Idempotent per date: running it twice on one day continues the shift without duplicating it
  - [ ] Stops cleanly on `BudgetExhausted` and records the reason
  - [ ] Printing happens **outside** the shift, at the moment of human approval, because the veto is async
- [ ] `silver shift [--dry-run]`: dry-run uses the cheapest model and 2 variants
- [ ] A macOS notification at the end of a shift (`osascript -e 'display notification …'`) saying "N series waiting for review"
- [ ] `launchd/com.silver.shift.plist`: `StartCalendarInterval` (e.g. 09:00), absolute paths to `node` and the repo, and logs to `archive/logs/`
- [ ] `silver install-schedule`: copies the plist to `~/Library/LaunchAgents/` and runs `launchctl bootstrap`. `silver uninstall-schedule` reverses it.
- [ ] Document that if the Mac is asleep at the scheduled time, launchd runs the job on wake

**Done when:** the Mac runs a shift unattended overnight, the notification appears, and the review → publish flow works the next morning.

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

New open questions go here as they come up.
