// The genie warp — the law behind the minimize.
//
// A pure mapping from sheet coordinates to panel-local space. The scene
// samples it once per vertex per frame; the tests sample it on a grid.
// Nothing here knows about meshes, textures, or time — `t` arrives
// already eased.
//
// Two constraints carry the custody story, and both are pinned by
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
}

export const GENIE_DEFAULTS: Omit<GenieParams, 'w' | 'h' | 'dockX' | 'dockY' | 'slotHalf'> = {
  stretchEnd: 0.45,
  slideStart: 0.25,
  throat: 1.3,
  sway: 2.4,
}

function smoothstep(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return k * k * (3 - 2 * k)
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
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
  const yTop0 = p.h / 2
  const yBot0 = -p.h / 2

  // The two edges own the timing. The bottom edge is the leading edge:
  // it travels to the mouth over [0, stretchEnd]. The top edge is the
  // trailing edge: it holds still until slideStart, then follows. Rows
  // between them interpolate, so the sheet stretches while the edges
  // disagree and drains while they agree.
  const yBot = lerp(yBot0, p.dockY, smoothstep(0, p.stretchEnd, t))
  const yTop = lerp(yTop0, p.dockY, smoothstep(p.slideStart, 1, t))
  const y = lerp(yTop, yBot, v)

  // The pinch reads the vertex's CURRENT height, not its rest height:
  // q = 1 at (and above) the resting bottom edge, 0 at the mouth. A
  // vertex is squeezed by where it IS in the funnel, which is why the
  // remaining window narrows on its way down without any extra state.
  const q = smoothstep(0, 1, Math.min(1, Math.max(0, (y - p.dockY) / (yBot0 - p.dockY))))

  // The custody moments are exact by construction, not by float luck:
  // untouched above the funnel, seated in the slot at the mouth.
  if (q === 1) return { x: (u - 0.5) * p.w, y, k: 1 }
  if (q === 0) return { x: p.dockX + (u - 0.5) * 2 * p.slotHalf, y, k: (2 * p.slotHalf) / p.w }

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
  return { x: lerp(xL, xR, u), y, k: (xR - xL) / p.w }
}

/**
 * The inverse the grab gesture needs: the t that puts the sheet's
 * MIDLINE (u = 0.5, v = 0.5) at `targetY`. The midline is the one row
 * that moves strictly monotonically through the whole drain — the top
 * edge holds still before slideStart and the bottom edge parks at the
 * mouth after stretchEnd, so an inverse anchored to either edge would
 * jump across those plateaus under a steady hand. Solved by bisection:
 * forty halvings of [0, 1] land within 1e-12, far under a device pixel.
 */
export function genieGrabSolve(targetY: number, p: GenieParams): number {
  const midY = (t: number) => genieWarp(0.5, 0.5, t, p).y
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
 * offset for the scene to apply as it sees fit (the genie hangs it on
 * the top edge, scaled off toward the anchored bottom).
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
