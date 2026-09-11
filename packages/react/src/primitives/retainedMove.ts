// Retained move — relocating live content without losing what the browser
// was holding for it.
//
// `Element.moveBefore` relocates a node without removing it first, so focus,
// scroll offsets, iframes, media and running animations all survive the trip.
// Safari has not shipped it, and there a plain `insertBefore` is a remove and
// an insert. Measured 2026-09-11 across Chromium, Firefox and WebKit, an
// insert-based reparent loses exactly four things: focus, every scroll offset
// in the subtree, an iframe's document, and the progress of a running CSS
// animation. Input values, canvas pixels, `<details>` state and listeners all
// survive either way.
//
// Three of those four are put back here. The fourth never arrives: content
// holding an iframe, video or audio is refused before a Surface will hand it
// off at all (`unsupportedSnapshot`), which leaves a running CSS animation as
// the one thing a browser without `moveBefore` cannot keep — and a
// compositor-only animation is already a still frame under snapDOM
// (platform.md #22), so what loses motion here had already lost it.
//
// Without this, a Surface simply refused to enter WebGL wherever `moveBefore`
// was missing, which cost Safari every scene rather than one property of one.
//
// Ownership: this module owns the relocation and the state carried across it.
// Callers own what moves where.

/**
 * Whether this browser can relocate a node without taking it out of the tree.
 *
 * Read per call and through `globalThis`, not once at module scope: this
 * module is imported on a server, where naming `Element` is a ReferenceError.
 */
const movesInPlace = () => 'Element' in globalThis && 'moveBefore' in Element.prototype

interface HeldState {
  readonly active: HTMLElement | null
  readonly selection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null
  readonly scrolls: readonly (readonly [Element, number, number])[]
}

function hold(root: HTMLElement): HeldState {
  const focused = root.ownerDocument.activeElement
  const active = focused instanceof HTMLElement && root.contains(focused) ? focused : null
  let selection: HeldState['selection'] = null
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    // Null on an input whose type has no text cursor — `checkbox`, `color`,
    // `range`. Reading it is safe on all of them; `setSelectionRange` is not,
    // so the null is what keeps the restore off those types.
    const start = active.selectionStart
    const end = active.selectionEnd
    if (start !== null && end !== null)
      selection = { start, end, direction: active.selectionDirection ?? 'none' }
  }
  const scrolls: (readonly [Element, number, number])[] = []
  for (const element of [root, ...root.querySelectorAll('*')])
    if (element.scrollTop !== 0 || element.scrollLeft !== 0)
      scrolls.push([element, element.scrollTop, element.scrollLeft] as const)
  return { active, selection, scrolls }
}

function restore(held: HeldState): void {
  for (const [element, top, left] of held.scrolls) {
    element.scrollTop = top
    element.scrollLeft = left
  }
  const { active, selection } = held
  if (!active) return
  // `preventScroll`, or focusing scrolls every new ancestor to bring the
  // element into view and undoes the offsets just put back.
  active.focus({ preventScroll: true })
  if (selection && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement))
    active.setSelectionRange(selection.start, selection.end, selection.direction)
}

/**
 * Move `node` to `parent`, keeping the state the move would otherwise drop.
 *
 * Where `moveBefore` exists this IS `moveBefore` and costs nothing. Where it
 * does not, the subtree is walked once for scroll offsets — a handoff happens
 * at a phase boundary, not per frame, so that walk is affordable where a
 * per-frame one would not be.
 */
export function moveRetained(
  node: HTMLElement,
  parent: HTMLElement,
  before: ChildNode | null = null,
): void {
  if (movesInPlace() && node.isConnected && parent.isConnected) {
    parent.moveBefore(node, before)
    return
  }
  const held = hold(node)
  parent.insertBefore(node, before)
  restore(held)
}
