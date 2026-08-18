// Surface readiness — has every registered WebGL presenter drawn once?
//
// The law: readiness is a KEYED set over one lifetime, never a count.
// A presenter proves itself by completing its first eligible
// color-writing draw; a Surface is ready when every presenter registered
// for the current lifetime has done so, and a source replacement starts a
// new lifetime in which nothing has proven anything yet.
//
// Keyed rather than counted, because a presenter that remounts mid-warm-up
// fires its first-draw boundary AGAIN. The retired lift hook learned this as receipts
// that double-counted: six presenters could satisfy a five-presenter gate
// with one of them never having drawn at all, and the page released over a
// surface that was still blank. A set cannot double-count.
//
// Lifetime-stamped rather than cleared, because a receipt is still
// travelling across a renderer frame. Clearing on replacement lets the OLD source's
// last draw land in the NEW lifetime's set and prove content that no longer
// exists. A receipt carrying the wrong lifetime is simply refused.
//
// Core owns the set and the predicate. The binding owns what counts as an
// eligible draw (see `transfer/presentation`) and when a lifetime ends.

/** Stable per presenter across remounts — the binding mints it. */
export type SurfacePresenterKey = string | number

export interface SurfaceReadiness {
  /** Rises on every source replacement. Receipts carry the one they were earned in. */
  readonly lifetime: number
  /** Presenters registered for this lifetime. */
  readonly registered: readonly SurfacePresenterKey[]
  /** Those whose first eligible color-writing draw has completed. */
  readonly proven: readonly SurfacePresenterKey[]
}

/** A Surface with its first source and no presenters yet. */
export function readinessAtBirth(): SurfaceReadiness {
  return { lifetime: 1, registered: [], proven: [] }
}

/** A presenter joins. Re-registering the same key is a no-op. */
export function readinessRegister(
  state: SurfaceReadiness,
  key: SurfacePresenterKey,
): SurfaceReadiness {
  if (state.registered.includes(key)) return state
  return { lifetime: state.lifetime, registered: [...state.registered, key], proven: state.proven }
}

/**
 * A presenter leaves. Its proof leaves with it — a receipt from a presenter
 * that is gone cannot stand in for one that is still warming.
 */
export function readinessUnregister(
  state: SurfaceReadiness,
  key: SurfacePresenterKey,
): SurfaceReadiness {
  if (!state.registered.includes(key)) return state
  return {
    lifetime: state.lifetime,
    registered: state.registered.filter((entry) => entry !== key),
    proven: state.proven.filter((entry) => entry !== key),
  }
}

/**
 * Record one presenter's first eligible draw. Refused — same reference — when
 * the receipt belongs to another lifetime, when the presenter is not
 * registered, or when it has already proven itself.
 */
export function readinessProve(
  state: SurfaceReadiness,
  key: SurfacePresenterKey,
  lifetime: number,
): SurfaceReadiness {
  if (lifetime !== state.lifetime) return state
  if (!state.registered.includes(key)) return state
  if (state.proven.includes(key)) return state
  return { lifetime: state.lifetime, registered: state.registered, proven: [...state.proven, key] }
}

/**
 * The source was replaced. Registrations survive — the presenters are the
 * same meshes and did not unmount — but every proof is void, because what
 * they proved was the old pixels.
 */
export function readinessReborn(state: SurfaceReadiness): SurfaceReadiness {
  return { lifetime: state.lifetime + 1, registered: state.registered, proven: [] }
}

/** Presenters still owed a first draw. */
export function readinessPending(state: SurfaceReadiness): readonly SurfacePresenterKey[] {
  return state.registered.filter((key) => !state.proven.includes(key))
}

/**
 * May this Surface report `onReady`, and may a handoff release the page?
 *
 * A Surface with NO registered presenters is not ready. Readiness is a
 * statement about pixels that exist, and the empty set would otherwise
 * report ready in the one window that matters most — after the source has
 * mounted and before its presenters have.
 */
export function readinessSettled(state: SurfaceReadiness): boolean {
  return state.registered.length > 0 && readinessPending(state).length === 0
}
