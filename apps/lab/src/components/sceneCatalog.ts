// Demo catalog — the one list of demos the site advertises, in the order it
// shows them. The overview's index and stage, the demo bar's previous and
// next links, and App's routes all read it, so a new demo is one entry here,
// one page in App's DEMO_PAGES (typecheck fails until it exists), and a
// thumbnail at public/thumbs/<id>.jpg (`npm run thumbs`).
// Source links follow main rather than a pinned commit, so they track the current API.

export const SOURCE_ROOT = 'https://github.com/petekp/munari'
export const SOURCE_REF = 'main'
export const GUIDE_URL = `${SOURCE_ROOT}/blob/${SOURCE_REF}/README.md#your-first-surface`
export const BROWSER_GUIDE = 'https://developer.chrome.com/blog/html-in-canvas-origin-trial'

export interface Demo {
  /** The `?scene=` value and the folder under apps/lab/src/scenes. */
  id: string
  title: string
  /** What the demo shows, as a short phrase under its thumbnail. */
  headline: string
  /** What to try first, shown beside the running demo. */
  instruction: string
}

export const DEMOS = [
  {
    id: 'genie', title: 'Genie',
    headline: 'A window that can bend',
    instruction: 'Minimize a window, or drag its title toward the dock. Try reversing direction before it arrives.',
  },
  {
    id: 'flight', title: 'Flight',
    headline: 'Drag and drop with weight',
    instruction: 'Drag a card by its title. Try a quick flick, or hold its × button to crumple it.',
  },
  {
    id: 'light', title: 'Light',
    headline: 'A lamp over live HTML',
    instruction: 'Drag the bulb. Change its distance from the page, then select a word to raise its shadow.',
  },
  {
    id: 'plume', title: 'Plume',
    headline: 'Words that become particles',
    instruction: 'Type a phrase, then pause.',
  },
  {
    id: 'selection', title: 'Selection',
    headline: 'Glass made from a text selection',
    instruction: 'Drag across a few words to select them. Extend the selection across several lines, then click elsewhere to clear it.',
  },
  {
    id: 'marble-hand', title: 'Marble hand',
    headline: 'A cursor that reflects the page',
    instruction: 'Move your pointer across the page. Change the background and watch the hand’s reflection.',
  },
  {
    id: 'knobs', title: 'Knobs',
    headline: 'Controls with a physical form',
    instruction: 'Turn a dial, switch the power, drag the panel’s corner to resize it, and drag its top edge to move it.',
  },
  {
    id: 'postcard', title: 'Postcard',
    headline: 'A form printed on paper',
    instruction: 'Type your name, then lift the postcard. Add a stamp or brush a corner while it floats.',
  },
  {
    id: 'logo', title: 'Logo',
    headline: 'Letters that move between page and 3D',
    instruction: 'Switch between HTML and 3D, then try the shape and motion controls.',
  },
] as const satisfies readonly Demo[]

export type DemoId = (typeof DEMOS)[number]['id']

export function demoFor(id: string): Demo | undefined {
  return DEMOS.find((demo) => demo.id === id)
}

export function sourceFor(id: string): string {
  return `${SOURCE_ROOT}/tree/${SOURCE_REF}/apps/lab/src/scenes/${id}`
}
