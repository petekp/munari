// Pointer twins — the attributes that stand in for :hover and :active on a
// parked subtree, and the chain walk that keeps them shaped like the real
// pseudo-classes.
//
// :hover and :active are set by the browser's own hit-testing. A parked
// subtree that the browser never hits therefore has neither, and dispatching
// synthetic events cannot flip a pseudo-class. So whichever route is driving
// the pointer mirrors the pseudo-class chains onto `data-hover` /
// `data-active` — target AND ancestors, exactly as the browser applies them.
//
// Author CSS with both selectors:  button:hover, button[data-hover] { … }
//
// The law: one module owns these attribute names and the chain walk, however
// the pointer arrived. Two routes drive them now — the synthetic relay, and
// the native route where the browser hit-tests the parked child through a
// matrix3d — and a scene's pixels must not depend on which one delivered the
// press (docs/authoring.md, decisions.md #39).
//
// The fault this forbids is structural rather than measured: a second
// stamping site written beside the relay's is free to differ in the small
// ways that never raise an error. Stamping the target alone instead of the
// chain leaves every `.card[data-hover] .title` rule dead on one route and
// live on the other, with identical DOM and no console output.
//
// Ownership: this module owns the names and the walk. `forwardEvents.ts`
// decides when the relay swaps them; `nativeRoute.ts` decides when the
// browser's own events do.

export const HOVER_ATTR = 'data-hover'
export const ACTIVE_ATTR = 'data-active'

/** `el` and its ancestors up to and including `root`. */
export function chainOf(root: Element, el: Element | null): Element[] {
  const out: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) {
    out.push(n)
    if (n === root) break
  }
  return out
}

/**
 * Move `attr` from `prev`'s chain to `next`'s, touching only the elements
 * that actually changed state — the shared ancestors keep the attribute
 * across the swap, which is what the browser does and what a CSS transition
 * on an ancestor needs in order not to restart.
 */
export function swapChainAttr(
  root: Element,
  prev: Element | null,
  next: Element | null,
  attr: string,
) {
  if (prev === next) return
  const nextChain = chainOf(root, next)
  const keep = new Set(nextChain)
  for (const el of chainOf(root, prev)) if (!keep.has(el)) el.removeAttribute(attr)
  for (const el of nextChain) if (!el.hasAttribute(attr)) el.setAttribute(attr, '')
}
