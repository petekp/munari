// DOM ancestor lookup for event targets. Document and window events have
// no Element to search, so they return null rather than calling closest.

/** The nearest ancestor of an event's target that matches, or null. */
export function closestFrom<E extends Element = HTMLElement>(
  target: EventTarget | null,
  selector: string,
): E | null {
  return target instanceof Element ? target.closest<E>(selector) : null
}
