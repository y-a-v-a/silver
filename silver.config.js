// Silver Factory configuration. Validated by src/config.js on load.
// Model slugs are OpenRouter ids: https://openrouter.ai/models
// A role file's frontmatter `model:` overrides models.roles for that role.

/** @type {import('./src/config.js').SilverConfig} */
export default {
  models: {
    // The Studio assistants' pool. A series spreads its variants across these,
    // so differences between providers become the drift (principle 2).
    studio: [
      'anthropic/claude-sonnet-5',
      'google/gemini-3.8-flash',
      'openai/gpt-6-luna-pro',
      'qwen/qwen3.8-flash', // replaced deepseek-v4.1-flash (2/12 produced), decision 2026-09-25
    ],
    // Default model per role.
    roles: {
      scout: 'google/gemini-3.8-flash',
      superstar: 'qwen/qwen3.8-flash', // cheap: chatter is noise by design
      warhol: 'anthropic/claude-opus-5.5', // must accept images
      printer: 'google/gemini-3.8-flash', // must accept images
      'fred-hughes': 'anthropic/claude-sonnet-5',
      archivist: 'anthropic/claude-sonnet-5',
      technician: 'anthropic/claude-sonnet-5',
    },
    // Used by `silver shift --dry-run` for every role.
    dryRun: 'qwen/qwen3.8-flash',
  },

  budget: {
    dailyUsd: 5, // hard cap; env SILVER_BUDGET_DAILY_USD overrides
    // Share of the daily cap that chatter may use, so superstars can't starve the studio.
    chatterShare: 0.1,
  },

  series: {
    variants: 12, // 3 models x 2 temperatures x 2 techniques
    modelsPerSeries: 3, // sampled from models.studio
    temperatures: [0.7, 1.1],
    techniquesPerSeries: 2, // sampled from the techniques menu below
    concurrency: 4,
  },

  // The technique menu. Each value is one line of guidance injected into the assistant's prompt.
  techniques: {
    'grid-repeat':
      'Repeat one image in a rigid grid; vary each cell slightly (colour, offset, fade), the way a silkscreen varies across a sheet.',
    'misregistered-silkscreen':
      'Build it from flat colour layers plus a black key layer printed slightly out of register; let the offset show.',
    halftone:
      'Reduce the subject to a coarse halftone dot screen; dot size carries the tone, and the dots should be visible.',
    camouflage:
      'Cover the canvas in interlocking organic camouflage blobs, in unnatural flat colours, animated so they drift slowly.',
    'death-and-disaster-tint':
      'Repeat a banal image under one monochrome tint (silver, orange, lavender); the colour does the emotional work.',
    'screen-test-portrait':
      'A static frontal "portrait" held for a long time; almost nothing moves except flicker, grain and tiny blinks.',
  },

  shift: {
    at: '09:00', // local time, used by the launchd plist
    subjectsPerShift: 6,
    seriesPerShift: 2,
    maxArchiveSubjectsPerShift: 1,
  },

  sources: {
    rss: [
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
      'https://www.theguardian.com/world/rss',
      'https://feeds.nos.nl/nosnieuwsalgemeen',
    ],
    trending: {
      googleTrendsGeo: 'US',
      hackernews: true,
      reddit: true,
    },
    itemsPerSource: 20,
    // A scouted subject may come back after this many days (decision 2026-09-24).
    // Commissions may always repeat.
    repeatAfterDays: 7,
  },

  review: {
    port: 4747, // env SILVER_REVIEW_PORT overrides
    tasteEntriesInPrompt: 40,
  },

  deploy: {
    provider: 'vercel', // deploys paths.site
    project: 'silver-factory', // Vercel project name
    siteUrl: null, // public URL once known, e.g. 'https://silver-factory.vercel.app' (absolute links in the feed)
  },

  printer: {
    // The print check runs each work this long after its ready frame and looks again
    // (plan: 60s; 10s keeps a 20-work print run at a few minutes).
    holdSeconds: 10,
  },

  // Relative to the repository root.
  // Phase 6: cast talent on the floor. Chatter runs on models.roles.superstar and is capped
  // by budget.chatterShare.
  superstars: {
    linesPerShift: 3, // at most this many chatter lines per superstar per shift
    proposeChance: 0.34, // chance that one superstar gets the Scout's leftovers and may propose a subject
    pileSize: 8, // how many of the Scout's leftovers that superstar sees
  },

  paths: {
    roles: 'roles',
    floor: 'floor',
    archive: 'archive',
    canon: 'canon',
    site: 'site',
    taste: 'taste.md',
  },
};
