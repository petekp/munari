// Focus across a Surface's two DOM copies — one logical element, two nodes.
//
// The law: a Surface renders its content TWICE, and focus is a property of
// the document, not of a copy. Exactly one of the two copies is reachable
// at a time, so when the hold moves the focused element has to move with
// it, and the outside world must be told about one focus, not two.
//
// The fault, 2026-08-17: the page copy is released by `inert`, and `inert`
// blurs whatever it contains. A user who had tabbed to the button and then
// lifted the Surface lost focus to `<body>` — no error, no visible ring,
// and the next Tab restarted from the top of the document. The transfer
// below runs in the same task as that blur, so the focus never lands on
// the body at all, and the ledger collapses the blur/focus pair into no
// logical change.
//
// Ownership: this module owns the key that names the same element in both
// copies and the dedupe ledger. It owns no React state and no store.

/** An authored name for an element, honored over its structural position. */
export const SURFACE_FOCUS_ATTRIBUTE = 'data-munari-focus'

/**
 * Name `element`'s position inside `root` so the other copy can be asked
 * for the same one. Null when it is not inside `root`.
 *
 * Structural by default — child indices from the root down. An authored
 * `data-munari-focus` anchors the path to that element instead, which is
 * what keeps a key stable when the two copies do not render identical
 * sibling lists (a page copy with an extra wrapper, a source copy that
 * omits decoration).
 */
export function surfaceFocusKey(root: HTMLElement, element: Element): string | null {
  const path: number[] = []
  let node: Element | null = element
  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) return null
    const authored = node.getAttribute(SURFACE_FOCUS_ATTRIBUTE)
    if (authored !== null) return `@${authored}${path.length ? `/${path.join('.')}` : ''}`
    path.unshift(Array.prototype.indexOf.call(parent.children, node))
    node = parent
  }
  if (node !== root) return null
  return path.join('.')
}

/** The element `key` names inside `root`, or null if this copy has none. */
export function surfaceFocusTarget(root: HTMLElement, key: string): HTMLElement | null {
  let base: Element | null = root
  let path = key
  if (key.startsWith('@')) {
    const slash = key.indexOf('/')
    const name = slash < 0 ? key.slice(1) : key.slice(1, slash)
    path = slash < 0 ? '' : key.slice(slash + 1)
    base = root.querySelector(`[${SURFACE_FOCUS_ATTRIBUTE}="${CSS.escape(name)}"]`)
    if (!base) return null
  }
  for (const step of path ? path.split('.') : []) {
    const index = Number(step)
    const next: Element | undefined = base.children[index]
    if (!next) return null
    base = next
  }
  return base instanceof HTMLElement ? base : null
}

/**
 * Move focus, and the caret with it, from one copy of a Surface to the
 * other. Returns what was focused, or null if nothing was.
 *
 * `preventScroll` because the copies are not in the same place: the page
 * copy is in page flow and the source copy is parked, so letting the
 * browser reveal the target scrolls the document to somewhere the user is
 * not looking.
 */
export function transferSurfaceFocus(from: HTMLElement, to: HTMLElement): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !from.contains(active)) return null
  const key = surfaceFocusKey(from, active)
  const target = key === null ? null : surfaceFocusTarget(to, key)
  // The two copies are not required to be structurally identical, so the
  // same path can name a button in one and a paragraph in the other.
  // `tabIndex` is the cheap test — natively focusable elements report 0 and
  // anything authored reports its attribute — and `activeElement` is the
  // authority, because `focus()` on an element that cannot take it is a
  // silent no-op.
  if (target && (target.tabIndex >= 0 || target.hasAttribute('tabindex'))) {
    target.focus({ preventScroll: true })
  }
  if (!target || document.activeElement !== target) {
    // Never the body. A copy with no usable match still takes the focus at
    // its root, so the next Tab continues from the Surface instead of
    // restarting at the top of the document.
    if (!to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1')
    to.focus({ preventScroll: true })
    return to
  }
  const caret =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null
  if (
    caret &&
    caret.start !== null &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  ) {
    try {
      target.setSelectionRange(caret.start, caret.end ?? caret.start)
    } catch {
      // Ranges are meaningless on some input types (email, number). The
      // focus already landed, which is the part that matters.
    }
  }
  return target
}

export type SurfaceFocusInstance = 'page' | 'source'

export interface SurfaceFocusLedger {
  /** One copy gained or lost focus. */
  report(instance: SurfaceFocusInstance, focused: boolean): void
  /** True while either copy holds focus. */
  focused(): boolean
  dispose(): void
}

/**
 * Collapse two copies' focus events into one logical signal.
 *
 * Coalesced in a microtask rather than reported as they arrive: a transfer
 * is a `focusout` immediately followed by a `focusin`, both in the same
 * task, and a consumer that saw the pair would close its editor between
 * them.
 */
export function createSurfaceFocusLedger(
  notify: (focused: boolean) => void,
): SurfaceFocusLedger {
  const held = { page: false, source: false }
  let announced = false
  let scheduled = false
  let live = true
  const flush = () => {
    scheduled = false
    if (!live) return
    const next = held.page || held.source
    if (next === announced) return
    announced = next
    notify(next)
  }
  return {
    report(instance, focused) {
      held[instance] = focused
      if (scheduled) return
      scheduled = true
      queueMicrotask(flush)
    },
    focused: () => held.page || held.source,
    dispose() {
      live = false
    },
  }
}
