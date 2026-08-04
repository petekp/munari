// The passage arithmetic.
//
// Two properties matter more than the rest, and both are about the ENDS of a
// flight rather than the middle:
//
//   AT t = 0 AND t = 1 THE CARD IS THE DOM IT REPLACES. Same box, same size,
//   on the plane, unrotated. That is what makes the handoff invisible in both
//   directions — the frame where the mesh appears and the frame where it
//   leaves are pixel copies of the element underneath. An off-by-a-half here
//   is a visible twitch at every liftoff and landing, and it is the kind of
//   thing that looks like a rendering bug for a week.
//
//   THE BOX IS INTERPOLATED, NOT A SCALE. `poseAt` returns a width and a
//   height, and the scene hands them to a Surface as its layout size. If this
//   ever returned a scale factor instead, the card would be a stretched
//   picture of a tile rather than a component laid out at that width — which
//   is the entire difference between this lab and a crossfade.

import { describe, expect, it } from 'vitest'

import { MAX_TEXTURE_EDGE } from 'anamorph'

import {
  HEIGHT_OMEGA,
  SNAP_FADE,
  atTarget,
  centreOf,
  densityAt,
  followHeight,
  gridSnap,
  landed,
  poseAt,
  snapWeight,
  springStep,
  type Box,
} from './passagePath'

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
})

const VIEW_W = 1200
const VIEW_H = 800

describe('centreOf', () => {
  it('puts a centred box at the origin — the viewport IS the frustum at z = 0', () => {
    expect(centreOf(box(500, 350, 200, 100), VIEW_W, VIEW_H)).toEqual({ x: 0, y: 0 })
  })

  it('is left-negative and up-positive, because CSS y goes down and world y goes up', () => {
    const c = centreOf(box(0, 0, 100, 60), VIEW_W, VIEW_H)
    expect(c.x).toBe(-550)
    expect(c.y).toBe(370)
  })
})

describe('poseAt', () => {
  const from = box(80, 120, 300, 220)
  const to = box(240, 200, 900, 560)

  it('is exactly the source box at t = 0 — flat, unrotated, on the plane', () => {
    const p = poseAt(from, to, 0, VIEW_W, VIEW_H, 260, 0.3)
    expect(p.width).toBe(300)
    expect(p.height).toBe(220)
    expect(p.z).toBeCloseTo(0, 10)
    expect(p.rotX).toBeCloseTo(0, 10)
    expect(p.rotY).toBeCloseTo(0, 10)
    expect(p).toMatchObject(centreOf(from, VIEW_W, VIEW_H))
  })

  it('is exactly the destination box at t = 1 — the landing is a pixel copy too', () => {
    const p = poseAt(from, to, 1, VIEW_W, VIEW_H, 260, 0.3)
    expect(p.width).toBe(900)
    expect(p.height).toBe(560)
    expect(p.z).toBeCloseTo(0, 10)
    expect(p.rotX).toBeCloseTo(0, 10)
    expect(p.rotY).toBeCloseTo(0, 10)
    expect(p).toMatchObject(centreOf(to, VIEW_W, VIEW_H))
  })

  it('interpolates the BOX, so the component lays itself out at a width nobody designed', () => {
    // Not a scale factor: a real width, handed to a real layout.
    const p = poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3)
    expect(p.width).toBeGreaterThan(from.width)
    expect(p.width).toBeLessThan(to.width)
  })

  it('moves ahead of its own growth, so the widest moment is not also the furthest', () => {
    // Three magnifications land at once otherwise — biggest, nearest the eye,
    // and furthest from where it is going — and the card leaves the screen.
    const half = poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3)
    const linearWidth = from.width + (to.width - from.width) * 0.5
    const linearLeft = from.left + (to.left - from.left) * 0.5
    expect(half.width).toBeLessThan(linearWidth)
    // Position is past halfway while size is behind it.
    const leftEdge = half.x + VIEW_W / 2 - half.width / 2
    expect(leftEdge).toBeGreaterThan(linearLeft)
  })

  it('takes a measured height over an interpolated one', () => {
    // How tall a responsive component is at width w is decided by layout, not
    // by a line between two known heights — it STEPS at every container
    // breakpoint. Interpolating it leaves the Surface taller than the card
    // inside it, and the bare strip of parked canvas below shows as a pale
    // band under the card for the whole flight.
    const p = poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3, 417)
    expect(p.height).toBe(417)
    // …and the box still grows downward from the interpolated top, rather
    // than pushing its own header up as it opens.
    const interp = poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3)
    const topOf = (q: { y: number; height: number }) => VIEW_H / 2 - q.y - q.height / 2
    expect(topOf(p)).toBeCloseTo(topOf(interp), 6)
  })

  it('ignores a measured height that is not a real measurement', () => {
    // Before the first paint there is nothing to measure, and a zero would
    // collapse the card to a line.
    expect(poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3, 0).height).toBeGreaterThan(0)
    expect(poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3, null).height).toBeGreaterThan(0)
  })

  it('reaches its full lift at the halfway point and nowhere else', () => {
    expect(poseAt(from, to, 0.5, VIEW_W, VIEW_H, 260, 0.3).z).toBeCloseTo(260, 6)
    expect(poseAt(from, to, 0.25, VIEW_W, VIEW_H, 260, 0.3).z).toBeLessThan(260)
    expect(poseAt(from, to, 0.75, VIEW_W, VIEW_H, 260, 0.3).z).toBeLessThan(260)
  })

  it('banks into the direction of travel', () => {
    // Rightward travel yaws one way; the mirror-image move yaws the other.
    const right = poseAt(from, box(900, 120, 300, 220), 0.5, VIEW_W, VIEW_H, 260, 0.3)
    const left = poseAt(box(900, 120, 300, 220), from, 0.5, VIEW_W, VIEW_H, 260, 0.3)
    expect(Math.sign(right.rotY)).toBe(-Math.sign(left.rotY))
    expect(Math.abs(right.rotY)).toBeCloseTo(0.3, 6)
  })

  it('does not twist a card that only moves straight down', () => {
    // A pure vertical move has no rightward component, so nothing should yaw
    // — the tilt is a consequence of the path, not decoration sprayed on it.
    const p = poseAt(from, box(80, 600, 300, 220), 0.5, VIEW_W, VIEW_H, 260, 0.3)
    expect(p.rotY).toBeCloseTo(0, 10)
    expect(Math.abs(p.rotX)).toBeCloseTo(0.3, 6)
  })
})

/**
 * THE PLATE'S TEXEL GRID IS THE CARD'S PIXEL GRID, AND IT ONLY LINES UP WITH THE
 * DISPLAY'S IF THE CARD'S CORNER DOES.
 *
 * The field draws every word as its own quad at its own measured box, and those
 * boxes are fractional — 27 of 27 measured live, median 0.31 px off the grid.
 * That is fine and it is not this: a word's fractional position is baked into
 * the capture, and its uv rect is exactly `box / card`, so the texel it wants
 * and the texel it asks for are the same one. What is NOT fine is the card's own
 * origin. Move the whole plate half a pixel and every glyph in it resamples
 * across two texel columns at once — one bilinear tap, applied uniformly, to
 * type that was rasterized to be read.
 *
 * Measured on the small endpoint 2026-08-04, held at t = 0, gradient energy over
 * the typography band against the same pixels of the real DOM:
 *
 *     DOM                      900.90
 *     mesh, origin at y 147.84 758.02   0.841 — Pete's "noticeably more blurry"
 *     mesh, origin snapped     902.19   1.001
 *
 * Supply was already exact at both endpoints and the mip chain was provably not
 * engaged (poking the sampler to LINEAR produced a byte-identical frame). This
 * is the third budget in `sharpness = supply × phase × transfer`, and it is the
 * one nothing else can compensate for: no amount of density fixes a bad phase,
 * because the extra texels land off-grid too.
 *
 * The snap moves the card off the DOM it is standing in for by up to half a
 * pixel. That is the trade, and it is not close — a half-pixel displacement is
 * invisible, a half-pixel blur is what the user reported.
 */
describe('gridSnap', () => {
  // The measurement above, in its own units: a 1280 × 720 viewport, a 308 × 324
  // card whose page rect put its top at 147.84375, dpr 1.
  const LIVE = { w: 308, h: 324, viewW: 1280, viewH: 720, x: -326, y: 50.15625 }
  const topOf = (y: number, h: number) => LIVE.viewH / 2 - y - h / 2
  const leftOf = (x: number, w: number) => LIVE.viewW / 2 + x - w / 2

  it('puts the card corner on the pixel grid — the regression, in its own numbers', () => {
    expect(topOf(LIVE.y, LIVE.h)).toBe(147.84375)
    const [dx, dy] = gridSnap(LIVE.x, LIVE.y, LIVE.w, LIVE.h, LIVE.viewW, LIVE.viewH, 1, 0)
    expect(leftOf(LIVE.x + dx, LIVE.w)).toBe(160)
    expect(topOf(LIVE.y + dy, LIVE.h)).toBe(148)
  })

  it('moves the card by less than half a pixel to do it', () => {
    const [dx, dy] = gridSnap(LIVE.x, LIVE.y, LIVE.w, LIVE.h, LIVE.viewW, LIVE.viewH, 1, 0)
    expect(Math.abs(dx)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(dy)).toBeLessThanOrEqual(0.5)
  })

  it('leaves a card that is already on the grid exactly where it is', () => {
    // The x axis in the live measurement was already integral, by luck of where
    // the tile sits. Nothing may move it.
    const [dx] = gridSnap(LIVE.x, LIVE.y, LIVE.w, LIVE.h, LIVE.viewW, LIVE.viewH, 1, 0)
    expect(dx).toBe(0)
  })

  /**
   * The grid is the DISPLAY's, not CSS's. On a Retina panel a half-CSS-pixel
   * offset is already on the grid and snapping it would be the error.
   */
  it('snaps to device pixels, so a half CSS pixel is on the grid at dpr 2', () => {
    const y = LIVE.y + 0.5 - 0.15625 // corner at a whole number of half-pixels
    const [, dy] = gridSnap(LIVE.x, y, LIVE.w, LIVE.h, LIVE.viewW, LIVE.viewH, 2, 0)
    expect(dy).toBe(0)
    const [, coarse] = gridSnap(LIVE.x, y, LIVE.w, LIVE.h, LIVE.viewW, LIVE.viewH, 1, 0)
    expect(coarse).not.toBe(0)
  })

  /**
   * And it is a REST snap. Mid-flight the card is magnified, tilted and lifted
   * — there is no phase to be right about, and quantizing a moving card's
   * position is just a way to make it move in steps.
   */
  it('does nothing in the middle of a flight, where there is no grid to be on', () => {
    expect(gridSnap(LIVE.x, LIVE.y, LIVE.w, LIVE.h, LIVE.viewW, LIVE.viewH, 1, 0.5)).toEqual([0, 0])
  })

  it('is at full strength at BOTH endpoints, because both are places to stop', () => {
    expect(snapWeight(0)).toBe(1)
    expect(snapWeight(1)).toBe(1)
  })

  it('arrives continuously, so the last half pixel is a drift and not a jump', () => {
    const w = snapWeight(SNAP_FADE / 2)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(1)
    // Monotone toward each end — no frame where the snap goes backwards.
    for (let i = 1; i <= 8; i++) {
      expect(snapWeight((i / 8) * SNAP_FADE)).toBeLessThanOrEqual(
        snapWeight(((i - 1) / 8) * SNAP_FADE) + 1e-12,
      )
    }
  })

  it('is off well before the flight is halfway', () => {
    expect(snapWeight(SNAP_FADE)).toBe(0)
    expect(snapWeight(1 - SNAP_FADE)).toBe(0)
    expect(snapWeight(0.5)).toBe(0)
  })
})

describe('springStep', () => {
  it('converges on the target', () => {
    let x = 0
    let v = 0
    for (let i = 0; i < 240; i++) [x, v] = springStep(x, v, 1, 11, 1 / 60)
    expect(x).toBeCloseTo(1, 4)
    expect(v).toBeCloseTo(0, 3)
  })

  it('never overshoots — critically damped, so a landing cannot bounce', () => {
    let x = 0
    let v = 0
    for (let i = 0; i < 240; i++) {
      ;[x, v] = springStep(x, v, 1, 11, 1 / 60)
      expect(x).toBeLessThanOrEqual(1.0000001)
    }
  })

  it('survives a backgrounded tab — implicit integration is stable at any dt', () => {
    // An explicit integrator blows up the first time a frame takes 400 ms,
    // which is exactly what happens when someone switches tabs mid-flight.
    let x = 0
    let v = 0
    for (let i = 0; i < 12; i++) [x, v] = springStep(x, v, 1, 11, 0.4)
    expect(Number.isFinite(x)).toBe(true)
    expect(x).toBeGreaterThan(0.9)
    expect(x).toBeLessThanOrEqual(1.0000001)
  })

  it('turns around mid-flight, carrying its momentum through the reversal', () => {
    // Press back while the card is still on its way out: the target moves,
    // the clock does not restart. The velocity at the moment of the turn is
    // still outbound, so the card keeps going briefly before it comes home.
    let x = 0
    let v = 0
    for (let i = 0; i < 12; i++) [x, v] = springStep(x, v, 1, 11, 1 / 60)
    const turned = x
    expect(v).toBeGreaterThan(0)
    ;[x, v] = springStep(x, v, 0, 11, 1 / 60)
    expect(x).toBeGreaterThan(turned)
    for (let i = 0; i < 240; i++) [x, v] = springStep(x, v, 0, 11, 1 / 60)
    expect(x).toBeCloseTo(0, 4)
  })
})

describe('atTarget', () => {
  it('needs both stillness and arrival', () => {
    expect(atTarget(1, 0, 1)).toBe(true)
    // Passing through the target at speed is not landing.
    expect(atTarget(1, 3, 1)).toBe(false)
    expect(atTarget(0.5, 0, 1)).toBe(false)
  })
})

describe('densityAt', () => {
  it('is exactly the page ratio on the plane', () => {
    expect(densityAt(2, 1000, 0, 400, 300)).toBe(2)
  })

  it('rises with the magnification, because a lifted card covers more display', () => {
    // camZ 1000, z 200 → the card is 1000/800 = 1.25× bigger on screen.
    expect(densityAt(2, 1000, 200, 400, 300)).toBeCloseTo(2.5, 6)
  })

  /**
   * The guard is BORROWED, not approximated. This used to assert 4000/3000 — a
   * ceiling the scene invented to keep a margin clear of a 4096 boundary it
   * could not name. `clampScale` is the same call `Surface` makes before it
   * decides whether to warn, so a density that came through here lands exactly
   * on the boundary and reads to `resolveFixedScale` as unchanged (#21).
   */
  it('clamps at the kernel texture guard rather than warning once a frame', () => {
    expect(densityAt(3, 1000, 500, 3000, 400)).toBe(MAX_TEXTURE_EDGE / 3000)
    // The long edge, whichever one it is.
    expect(densityAt(3, 1000, 500, 400, 3000)).toBe(MAX_TEXTURE_EDGE / 3000)
  })

  /**
   * A card lifted all the way to the eye is a division by zero in the density
   * identity. The guard is what makes that a finite (if useless) number rather
   * than an Infinity handed to a canvas allocator.
   */
  it('survives a card lifted onto the camera', () => {
    expect(Number.isFinite(densityAt(2, 1000, 1000, 400, 300))).toBe(true)
  })
})

// ── the height the layout actually wants ─────────────────────────────────
//
// Measured in Chrome on 2026-08-04 by sweeping `.psg-frame`'s width across
// the whole range a passage crosses and reading `.psg-card`'s `offsetHeight`
// at each step: 308 px to 940 px, one sample every 4 px. These are not
// plausible numbers, they are this component's numbers, and every claim below
// is a claim about what the browser did rather than about what a model of it
// would do.
const CARD_H0 = 308
const CARD_HSTEP = 4
const CARD_HEIGHTS = [
  324, 327, 311, 315, 318, 321, 324, 327, 330, 333, 336, 339, 342, 345, 348, 351, 354, 357,
  360, 363, 367, 370, 373, 376, 379, 383, 386, 389, 392, 396, 399, 430, 431, 433, 434, 435,
  437, 438, 439, 441, 442, 423, 425, 426, 427, 428, 430, 431, 433, 414, 415, 416, 418, 419,
  420, 422, 423, 424, 426, 427, 428, 430, 431, 432, 414, 415, 416, 417, 419, 400, 402, 403,
  404, 405, 407, 408, 409, 411, 412, 413, 415, 416, 417, 419, 420, 422, 423, 424, 426, 427,
  429, 430, 431, 433, 434, 436, 437, 439, 440, 442, 443, 445, 446, 535, 538, 540, 543, 545,
  548, 550, 553, 556, 559, 562, 565, 568, 571, 574, 577, 580, 583, 586, 589, 592, 595, 598,
  600, 603, 606, 609, 612, 615, 618, 621, 624, 627, 630, 633, 636, 639, 642, 645, 648, 650,
  654, 656, 659, 662, 665, 668, 671, 674, 677, 680, 683, 686, 689, 692, 695,
]

/** The layout's answer at width `w` — a lookup, so it steps exactly as it did. */
function naturalHeight(w: number): number {
  const i = Math.round((w - CARD_H0) / CARD_HSTEP)
  return CARD_HEIGHTS[Math.min(CARD_HEIGHTS.length - 1, Math.max(0, i))]
}

/**
 * Run the real flight and record, frame by frame, what the layout wanted and
 * what the box did. The spring, the size curve and the frame budget are the
 * scene's own, so this is the flight rather than a model of it.
 */
function flight(follow: boolean, omega = 9.5, dt = 1 / 120) {
  const from = box(40, 500, 308, 324)
  const to = box(300, 120, 940, 695)
  let x = 0
  let v = 0
  let h = from.height
  let hv = 0
  const wanted: number[] = []
  const used: number[] = []
  for (let i = 0; i < 400; i++) {
    ;[x, v] = springStep(x, v, 1, omega, dt)
    const w = from.width + (to.width - from.width) * Math.pow(Math.min(1, x), 1.5)
    const natural = naturalHeight(w)
    if (follow) [h, hv] = followHeight(h, hv, natural, HEIGHT_OMEGA, dt)
    else h = natural
    wanted.push(natural)
    used.push(h)
    if (follow ? landed(x, v, 1, h, natural) : atTarget(x, v, 1)) break
  }
  return { wanted, used }
}

const biggestStep = (s: number[]) =>
  s.slice(1).reduce((m, y, i) => Math.max(m, Math.abs(y - s[i])), 0)

describe('followHeight', () => {
  it('the layout really does step — this is the bug, not a theory', () => {
    // The premise every claim below rests on. If this component's height ever
    // becomes continuous the follower stops being justified, and this test is
    // what will say so.
    const { wanted } = flight(false)
    expect(biggestStep(wanted)).toBeGreaterThan(80)
    // Not one bad breakpoint — seven discontinuities, in both directions.
    const steps = wanted.slice(1).filter((y, i) => Math.abs(y - wanted[i]) > 6)
    expect(steps.length).toBeGreaterThanOrEqual(2)
    expect(wanted.slice(1).some((y, i) => y < wanted[i])).toBe(true)
  })

  it('crosses the same steps without ever jumping', () => {
    // 88 px in one frame is a snap; 8 px is motion. The bound is the whole
    // claim of the fix and is deliberately far below the raw series.
    const { used } = flight(true)
    expect(biggestStep(used)).toBeLessThan(15)
  })

  it('smooths the box without erasing the layout', () => {
    // The failure this rules out is the tempting one: a follower slow enough
    // to flatten the curve would pass the test above and quietly turn the lab
    // back into an interpolation. The box must still visit the shape the
    // layout described — including the dip in the middle, which is the part
    // no interpolator between 324 and 695 could produce at all.
    const a = flight(false)
    const b = flight(true)
    const dip = (s: number[]) => Math.min(...s.slice(20, s.length - 20))
    expect(dip(b.used)).toBeLessThan(dip(a.wanted) + 12)
    expect(Math.max(...b.used)).toBeGreaterThan(Math.max(...a.wanted) - 6)
  })

  it('lands EXACTLY on the height the DOM is handing back', () => {
    // A follower only ever approaches. Half a pixel of disagreement at the
    // landing is a seam at the one moment the whole handoff is judged, so the
    // law snaps rather than converging forever.
    const { wanted, used } = flight(true)
    expect(used[used.length - 1]).toBe(wanted[wanted.length - 1])
  })

  it('settles a visible distance short of the target, which is why the scene snaps', () => {
    // `atTarget`'s threshold is on PROGRESS, and progress is not distance.
    // 0.0015 of the way from a 308 px tile to a 940 px article is most of a
    // pixel of width at the end of a `t^1.5` curve — and once the height comes
    // from measuring the layout rather than from interpolating, that width
    // error is amplified by however steeply the component is growing there.
    // Measured in the browser: the mesh handed over 0.41 px narrow and 1.09 px
    // short, and the card visibly grew at the instant the DOM took over.
    const from = box(40, 500, 308, 324)
    const to = box(300, 120, 940, 695)
    expect(atTarget(1 - 0.0014, 0, 1)).toBe(true)
    const nearly = poseAt(from, to, 1 - 0.0014, VIEW_W, VIEW_H, 150, 0.26)
    expect(to.width - nearly.width).toBeGreaterThan(0.5)
    // The layout is steeper than the box there, so the height error is worse
    // than the width error that caused it.
    const slope =
      (naturalHeight(to.width) - naturalHeight(to.width - 8)) / 8
    expect((to.width - nearly.width) * slope).toBeGreaterThan(0.5)
  })

  it('does not let the position finish while the box is still growing', () => {
    // Measured: with the landing keyed on the position spring alone, the mesh
    // unmounts 1.9 px short and the DOM reappears taller in the same frame.
    // Two springs run in a flight and they do not finish together.
    const from = box(40, 500, 308, 324)
    const to = box(300, 120, 940, 695)
    let [x, v, h, hv] = [0, 0, from.height, 0]
    let positionDone = -1
    let boxDone = -1
    for (let i = 0; i < 400; i++) {
      ;[x, v] = springStep(x, v, 1, 9.5, 1 / 120)
      const w = from.width + (to.width - from.width) * Math.pow(Math.min(1, x), 1.5)
      const natural = naturalHeight(w)
      ;[h, hv] = followHeight(h, hv, natural, HEIGHT_OMEGA, 1 / 120)
      if (positionDone < 0 && atTarget(x, v, 1)) positionDone = i
      if (boxDone < 0 && positionDone >= 0 && h === natural) boxDone = i
      if (boxDone >= 0) break
    }
    expect(positionDone).toBeGreaterThan(0)
    expect(boxDone).toBeGreaterThan(positionDone)
    // `landed` is the predicate that closes the gap, and it is false at the
    // moment `atTarget` alone would have ended the flight.
    expect(landed(1, 0, 1, 693, 695)).toBe(false)
    expect(landed(1, 0, 1, 695, 695)).toBe(true)
  })

  it('is already settled when the layout is', () => {
    let [h, v] = [400, 0]
    for (let i = 0; i < 5; i++) [h, v] = followHeight(h, v, 400, HEIGHT_OMEGA, 1 / 120)
    expect(h).toBe(400)
    expect(v).toBe(0)
  })

  it('closes a breakpoint step in about a tenth of a second', () => {
    // The real 720 px step, 447 → 535. Slow enough to read as motion, fast
    // enough that the box is never visibly behind its own content — this card
    // is `overflow: hidden`, so a lazy follower is a card whose bottom rows
    // stay cut off for as long as it takes. Measured to WITHIN 4 px rather
    // than to equality: the last half-pixel is invisible and takes as long
    // again as the whole visible part of the move.
    let [h, v] = [447, 0]
    let visible = 0
    let settled = 0
    for (let i = 1; i <= 200; i++) {
      ;[h, v] = followHeight(h, v, 535, HEIGHT_OMEGA, 1 / 120)
      if (!visible && Math.abs(535 - h) < 4) visible = i
      if (!settled && h === 535) settled = i
    }
    expect(visible / 120).toBeGreaterThan(0.05)
    expect(visible / 120).toBeLessThan(0.2)
    expect(settled).toBeGreaterThan(0)
  })

  it('trails the layout by more than a hairline, so the box must be TOLD', () => {
    // The consequence that has to be paid for elsewhere, and it is not a
    // rounding error. A critically damped follower trails a ramp in
    // proportion to how fast the ramp is moving, and this one climbs 370 px
    // in 700 ms with an 88 px step in the middle of it — so for most of a
    // flight the box is a visible distance from the height its content
    // wants. Measured in the browser: 106 of 138 frames disagreed, worst
    // 120 px.
    //
    // Which is why `Passage.tsx` hands the card its box height rather than
    // padding the difference. Padding can only fill a box that is too tall;
    // this lag makes the box too SHORT for two thirds of every flight, and a
    // card overflowing its frame loses its bottom edge and its radius. The
    // number below is the one that makes "the card is whatever tall it wants
    // to be" untenable — if it ever falls to a hairline, the imposition and
    // its every-frame measurement can go.
    const { wanted, used } = flight(true)
    const lag = wanted.map((w, i) => w - used[i])
    expect(Math.max(...lag)).toBeGreaterThan(50)
    // And it goes BOTH ways, which is the part that decides the mechanism.
    // The layout is non-monotonic — five of its discontinuities are drops, as
    // a paragraph loses a line — so on those the follower is briefly TALLER
    // than the card it holds. Browser agrees: worst overshoot 13.15 px.
    // A card that is only ever too big for its box could be handled by
    // cropping; one that is also sometimes too small could be handled by
    // padding; a card that is both, inside one flight, can only be handled by
    // telling it the box and letting its own background and `overflow` answer
    // in whichever direction the disagreement went.
    expect(Math.min(...lag)).toBeLessThan(-5)
  })
})
