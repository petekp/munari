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

import { atTarget, centreOf, densityAt, poseAt, springStep, type Box } from './passagePath'

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

  it('clamps at the texture guard rather than warning once a frame', () => {
    expect(densityAt(3, 1000, 500, 3000, 400)).toBeCloseTo(4000 / 3000, 6)
  })
})
