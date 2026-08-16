// The bouncing marks' contract. The law is bounceStep alone. The
// harness around it (the shared simulation) was exercised by
// live-content.mjs, which read the same mark out of both window copies
// and required zero drift; that probe was removed on 2026-08-15, so
// this file is now the only thing holding the law.
import { describe, expect, it } from 'vitest'

import { type BounceBody, type MarkOutline, bounceStep, markOutline } from './genieBounce'

const W = 460
const H = 340

const body = (x: number, y: number, vx: number, vy: number, outline: MarkOutline): BounceBody => ({
  x,
  y,
  vx,
  vy,
  outline,
})

const circle = (r: number): MarkOutline => ({ kind: 'circle', r })

const energy = (bodies: BounceBody[]) =>
  bodies.reduce((sum, b) => sum + b.vx * b.vx + b.vy * b.vy, 0)

// The three marks as the scene ships them: square, circle, triangle.
const marks = () => [
  body(100, 90, 40, 31, markOutline('quadrato', 34)),
  body(300, 80, -37, 22, markOutline('cerchio', 30)),
  body(240, 240, 25, -44, markOutline('triangolo', 36)),
]

const inside = (b: BounceBody) => {
  if (b.outline.kind === 'circle') {
    expect(b.x).toBeGreaterThanOrEqual(b.outline.r - 1e-9)
    expect(b.x).toBeLessThanOrEqual(W - b.outline.r + 1e-9)
    expect(b.y).toBeGreaterThanOrEqual(b.outline.r - 1e-9)
    expect(b.y).toBeLessThanOrEqual(H - b.outline.r + 1e-9)
    return
  }
  for (const v of b.outline.verts) {
    expect(b.x + v.x).toBeGreaterThanOrEqual(-1e-9)
    expect(b.x + v.x).toBeLessThanOrEqual(W + 1e-9)
    expect(b.y + v.y).toBeGreaterThanOrEqual(-1e-9)
    expect(b.y + v.y).toBeLessThanOrEqual(H + 1e-9)
  }
}

describe('bounceStep', () => {
  it('keeps every silhouette inside the court through thousands of frames', () => {
    const bodies = marks()
    for (let i = 0; i < 5000; i++) {
      bounceStep(bodies, 1 / 60, W, H)
      for (const b of bodies) inside(b)
    }
  })

  it('conserves kinetic energy — gentle stays gentle, forever', () => {
    const bodies = marks()
    const before = energy(bodies)
    for (let i = 0; i < 5000; i++) bounceStep(bodies, 1 / 60, W, H)
    expect(energy(bodies)).toBeCloseTo(before, 6)
  })

  it('a head-on pair exchanges velocities and separates', () => {
    const bodies = [body(200, 170, 30, 0, circle(32)), body(262, 170, -30, 0, circle(30))]
    bounceStep(bodies, 1 / 60, W, H)
    // Equal masses swap along the collision normal.
    expect(bodies[0].vx).toBeLessThan(0)
    expect(bodies[1].vx).toBeGreaterThan(0)
    // And the resolution leaves no overlap to re-fire next frame.
    const d = Math.hypot(bodies[1].x - bodies[0].x, bodies[1].y - bodies[0].y)
    expect(d).toBeGreaterThanOrEqual(62 - 1e-9)
  })

  it('a receding pair is left alone even while still overlapping', () => {
    const bodies = [body(200, 170, -30, 0, circle(32)), body(240, 170, 30, 0, circle(30))]
    bounceStep(bodies, 1 / 60, W, H)
    // Already separating: velocities keep their signs (no re-collision
    // that would glue the pair together), only the overlap is opened.
    expect(bodies[0].vx).toBeLessThan(0)
    expect(bodies[1].vx).toBeGreaterThan(0)
  })

  it("the triangle's empty corner is a miss, not a bounce", () => {
    // A small circle sits inside the triangle's BOUNDING BOX — up in
    // the top-right corner, beside the apex — but outside its actual
    // slanted edge. Box bounds would fire here; the true silhouette
    // must not.
    const tri = body(200, 170, 0, 0, markOutline('triangolo', 36))
    const orb = body(228, 142, 0, 0, markOutline('cerchio', 18))
    bounceStep([tri, orb], 0, W, H)
    expect(tri.x).toBe(200)
    expect(tri.y).toBe(170)
    expect(orb.x).toBe(228)
    expect(orb.y).toBe(142)
  })

  it("the triangle's slanted edge deflects along its own normal", () => {
    // A circle falling straight down onto the right slant must be
    // shoved sideways — the contact normal belongs to the edge, not to
    // an axis-aligned box (which would return the fall straight up).
    const tri = body(200, 170, 0, 0, markOutline('triangolo', 36))
    const orb = body(230, 140, 0, 30, markOutline('cerchio', 30))
    const before = energy([tri, orb])
    bounceStep([tri, orb], 0, W, H)
    expect(orb.vx).toBeGreaterThan(0)
    expect(tri.vx).toBeLessThan(0)
    expect(energy([tri, orb])).toBeCloseTo(before, 6)
  })
})
