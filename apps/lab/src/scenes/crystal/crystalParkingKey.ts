// The crystal's parking key, lifted off `window`.
//
// `p` freezes the glass wherever it stands so the tweak panel becomes
// reachable — see Crystal.tsx for the parking rationale. The handler is
// extracted for the same reason `flightGestures` is: it lives on `window`,
// and this seam is best tested as DOM (crystalParkingKey.test.ts drives the
// real attach). What is load-bearing here is not the key match or the
// modifier guard — it is `e.repeat`.
//
// A held `p` is one physical press but many keydowns: the OS fires an
// initial one with `KeyboardEvent.repeat === false`, then an auto-repeat
// train at roughly 30 Hz (OS- and user-settings-dependent), each stamped
// `repeat === true`. Toggling on every keydown flips `parked` once per
// repeat and lands it on whichever parity the count reaches —
// non-deterministic, and the wrong parity is recoverable only from one
// side (the checkbox sets `parked` directly, but only when chrome is on;
// in bare mode the keyboard is the only control). Ignoring auto-repeat
// keeps a single press at ONE stable state: it toggles once and stays,
// which is what a held press means.

/** The slice of the scene the parking key touches: just the toggle. */
export interface ParkingDeps {
  /**
   * Toggle `parked`. Called at most once per physical press of `p`:
   * OS auto-repeat keydowns do not call it.
   */
  onToggle: () => void
}

/**
 * Attach the parking key to `window`; returns the detach.
 *
 * Only the INITIAL keydown toggles. OS auto-repeat fires further keydowns
 * stamped `e.repeat === true`, and acting on those would oscillate `parked`
 * ~30 times a second while the key is held; the `repeat` guard drops them.
 * `Cmd-P`, `Ctrl-P` and `Alt-P` are left for the browser (not a parking
 * gesture); `p`, `P` and `Shift-P` park, exactly as before.
 */
export function attachCrystalParking({ onToggle }: ParkingDeps): () => void {
  const key = (e: KeyboardEvent) => {
    if (e.repeat) return
    if (e.key !== 'p' && e.key !== 'P') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    onToggle()
  }
  window.addEventListener('keydown', key)
  return () => window.removeEventListener('keydown', key)
}
