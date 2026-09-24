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
      'deepseek/deepseek-v4.1-flash',
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
  },

  review: {
    port: 4747, // env SILVER_REVIEW_PORT overrides
    tasteEntriesInPrompt: 40,
  },

  deploy: {
    provider: 'vercel', // deploys paths.site
  },

  // Relative to the repository root.
  paths: {
    roles: 'roles',
    floor: 'floor',
    archive: 'archive',
    canon: 'canon',
    site: 'site',
    taste: 'taste.md',
  },
};
