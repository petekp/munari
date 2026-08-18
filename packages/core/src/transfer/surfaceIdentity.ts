// Surface identity — the ledger that says who speaks for one piece of
// content, and which of its parts have shown up.
//
// The law: a Surface has AT MOST ONE controller at a time, and its
// registrations belong to the epoch that was live when they were made.
// Everything downstream — readiness, evidence, the crossing itself —
// reads a registration only if the epoch still matches, so a stale
// declaration cannot vote on a live handoff.
//
// The fault this exists for is invisible in review. A handle outlives the
// component that made it, and React mounts twice under Strict Mode, so the
// naive ledger sees acquire → acquire → release and ends up holding a
// released identity: the second mount's registrations are attributed to a
// controller that no longer exists, and the Surface silently answers to
// nobody. Tokens plus an epoch make the double-invoke a no-op instead of a
// corruption — release with a token that is not the live one changes
// nothing.
//
// Every transition returns the SAME state reference when it changes
// nothing, so a caller detects a no-op — and therefore a duplicate
// controller or a duplicate part — by identity, with no second predicate to
// keep in sync. This mirrors `crossingRequest`.
//
// Core owns the ledger because it is renderer-agnostic. The binding owns
// token minting, React commit order, and the developer diagnostics it
// prints when a transition reports a no-op it did not expect.

/** One named source and presenter set inside an atomic multi-part Surface. */
export type SurfacePartId = string | number

/** The live controller and the lifetime its registrations belong to. */
export interface SurfaceIdentity {
  /**
   * Rises on every acquire. `0` means no controller has ever held this
   * identity, so a receipt stamped `0` is from before the Surface existed.
   */
  readonly epoch: number
  /** The live controller's token, or `null` while the identity is free. */
  readonly controller: number | null
}

/** The rest pose: no controller, no epoch spent. */
export function surfaceUnclaimed(): SurfaceIdentity {
  return { epoch: 0, controller: null }
}

/**
 * Claim the identity for `token`. A free identity advances to a new epoch.
 * A claim by the controller that already holds it is a no-op; a claim while
 * a DIFFERENT controller holds it is the duplicate-controller fault, and is
 * also a no-op — the incumbent keeps the identity, so a second declaration
 * can never take content away from the tree that is already presenting it.
 * Both no-ops return the same reference.
 */
export function surfaceAcquire(state: SurfaceIdentity, token: number): SurfaceIdentity {
  if (state.controller !== null) return state
  return { epoch: state.epoch + 1, controller: token }
}

/**
 * Release the identity. Only the live controller can; a release carrying a
 * stale token returns the same reference, which is what makes Strict Mode's
 * mount → unmount → mount land on the second mount's registrations rather
 * than tearing them down with the first mount's cleanup.
 *
 * The epoch does NOT fall back. A released identity keeps its number so a
 * receipt still travelling from the old lifetime reads as stale rather
 * than as the next one.
 */
export function surfaceRelease(state: SurfaceIdentity, token: number): SurfaceIdentity {
  if (state.controller !== token) return state
  return { epoch: state.epoch, controller: null }
}

/** Does `token` hold this identity right now? */
export function surfaceHolds(state: SurfaceIdentity, token: number): boolean {
  return state.controller === token
}

/**
 * Is a registration or receipt stamped `epoch` still speaking for the live
 * lifetime? Anything from an earlier epoch is stale by construction, and
 * an unclaimed identity has no live lifetime to speak for.
 */
export function surfaceEpochCurrent(state: SurfaceIdentity, epoch: number): boolean {
  return state.controller !== null && epoch === state.epoch
}

// ── part sets ────────────────────────────────────────────────────────────

/**
 * The parts a multi-part Surface is waiting on, and the ones that have
 * declared themselves. An atomic Surface transfers all of its parts or none
 * of them, so this is a set-completeness question and never a count: two
 * presenters for one part is legal (several WebGL presentations may share a
 * part), and counting would read that as a second part arriving.
 */
export interface SurfacePartSet {
  /** Declared by `Surface.Part`, in declaration order. */
  readonly expected: readonly SurfacePartId[]
  /** Declared by a WebGL presenter naming that part. */
  readonly registered: readonly SurfacePartId[]
}

export function partSetEmpty(): SurfacePartSet {
  return { expected: [], registered: [] }
}

/**
 * Declare a part. A duplicate id is a fault and returns the same reference:
 * ids are the application's own, and reorderable parts that fall back to
 * array index produce two parts claiming one id, which would let a set look
 * complete while one part has no presenter at all.
 */
export function partSetExpect(set: SurfacePartSet, id: SurfacePartId): SurfacePartSet {
  if (set.expected.includes(id)) return set
  return { expected: [...set.expected, id], registered: set.registered }
}

/** Withdraw a declared part. Unknown ids are a no-op. */
export function partSetForget(set: SurfacePartSet, id: SurfacePartId): SurfacePartSet {
  if (!set.expected.includes(id)) return set
  return {
    expected: set.expected.filter((part) => part !== id),
    registered: set.registered.filter((part) => part !== id),
  }
}

/**
 * A presenter reports that it covers `id`. Registering a part nobody
 * declared is a no-op — a presenter naming a part that does not exist must
 * not be able to complete a set on its own.
 */
export function partSetRegister(set: SurfacePartSet, id: SurfacePartId): SurfacePartSet {
  if (!set.expected.includes(id)) return set
  if (set.registered.includes(id)) return set
  return { expected: set.expected, registered: [...set.registered, id] }
}

/** A presenter goes away. The part stays expected; the set is incomplete again. */
export function partSetUnregister(set: SurfacePartSet, id: SurfacePartId): SurfacePartSet {
  if (!set.registered.includes(id)) return set
  return {
    expected: set.expected,
    registered: set.registered.filter((part) => part !== id),
  }
}

/** The declared parts with no presenter — what keeps DOM visible. */
export function partSetMissing(set: SurfacePartSet): readonly SurfacePartId[] {
  return set.expected.filter((id) => !set.registered.includes(id))
}

/**
 * May this Surface attempt a handoff? An EMPTY set is not complete: a
 * source-free root with no parts has declared no content, and treating it
 * as ready would release the page for a Surface with nothing to present.
 */
export function partSetComplete(set: SurfacePartSet): boolean {
  return set.expected.length > 0 && partSetMissing(set).length === 0
}
