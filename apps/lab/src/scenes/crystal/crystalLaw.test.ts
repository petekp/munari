// Crystal geometry and pointer correction, evaluated on the CPU.
// Shader agreement requires the rendered checks in gate:crystal-pointer.

import { describe, expect, it } from 'vitest'
import { cameraDistance } from '@petepetrash/munari/advanced'
import {
  ARROW_AXIS,
  REST_FRAME,
  bendAt,
  bottomAt,
  boundsOf,
  frameOf,
  hotspotDrop,
  lightDirOf,
  makePose,
  normalAt,
  sdArrowPolygon,
  sdCrystal,
  sdInner2,
  stepCrystal,
  tipPlanePoint,
  tipScreenPoint,
  toLocal,
  topAt,
  traceCrystal,
  type CrystalFrame,
  type Vec3,
} from './crystalLaw'
import { crystalTuning as tune } from './crystalTuning'

const W = 1280
const H = 860
const EYE: Vec3 = [W / 2, H / 2, cameraDistance(H, 42)]

function frameAt(x: number, y: number, t = tune): CrystalFrame {
  return frameOf(makePose(x, y), t, EYE)
}

function tremorAt(x: number, y: number): number {
  const [bx, by] = bendAt(x, y, frameAt(x, y), tune, EYE)
  let worst = 0
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const sx = x + 2 * Math.cos(a)
    const sy = y + 2 * Math.sin(a)
    const [nx, ny] = bendAt(sx, sy, frameAt(sx, sy), tune, EYE)
    worst = Math.max(worst, Math.hypot(nx - bx, ny - by))
  }
  return worst
}

describe('the arrow', () => {

  it('is concave, which is why no rounded-rect field could stand in', () => {

    expect(sdArrowPolygon(11, 21)).toBeGreaterThan(0)
    expect(sdArrowPolygon(4, 10)).toBeLessThan(0)
  })

  it('hangs its mass down and to the right of the tip', () => {
    expect(ARROW_AXIS[0]).toBeGreaterThan(0)
    expect(ARROW_AXIS[1]).toBeGreaterThan(0)
    expect(Math.hypot(ARROW_AXIS[0], ARROW_AXIS[1])).toBeCloseTo(1, 12)
  })
})

describe('the solid', () => {
  const TOP = tune.pavilionPx + tune.girdleThickPx + tune.crownPx - hotspotDrop(tune)

  const FAT: [number, number] = [25, 63]

  it('is a solid all the way through, not a bump on a plane', () => {

    const d2 = sdInner2(FAT[0], FAT[1], tune)
    const mid: Vec3 = [FAT[0], FAT[1], (topAt(d2, tune) + bottomAt(d2, tune)) / 2]
    expect(d2).toBeLessThan(-tune.girdlePx)
    expect(sdCrystal(mid, tune)).toBeLessThan(0)
    expect(sdCrystal([FAT[0], FAT[1], TOP + 1], tune)).toBeGreaterThan(0)
    expect(sdCrystal([FAT[0], FAT[1], -hotspotDrop(tune) - 1], tune)).toBeGreaterThan(0)
  })

  it('hangs its underside BELOW the hotspot, which is what a pavilion is', () => {

    expect(bottomAt(sdInner2(0, 0, tune), tune)).toBeCloseTo(0, 6)
    expect(bottomAt(sdInner2(FAT[0], FAT[1], tune), tune)).toBeLessThan(0)

    expect(bottomAt(tune.girdlePx, tune)).toBeGreaterThan(bottomAt(-30, tune))
  })

  it('bends every ray on the way OUT, which a flat bottom could not', () => {

    const flat = { ...tune, pavilionDeg: 0 }
    expect(bottomAt(sdInner2(FAT[0], FAT[1], flat), flat)).toBeCloseTo(0, 6)
    const off = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2, flat), flat, EYE)
    const on = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2), tune, EYE)
    expect(Math.hypot(off[0], off[1])).toBeLessThan(Math.hypot(on[0], on[1]))
  })

  it('is a lens over its whole face, which a flat top could not be', () => {

    let facet = 0
    let table = 0
    for (let y = -40; y < 280; y += 2) {
      for (let x = -40; x < 190; x += 2) {
        const d2 = sdInner2(x, y, tune)
        if (d2 > tune.girdlePx) continue
        if (topAt(d2, tune) < TOP - 1e-6) facet++
        else table++
      }
    }
    expect(facet).toBeGreaterThan(table)
    expect(table).toBeGreaterThan(0)

    const flat = { ...tune, crownDeg: 0 }
    const off = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2, flat), flat, EYE)
    const on = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2), tune, EYE)
    expect(Math.hypot(off[0], off[1])).toBeLessThan(Math.hypot(on[0], on[1]) / 2)
  })

  it('keeps a normal-incidence ray below total internal reflection at its exit', () => {

    const critical = (Math.asin(1 / tune.ior) * 180) / Math.PI
    const rad = (tune.crownDeg * Math.PI) / 180
    const deflect = tune.crownDeg - (Math.asin(Math.sin(rad) / tune.ior) * 180) / Math.PI
    expect(deflect + tune.pavilionDeg).toBeLessThan(critical)
  })

  it('points its normals OUT of the stone, which is what makes a bounce a bounce', () => {

    const deep = sdInner2(FAT[0], FAT[1], tune)
    const nTable = normalAt([FAT[0], FAT[1], topAt(deep, tune) - 0.2], tune)
    expect(nTable[2]).toBeGreaterThan(0.99)
    const nUnder = normalAt([FAT[0], FAT[1], bottomAt(deep, tune) + 0.2], tune)
    expect(nUnder[2]).toBeLessThan(-0.9)

    const nFacet = normalAt([30, 100, topAt(sdInner2(30, 100, tune), tune) - 0.2], tune)
    expect((Math.acos(nFacet[2]) * 180) / Math.PI).toBeCloseTo(tune.crownDeg, 1)

  })

  it('never lies about distance: one step of the field cannot reach through it', () => {

    let worst = 0
    for (let i = 0; i < 400; i++) {
      const a: Vec3 = [-60 + i * 0.9, -40 + i * 0.7, -30 + i * 0.3]
      const b: Vec3 = [a[0] + 1, a[1] + 0.5, a[2] + 0.4]
      const gap = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      worst = Math.max(worst, Math.abs(sdCrystal(b, tune) - sdCrystal(a, tune)) / gap)
    }
    expect(worst).toBeLessThanOrEqual(1.001)
  })
})

describe('the hotspot', () => {
  it('sits under the ground face and not under a vertex', () => {

    expect(sdInner2(0, 0, tune)).toBeCloseTo(tune.chamferPx - tune.roundPx, 9)

    const top = tune.pavilionPx + tune.girdleThickPx + tune.crownPx - hotspotDrop(tune)
    expect(topAt(sdInner2(0, 0, tune), tune)).toBeLessThan(top)
  })

  it('is ON the glass, which a pavilion does not give for free', () => {

    expect(sdCrystal([0, 0, 0], tune)).toBeCloseTo(0, 2)

    const d2 = sdInner2(0, 0, tune)
    expect(topAt(d2, tune)).toBeGreaterThan(bottomAt(d2, tune))
  })

  it('holds up away from the middle, where the ray is no longer straight down', () => {

    const f = frameAt(220, H / 2)
    const [bx, by] = bendAt(220, H / 2, f, tune, EYE)
    expect(Number.isFinite(bx + by)).toBe(true)
    expect(Math.hypot(bx, by)).toBeGreaterThan(0)
    expect(tremorAt(220, H / 2)).toBeLessThan(0.3)

    const g = bendAt(1060, H / 2, frameAt(1060, H / 2), tune, EYE)
    expect(Number.isFinite(g[0] + g[1])).toBe(true)
    expect(Math.hypot(g[0], g[1])).toBeGreaterThan(0)
    expect(tremorAt(1060, H / 2)).toBeLessThan(1)
  })

  it('puts the tip back on the hand it was placed for', () => {
    for (const [x, y] of [
      [100, 80],
      [640, 430],
      [1180, 820],
    ]) {
      const [tx, ty] = tipPlanePoint(x, y, EYE, tune.liftPx)
      const f: CrystalFrame = { tipX: tx, tipY: ty, tipZ: tune.liftPx, rot: REST_FRAME.rot }
      const [sx, sy] = tipScreenPoint(f, EYE)
      expect(sx).toBeCloseTo(x, 6)
      expect(sy).toBeCloseTo(y, 6)
    }
  })

  it('leaves through the FIRST face it meets, and reports that one', () => {

    const f = frameAt(W / 2, H / 2)
    const dz = -EYE[2]
    const hit = traceCrystal(EYE, [0, 0, dz / Math.abs(dz)], f, tune)
    expect(hit).not.toBeNull()
    expect(hit!.bounces).toBe(0)

    expect(hit!.through).toBeGreaterThan(0)

    expect(hit!.weight).toBeGreaterThan(0)
    expect(hit!.weight).toBeLessThanOrEqual(1)
  })
})

describe('the bend', () => {
  it('is exactly zero everywhere outside the glass', () => {

    const f = frameAt(W / 2, H / 2)
    for (const [x, y] of [
      [40, 40],
      [W - 40, 40],
      [W / 2, H - 40],
      [W / 2 - 200, H / 2],
      [W / 2, H / 2 - 200],
    ]) {
      expect(bendAt(x, y, f, tune, EYE)).toEqual([0, 0])
    }
  })

  it('bounds displacement without clipping most of the default glass', () => {

    const f = frameAt(W / 2, H / 2)
    let worst = 0
    let hits = 0
    let capped = 0
    const all: number[] = []
    for (let y = H / 2 - 40; y < H / 2 + 300; y += 2) {
      for (let x = W / 2 - 60; x < W / 2 + 220; x += 2) {
        const [bx, by] = bendAt(x, y, f, tune, EYE)
        const m = Math.hypot(bx, by)
        if (m > 0) {
          hits++
          all.push(m)
        }
        if (m > tune.maxBendPx - 0.01) capped++
        worst = Math.max(worst, m)
      }
    }
    all.sort((p, q) => p - q)
    expect(hits).toBeGreaterThan(0)
    expect(all[Math.floor(all.length * 0.99)]).toBeLessThan(tune.maxBendPx)
    expect(capped).toBeGreaterThan(0)
    expect(worst).toBeCloseTo(tune.maxBendPx, 6)

    const tight = { ...tune, maxBendPx: 20 }
    const g = frameAt(W / 2, H / 2, tight)
    let tightCapped = 0
    for (let y = H / 2; y < H / 2 + 200; y += 4) {
      for (let x = W / 2; x < W / 2 + 140; x += 4) {
        const [bx, by] = bendAt(x, y, g, tight, EYE)
        expect(Math.hypot(bx, by)).toBeLessThanOrEqual(20 + 1e-6)
        if (Math.hypot(bx, by) > 19.99) tightCapped++
      }
    }
    expect(tightCapped).toBeGreaterThan(0)
  })

  it('rides the crystal: tilting the body moves the bend with it', () => {

    const level = frameAt(W / 2, H / 2)
    const thrown = makePose(W / 2, H / 2)
    thrown.bodyX -= 80
    thrown.bodyY -= 30
    const tilted = frameOf(thrown, tune, EYE)
    const a = bendAt(W / 2 + 30, H / 2 + 60, level, tune, EYE)
    const b = bendAt(W / 2 + 30, H / 2 + 60, tilted, tune, EYE)
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(4)
  })
})

describe('the hand', () => {
  it('never lags the tip: the drawn point is the reported point', () => {

    const pose = makePose(100, 100)
    stepCrystal(pose, 500, 300, 1 / 60, tune)
    expect(pose.tipX).toBe(500)
    expect(pose.tipY).toBe(300)
    expect(pose.bodyX).toBeLessThan(500)
  })

  it('settles a 400px jump by the seventeenth frame without overshooting', () => {
    const pose = makePose(0, 0)
    let frames = 0
    for (; frames < 240; frames++) {
      stepCrystal(pose, 400, 0, 1 / 60, tune)
      if (Math.hypot(pose.tipX - pose.bodyX, pose.tipY - pose.bodyY) < 1) break
    }

    expect(frames).toBeLessThanOrEqual(16)
    expect(tune.followD).toBeGreaterThan(2 * Math.sqrt(tune.followK))
    expect(pose.bodyX).toBeLessThanOrEqual(400)
  })

  it('tilts out of the page, and not at all when it is standing still', () => {

    expect(frameAt(400, 400).rot).toEqual(REST_FRAME.rot)

    const thrown = makePose(400, 400)
    thrown.bodyX -= 90
    const f = frameOf(thrown, tune, EYE)

    const left = toLocal([f.tipX - 60, f.tipY + 60, 0], f)
    const right = toLocal([f.tipX + 60, f.tipY + 60, 0], f)
    expect(left[2]).toBeLessThan(right[2])

    const r = f.rot
    for (let i = 0; i < 3; i++) {
      expect(Math.hypot(r[i * 3], r[i * 3 + 1], r[i * 3 + 2])).toBeCloseTo(1, 9)
    }
  })

  it('survives a backgrounded tab handing back a whole second', () => {

    const pose = makePose(0, 0)
    stepCrystal(pose, 900, 400, 1, tune)
    expect(Number.isFinite(pose.bodyX)).toBe(true)
    expect(Number.isFinite(pose.bodyY)).toBe(true)

    const flung = frameOf(pose, tune, EYE)
    const rest = frameOf(makePose(pose.tipX, pose.tipY), tune, EYE)

    for (const v of flung.rot) expect(Number.isFinite(v)).toBe(true)
    expect(Math.hypot(flung.rot[0], flung.rot[1], flung.rot[2])).toBeCloseTo(1, 6)

    const swing = Math.acos(
      Math.min(1, flung.rot[8] * rest.rot[8] + flung.rot[7] * rest.rot[7] + flung.rot[6] * rest.rot[6]),
    )
    expect((swing * 180) / Math.PI).toBeLessThanOrEqual(
      tune.maxLagPx * Math.max(tune.spinPerLag, tune.tiltPerLag) * 0.01 + 1e-6,
    )
  })
})

describe('the light', () => {
  it('comes over the left shoulder and travels down into the page', () => {
    const [lx, ly, lz] = lightDirOf(tune)
    expect(lx).toBeGreaterThan(0)
    expect(ly).toBeGreaterThan(0)
    expect(lz).toBeLessThan(0)
    expect(Math.hypot(lx, ly, lz)).toBeCloseTo(1, 12)

    expect(tune.lightElevationDeg).toBeLessThan(90)
    const offset = tune.liftPx / Math.tan((tune.lightElevationDeg * Math.PI) / 180)
    expect(offset).toBeLessThan(boundsOf(tune).r)
  })
})
