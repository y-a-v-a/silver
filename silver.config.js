// Silver Factory configuration. Validated by src/config.js on load.
// Model slugs are OpenRouter ids: https://openrouter.ai/models
// A role file's frontmatter `model:` overrides models.roles for that role.

/** @type {import('./src/config.js').SilverConfig} */
export default {
  models: {
    // The Studio assistants' pool. A series spreads its variants across these,
    // so differences between providers become the drift (principle 2).
    // Re-cast on 2026-10-23 after a bake-off of 12 models on the new studio brief: the stronger
    // hands make stranger work. Out: Qwen 3.8 Flash and Gemini 3.8 Flash (timid), Sonnet 5
    // (Sonnet 5.5 at the same price). Not cast: Grok 4.7 (calls hung past the timeout), MiniMax
    // M3.1 Flash and Mistral Large 4 (pale or broken). GPT-6 Luna Pro stays: cheap and odd.
    studio: [
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-opus-5.5',
      'google/gemini-4-argon',
      'moonshotai/kimi-k3',
      'openai/gpt-6-luna-pro',
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
    // Fallbacks per model (decision 2026-09-25): OpenRouter moves down the list when a
    // provider fails or rate-limits (Qwen's upstream returned HTTP 429s on the superstars).
    fallbacks: {
      'qwen/qwen3.8-flash': ['google/gemini-3.8-flash'],
      'moonshotai/kimi-k3': ['google/gemini-3.8-flash'],
      'google/gemini-4-argon': ['google/gemini-3.8-flash'],
    },
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
    // After the shortlist, Warhol's first pick goes back to the hand that made it for a second
    // pull, pushed further (decision 2026-10-23). 0 turns it off; 2 or 3 pulls more picks.
    secondPulls: 1,
  },

  // The technique menu: procedures, not styles (decision 2026-10-23: no more Warhol pastiche).
  // Each value is the guidance injected into the assistant's prompt. The 1964 menu (grid-repeat,
  // halftone, misregistered silkscreen, camouflage, disaster tint, screen test) is retired.
  techniques: {
    'scratch-film':
      'A strip of black film emulsion scratched by hand with a needle: frames stacked vertically with sprocket holes at the edges, white and pale-tinted scratches cut into the black that jitter from frame to frame, dust, a hair, a frame line that slips. The subject survives only as scratched marks or letters that will not hold still.',
    'inkjet-failure':
      'An inkjet printer printing the subject and failing: horizontal banding where nozzles clog, one ink running out halfway down, the sheet slipping so the image shears and restarts, raw paper showing through. Mostly black ink, maybe one colour channel. The failure is the composition; make it large and cool.',
    'asemic-ledger':
      'Rows of handwriting that cannot be read: looping scrawl on ruled lines, columns, tally marks, crossings-out, in graphite or blue ballpoint on off-white. One or two legible fragments of the subject (a number, a word) surface in the scrawl. Obsessive and quiet.',
    'graphite-erasure':
      'Graphite scrawl on a big off-white field: looping lines, a word written over and over, crossed out and half rubbed away into grey smears, a drip or a smear of one colour. Most of the field stays empty. Nervous and lyrical.',
    'plotter-hatching':
      'A pen plotter drawing the subject with hatch and cross-hatch fields: thin lines in two or three inks, pen skips where the nib lifts, wobble, a blot where the pen rested, one pen running dry so its lines fade out. A precise machine with imperfect materials.',
    'compression-rot':
      "The subject as a poor image, re-saved a thousand times: 8x8 JPEG blocks, smeared chroma, posterised bands, ringing around edges, a stripe where the data broke and the rest slid sideways. Draw a source image into a small buffer, then degrade it once with block averaging and channel offsets. The decay is the beauty.",
    'molnar-disorder':
      'A strict system with a little disorder in it: a grid of squares, strokes or letters from the subject where a few per cent of the elements disobey (they rotate, wander, double or go missing), and the disorder slowly spreads. One or two colours. Exact and calm.',
    'xerox-generations':
      'A photocopy of a photocopy of a photocopy: toner speckle, crushed blacks, the page skewed with a dark shadow at its edge, the same image copied again and again, each generation darker, grainier and more abstract. Zine black on grey-white, maybe one colour copier accident.',
    'thermal-receipt':
      'The subject itemised on thermal paper: narrow monospace columns of items, quantities and totals taken literally from the subject, plus one line that should not be there. Grey print fading where the paper got warm, a curl, a torn edge, several slips overlapping on a dark surface.',
    'cut-up':
      "Cut the subject's own words (title, context, the floor's lines) into strips and reassemble them into new sentences, with scissors: torn paper strips on a ground, misaligned baselines, tape, small shadows, a few strips upside down. The new sentences should almost make sense.",
    'machine-vision':
      'What a machine sees: a dim, grainy surveillance still of the scene, overlaid with detection boxes, segmentation masks, keypoints and labels with confidence scores that misread it with total certainty. Thin cold lines, scan noise, one wrong label that is strangely right.',
    seismograph:
      'The subject as needle traces on a long paper strip: several pens (tremor, pulse, breath, or whatever the subject would register) twitching across a printed grid, spiking where the story spikes, with hurried annotations in pencil. Red and blue ink on pale green or buff paper.',
    'ink-bleed':
      'Ink dropped on wet paper: stains blooming outward with darker rims at the drying edge, tide marks, rings, a word of the subject bleeding into the fibres. Few colours, lots of water. Build each stain from many translucent layers; it may keep spreading slowly.',
    scratchboard:
      'A black surface scratched through to a coloured or white ground: dense hand-cut hatching, nervous outlines, a scratched-in word, the energy of a cheap engraving or a woodcut made with a nail. Lines taper and skid; some cuts go too far.',
    redaction:
      'A document about the subject, mostly redacted: black bars, white-out, a stamp, a few words left exposed that read as a different, stranger message. The bars are the composition: rhythm, weight, maybe gold or silver leaf in one place.',
    'spray-stencil':
      'Words or one number from the subject sprayed through a cut stencil: overspray haze, drips, stencil bridges breaking the letters, then partly rolled over and sprayed again in another colour. Pick the palette from the subject, never just black on white; crop the letters with the edge, or make them small and lost.',
    'fax-transmission':
      'A fax arriving: the image transmitted line by line from top to bottom, with dropped lines, stretched rows, thermal grey, a header line with a page count, and an error halfway down where the image slips sideways. It draws itself over time.',
    oscilloscope:
      'The subject traced by a single beam on a phosphor screen: green or amber glow, persistence trails, the beam never lifts so every shape is joined to the next, wobble and bloom. Dark and luminous; the drawing keeps re-tracing itself.',
    'type-sediment':
      "The subject's words and characters fall, pile and drift like sediment or snow: terminal or typewriter glyphs, overstrikes, a few characters stuck in mid-air, the pile slowly growing. Monospace, one or two colours on black or paper.",
    'pixel-sort':
      'Draw a source image of the subject into a buffer, then sort runs of pixels by brightness so it melts into streaks in one direction, leaving untouched islands where a threshold holds. Do the sort once, on a buffer. Melted, not destroyed.',
    rorschach:
      "A bilateral ink blot pressed from the subject: one dark ink on paper, mirrored down the centre, fibrous edges, splatter, a pale fold line; the subject's shape or one word hides in the symmetry. Clinical and strange.",
    decollage:
      'Torn street posters: layers of posters about the subject pasted over each other and ripped back, revealing fragments of older type and colour beneath, with white paper fibre along every tear. Brash colour, only in fragments.',
    'slime-growth':
      "Something grows over the subject: a slime mould, lichen or cellular automaton spreading from the subject's letters or shape, branching, leaving trails and slowly eating what it started from. Organic, slow, faintly repellent and beautiful.",
    cyanotype:
      "The subject as a photogram on light-sensitive paper: Prussian-blue ground, soft white silhouettes of objects from the story, light leaks, brush marks of the coating at the edges. A few objects, carefully placed.",
    'embroidery-reverse':
      'The back of an embroidery of the subject: tangled thread, knots, jump stitches carried across the cloth, satin-stitch letters reversed and half readable, on rough linen. You only see how it was made, not what it shows.',
    'screen-burn':
      'The subject burned into an old screen: the ghost of an interface or a notification that stayed on too long, stuck pixels, uneven backlight, faint colour cast, a few live pixels still flickering. Dim and melancholic.',
    'wrong-map':
      'The subject mapped as territory: contour lines, isobars or a transit diagram whose stations are words from the subject, printed from misregistered plates, with pencil corrections and a coffee ring. A map you could get lost in.',
    'long-exposure':
      'The subject moving through a long photographic exposure: light trails, motion smears, ghost doubles, everything solid dissolved into streaks; one thing held still and sharp. Night palette; build it up from many faint layers.',
    'x-ray':
      'The subject seen through an X-ray or ultrasound: inverted greyscale, soft inner structures, anything metal glowing white, a scan cone or film edge, measurement ticks and grain. Clinical and intimate.',
    'one-bit-dither':
      'Draw the subject small, then dither it to one bit (Floyd-Steinberg or Atkinson) and blow it up so every pixel shows, in two colours that do not belong together (oxblood on pink, lime on grey). Like a camera from a toy, or an old screen in a dark room.',
  },

  // The dare deck (decision 2026-10-23). Every variant in a series draws a different card, an
  // oblique constraint in the spirit of Eno and Schmidt's Oblique Strategies, so no two variants
  // are made from the same brief.
  dares: [
    'Leave four fifths of the canvas empty. The work happens in one place.',
    'One colour only, and it is the wrong one for this subject.',
    'Draw it from memory, badly; then draw it again on top, more carefully and slightly off.',
    'The subject appears only as a number.',
    'Make it look as if it was found in a drawer twenty years from now.',
    'It is enormous; we see only a fragment, cropped hard.',
    'Make it so quiet you have to lean in.',
    'Something is wrong with the paper.',
    'One element refuses the system everything else obeys.',
    'It is a weather report.',
    'Make it look like evidence that was never filed.',
    'Make it tender.',
    'Make it ugly first, then make the ugliness exact.',
    'Crop until it is almost abstract, then stop one step before.',
    'It has been folded into eight and unfolded.',
    'It slowly erases itself.',
    'There is an intruder in the picture.',
    'Lines only; no filled shapes.',
    'Filled shapes only; no lines.',
    'Black, off-white and one accident.',
    'It is lit from below, at night.',
    'Make it a diagram of a feeling.',
    'Count something, obsessively, and let the counting show.',
    'Leave a mistake in on purpose and put it at the centre.',
    'The words are too big to read.',
    'The words are too small to read.',
    'Something drips.',
    'It has been left out in the rain.',
    'Lower the resolution until it hurts, then a little more.',
    'Expensive and cheap at the same time.',
    'Everything is slightly too close together.',
    'Give it a ghost: a second, fainter version that lags behind.',
    'The subject is only its shadow.',
    'Work from the edges inward; the centre stays unfinished.',
    'Two things that should never touch are touching.',
    'It is a page torn from a notebook that belongs to someone else.',
    'Show the back of the work, not the front.',
    "Use the subject's own colours, then remove the most important one.",
    'It is seen through something: a screen door, a plastic bag, water, a dirty window.',
    'Make it as if a machine tried to redraw it from a description.',
    'A single gesture, repeated until it becomes a surface.',
    'Slow everything down. Nothing in it is in a hurry.',
    'Make it glow faintly, like something left on overnight.',
    'It is mostly texture. The subject is a disturbance in it.',
  ],

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
