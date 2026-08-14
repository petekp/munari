// The genie warp — the law behind the minimize.
//
// A pure mapping from sheet coordinates to panel-local space. The scene
// samples it once per vertex per frame; the tests sample it on a grid.
// Nothing here knows about meshes, textures, or time — `t` arrives
// already eased.
//
// Two constraints carry the hold story, and both are pinned by
// genieLaw.test.ts:
//
//   t = 0 is an EXACT identity. The moment before the sheet lifts and
//   the moment after it lands are moments the compositor owns, and the
//   mesh must agree with the page to the pixel there — "almost at rest"
//   would be a visible seam at the swap.
//
//   t = 1 fits the mouth. Every point of the sheet sits inside the dock
//   slot's half-width, so the landing thumbnail can own the pixels next.
//
// Geometry of the warp: the funnel is a fixed shape in space, living
// entirely BETWEEN the window's resting bottom edge and the dock mouth.
// Vertices above the resting bottom edge are untouched by the pinch
// (that is what makes t = 0 an identity, with no blend weight needed);
// a vertex pinches only as the stretch or the slide carries it below
// that line, which is also how the real thing behaved: the curve lives
// under the window, and the window drains through it.

export interface GenieParams {
  /** Sheet size at rest, world units. */
  w: number
  h: number
  /** Dock mouth centre, panel-local. Must sit below the resting sheet. */
  dockX: number
  dockY: number
  /** Half-width of the mouth — the width the sheet must fit at t = 1. */
  slotHalf: number
  /**
   * When the bottom edge finishes its travel to the mouth (the stretch),
   * and when the top edge starts its own (the slide). They overlap:
   * the stretch is still finishing as the drain begins, which is what
   * reads as suction rather than as two animations in a row.
   */
  stretchEnd: number
  slideStart: number
  /**
   * Exponent on the funnel's flare. 1 is the plain smoothstep S-curve;
   * above 1 lengthens the throat (narrow for longer before flaring).
   */
  throat: number
  /**
   * Exponent on the NEAR edge — the funnel edge on the dock's side.
   * The funnel is asymmetric, which is the classic silhouette: the near
   * edge plants early into a taut, near-vertical line above the mouth
   * corner (sway, the higher exponent), while the far edge holds wide
   * and does the long S flare (throat). sway ≥ throat also PROVES the
   * funnel never folds: the edge gap is 2·slotHalf + (w − 2·slotHalf)·
   * q^throat, positive at every height. A symmetric center/width form
   * cannot have the S without the wide sheet bulging past the dock
   * line — measured as a hull breach the first time it was tried.
   */
  sway: number
  /**
   * Radius of an optional loop near the mouth. Zero keeps the classic S.
   * A signed value adds one full tangent turn — the sign picks which side
   * of the drain the circle sits on, and the path bows out to 2·|radius|
   * on that side — while preserving the exact rest and dock identities.
   */
  loopRadius: number
}

export const GENIE_DEFAULTS: Omit<GenieParams, 'w' | 'h' | 'dockX' | 'dockY' | 'slotHalf'> = {
  stretchEnd: 0.45,
  slideStart: 0.25,
  throat: 1.15,
  sway: 1.95,
  loopRadius: 0,
}

// The edge paths keep one quarter of their linear slope at both hold
// walls. The drive itself still leaves either wall from rest, so takeoff
// remains gentle. On arrival, however, real geometric velocity survives
// for the landing spring to consume instead of the sheet easing to a stop
// and starting a separate wobble one frame later.
const EDGE_MOMENTUM = 0.25

function momentumstep(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  const smooth = k * k * (3 - 2 * k)
  return EDGE_MOMENTUM * k + (1 - EDGE_MOMENTUM) * smooth
}

function smootherstep(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return k * k * k * (k * (k * 6 - 15) + 10)
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

function baseY(v: number, t: number, p: GenieParams): number {
  const yTop0 = p.h / 2
  const yBot0 = -p.h / 2
  const yBot = lerp(yBot0, p.dockY, momentumstep(0, p.stretchEnd, t))
  const yTop = lerp(yTop0, p.dockY, momentumstep(p.slideStart, 1, t))
  return lerp(yTop, yBot, v)
}

/**
 * Signed screen-space velocity of the bottom edge as it reaches rest.
 * `tVelocity` is the drive's signed progress speed in t/s; a restore has
 * a negative value and returns a positive y velocity because the sheet is
 * moving upward. This is the exact endpoint derivative of `baseY`, so the
 * settle spring begins with the velocity the visible geometry actually had.
 */
export function genieRestBottomVelocity(tVelocity: number, p: GenieParams): number {
  const bottomJourney = p.dockY + p.h / 2
  return (bottomJourney * EDGE_MOMENTUM * tVelocity) / p.stretchEnd
}

// Where the turn lives in the funnel: below loopStart the drain curls,
// below loopEnd it has already straightened for the icon neck. Kept in
// the lower, narrow part so the path reads as a loop rather than a broad S.
const LOOP_START = 0.66
const LOOP_END = 0.08

function loopOffset(q: number, radius: number): { x: number; y: number } {
  if (radius === 0 || q >= LOOP_START || q <= LOOP_END) return { x: 0, y: 0 }
  // One full turn around a circle entered TANGENT to the drain. A vertical
  // path can only meet a circle tangentially at the circle's side, so the
  // whole turn lives on one side of the centreline: x = r(1 − cos θ) and
  // its slope are both zero at θ = 0 and 2π, which is what lets the loop
  // begin and end with no lead-in swing and no radius envelope. Both of
  // those existed before to hide a sideways (non-tangent) entry, and each
  // return-to-zero they made pinched the silhouette into an hourglass.
  // Easing θ keeps entry and exit flat through curvature as well, so the
  // straight drain and the turn meet with no visible change in bend, and
  // the sheet's taper — monotone in the row's height by construction —
  // stays the only thing shaping the outline.
  const d = (LOOP_START - q) / (LOOP_START - LOOP_END)
  const angle = 2 * Math.PI * smootherstep(0, 1, d)
  return {
    x: radius * (1 - Math.cos(angle)),
    y: -Math.abs(radius) * Math.sin(angle),
  }
}

/**
 * Map a sheet point to panel-local space.
 *
 * `u` runs 0 → 1 left to right, `v` runs 0 → 1 TOP to BOTTOM (texture
 * convention, so a PlaneGeometry's UVs feed straight in), `t` runs
 * 0 (at rest) → 1 (in the dock).
 *
 * `k` is the width of the row this point sits on, as a fraction of the
 * sheet's resting width — 1 above the funnel, 2·slotHalf/w at the mouth.
 * It falls out of the same lerp that places `x` (the law is linear in
 * `u`, so a row's width is just its two edges), and it is returned
 * rather than recovered later because everything downstream that wants
 * to know how hard a piece of the sheet is being squeezed would
 * otherwise have to evaluate this function twice to find out.
 */
export function genieWarp(
  u: number,
  v: number,
  t: number,
  p: GenieParams,
): { x: number; y: number; k: number } {
  const yBot0 = -p.h / 2

  // The two edges own the timing. The bottom edge is the leading edge:
  // it travels to the mouth over [0, stretchEnd]. The top edge is the
  // trailing edge: it holds still until slideStart, then follows. Rows
  // between them interpolate, so the sheet stretches while the edges
  // disagree and drains while they agree.
  const yBase = baseY(v, t, p)

  // The pinch reads the vertex's CURRENT height, not its rest height:
  // q = 1 at (and above) the resting bottom edge, 0 at the mouth. A
  // vertex is squeezed by where it IS in the funnel, which is why the
  // remaining window narrows on its way down without any extra state.
  const rawPath = (yBase - p.dockY) / (yBot0 - p.dockY)
  // The looped sheet starts its horizontal bend in a shallow band above the
  // old bottom edge. Without this band, a long vertical side meets the funnel
  // at one visible point. The band is zero at rest and grows smoothly with
  // the flight, so t = 0 stays an exact identity while the moving silhouette
  // becomes one continuous, round curve.
  const shoulder = p.loopRadius === 0 ? 0 : 0.28 * smootherstep(0, 0.55, t)
  const qPath = Math.min(1, Math.max(0, rawPath / (1 + shoulder)))
  const loopPath = Math.min(1, Math.max(0, rawPath))
  const q = smootherstep(0, 1, qPath)

  // The hold moments are exact by construction, not by float luck:
  // untouched above the funnel, seated in the slot at the mouth.
  if (q === 1) return { x: (u - 0.5) * p.w, y: yBase, k: 1 }
  if (q === 0)
    return {
      x: p.dockX + (u - 0.5) * 2 * p.slotHalf,
      y: yBase,
      k: (2 * p.slotHalf) / p.w,
    }

  const sFar = p.throat === 1 ? q : Math.pow(q, p.throat)
  const sNear = Math.pow(q, p.sway)

  // Two edges, two exponents (see `sway`): the near edge plants into its
  // taut line above the mouth corner early, the far edge holds wide and
  // does the long flare. Each edge travels straight from its rest corner
  // to its mouth corner, which is what keeps the whole sheet inside the
  // hull of rest sheet and mouth — no transient bulge past the dock.
  const nearIsRight = p.dockX >= 0
  const xR = lerp(p.dockX + p.slotHalf, p.w / 2, nearIsRight ? sNear : sFar)
  const xL = lerp(p.dockX - p.slotHalf, -p.w / 2, nearIsRight ? sFar : sNear)
  const loop = loopOffset(loopPath, p.loopRadius)
  return {
    x: lerp(xL, xR, u) + loop.x,
    y: yBase + loop.y,
    k: (xR - xL) / p.w,
  }
}

/**
 * The inverse the grab gesture needs: the t that puts the sheet's
 * unlooped MIDLINE (v = 0.5) at `targetY`. The visual path can curl, but
 * the hand still needs one monotonic progress axis. The base midline is
 * that axis: the top edge holds before slideStart and the bottom edge parks
 * after stretchEnd, while their midpoint keeps moving. Solved by bisection:
 * forty halvings of [0, 1] land within 1e-12, far under a device pixel.
 */
export function genieGrabSolve(targetY: number, p: GenieParams): number {
  const midY = (t: number) => baseY(0.5, t, p)
  if (targetY >= midY(0)) return 0
  if (targetY <= midY(1)) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (midY(mid) > targetY) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ── the settle: what the landing does with its momentum ─────────────────

export interface SettleParams {
  /** Wobble frequency, Hz. */
  hz: number
  /** Envelope time constant, seconds. */
  decay: number
  /** Amplitude clamp, px — what makes the 350ms budget hold for ANY
   *  arrival speed (genieLaw.test.ts pins it). */
  maxA: number
}

export const SETTLE_DEFAULTS: SettleParams = {
  hz: 3.2,
  decay: 0.1,
  maxA: 14,
}

/**
 * The wobble that consumes a landing's momentum: a decaying sine whose
 * initial SLOPE equals the arrival velocity (A = v/ω does that), so
 * motion is continuous through the moment of contact — the sheet does
 * not stop and then wobble, the wobble IS how it stops. Returns a px
 * offset for the scene to apply to the edge that carried that momentum.
 */
export function genieSettle(tau: number, vArrivalPx: number, s: SettleParams): number {
  const omega = 2 * Math.PI * s.hz
  const a = Math.sign(vArrivalPx) * Math.min(s.maxA, Math.abs(vArrivalPx) / omega)
  return a * Math.exp(-tau / s.decay) * Math.sin(omega * tau)
}

/** Done when the envelope is under half a device pixel — the identity
 *  swap may only happen then. */
export function genieSettleDone(tau: number, vArrivalPx: number, s: SettleParams): boolean {
  const omega = 2 * Math.PI * s.hz
  const a = Math.min(s.maxA, Math.abs(vArrivalPx) / omega)
  return a * Math.exp(-tau / s.decay) < 0.5
}
