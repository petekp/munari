// Example descriptions — one vocabulary for navigation, previews, and guides.
// The source reference matches the development API shown on this site.

export const SOURCE_ROOT = 'https://github.com/petekp/munari'
export const SOURCE_REF = 'c9dc2f359ca253b9031b60e079f5ff2272053fdd'
export const GUIDE_URL = `${SOURCE_ROOT}/blob/${SOURCE_REF}/README.md#your-first-surface`
export const SOURCE_ARCHIVE = `${SOURCE_ROOT}/archive/${SOURCE_REF}.zip`
export const BROWSER_GUIDE = 'https://developer.chrome.com/blog/html-in-canvas-origin-trial'

/** The wash the shell wears for the overview. Each example names its own. */
export const HOME_WASH = '#e3ec5a'

export const EXAMPLES = [
  {
    id: 'flight', title: 'Flight', category: 'Interaction', wash: '#f2695c',
    headline: 'Drag and drop with weight',
    description: 'HTML cards bend, move between columns, and crumple when you delete them.',
    instruction: 'Drag a card by its title. Try a quick flick, or hold its × button to crumple it.',
    takeaway: 'The page supplies the content. The scene adds the shape and motion.',
  },
  {
    id: 'genie', title: 'Genie', category: 'Motion', wash: '#52c7f2',
    headline: 'A window that can bend',
    description: 'Minimize live content into a dock, then reverse the motion with your pointer.',
    instruction: 'Minimize a window, or drag its title toward the dock. Try reversing direction before it arrives.',
    takeaway: 'Content can change shape while its controls and video continue to work.',
  },
  {
    id: 'knobs', title: 'Knobs', category: 'Controls', wash: '#f5a53f',
    headline: 'Give controls a physical form',
    description: 'A responsive HTML interface becomes a panel with depth, lighting, and tactile controls.',
    instruction: 'Turn a dial, switch the power, and resize the panel with its corner handle.',
    takeaway: 'DOM layout and 3D controls can stay aligned as the interface changes size.',
  },
  {
    id: 'selection', title: 'Selection', category: 'Text', wash: '#f07ff0',
    headline: 'Make something from a selection',
    description: 'Selected lines of native text become pieces of glass in the scene.',
    instruction: 'Drag across a few words to select them. Extend the selection across several lines, then click elsewhere to clear it.',
    takeaway: 'The browser handles text selection; the scene works with its rendered pixels.',
  },
  {
    id: 'marble-hand', title: 'Marble hand', category: 'Materials', wash: '#66c94e',
    headline: 'A cursor that reflects the page',
    description: 'Move a sculpted hand across live typography and changing backgrounds.',
    instruction: 'Move your pointer across the page. Change the background and inspect the hand’s reflection.',
    takeaway: 'A live DOM texture can supply a material without replacing the visible page.',
  },
  {
    id: 'plume', title: 'Plume', category: 'Particles', wash: '#f76fa2',
    headline: 'Let your words become particles',
    description: 'Type into a real text field and watch the rendered letters dissolve into the air.',
    instruction: 'Type a phrase, then pause. Open “Tweak Plume” to explore the timing and particle behavior.',
    takeaway: 'Native text editing can supply the shapes and colors for a particle effect.',
  },
  {
    id: 'logo', title: 'Logo', category: 'Typography', wash: '#b47deb',
    headline: 'Typography with another dimension',
    description: 'The same letterforms appear as page typography and animated 3D objects.',
    instruction: 'Switch between HTML and WebGL, then try the shape and motion controls.',
    takeaway: 'Materials and geometry can change the appearance of text drawn from the DOM.',
  },
] as const

export const FEATURED_EXAMPLES = EXAMPLES.filter((example) => example.id !== 'logo')

export function exampleFor(id: string) {
  return EXAMPLES.find((example) => example.id === id)
}

/** The shell's wash for a scene: the example's own, or the overview's. */
export function washFor(id: string): string {
  return exampleFor(id)?.wash ?? HOME_WASH
}

export function sourceFor(id: string): string {
  return `${SOURCE_ROOT}/tree/${SOURCE_REF}/apps/lab/src/scenes/${id}`
}
