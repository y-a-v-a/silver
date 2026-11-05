// What each role is handed at call time: every {{placeholder}} a role file may use, and what
// it holds. The code fills these in, so a placeholder outside this list would make the role
// fail on its next call: the editor refuses it. Keep this in step with the llm.call(...) vars
// in src/agents/ (test/souls.test.js checks the shipped role files against it).

const SUPERSTAR = {
  subjects: "the day's subjects, as numbered cards",
  floor: 'what people have said about them so far',
  pile: "the Scout's leftovers, on the days this superstar is shown them",
  lines: 'how many lines they may say (superstars.linesPerShift)',
};

export const ROLE_VARS = Object.freeze({
  scout: {
    today: "today's date",
    count: 'how many subjects to pick (shift.subjectsPerShift)',
    recent: 'subjects already on the floor recently',
    candidates: 'the numbered list pulled from the sources',
    archive_max: 'how many may come from the archive (shift.maxArchiveSubjectsPerShift)',
    direction: 'your note to the scouts (direction.md)',
  },
  'scout-annotate': {
    title: "the commission's title",
    url: 'its URL, or a note that there is none',
    human_why: 'your reason for commissioning it',
    text: 'the text of the page or commission',
  },
  'studio-assistant': {
    subject_title: "the subject's title",
    subject_why: 'why it is a ready-made',
    subject_image: "the Scout's proposed image",
    subject_context: 'text from the source',
    floor_excerpt: "the floor's chatter about this subject",
    brief: 'one line from the floor to take literally (dealt per variant)',
    technique: "the procedure's name (dealt per variant)",
    technique_guidance: "the procedure's guidance",
    dare: 'a card from the dare deck (dealt per variant)',
    direction: 'your note to the studio (direction.md), plus any note on this series',
    width: 'canvas width in pixels',
    height: 'canvas height in pixels',
    ready_frames: 'the frame the screenshot is taken at',
  },
  'second-pull': {
    warhol_note: 'what Warhol said about the work',
    human_note: 'what you asked for when sending it back',
    first_brief: 'the whole brief it was first made from',
    ready_frames: 'the frame the screenshot is taken at',
  },
  warhol: {
    subject: 'the subject, with the notes on it',
    chatter: 'what the floor said',
    taste: 'taste.md: your words and your latest decisions',
    direction: 'your note to Warhol (direction.md)',
    variants: 'the list of variants, in image order',
    max_picks: 'how many he may pick',
  },
  printer: {
    work: 'the work being printed',
    run: 'what happened when it ran',
    hold: 'what happened after the hold',
  },
  'fred-hughes': {
    edition: 'the edition number',
    work: 'the facts about the work',
    taken: 'titles already used in this series',
  },
  archivist: {
    date: 'the date, written out',
    notes: 'the day on the floor, as plain notes',
  },
  technician: {
    tool: 'the tool being released',
    about: 'what the tool is',
    changes: 'what changed',
  },
});

/** The variables a role gets: its own entry, or the shared superstar set. */
export function varsFor(id, group) {
  return group === 'superstar' ? SUPERSTAR : (ROLE_VARS[id] ?? null);
}

/**
 * Why a setting isn't in the editor. The code relies on these staying as they are.
 */
export const LOCKED_FIELDS = Object.freeze({
  id: 'matches the file name; the code calls the role by it',
  output: 'the code that reads the reply expects this format',
  vision: 'whether the code sends this role images',
  model_role: 'runs on the model of another role',
  reads: 'documents which events it reads',
  emits: 'documents which events it writes',
});
