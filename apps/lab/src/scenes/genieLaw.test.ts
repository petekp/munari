import { describe, expect, it } from 'vitest'
import {
  GENIE_DEFAULTS,
  SETTLE_DEFAULTS,
  genieGrabSolve,
  genieRestBottomVelocity,
  genieSettle,
  genieSettleDone,
  genieWarp,
  type GenieParams,
} from './genieLaw'

// The law's two custody constraints, plus the shape guarantees the scene
// leans on. Numbers are pinned loose enough to survive tuning the feel
// (timings, throat) and tight enough that a regression that would show
// on screen fails here first.

const P: GenieParams = {
  w: 4,
  h: 3,
  dockX: 1.5,
  dockY: -4,
  slotHalf: 0.35,
  ...GENIE_DEFAULTS,
}

const STEPS = [0, 0.25, 0.5, 0.75, 1]

describe('genie warp', () => {
  it('t = 0 is an exact identity — the rest pose the compositor takes over', () => {
    for (const u of STEPS) {
      for (const v of STEPS) {
        const { x, y } = genieWarp(u, v, 0, P)
        expect(x).toBe((u - 0.5) * P.w)
        expect(y).toBe(P.h / 2 - v * P.h)
      }
    }
  })

  it('t = 1 fits the mouth — every point inside the dock slot', () => {
    for (const u of STEPS) {
      for (const v of STEPS) {
        const { x, y } = genieWarp(u, v, 1, P)
        expect(Math.abs(x - P.dockX)).toBeLessThanOrEqual(P.slotHalf + 1e-9)
        expect(y).toBeCloseTo(P.dockY, 9)
      }
    }
  })

  it('the top edge holds until the slide starts', () => {
    for (const t of [0, 0.1, 0.2, P.slideStart]) {
      for (const u of STEPS) {
        expect(genieWarp(u, 0, t, P).y).toBe(P.h / 2)
      }
    }
  })

  it('anything at mouth height is already mouth-width', () => {
    // The funnel is a shape in space: a vertex that has descended to the
    // mouth must be inside the slot no matter when it got there.
    for (const t of [0.3, 0.5, 0.7, 0.9]) {
      for (const u of STEPS) {
        for (const v of STEPS) {
          const { x, y } = genieWarp(u, v, t, P)
          if (y <= P.dockY + 0.05) {
            expect(Math.abs(x - P.dockX)).toBeLessThanOrEqual(P.slotHalf + 0.05)
          }
        }
      }
    }
  })

  it('stays inside the hull of rest sheet and mouth throughout', () => {
    const xMin = Math.min(-P.w / 2, P.dockX - P.slotHalf) - 1e-9
    const xMax = Math.max(P.w / 2, P.dockX + P.slotHalf) + 1e-9
    for (let t = 0; t <= 1.0001; t += 0.05) {
      for (const u of STEPS) {
        for (const v of STEPS) {
          const { x, y } = genieWarp(u, v, t, P)
          expect(x).toBeGreaterThanOrEqual(xMin)
          expect(x).toBeLessThanOrEqual(xMax)
          expect(y).toBeGreaterThanOrEqual(P.dockY - 1e-9)
          expect(y).toBeLessThanOrEqual(P.h / 2 + 1e-9)
        }
      }
    }
  })

  it('moves continuously in t — no frame-to-frame jumps', () => {
    // 120 steps ≈ two 60fps seconds. The bound is generous (a tenth of
    // the whole journey per step); what it forbids is a discontinuity.
    const dt = 1 / 120
    const journey = Math.hypot(P.dockX, P.h / 2 - P.dockY)
    for (const u of STEPS) {
      for (const v of STEPS) {
        let prev = genieWarp(u, v, 0, P)
        for (let t = dt; t <= 1.0001; t += dt) {
          const next = genieWarp(u, v, t, P)
          const step = Math.hypot(next.x - prev.x, next.y - prev.y)
          expect(step).toBeLessThan(journey / 10)
          prev = next
        }
      }
    }
  })

  it('can curl through one loop without moving either custody identity', () => {
    const looped = { ...P, loopRadius: 0.75 }
    for (const u of STEPS) {
      for (const v of STEPS) {
        expect(genieWarp(u, v, 0, looped)).toEqual(genieWarp(u, v, 0, P))
        expect(genieWarp(u, v, 1, looped)).toEqual(genieWarp(u, v, 1, P))
      }
    }
  })

  it('the loop is one tangent turn — a single excursion, no return-to-centre wiggles', () => {
    // A vertical path meets a circle tangentially only at the circle's
    // side, so the whole turn lives on ONE side of the drain and bows out
    // to the circle's diameter. The old lead-in swing and radius envelope
    // each pinched the outline back to the centreline mid-flight — the
    // hourglass. Pinned: the offset never crosses to the other side, it
    // reaches a real diameter, and it rises and falls exactly once.
    // Isolated through the public surface by mirroring: the shoulder and
    // the vertical dip depend only on |radius|, so half the difference
    // between the two mirror flights is exactly the turn's x excursion.
    const r = 0.75
    const looped = { ...P, loopRadius: r }
    const mirrored = { ...P, loopRadius: -r }
    const offsets: number[] = []
    for (let v = 0; v <= 1.0001; v += 0.005) {
      const right = genieWarp(0.5, v, 0.4, looped)
      const left = genieWarp(0.5, v, 0.4, mirrored)
      expect(left.y).toBeCloseTo(right.y, 12)
      offsets.push((right.x - left.x) / 2)
    }
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...offsets)).toBeGreaterThan(1.9 * r)
    let flips = 0
    for (let i = 2; i < offsets.length; i++) {
      const a = offsets[i - 1] - offsets[i - 2]
      const b = offsets[i] - offsets[i - 1]
      if (a > 1e-12 && b < -1e-12) flips += 1
      if (a < -1e-12 && b > 1e-12) flips += 1
    }
    expect(flips).toBe(1)

    // And it is an actual loop, not a bulge: somewhere inside the turn
    // the sheet climbs back upward before continuing to the mouth.
    let climbs = false
    let prevY = genieWarp(0.5, 0, 0.4, looped).y
    for (let v = 0.005; v <= 1.0001; v += 0.005) {
      const y = genieWarp(0.5, v, 0.4, looped).y
      if (y > prevY + 1e-9) climbs = true
      prevY = y
    }
    expect(climbs).toBe(true)
  })

  it('the looped taper never comes back — width shrinks monotonically along the sheet', () => {
    // The user-visible promise: from the window's bottom edge to the dock
    // mouth the silhouette only narrows. The loop moves the path, never
    // the width, so k must stay monotone with the loop exactly as without.
    const looped = { ...P, loopRadius: 0.75 }
    for (const t of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      let prev = Infinity
      for (let v = 0; v <= 1.0001; v += 0.02) {
        const { k } = genieWarp(0.5, v, t, looped)
        expect(k).toBeLessThanOrEqual(prev + 1e-9)
        expect(k).toBeGreaterThan(0)
        prev = k
      }
    }
  })

  it('the looped flight moves continuously in t — no frame-to-frame jumps', () => {
    const looped = { ...P, loopRadius: 0.75 }
    const dt = 1 / 120
    const journey = Math.hypot(P.dockX, P.h / 2 - P.dockY)
    for (const u of STEPS) {
      for (const v of STEPS) {
        let prev = genieWarp(u, v, 0, looped)
        for (let t = dt; t <= 1.0001; t += dt) {
          const next = genieWarp(u, v, t, looped)
          const step = Math.hypot(next.x - prev.x, next.y - prev.y)
          expect(step).toBeLessThan(journey / 10)
          prev = next
        }
      }
    }
  })

  it('plants its near edge while the far edge still flares — the asymmetric S', () => {
    // The classic genie's silhouette is not a symmetric funnel gliding
    // sideways: the edge on the dock's side plants early into a taut
    // near-vertical line above the mouth corner, while the far edge
    // holds wide and does the long S flare. Pinned two ways: the near
    // edge's progress toward its mouth corner is never behind the far
    // edge's (every height, every sampled t), and somewhere mid-funnel
    // it leads by a real margin — sway ≈ throat would glide, not sway.
    expect(GENIE_DEFAULTS.sway).toBeGreaterThan(GENIE_DEFAULTS.throat)
    expect(GENIE_DEFAULTS.throat).toBeGreaterThanOrEqual(1)
    const restNear = P.w / 2
    const mouthNear = P.dockX + P.slotHalf
    const restFar = -P.w / 2
    const mouthFar = P.dockX - P.slotHalf
    let maxLead = 0
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      for (const v of STEPS) {
        // dockX > 0 in P, so the near edge is the right one (u = 1).
        const near = genieWarp(1, v, t, P).x
        const far = genieWarp(0, v, t, P).x
        const nearProgress = (restNear - near) / (restNear - mouthNear)
        const farProgress = (far - restFar) / (mouthFar - restFar)
        expect(nearProgress).toBeGreaterThanOrEqual(farProgress - 1e-9)
        maxLead = Math.max(maxLead, nearProgress - farProgress)
      }
    }
    expect(maxLead).toBeGreaterThan(0.15)
  })

  // ── k: how wide the row is ────────────────────────────────────────────
  //
  // The sheet's painted shadow fades on this, so it is not a convenience
  // return — it is the input to something visible, and the shader has no
  // way to check it. These pin it as a MEASUREMENT of the funnel rather
  // than a number that merely tracks it: whatever the law does to x, k
  // has to be the width that resulted.

  it('k is the row it describes — the span between the two edges, every time', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      for (const v of STEPS) {
        const row = genieWarp(0.5, v, t, P)
        const left = genieWarp(0, v, t, P)
        const right = genieWarp(1, v, t, P)
        const span = Math.hypot(right.x - left.x, right.y - left.y)
        expect(row.k).toBeCloseTo(span / P.w, 12)
      }
    }
  })

  it('k is 1 at rest and the mouth ratio at the mouth — the two custody moments', () => {
    for (const u of STEPS) {
      for (const v of STEPS) {
        expect(genieWarp(u, v, 0, P).k).toBe(1)
        expect(genieWarp(u, v, 1, P).k).toBeCloseTo((2 * P.slotHalf) / P.w, 12)
      }
    }
  })

  it('k never widens on the way down — a row below another is never broader', () => {
    // The fade reads k as "how squeezed is this part of the sheet", which
    // is only meaningful if the funnel narrows monotonically toward the
    // mouth. If it did not, a shadow could come BACK partway down.
    for (const t of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      let prev = Infinity
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const { k } = genieWarp(0.5, v, t, P)
        expect(k).toBeLessThanOrEqual(prev + 1e-9)
        expect(k).toBeGreaterThan(0)
        prev = k
      }
    }
  })
})

describe('grab solve', () => {
  it('the midline is strictly monotone in t — the one row a hand can own without jumps', () => {
    let prev = genieWarp(0.5, 0.5, 0, P).y
    for (let t = 0.01; t <= 1.0001; t += 0.01) {
      const y = genieWarp(0.5, 0.5, t, P).y
      expect(y).toBeLessThan(prev)
      prev = y
    }
  })

  it('round-trips: the t that puts the midline at y is found from y', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const y = genieWarp(0.5, 0.5, t, P).y
      const solved = genieGrabSolve(y, P)
      expect(solved).toBeCloseTo(Math.min(1, t), 3)
    }
  })

  it('keeps one monotonic hand axis while the visible sheet loops', () => {
    const looped = { ...P, loopRadius: 0.75 }
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const anchorY = genieWarp(0.5, 0.5, t, P).y
      expect(genieGrabSolve(anchorY, looped)).toBeCloseTo(Math.min(1, t), 3)
    }
  })

  it('clamps outside the drain: above rest is 0, below the mouth is 1', () => {
    expect(genieGrabSolve(P.h, P)).toBe(0)
    expect(genieGrabSolve(P.dockY - 1, P)).toBe(1)
  })
})

describe('settle wobble', () => {
  const V = 220 // px/s, a real flick's arrival

  it('inherits the bottom edge velocity that the warp has at rest', () => {
    const tVelocity = -1.4
    const expected = genieRestBottomVelocity(tVelocity, P)
    const h = 1e-5
    const y0 = genieWarp(0.5, 1, 0, P).y
    const y1 = genieWarp(0.5, 1, h, P).y
    const measured = ((y1 - y0) / h) * tVelocity

    expect(expected).toBeGreaterThan(0)
    expect(expected).toBeCloseTo(measured, 2)
    const settleSlope = (genieSettle(h, expected, SETTLE_DEFAULTS) - genieSettle(0, expected, SETTLE_DEFAULTS)) / h
    expect(settleSlope).toBeCloseTo(expected, 0)
  })

  it('starts from zero displacement with the arrival velocity — motion is continuous through the landing', () => {
    expect(genieSettle(0, V, SETTLE_DEFAULTS)).toBe(0)
    const h = 1e-4
    const slope = (genieSettle(h, V, SETTLE_DEFAULTS) - genieSettle(0, V, SETTLE_DEFAULTS)) / h
    expect(slope).toBeCloseTo(V, -1)
    expect(Math.abs(slope - V) / V).toBeLessThan(0.05)
  })

  it('never exceeds its own envelope, and the envelope never exceeds the amplitude clamp', () => {
    for (const v of [40, V, 2000, 100000]) {
      for (let tau = 0; tau <= 0.5; tau += 0.01) {
        const off = Math.abs(genieSettle(tau, v, SETTLE_DEFAULTS))
        expect(off).toBeLessThanOrEqual(SETTLE_DEFAULTS.maxA + 1e-9)
        expect(off).toBeLessThanOrEqual(
          Math.min(SETTLE_DEFAULTS.maxA, v / (2 * Math.PI * SETTLE_DEFAULTS.hz)) *
            Math.exp(-tau / SETTLE_DEFAULTS.decay) +
            1e-9,
        )
      }
    }
  })

  it('is done — sub-half-pixel — within 350ms no matter how hard the landing', () => {
    // The perceptual budget: by the time a hand could look for the
    // window's edge, the wobble is beneath a device pixel. The clamp is
    // what makes this hold for ANY arrival speed.
    for (const v of [40, V, 2000, 100000]) {
      expect(genieSettleDone(0.35, v, SETTLE_DEFAULTS)).toBe(true)
      let tau = 0
      while (!genieSettleDone(tau, v, SETTLE_DEFAULTS)) tau += 0.01
      for (let after = tau; after <= 0.6; after += 0.01) {
        expect(Math.abs(genieSettle(after, v, SETTLE_DEFAULTS))).toBeLessThan(0.5)
      }
    }
  })
})
