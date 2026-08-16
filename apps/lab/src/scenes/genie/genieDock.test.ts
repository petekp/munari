import { describe, expect, it } from 'vitest'
import {
  DOCK_DEFAULTS,
  dockFill,
  dockPose,
  dockRing,
  dockRingDone,
  dockSwell,
} from './genieDock'

// The dock's two contracts: the swell is the container's OWN size,
// synchronized to the drive's progress with no separate tween; the
// ring is the container's reaction to what it just absorbed — same
// family of mechanism as genieLaw's settle wobble, but read as
// squash-and-stretch on a box instead of a wobble on a hanging edge.

const D = DOCK_DEFAULTS

describe('dock swell', () => {
  it('rest identity: at and before absorbStart, the tile is exactly its own size', () => {
    for (const progress of [0, 0.1, 0.2, D.absorbStart]) {
      expect(dockSwell(progress)).toBe(1)
    }
  })

  it('docked rest: at progress 1, the tile is exactly 1 + swell', () => {
    expect(dockSwell(1)).toBe(1 + D.swell)
  })

  // The floor that was missing the first time this shipped. Every other
  // test here passed at swell = 0.1, because they are all written
  // against D.swell — a law can be perfectly self-consistent and still
  // be invisible. The repo's rule is that a mechanism is not shipped
  // until a budget pinned to real perception says a human can see it,
  // and for a size change on a small box that budget is in PIXELS at
  // the size the box is actually drawn.
  it('perceptual floor: on the lab tile, docking grows the container by at least 12px — plainly bigger than the bays beside it', () => {
    const TILE = 52 // .gen-tile, genie.css — load-bearing: measure() reads this box
    const grown = TILE * dockSwell(1)
    expect(grown - TILE).toBeGreaterThanOrEqual(12)
    // And not so far that it swallows the dock: the tray's gap is 14px,
    // so a bay may lean into the gap but must not reach its neighbour.
    expect((grown - TILE) / 2).toBeLessThan(14)
  })

  it('is monotone nondecreasing across the whole journey — the container never shrinks while absorbing', () => {
    let prev = dockSwell(0)
    for (let progress = 0; progress <= 1.0001; progress += 0.01) {
      const s = dockSwell(progress)
      expect(s).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = s
    }
  })
})

describe('dock fill', () => {
  const THRESHOLD_Y = -400

  it('stays empty until the bottom edge touches the visible top of the mark', () => {
    expect(dockFill(-200, -350, THRESHOLD_Y)).toBe(0)
    expect(dockFill(-250, THRESHOLD_Y, THRESHOLD_Y)).toBe(0)
  })

  it('tracks the fraction of the sheet below the mark boundary', () => {
    expect(dockFill(-350, -450, THRESHOLD_Y)).toBe(0.5)
    expect(dockFill(-325, -425, THRESHOLD_Y)).toBe(0.25)
  })

  it('becomes full only when the top edge has passed the boundary', () => {
    expect(dockFill(THRESHOLD_Y, -500, THRESHOLD_Y)).toBe(1)
    expect(dockFill(-450, -500, THRESHOLD_Y)).toBe(1)
    expect(dockFill(-450, -450, THRESHOLD_Y)).toBe(1)
  })
})

describe('dock ring', () => {
  const V = 900 // px/s, a firm but unremarkable arrival

  it('a landing with no speed rings nothing, at any time', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      expect(dockRing(t, 0)).toBe(0)
    }
  })

  it('squashes first — positive in the first quarter cycle, arriving mass presses the container wider and shorter', () => {
    const quarter = 1 / (4 * D.ringHz)
    for (let t = 1e-4; t < quarter; t += quarter / 20) {
      expect(dockRing(t, V)).toBeGreaterThan(0)
    }
  })

  it('amplitude clamps at maxSquash for a huge arrival — no flick can turn the box inside out', () => {
    for (let t = 0; t <= 0.3; t += 0.01) {
      expect(Math.abs(dockRing(t, 1e9))).toBeLessThanOrEqual(D.maxSquash + 1e-9)
    }
  })

  it('dies inside the human window: a hard landing (1500px/s) is done by 400ms', () => {
    expect(dockRingDone(0, 1500)).toBe(false)
    expect(dockRingDone(0.4, 1500)).toBe(true)
  })

  it('perceptual floor: a gentle landing (300px/s) rings visibly but subtly', () => {
    let peak = 0
    for (let t = 0; t <= 0.3; t += 0.001) {
      peak = Math.max(peak, dockRing(t, 300))
    }
    expect(peak).toBeGreaterThan(0.02)
    expect(peak).toBeLessThan(0.06)
  })
})

describe('dock pose', () => {
  it('rest identity: progress 0, dead ring — sx = sy = 1 exactly', () => {
    const pose = dockPose(0, 0, 0)
    expect(pose.sx).toBe(1)
    expect(pose.sy).toBe(1)
  })

  it('docked rest: progress 1, ring dead — sx = sy = 1 + swell exactly', () => {
    const pose = dockPose(1, 10, 0)
    expect(pose.sx).toBe(1 + D.swell)
    expect(pose.sy).toBe(1 + D.swell)
  })

  it('conserves the sum — sx/s + sy/s is 2, the cartoon-volume linearization', () => {
    for (const progress of [0, 0.3, 0.6, 1]) {
      for (const t of [0, 0.02, 0.05, 0.15]) {
        const s = dockSwell(progress)
        const pose = dockPose(progress, t, 900)
        expect(pose.sx / s + pose.sy / s).toBeCloseTo(2, 10)
      }
    }
  })
})
