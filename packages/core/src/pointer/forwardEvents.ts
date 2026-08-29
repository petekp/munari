// Input forwarding: map a hit on a 3D surface back into the live DOM subtree
// that the surface's texture is rasterized from.
//
// The pipeline: r3f raycast gives us the intersection UV → we scale that to
// pixel coordinates inside the source element → walk the (real, laid-out)
// subtree with getBoundingClientRect to find the deepest element under the
// point → dispatch synthetic pointer events there and manage focus.
//
// Because the source subtree is REAL DOM parked behind the WebGL canvas, the
// browser does the rest for free: :hover/:focus styles repaint into the
// texture, and once an input is focused, native keystrokes type into it with
// no forwarding needed at all (we just stop the canvas from stealing focus).

import { relay } from './relay'

const FOCUSABLE = 'input, textarea, select, button, [tabindex], [contenteditable]'

/**
 * Deepest descendant of `root` that accepts the pointer at (x, y) — or null,
 * when nothing there does.
 *
 * `pointer-events` is honoured for the same reason the browser honours it: a
 * Surface is a slab of glass, and it is clear everywhere its DOM declined to
 * paint. A floating layer is the worked example — a full-size container
 * standing in front of its panel, `pointer-events: none`, holding a popover
 * that sets `auto`. Without this, the slab caught every ray the moment it went
 * live and the panel behind it went dead (see Surface's `hitTest="content"`).
 *
 * `none` is not a wall: a descendant may set `auto` and be hittable inside a
 * transparent ancestor — that is precisely the portal-container idiom. So the
 * walk descends through transparent elements and only refuses to *land* on
 * them.
 *
 * Note this reads the *computed* value, which is inherited. The parking canvas
 * is `pointer-events: none`, so createDomTextureSource re-roots the cascade on
 * the source element; without that every element here would read as clear.
 */
export function deepestElementAt(root: Element, x: number, y: number): Element | null {
  // The browser's own hit test first: document.elementsFromPoint returns the
  // real paint-order stack — z-index and stacking contexts resolved, with
  // pointer-events, visibility and zero-size handled natively — and it DOES
  // see parked canvas-fallback subtrees (measured, Chrome 150). The geometric
  // walk below can only see DOM order, which paint order is allowed to
  // contradict: measured — a sonner toast (z 999999999, FIRST
  // child of the chrome layer) painted above the dialog overlay (z 50, later
  // sibling), and the walk handed the pointer to the overlay underneath the
  // visible toast. Every parked source shares the viewport origin, so the
  // stack holds elements of every overlapping source — filtering to `root`
  // keeps our own subtree's order intact.
  //
  // The browser can only answer inside the visual viewport (elementsFromPoint
  // clamps), and a layoutless environment answers with nothing useful — both
  // fall through to the walk. When the stack is real but holds nothing of
  // this root, the walk agrees by construction (nothing hittable paints
  // there), so falling through is also the null verdict, just derived twice.
  const doc = root.ownerDocument
  const view = doc.defaultView
  if (
    'elementsFromPoint' in doc &&
    view &&
    x >= 0 &&
    y >= 0 &&
    x < view.innerWidth &&
    y < view.innerHeight
  ) {
    const stack = doc.elementsFromPoint(x, y)
    if (stack.length > 0) {
      for (const el of stack) if (root.contains(el)) return el
      return null
    }
  }
  let best: Element | null = null
  const walk = (node: Element) => {
    const r = node.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
    // Later siblings win ties, as in paint order; depth wins over breadth.
    if (getComputedStyle(node).pointerEvents !== 'none') best = node
    for (const child of Array.from(node.children)) walk(child)
  }
  walk(root)
  return best
}

// ---- focus modality mirroring -------------------------------------------
//
// `:focus-visible` is not a state, it is a *verdict*: the browser decides
// whether the focus that just landed deserves a visible ring, and it decides
// by asking how the user last interacted — keyboard shows the ring, pointer
// does not (unless the element takes keyboard input, which always earns it).
// The heuristic is fed exclusively by TRUSTED events. Everything the
// forwarder dispatches is synthetic, so the browser never hears our pointer
// story, and any script focus that follows a forwarded click — our own fixup
// below, or a library's autofocus (Radix FocusScope focuses the first
// tabbable of every popover it opens) — is judged as if the user had been
// tabbing. Measured 2026-08-01: every pointer-opened popover materialized a
// focus ring a real page would not show, and with shadcn's `transition-all`
// on the button, paid ~18 paints of ring fade during its entrance transition.
//
// Same doctrine as the boundary protocol above: the forwarder is the only
// thing that knows the pointer's real story, so whatever it declines to say,
// nothing downstream can reconstruct. It mirrors the verdict the browser
// would have reached onto `data-pointer-focus`, and the consumer's
// `focus-visible` variant excludes it:
//
//   @custom-variant focus-visible (&:focus-visible:not([data-pointer-focus]));
//
// Keyboard is tracked from real keydowns (which ARE trusted and also reach
// the heuristic — that direction was never broken) so a Tab after a click
// re-earns the ring on the next focus, exactly as on a page.

const POINTER_FOCUS_ATTR = 'data-pointer-focus'

/**
 * The browser's own carve-out: an element that supports keyboard input shows
 * its focus ring however focus arrived — click into a text field and the ring
 * is correct, not noise. Only button-like things get stamped.
 */
function ringSuppressible(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return false
  if (el instanceof HTMLElement && el.isContentEditable) return false
  if (el instanceof HTMLInputElement) {
    return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(el.type)
  }
  return true
}

/** What the user last did, as far as any parked subtree can know. Starts as
 * 'keyboard' because that is the browser's posture before any interaction —
 * an autofocus on a freshly loaded page shows its ring. */
let modality: 'pointer' | 'keyboard' = 'keyboard'

const isModifier = (key: string) =>
  key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'

const onModalityKeydown = (e: KeyboardEvent) => {
  // Voice stance: trusted by vocabulary — the library relays no
  // keyboard (typing through a surface is real focus and real keys),
  // so every keydown heard here is the user's.
  // Modifier chords are how pointer users invoke shortcuts mid-gesture; the
  // browser's heuristic ignores them and so do we.
  if (!isModifier(e.key)) modality = 'keyboard'
}
const onModalityFocusIn = (e: FocusEvent) => {
  const el = e.target
  if (!(el instanceof HTMLElement)) return
  if (modality === 'pointer' && ringSuppressible(el)) {
    el.setAttribute(POINTER_FOCUS_ATTR, '')
  } else {
    el.removeAttribute(POINTER_FOCUS_ATTR)
  }
}
const onModalityFocusOut = (e: FocusEvent) => {
  const el = e.target
  if (el instanceof HTMLElement) el.removeAttribute(POINTER_FOCUS_ATTR)
}

/**
 * One shared document-level install: the first caller installs, the last
 * release tears down, and a release called twice counts once. `install`
 * returns the teardown.
 */
function refCounted(install: () => () => void): () => () => void {
  let refs = 0
  let teardown: (() => void) | null = null
  return () => {
    if (refs++ === 0) teardown = install()
    let released = false
    return () => {
      if (released) return
      released = true
      if (--refs === 0) {
        teardown?.()
        teardown = null
      }
    }
  }
}

/**
 * Install the document-level half of the mirror (keydown resets to keyboard;
 * focusin stamps, focusout cleans). Reference-counted: every Surface calls
 * this, one set of listeners serves them all. Returns a release.
 *
 * keydown listens on CAPTURE so a handler that stops propagation (FocusScene
 * claims Tab and arrows at the document) cannot hide a keyboard interaction
 * from the mirror.
 */
export const trackFocusModality: () => () => void = refCounted(() => {
  document.addEventListener('keydown', onModalityKeydown, true)
  document.addEventListener('focusin', onModalityFocusIn)
  document.addEventListener('focusout', onModalityFocusOut)
  return () => {
    document.removeEventListener('keydown', onModalityKeydown, true)
    document.removeEventListener('focusin', onModalityFocusIn)
    document.removeEventListener('focusout', onModalityFocusOut)
  }
})

// ---- hover / active mirroring -------------------------------------------
//
// :hover and :active are set by the browser's REAL hit-testing, which never
// reaches the parked subtree (it sits behind the canvas with pointer-events
// off) — and dispatching synthetic events cannot flip pseudo-classes. So the
// forwarder owns those states: it mirrors the pseudo-class chains onto
// `data-hover` / `data-active` attributes (target + ancestors, like the real
// thing) and dispatches pointerover/pointerout on hover changes.
//
// Author CSS with both selectors:  button:hover, button[data-hover] { … }

const HOVER_ATTR = 'data-hover'
const ACTIVE_ATTR = 'data-active'

interface PointerMirror {
  hovered: Element | null
  active: Element | null
  /** Last forwarded position, in the source subtree's page coordinates. */
  at: { x: number; y: number }
  /** Identity and device data from the latest forwarded native sample. */
  sample: ForwardPointerSample
  /** Pending animation frame for the departure moves; 0 when none. */
  away: number
}

const mirrors = new WeakMap<HTMLElement, PointerMirror>()

/**
 * The native pointer facts that survive the DOM-to-WebGL-to-DOM relay.
 * Passing no sample keeps the historic primary-mouse behavior.
 */
export interface ForwardPointerSample {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly button: number
  readonly buttons: number
  readonly pressure: number
  readonly width: number
  readonly height: number
  readonly tiltX: number
  readonly tiltY: number
  readonly twist: number
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

const DEFAULT_POINTER_SAMPLE: ForwardPointerSample = Object.freeze({
  pointerId: 1,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 0,
  pressure: 0,
  width: 1,
  height: 1,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
})

function pointerInit(
  sample: ForwardPointerSample,
  x: number,
  y: number,
): PointerEventInit & MouseEventInit {
  return {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    pointerId: sample.pointerId,
    pointerType: sample.pointerType,
    isPrimary: sample.isPrimary,
    button: sample.button,
    buttons: sample.buttons,
    pressure: sample.pressure,
    width: sample.width,
    height: sample.height,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
    twist: sample.twist,
    altKey: sample.altKey,
    ctrlKey: sample.ctrlKey,
    metaKey: sample.metaKey,
    shiftKey: sample.shiftKey,
    view: window,
  }
}

const mirrorOf = (root: HTMLElement): PointerMirror => {
  let m = mirrors.get(root)
  if (!m) {
    m = {
      hovered: null,
      active: null,
      at: { x: 0, y: 0 },
      sample: DEFAULT_POINTER_SAMPLE,
      away: 0,
    }
    mirrors.set(root, m)
  }
  return m
}

/** `el` and its ancestors up to and including `root`. */
function chainOf(root: Element, el: Element | null): Element[] {
  const out: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) {
    out.push(n)
    if (n === root) break
  }
  return out
}

function swapChainAttr(root: Element, prev: Element | null, next: Element | null, attr: string) {
  if (prev === next) return
  const nextChain = chainOf(root, next)
  const keep = new Set(nextChain)
  for (const el of chainOf(root, prev)) if (!keep.has(el)) el.removeAttribute(attr)
  for (const el of nextChain) if (!el.hasAttribute(attr)) el.setAttribute(attr, '')
}

/**
 * The boundary-crossing protocol: what a real browser dispatches when the
 * pointer moves off `prev` and onto `next` (either may be null at the edges
 * of the surface).
 *
 * The pair that bubbles and the pair that doesn't say different things, and
 * libraries listen to both:
 *
 * - `pointerout`/`pointerover` bubble, so one dispatch each is the whole
 *   announcement — every ancestor hears "something under me changed".
 * - `pointerleave`/`pointerenter` do NOT bubble. The browser fires one per
 *   element actually crossed and stops at the deepest common ancestor,
 *   because the pointer never left *that*. So they mean "the pointer left
 *   ME", which is a claim only the crossed elements may make.
 *
 * Forwarding only the bubbling pair — which is all this did until 2026-07-31
 * — is why a Radix tooltip opened inside a Surface could never close. It
 * builds its grace area from a native `pointerleave` on the trigger, and
 * only mounts the document listener that closes it once that area exists.
 * No leave, no grace area, no close: the tooltip hung until something else
 * unmounted it.
 *
 * Order matters and is the spec's: out, leave, over, enter — leaves outward
 * from the deepest element, enters inward toward it.
 *
 * The `mouseout`/`mouseleave`/`mouseover`/`mouseenter` twins ARE mirrored,
 * one per pointer event — a real browser fires mouse compatibility events
 * for every pointer boundary crossing, and the first mouse-native consumer
 * (recharts) arrived to collect: React synthesizes
 * `onMouseLeave` from native `mouseout`, so without the twin a chart's
 * tooltip appears on forwarded moves and then never hides — the departure
 * burst was speaking a dialect recharts doesn't listen to.
 */
function crossBoundary(
  root: HTMLElement,
  prev: Element | null,
  next: Element | null,
  init: PointerEventInit & MouseEventInit,
) {
  if (prev === next) return

  const prevChain = chainOf(root, prev)
  const nextChain = chainOf(root, next)
  const entered = new Set(nextChain)
  const left = new Set(prevChain)

  if (prev) {
    relay(prev, new PointerEvent('pointerout', { ...init, bubbles: true, relatedTarget: next }))
    relay(prev, new MouseEvent('mouseout', { ...init, bubbles: true, relatedTarget: next }))
  }
  for (const el of prevChain) {
    if (entered.has(el)) break // the deepest common ancestor — not left
    relay(el, new PointerEvent('pointerleave', { ...init, bubbles: false, relatedTarget: next }))
    relay(el, new MouseEvent('mouseleave', { ...init, bubbles: false, relatedTarget: next }))
  }

  if (next) {
    relay(next, new PointerEvent('pointerover', { ...init, bubbles: true, relatedTarget: prev }))
    relay(next, new MouseEvent('mouseover', { ...init, bubbles: true, relatedTarget: prev }))
  }
  const entering: Element[] = []
  for (const el of nextChain) {
    if (left.has(el)) break
    entering.push(el)
  }
  for (const el of entering.reverse()) {
    relay(el, new PointerEvent('pointerenter', { ...init, bubbles: false, relatedTarget: prev }))
    relay(el, new MouseEvent('mouseenter', { ...init, bubbles: false, relatedTarget: prev }))
  }
}

// Roots whose mirror is currently hovering — the set a wheel event consults
// to find which surface (if any) is under the pointer. A WeakMap can't be
// iterated, and the wheel arrives on the CANVAS with screen coordinates, so
// the only way back to the parked point is through the mirrors that already
// know it.
const hoverRoots = new Set<HTMLElement>()

function updateHover(
  root: HTMLElement,
  target: Element,
  init: PointerEventInit & MouseEventInit,
) {
  const m = mirrorOf(root)
  hoverRoots.add(root)
  if (m.hovered === target) return
  // Mirror first, dispatch second: the browser has :hover applied before it
  // fires the boundary events, so a handler reading [data-hover] must see the
  // new state, not the one being left.
  swapChainAttr(root, m.hovered, target, HOVER_ATTR)
  crossBoundary(root, m.hovered, target, init)
  m.hovered = target
}

/**
 * How far outside the source's own rect to park the pointer on exit.
 *
 * Any positive margin is provably enough for Radix's grace area: it pads its
 * exit points *inward* (`getPaddedExitPoints`, padding 5, always toward the
 * element), so the hull it hands to the tracker never escapes the trigger ∪
 * content bounding box — which is inside the source root. A point outside the
 * root is therefore outside the hull, for any tooltip, at any position.
 * 16px is simply comfortable clearance for fractional rects.
 */
const AWAY_MARGIN_PX = 16

/**
 * How many frames of departure to send. Three is enough slack for a consumer
 * that reacts to the leave through a React state update — render and passive
 * effects are separate scheduler tasks, and either may land after a given
 * frame — while staying far too short to be felt.
 */
const AWAY_FRAMES = 3

/**
 * Where the pointer is, across every surface at once.
 *
 * No single surface can answer this: each one only knows the ray arrived or
 * left. But a departure needs to say where the pointer *went*, and when it
 * went to a neighbouring surface, "off-page" is a lie with consequences —
 * Radix spans its grace polygon across trigger ∪ content precisely so the
 * pointer may cross from one to the other, and a tooltip you reach for
 * dismisses itself if we report that crossing as an exit to nowhere.
 *
 * The coordinates need no conversion. Every parked source is fixed at
 * page (0,0), so a point forwarded to any surface is already a page
 * point in the same document Radix measured its hull in.
 *
 * One record is enough, and staleness cannot arise: a surface only announces a
 * departure when the pointer was on it, so if the newest forward anywhere went
 * somewhere else, the pointer crossed there. Same root means it left for
 * nothing at all.
 */
let lastForward: { root: HTMLElement; x: number; y: number } | null = null

/** Drop all mirrored state (call when the pointer leaves the surface). */
export function clearPointerState(root: HTMLElement) {
  const m = mirrors.get(root)
  if (!m) return
  // While a surface drag is live, a departure is a lie twice over. The
  // consumer asked for pointer capture (we refused it — see
  // guardPointerCapture), and capture semantics are exactly this: no boundary
  // events, no position reports from anywhere else, until the button comes
  // up. And the burst below would say `buttons: 0` — the one signal every
  // drag consumer treats as "released" (react-resizable-panels deactivates on
  // its first buttonless move; measured killing a drag 13px in). Defer the
  // whole departure; it runs, honestly, when the drag ends.
  if (surfaceDragPointerId !== null) {
    pendingClears.add(root)
    return
  }
  hoverRoots.delete(root)
  if (m.hovered) {
    // Leave from where the pointer actually was. The grace polygon is
    // anchored at these coordinates, so reporting the away point here would
    // stretch the hull out to meet it and the move below would land inside
    // its own grace area — open forever, for a subtler reason.
    const init = pointerInit({ ...m.sample, button: 0, buttons: 0, pressure: 0 }, m.at.x, m.at.y)
    swapChainAttr(root, m.hovered, null, HOVER_ATTR)
    crossBoundary(root, m.hovered, null, init)
    m.hovered = null

    // Then say where the pointer went, over the next few frames. Document
    // -level trackers — Radix's grace area, and every dismissal heuristic
    // built like it — reason about position, not about which subtree an event
    // came from, so a leave with no follow-up move leaves them believing the
    // pointer is still parked wherever it last was.
    //
    // Why a burst and not one dispatch: a real pointer that leaves an element
    // keeps moving, so a consumer that ARMS a tracker in response to the
    // leave still receives later moves. Ours is discrete — one exit, one
    // instant — and a single synchronous move lands before any consumer has
    // reacted. Radix is the worked example: `pointerleave` sets React state,
    // and the document listener that closes the tooltip is attached by the
    // effect after that commits. Measured 2026-07-31: the synchronous move
    // did nothing; the identical move sent later closed the tooltip.
    //
    // Cancelled if the pointer comes back (see forwardPointer), so returning
    // to the surface never eats its own dismissal.
    const rect = root.getBoundingClientRect()
    let frames = AWAY_FRAMES
    const step = () => {
      m.away = 0
      // A surface torn down mid-departure has nothing to dismiss, and events
      // from a detached tree never reach document anyway.
      if (!root.isConnected) return

      // Where did it go? If a neighbouring surface has taken the pointer since
      // this departure began, there — a real destination, which a grace area
      // may well decide to tolerate. Otherwise off the source entirely, which
      // is provably outside any hull Radix can build (AWAY_MARGIN_PX). Asked
      // per frame, not once, because the destination can arrive a frame late
      // and because the pointer may leave everything after all.
      const to = lastForward && lastForward.root !== root ? lastForward : null
      const away: PointerEventInit & MouseEventInit = {
        ...init,
        clientX: to ? to.x : rect.left - AWAY_MARGIN_PX,
        clientY: to ? to.y : rect.top - AWAY_MARGIN_PX,
      }
      relay(root, new PointerEvent('pointermove', away))
      relay(root, new MouseEvent('mousemove', away))
      if (--frames > 0) m.away = requestAnimationFrame(step)
    }
    m.away = requestAnimationFrame(step)
  }
  if (m.active) {
    swapChainAttr(root, m.active, null, ACTIVE_ATTR)
    m.active = null
  }
}

/**
 * The cursor the page would show over the relay's hover target, for the
 * canvas to wear while it hears the pointer — the content's `cursor` is as
 * much of the pointer story as its hover, and the canvas otherwise shows
 * its own default the moment the pixels lift. `auto` is resolved the way
 * the browser would: the I-beam over text-entry content, the arrow
 * otherwise (plain selectable text also gets the arrow — the real rule
 * needs the browser's own hit-test data).
 */
export function surfaceCursorAt(target: Element): string {
  const cursor = getComputedStyle(target).cursor
  if (cursor !== 'auto') return cursor
  return target.closest('input, textarea, [contenteditable]') ? 'text' : 'default'
}

// ---- the landing bridge --------------------------------------------------

const bridges = new WeakMap<HTMLElement, () => void>()

/**
 * Hand the hover twin to the page copy when the canvas loses the hold.
 *
 * The gaining page copy hears only the browser, and the browser's own
 * `:hover` cannot re-form until a trusted contact hit-tests the copy — the
 * pointer gate's canvas stays solid until its first post-flip miss, so the
 * copy shows unhovered for the contacts in between. Measured 2026-08-20: a
 * pointer sweeping through a landing left two frames with no hover on
 * either copy. The twin is stamped at the pointer's place and lifted on the
 * first trusted contact that proves the real story resumed: a target inside
 * `root` (`:hover` is applied before dispatch), a position off the stamped
 * element (the pointer left), or a departure out of the document.
 */
export function bridgeHover(root: HTMLElement, x: number, y: number): void {
  bridges.get(root)?.()
  const target = deepestElementAt(root, x, y)
  if (!target) return
  const chain = chainOf(root, target)
  for (const el of chain) el.setAttribute(HOVER_ATTR, '')
  const doc = root.ownerDocument
  const lift = () => {
    bridges.delete(root)
    doc.removeEventListener('pointermove', onContact, true)
    doc.removeEventListener('pointerover', onContact, true)
    doc.removeEventListener('pointerdown', onContact, true)
    doc.removeEventListener('mousemove', onContact, true)
    doc.removeEventListener('pointerout', onOut, true)
    for (const el of chain) el.removeAttribute(HOVER_ATTR)
  }
  const onContact = (e: Event) => {
    if (!e.isTrusted) return
    if (e.target instanceof Node && root.contains(e.target)) {
      lift()
      return
    }
    // SAFETY: this handler is attached only to pointer and mouse event
    // types, and every PointerEvent is a MouseEvent.
    const { clientX, clientY } = e as MouseEvent
    const r = target.getBoundingClientRect()
    const over =
      clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
    // Still over the stamped element but heard elsewhere: the gate's canvas
    // is still solid above the copy. Keep the twin until it goes clear.
    if (!over) lift()
  }
  const onOut = (e: PointerEvent) => {
    // relatedTarget null: the pointer left the document, and no further
    // contact will come to lift the twin by position.
    if (e.isTrusted && e.relatedTarget === null) lift()
  }
  bridges.set(root, lift)
  doc.addEventListener('pointermove', onContact, true)
  doc.addEventListener('pointerover', onContact, true)
  doc.addEventListener('pointerdown', onContact, true)
  // Chrome re-hit-tests a still pointer after a hit-affecting style change
  // with a fake MOUSE move, never a pointer event — without this listener a
  // still landing keeps the twin past the browser's own re-hover.
  doc.addEventListener('mousemove', onContact, true)
  doc.addEventListener('pointerout', onOut, true)
}

/**
 * Stop a native canvas pointermove from bubbling on to document — the
 * same truth-telling as Surface's pointerdown suppression, extended to
 * hover. Every pointer over a Surface arrives as a native event whose
 * target is the canvas and whose coordinates are screen coordinates; the
 * forwarder retells that move as a synthetic event with the coordinates of
 * what the pointer actually hit. Document-level listeners that reason about
 * move COORDINATES — Radix's tooltip grace tracker is the measured case:
 * `isPointInPolygon(clientX/Y, hull)` against a hull built in parked-source
 * page space — hear the canvas's screen coordinates as "miles outside" and
 * dismiss a tooltip the pointer is demonstrably travelling toward. Both
 * stories must not reach the document; the forwarded one is the true one.
 *
 * Hover moves only (`buttons === 0`): OrbitControls registers document-level
 * move/up listeners for the duration of a drag, and a drag that began on
 * empty space must keep orbiting while the ray crosses a panel. Dismissal
 * still works everywhere — a pointer over empty canvas never reaches a
 * Surface handler, so its native move bubbles untouched and closes what it
 * should close; a pointer leaving a Surface gets the departure burst, whose
 * synthetic moves land provably outside every grace hull.
 */
export function silenceHoverMove(native: PointerEvent) {
  if (native.buttons === 0) native.stopPropagation()
}

export interface ForwardResult {
  target: Element
  focused: boolean
}

/**
 * Cancel unwinds a press without a click. The element that heard the down
 * hears the cancel even when the ray has since left it, so `mirror.active`
 * wins over whatever is under the pointer now.
 */
function forwardCancel(
  root: HTMLElement,
  mirror: PointerMirror,
  pointer: ForwardPointerSample,
  target: Element | null,
  x: number,
  y: number,
): ForwardResult | null {
  const cancelTarget = mirror.active ?? target
  if (cancelTarget) {
    relay(cancelTarget, new PointerEvent('pointercancel', pointerInit(pointer, x, y)))
  }
  swapChainAttr(root, mirror.active, null, ACTIVE_ATTR)
  mirror.active = null
  if (surfaceDragPointerId === pointer.pointerId) surfaceDragPointerId = null
  flushPendingClears()
  return cancelTarget ? { target: cancelTarget, focused: false } : null
}

/**
 * The release half — up, click, then the focus fixup a synthetic click does
 * not run. Returns whether focus actually landed on the target.
 */
function forwardRelease(
  root: HTMLElement,
  mirror: PointerMirror,
  target: Element,
  init: PointerEventInit & MouseEventInit,
  pointer: ForwardPointerSample,
): boolean {
  modality = 'pointer' // a release is a pointer interaction even without its down
  if (surfaceDragPointerId === pointer.pointerId) surfaceDragPointerId = null
  relay(target, new PointerEvent('pointerup', init))
  relay(target, new MouseEvent('mouseup', init))
  relay(target, new MouseEvent('click', init))
  swapChainAttr(root, mirror.active, null, ACTIVE_ATTR)
  mirror.active = null
  // Synthetic clicks don't run the browser's focus fixup, so do it by hand.
  const focusable = target.closest<HTMLElement>(FOCUSABLE)
  let focused = false
  if (focusable) {
    focusable.focus({ preventScroll: true })
    focused = document.activeElement === focusable
  } else {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  }
  // Departures deferred during the drag unwind now — the order a real
  // capture ends in: the up reaches its target first, then the boundary
  // events fire.
  flushPendingClears()
  return focused
}

/**
 * Forward a pointer interaction to the DOM subtree rooted at `root`.
 * (u, v) are texture coordinates: u ∈ [0,1] left→right, v ∈ [0,1] bottom→top
 * (GL convention — we flip v internally to DOM's top-down y).
 */
export function forwardPointer(
  root: HTMLElement,
  u: number,
  v: number,
  kind: 'down' | 'up' | 'move' | 'cancel',
  sample?: ForwardPointerSample,
): ForwardResult | null {
  const pointer = sample ?? {
    ...DEFAULT_POINTER_SAMPLE,
    buttons: kind === 'down' ? 1 : 0,
    pressure: kind === 'down' ? 0.5 : 0,
  }
  // A held-button move that did not begin on any surface is a FOREIGN
  // capture — OrbitControls orbiting from empty space, a text selection
  // sweeping across the canvas, a drag that started in another window — and
  // capture semantics are silence: no boundary events, no hover, no position
  // reports, until the button comes up. This is the same rule pointed
  // the other way. The measured cost of speaking anyway (2026-08-02):
  // OrbitControls holds a document-level pointermove listener for
  // exactly the duration of its drag and does raw clientX/Y delta
  // math on whatever arrives, so one panel-edge crossing mid-orbit
  // fed it a departure burst at (−16,−16), poisoned its rotate
  // anchor, and the next real 10px hand move moved the controlled view.
  // The r3f 'up' side needs no gate here — Surface's
  // pressedRef already refuses a release it never saw the press for.
  if (
    kind === 'move' &&
    pointer.buttons !== 0 &&
    surfaceDragPointerId !== pointer.pointerId
  )
    return null
  const rect = root.getBoundingClientRect()
  const x = rect.left + u * rect.width
  const y = rect.top + (1 - v) * rect.height
  const target = deepestElementAt(root, x, y)
  const mirror = mirrorOf(root)
  if (
    kind === 'cancel' &&
    mirror.active &&
    mirror.sample.pointerId !== pointer.pointerId
  )
    return null
  mirror.sample = pointer
  if (kind === 'cancel') return forwardCancel(root, mirror, pointer, target, x, y)
  // Nothing here accepts the pointer — the ray passed through clear glass.
  // Whatever this surface was hovering, it is not hovering it now.
  if (!target) {
    clearPointerState(root)
    return null
  }
  mirror.at = { x, y }
  lastForward = { root, x, y }
  // The pointer is back before the departure finished sending — call it off,
  // or we would announce the pointer is gone while it is demonstrably here.
  if (mirror.away) {
    cancelAnimationFrame(mirror.away)
    mirror.away = 0
  }

  const init = pointerInit(pointer, x, y)

  let focused = false
  if (kind === 'move') {
    updateHover(root, target, init)
    relay(target, new PointerEvent('pointermove', init))
    relay(target, new MouseEvent('mousemove', init))
  } else if (kind === 'down') {
    // The press is the interaction the modality mirror cares about — declared
    // BEFORE dispatch, because a consumer may focus synchronously from its
    // pointerdown handler and the verdict must already be in.
    modality = 'pointer'
    surfaceDragPointerId = pointer.pointerId
    // Real browsers hover before they press — a down with no prior move
    // (surface just appeared under the cursor) still hovers correctly.
    updateHover(root, target, init)
    swapChainAttr(root, null, target, ACTIVE_ATTR)
    mirror.active = target
    relay(target, new PointerEvent('pointerdown', init))
    relay(target, new MouseEvent('mousedown', init))
  } else {
    focused = forwardRelease(root, mirror, target, init, pointer)
  }

  return { target, focused }
}

/**
 * Checkboxes/radios toggle via real activation behavior on click; synthetic
 * clicks handle them, but selects need help: a synthetic click can't open a
 * native dropdown picker. Instead we cycle the value — good enough to prove
 * state flows; a real library would render its own popover surface.
 */
export function nudgeSelect(el: HTMLSelectElement) {
  el.selectedIndex = (el.selectedIndex + 1) % el.options.length
  relay(el, new Event('change', { bubbles: true }))
}

// ---- wheel / scroll forwarding ------------------------------------------
//
// Scroll RASTERIZES fine — a scrollTop change invalidates the paint record
// like any descendant mutation (measured 2026-08-01: instant jump = 1 paint,
// smooth scroll = 1 paint/frame while gliding, pixels verified). What the
// platform will not do is scroll FOR us: the default scrolling action only
// runs for trusted wheel events, and everything the forwarder dispatches is
// synthetic. So the forwarder performs the scroll itself, the way the
// browser would have: dispatch the (cancelable) wheel to the DOM first, and
// if no handler claims it, walk up from the target for the nearest scroll
// container that can still move in the delta's direction and move it.
//
// The return value is the arbitration verdict the consumer needs: `true` means
// the surface consumed the wheel (a handler claimed it, a scroller moved, or
// an `overscroll-behavior: contain|none` boundary swallowed it), and the
// camera must not also zoom. `false` means the wheel fell all the way
// through — over a panel with nothing scrollable, the room itself is the
// next scroll container, exactly like scroll chaining reaching the page.

/** Can `el` still scroll in the direction of `delta` on `axis`? */
function canScroll(el: Element, axis: 'x' | 'y', delta: number): boolean {
  if (delta === 0) return false
  const cs = getComputedStyle(el)
  const overflow = axis === 'y' ? cs.overflowY : cs.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  const max =
    axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
  if (max <= 0) return false
  const pos = axis === 'y' ? el.scrollTop : el.scrollLeft
  // Half a pixel of slack: scroll positions are fractional on scaled sources.
  return delta > 0 ? pos < max - 0.5 : pos > 0.5
}

/** Is `el` a scroll container on `axis` whose overscroll must not chain? */
function overscrollStops(el: Element, axis: 'x' | 'y'): boolean {
  const cs = getComputedStyle(el)
  const overflow = axis === 'y' ? cs.overflowY : cs.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  const behavior =
    (axis === 'y' ? cs.overscrollBehaviorY : cs.overscrollBehaviorX) ||
    cs.overscrollBehavior
  return behavior === 'contain' || behavior === 'none'
}

/**
 * Forward a wheel at page point (x, y) into `root`. Returns true when the
 * surface consumed it (the camera must stand down), false when it chained
 * through to the surrounding view.
 */
export function forwardWheel(
  root: HTMLElement,
  x: number,
  y: number,
  wheel: { deltaX: number; deltaY: number; deltaMode?: number },
): boolean {
  const target = deepestElementAt(root, x, y)
  if (!target) return false

  // The retelling: consumers hear the wheel whether or not anything scrolls
  // (cmdk, carousels, custom scrollers all listen). A preventDefault is a
  // claim, honored the way the browser would.
  const ev = new WheelEvent('wheel', {
    clientX: x,
    clientY: y,
    deltaX: wheel.deltaX,
    deltaY: wheel.deltaY,
    deltaMode: wheel.deltaMode ?? 0,
    bubbles: true,
    cancelable: true,
    view: window,
  })
  if (!relay(target, ev)) return true

  // Line/page deltas normalized to pixels before moving anything (real
  // devices send pixels; some mice send lines).
  const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 100 : 1
  const dx = wheel.deltaX * unit
  const dy = wheel.deltaY * unit

  // Scroll chaining, target → root: the nearest scroll container that can
  // move takes the delta; a container at its end with overscroll containment
  // stops the chain cold, consuming nothing — the chat log at its bottom must
  // not become a camera zoom.
  for (const el of chainOf(root, target)) {
    const x2 = canScroll(el, 'x', dx)
    const y2 = canScroll(el, 'y', dy)
    if (x2 || y2) {
      // Direct mutation, not scrollBy: user scrolling is exempt from CSS
      // scroll-behavior, so instant is the faithful semantics — and it costs
      // exactly one paint. scroll events fire from the mutation for free.
      if (x2) el.scrollLeft += dx
      if (y2) el.scrollTop += dy
      return true
    }
    if ((dx !== 0 && overscrollStops(el, 'x')) || (dy !== 0 && overscrollStops(el, 'y')))
      return true
  }
  return false
}

// The wheel cannot be arbitrated where it is heard. OrbitControls listens on
// the CANVAS element — the wheel's real target — so by the time r3f's own
// wrapper-level handler (and any mesh onWheel) runs, the camera has already
// zoomed. The only seat ahead of the canvas is document capture. From there,
// the mirrors already know whether the pointer is over a surface and where
// its parked point is; if that surface consumes the wheel, the event is
// stopped before OrbitControls ever hears it.

// True from a forwarded pointerdown until its release — a drag that BEGAN on
// a Surface. The discriminator matters: a drag that began on empty space and
// merely travels over a panel is OrbitControls' gesture, and its document
// stream must not be touched.
let surfaceDragPointerId: number | null = null

// Departures announced while the drag was live, waiting for the release.
// (See clearPointerState — capture semantics defer them, not drop them:
// whatever hover state those surfaces were holding still has to unwind, or
// it leaks past the gesture.)
const pendingClears = new Set<HTMLElement>()

function flushPendingClears() {
  const pending = [...pendingClears]
  pendingClears.clear()
  for (const root of pending) clearPointerState(root)
}

/**
 * Arbitrate trusted DRAG moves at document capture — the third seat in the
 * wheel/hover family, and it exists for the same reason: the canvas is how
 * the pointer travelled, not what it is dragging.
 *
 * react-resizable-panels listens for pointermove at document BUBBLE and
 * computes drag deltas from `clientX/Y` against the point where the drag
 * began — which was a FORWARDED down, in parked coordinates. The trusted
 * move (target CANVAS, screen coordinates) reaching that same listener
 * interleaves a second coordinate system into the delta stream: the
 * two-narrator problem again, this time with a button held.
 *
 * The remedy is `preventDefault`, not stopPropagation: the panel library's
 * own front door is `if (event.defaultPrevented) return`, and propagation
 * must survive because r3f delivers mesh events from the canvas wrapper's
 * bubble — the forwarding pipeline itself rides the path a stop would cut.
 * Suppressing a drag-move's compat `mousemove` is the only side effect, and
 * only while a surface drag is live.
 */
export const trackDrag: () => () => void = refCounted(() => {
  const onMove = (e: PointerEvent) => {
    if (
      surfaceDragPointerId !== e.pointerId ||
      !e.isTrusted ||
      e.buttons === 0
    )
      return
    if (!(e.target instanceof HTMLCanvasElement)) return
    e.preventDefault()
  }
  // A release anywhere ends the gesture — including over the floor or off
  // the window, where no Surface handler will ever hear it to forward one.
  const onEnd = (e: PointerEvent) => {
    if (e.isTrusted && surfaceDragPointerId === e.pointerId) {
      surfaceDragPointerId = null
      // This capture listener runs before the same trusted up reaches the
      // canvas and is forwarded — a microtask puts the flush after it, so
      // the up still lands before any deferred boundary events. (When the
      // forwarded up flushed already, this finds the set empty.)
      queueMicrotask(flushPendingClears)
    }
  }
  document.addEventListener('pointermove', onMove, { capture: true, passive: false })
  document.addEventListener('pointerup', onEnd, true)
  document.addEventListener('pointercancel', onEnd, true)
  return () => {
    document.removeEventListener('pointermove', onMove, { capture: true })
    document.removeEventListener('pointerup', onEnd, true)
    document.removeEventListener('pointercancel', onEnd, true)
    surfaceDragPointerId = null
    flushPendingClears()
  }
})

/**
 * The relay-surviving facts of a native event, as a PLAIN object. A retained
 * PointerEvent spreads to nothing — its properties live on prototype getters
 * — so a sample built by `{...event}` carries `pointerId: undefined`, and
 * forwardPointer's cancel guard then refuses the cancel it was built for.
 * Every sample that will be stored or spread goes through here.
 */
export function pointerSampleOf(e: PointerEvent): ForwardPointerSample {
  return {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    isPrimary: e.isPrimary,
    button: e.button,
    buttons: e.buttons,
    pressure: e.pressure,
    width: e.width,
    height: e.height,
    tiltX: e.tiltX,
    tiltY: e.tiltY,
    twist: e.twist,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
  }
}

/** Where the trusted pointer last was, in viewport coordinates. */
export interface PointerPlace {
  readonly x: number
  readonly y: number
  readonly sample: ForwardPointerSample
}

let pointerPlace: PointerPlace | null = null

/**
 * Reference-counted document-capture record of the pointer's last trusted
 * position. It exists for the crossing's arrival burst (decisions.md #33):
 * the flip that gives the canvas input is a protocol event with no pointer
 * event attached, so a presenter re-arming hover under a STILL pointer has
 * no event to read the position from — only this record, written before
 * the flip.
 */
export const trackPointerPlace: () => () => void = refCounted(() => {
  const onPoint = (e: PointerEvent) => {
    if (!e.isTrusted) return
    pointerPlace = { x: e.clientX, y: e.clientY, sample: pointerSampleOf(e) }
  }
  // A pointerout with no relatedTarget is the pointer leaving the
  // document: a place kept past that would re-arm hover on content the
  // pointer is no longer over at all.
  const onOut = (e: PointerEvent) => {
    if (e.isTrusted && e.relatedTarget === null) pointerPlace = null
  }
  // pointerup included: a lift triggered on release flips the hold with
  // the DOWN as the newest sample otherwise, and its buttons:1 made the
  // arrival burst read a finished press as still open (2026-08-20).
  document.addEventListener('pointermove', onPoint, true)
  document.addEventListener('pointerdown', onPoint, true)
  document.addEventListener('pointerup', onPoint, true)
  document.addEventListener('pointerout', onOut, true)
  return () => {
    document.removeEventListener('pointermove', onPoint, true)
    document.removeEventListener('pointerdown', onPoint, true)
    document.removeEventListener('pointerup', onPoint, true)
    document.removeEventListener('pointerout', onOut, true)
    pointerPlace = null
  }
})

/** The record `trackPointerPlace` keeps; null before any trusted event. */
export function lastPointerPlace(): PointerPlace | null {
  return pointerPlace
}

/**
 * Parked matter must never hold the real pointer. A consumer that calls
 * `setPointerCapture` from a parked subtree (react-resizable-panels does,
 * per forwarded move, on its separator) captures the REAL mouse — synthetic
 * events share pointerId 1 with it — and every trusted event thereafter
 * retargets to the parked element: the canvas goes silent, r3f stops
 * raycasting, and the forwarding pipeline starves itself mid-gesture.
 * Release it the moment it is granted; the consumer's `hasPointerCapture`
 * check simply re-asks next move and is refused again.
 */
export function guardPointerCapture(host: HTMLElement): () => void {
  const onGot = (e: PointerEvent) => {
    if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
  }
  host.addEventListener('gotpointercapture', onGot, true)
  return () => host.removeEventListener('gotpointercapture', onGot, true)
}

/** Reference-counted document-capture wheel arbiter. Returns a release. */
export const trackWheel: () => () => void = refCounted(() => {
  const onWheel = (e: WheelEvent) => {
    // Only wheels aimed at a canvas are ours to arbitrate — page scrolling
    // outside the canvas stays untouched, and the synthetic wheel dispatched
    // by forwardWheel (whose target is parked DOM, never a canvas) can't
    // re-enter here.
    if (!(e.target instanceof HTMLCanvasElement)) return
    for (const rootEl of hoverRoots) {
      const m = mirrors.get(rootEl)
      if (!m?.hovered) continue
      if (forwardWheel(rootEl, m.at.x, m.at.y, e)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
    }
  }
  document.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => document.removeEventListener('wheel', onWheel, { capture: true })
})
