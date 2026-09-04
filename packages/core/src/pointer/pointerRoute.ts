// The pointer route — which of the two canvas-side routes hears the pointer
// for one presented Surface, this instant.
//
// `crossingPointer` (decisions.md #33) settles the first question: page or
// canvas, per phase, following the eye. This settles the second, and only
// where the canvas won. Two routes can deliver a pointer into a parked
// subtree:
//
//   relay   — raycast, uv, page point, element walk, synthetic dispatch. It
//             works for every pose, including ones no matrix can express, and
//             it works on browsers with no origin trial at all.
//   native  — the parked canvas rides above the renderer canvas wearing the
//             presented pose as a `matrix3d`, and the browser hit-tests the
//             real child through it. Trusted clicks, real :hover, real focus,
//             a real caret, real selection.
//
// The law: exactly one route owns input at any instant, and the route is a
// verdict, not a negotiation. Neither route asks the other what it is doing;
// both ask this function, and a change of answer is a handoff with named
// duties — the same shape as every other transfer in this kernel.
//
// The fault: decision #33 was written because one press was heard by two live
// copies of the same content, and the visible copy was not the one that
// changed (measured 2026-08-19, gate:lifting-pointer — 3/3 clicks routed to
// the hidden copy through the whole 'lifting' dwell). Two routes into ONE
// copy is the same fault at a smaller scale and it is harder to see: the
// press lands on the right element twice, so a button looks fine and a
// counter counts two, a toggle returns to where it started, and a form
// submits twice. Making the route a single derived value, rather than two
// enable flags that happen to disagree, is what makes that state
// unrepresentable.
//
// Why each condition is a condition, with what measured it:
//
//   planar   — a `matrix3d` is a planar homography. Deformation moves
//              vertices (decisions.md #35), so a bent Surface has no matrix
//              to wear, and a pose seen edge-on has no hit region a hand can
//              land on.
//   facing   — three's default raycast refuses a back-facing hit under
//              `FrontSide`, and the browser knows nothing of material sides,
//              so the law refuses the same poses the relay would. Read from
//              the projected winding rather than told to CSS: whether
//              `backface-visibility` even governs hit-testing of an unpainted
//              canvas child is unmeasured, and the winding is arithmetic that
//              is already in hand.
//   onScreen — a parked canvas whose transformed box leaves the viewport
//              stops receiving paint records; the compositor skips it.
//   capable  — the whole rig is an origin-trial behaviour.
//
// Coverage is NOT a condition, by construction rather than by luck: the
// canvas wears the pose itself, and the native hit clip follows the
// TRANSFORMED canvas box (measured 2026-09-02, Chrome 151, platform.md #21) —
// so the clip IS the projected quad, for every planar pose including tilts.
// The canvas's CSS box never changes size, so the capture's replay scale
// (platform.md #8) is untouched.
//
// Ownership: this module decides, and does nothing. `surfacePose.ts` supplies
// the geometry the conditions are read from, `nativeRoute.ts` performs the
// duties, and the binding is what evaluates the conditions each frame.

/**
 * Who hears the pointer for one presented Surface. `'page'` is the phase
 * verdict standing — the canvas does not hear at all, so neither canvas-side
 * route owns anything.
 */
export type PointerRoute = 'page' | 'native' | 'relay'

/**
 * What the consumer asked for. `'relay'` pins the synthetic route whatever
 * the platform can do; `'auto'` takes the native route wherever every other
 * condition allows it.
 */
export type PointerRouteRequest = 'auto' | 'relay'

/** The facts the verdict is a function of. Every one of them is observed. */
export interface PointerRouteConditions {
  readonly request: PointerRouteRequest
  /** The platform can hit-test a canvas child through a transform. */
  readonly capable: boolean
  /** The canvas is the side that hears this phase (`crossingPointer`). */
  readonly hearing: boolean
  /** The presented pose is a planar homography with a pointable hit region. */
  readonly planar: boolean
  /** The sheet faces the camera, or its material takes hits from both sides. */
  readonly facing: boolean
  /** The projected quad still reaches the viewport. */
  readonly onScreen: boolean
}

/**
 * What a route does while it owns input. Two duties, and no route performs
 * both — that is the "exactly one owner" law, written where it can be
 * checked rather than asserted in prose.
 */
export interface PointerRouteDuties {
  /** Dispatches synthetic events into the parked subtree, and takes rays to
   *  find out where. A mesh with this duty off declines at the raycast. */
  readonly relays: boolean
  /** Lifts the parked canvas over the renderer canvas wearing the presented
   *  pose, so the browser delivers the real event itself. */
  readonly rides: boolean
}

/**
 * The duties of a route change, in the order they must run.
 *
 * Outgoing first, incoming second, always: both routes speak through the same
 * DOM, and the relay's coordinates come from the parked subtree's
 * untransformed layout box. Re-arming the relay before parking the rig would
 * read the transformed bounding rect and land the arrival hover in the wrong
 * place — which looks exactly like a rounding bug and is not one.
 */
export interface PointerRouteHandoff {
  readonly from: PointerRoute
  readonly to: PointerRoute
  /** Cancel the open relayed press and clear the twins the relay stamped. */
  readonly closeRelay: boolean
  /** Put the parked canvas back where the rest of the library expects it. */
  readonly park: boolean
  /** Lift the parked canvas and pose it before the next event arrives. */
  readonly lift: boolean
  /** Re-arm relayed hover at the pointer's last trusted place. */
  readonly rearmRelay: boolean
  /**
   * Stamp the hover twin on the PAGE copy until the browser's own :hover
   * re-forms there. An arrival action rather than a standing duty, which is
   * why it lives on the handoff and not in `PointerRouteDuties` — the page
   * route's whole job is to stop doing things.
   */
  readonly bridgePage: boolean
  /** False when the route did not actually change; every duty is then off. */
  readonly moved: boolean
}

const PAGE_DUTIES: PointerRouteDuties = { relays: false, rides: false }
const RELAY_DUTIES: PointerRouteDuties = { relays: true, rides: false }
const NATIVE_DUTIES: PointerRouteDuties = { relays: false, rides: true }

/** Who hears the pointer, given everything observed about this instant. */
export function routeFor(conditions: PointerRouteConditions): PointerRoute {
  // The phase verdict is not this law's to revisit. When the page holds the
  // pixels, the page holds the pointer.
  if (!conditions.hearing) return 'page'
  if (
    conditions.request === 'auto' &&
    conditions.capable &&
    conditions.planar &&
    conditions.facing &&
    conditions.onScreen
  ) {
    return 'native'
  }
  // The relay is total on purpose: every canvas-side case the native route
  // declines is a case the relay already served. A fallback with its own
  // preconditions would leave gaps where nothing hears at all.
  return 'relay'
}

export function pointerRouteDuties(route: PointerRoute): PointerRouteDuties {
  if (route === 'relay') return RELAY_DUTIES
  if (route === 'native') return NATIVE_DUTIES
  return PAGE_DUTIES
}

/** The difference of two routes' duties — the whole content of a switch. */
export function pointerRouteHandoff(
  from: PointerRoute,
  to: PointerRoute,
): PointerRouteHandoff {
  const before = pointerRouteDuties(from)
  const after = pointerRouteDuties(to)
  return {
    from,
    to,
    closeRelay: before.relays && !after.relays,
    park: before.rides && !after.rides,
    lift: !before.rides && after.rides,
    rearmRelay: !before.relays && after.relays,
    bridgePage: to === 'page' && from !== 'page',
    moved: from !== to,
  }
}
