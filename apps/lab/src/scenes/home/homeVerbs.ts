// Landing verbs — one effect per demo, phrased as a prompt for a coding agent.
// A sentence names the effect with {verb} and the visitor's component with
// {target}; the picker label and the highlighted word are the same verb.

export interface HomeVerb {
  verb: string
  demo: string
  sentence: string
  target: string
  /** Added to the copied prompt after the sentence the page shows. */
  detail: string
}

export const HOME_VERBS: readonly HomeVerb[] = [
  { verb: 'bend', demo: 'genie', sentence: 'Use Munari to {verb} my {target} into the dock when it minimizes.', target: 'settings window', detail: 'Keep its form working during the animation.' },
  { verb: 'throw', demo: 'flight', sentence: 'Use Munari to let me {verb} my {target} between columns.', target: 'task cards', detail: 'Cards should tilt and carry weight while I drag them.' },
  { verb: 'light', demo: 'light', sentence: 'Use Munari to {verb} my {target} with a lamp the visitor can drag.', target: 'landing page', detail: 'The headline should cast shadows on the page.' },
  { verb: 'dissolve', demo: 'plume', sentence: 'Use Munari to {verb} the text in my {target} into particles.', target: 'search field', detail: 'Start when I submit the search.' },
  { verb: 'refract', demo: 'selection', sentence: 'Use Munari to turn text selected in my {target} into glass that can {verb} the page.', target: 'article', detail: 'The glass should bend the page behind it.' },
  { verb: 'reflect', demo: 'marble-hand', sentence: 'Use Munari to {verb} my {target} in a chrome ball that replaces the cursor.', target: 'landing page', detail: 'The ball should reflect the page under it as it moves.' },
  { verb: 'press', demo: 'knobs', sentence: 'Use Munari to give my {target} controls that {verb} in.', target: 'settings panel', detail: 'Give the panel physical depth.' },
  { verb: 'write on', demo: 'postcard', sentence: 'Use Munari to turn my {target} into a postcard you can {verb} in 3D.', target: 'signup form', detail: 'It should tilt and stay fillable.' },
]

/** The skill path inside an installed package. */
export const SKILL_PATH = 'node_modules/@petepetrash/munari/.agents/skills/munari/SKILL.md'

/** The sentence split around its verb and target, in reading order. */
export function sentenceParts(entry: HomeVerb): { kind: 'text' | 'verb' | 'target'; text: string }[] {
  return entry.sentence.split(/(\{verb\}|\{target\})/).filter(Boolean).map((part) => {
    if (part === '{verb}') return { kind: 'verb', text: entry.verb }
    if (part === '{target}') return { kind: 'target', text: entry.target }
    return { kind: 'text', text: part }
  })
}

/** The full prompt a visitor copies, with their own component named. */
export function promptFor(entry: HomeVerb, target: string): string {
  const named = target.trim() || entry.target
  const sentence = entry.sentence.replace('{verb}', entry.verb).replace('{target}', named)
  return `Install @petepetrash/munari, three, @react-three/fiber, and @zumer/snapdom, with @types/three as a dev dependency. Then read ${SKILL_PATH} before writing any Munari code.\n\n${sentence} ${entry.detail}`
}
