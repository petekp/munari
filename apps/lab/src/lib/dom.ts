// Event targets, made answerable.
//
// The DOM types an event's `target` as `EventTarget` — the same type a window,
// a document and a fetch controller carry. Every question this lab asks of one
// ("which card did that land on?", "hold this pointer") is a question only an
// Element can answer. So each helper here asks whether it IS one first. That
// is not a formality: a listener bound to the document sees events whose
// target is the document, and the browser will say no.

/** The nearest ancestor of an event's target that matches, or null. */
export function closestFrom<E extends Element = HTMLElement>(
  target: EventTarget | null,
  selector: string,
): E | null {
  return target instanceof Element ? target.closest<E>(selector) : null
}

/** Route the rest of this pointer's stream to the element it started on. */
export function capturePointer(target: EventTarget | null, pointerId: number): void {
  if (target instanceof Element) target.setPointerCapture(pointerId)
}

/** Hand the stream back. Optional call: a pointer that never captured, or a
 *  target already detached, must not throw on the way out. */
export function releasePointer(target: EventTarget | null, pointerId: number): void {
  if (target instanceof Element) target.releasePointerCapture?.(pointerId)
}
