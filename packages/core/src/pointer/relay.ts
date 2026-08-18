// Provenance for the surface protocol's synthetic events.
//
// The protocol retells the pointer's story into parked subtrees, and those
// retellings BUBBLE to document by design — Radix and everything built like
// it listen there. So `window` carries two voices: the user's hand
// (`isTrusted: true`, coordinates in screen space) and the library's
// relays (`isTrusted: false`, coordinates in parked-source page space —
// which, every source being fixed at page (0,0), means "near the top-left
// corner"). A page-level listener that reads coordinates without asking who
// is speaking flies whatever it controls into that corner.
//
// `isTrusted` is the platform's own answer and the right default guard: no
// dispatch path can set it, so nothing we or anyone else constructs can
// impersonate the hand. But it cannot answer the OTHER direction — "is this
// specifically the surface protocol talking?" — which matters to a consumer
// whose legitimate input is itself untrusted (assistive-technology
// middleware, remote-control tooling, a test harness speaking as the hand).
// For them, every retelling leaves the library through this one call and
// carries a brand only we write. A relay is not an impersonation: it passes
// the hand's story along and stamps itself on the way out.

/**
 * The brand lives in the realm-wide symbol registry, NOT a module-local
 * `Symbol()`: this repo has measured a dev-server restart leaving a tab with
 * two live instances of one module (toast() from one, its subscriber on the
 * other — no error, nothing worked). A per-instance symbol would make one
 * instance's relays invisible to the other's predicate; `Symbol.for` is
 * shared by construction.
 */
const RELAYED = Symbol.for('munari.relayed')

interface Brandable {
  [RELAYED]?: true
}

/**
 * Dispatch `ev` on `target` as the surface protocol's own retelling. Every
 * synthetic event the library emits must leave through here — it is what
 * makes `isRelayed` a complete answer. Returns `dispatchEvent`'s verdict
 * (false when a handler called `preventDefault` on a cancelable event).
 */
export function relay(target: EventTarget, ev: Event): boolean {
  // SAFETY: `Brandable` names one optional key and nothing else, and that
  // key is a registry symbol only this module writes. The assertion adds a
  // property to `ev`; it narrows nothing the platform already declared, so
  // no member of Event is being re-described here. Augmenting the global
  // Event interface would say the same thing to every consumer of the
  // library, which is the wrong blast radius for a private brand.
  const branded = ev as Brandable
  branded[RELAYED] = true
  return target.dispatchEvent(ev)
}

/**
 * Is this event one of the surface protocol's retellings?
 *
 * The complement of the `isTrusted` guard, for listeners that must accept
 * untrusted input from elsewhere. The strict rule is still the
 * default — filter on `isTrusted` and this predicate never comes up. Use
 * it only when your input pipeline is legitimately synthetic and you need to
 * reject the library's voice specifically:
 *
 *   window.addEventListener('pointermove', (e) => {
 *     if (isRelayed(e)) return   // the library talking to itself
 *     // e is the hand, or something speaking for the hand on purpose
 *   })
 */
export function isRelayed(ev: Event): boolean {
  // SAFETY: the read half of the brand `relay` writes. Absent is the
  // answer for every event the library did not emit, which is why the key
  // is optional and the test is `=== true` rather than a truthiness check.
  return (ev as Brandable)[RELAYED] === true
}

/**
 * A React event, as far as provenance is concerned: a wrapper that carries
 * the platform event it was made from.
 */
export interface NativeEventCarrier {
  readonly nativeEvent: Event
}

/**
 * `isRelayed`, for a handler that may be given either a platform event or
 * React's wrapper around one.
 *
 * The brand is written on the event the library DISPATCHED. React does not
 * copy unknown properties onto its synthetic wrapper, so `isRelayed` handed
 * a synthetic event answers `false` for every relay — the wrapper is not the
 * event that was branded. A component that guards with the wrong one is
 * guarding nothing, and the symptom is not a crash: it is the library's own
 * retellings being processed as the hand, at parked-source coordinates, in
 * the top-left corner of whatever the listener controls.
 */
export function isRelayedEvent(ev: Event | NativeEventCarrier): boolean {
  // SAFETY: the union's two arms are distinguished by the one field only
  // the React arm declares. Reading it as optional is the narrowing itself
  // — a platform Event has no `nativeEvent`, so the fallback is the event.
  const native = (ev as Partial<NativeEventCarrier>).nativeEvent
  // SAFETY: the union above admits nothing else, so what remains when the
  // carrier field is absent is the platform event.
  return isRelayed(native ?? (ev as Event))
}
