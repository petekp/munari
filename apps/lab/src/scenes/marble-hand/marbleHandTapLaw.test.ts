// Marble-hand finger regions — what the baked weights are allowed to touch.
//
// The law: the sawn wrist never moves, each of the five digits owns a
// region big enough to see, a tap only ever lifts the stone further off
// the page, and the pinch closes the thumb-index gap without ever driving
// the stone into the page.
//
// The fault, 2026-08-31: hinge capsules sized to reach a fingertip also
// swallow the neighbour's first phalanx — 20 vertices carried a full-weight
// claim from two fingers at once. A wrong owner there tears the web between
// the fingers, and the tear is only visible from the shallow lab camera at
// certain poses. Reversing the flexion sign is the other silent failure: it
// unrolls the curl instead of tightening it and drops the lowest vertex
// through the page the pose suite guards.
//
// Ownership: this suite reads the shipped STL and the shipped hinge table,
// so a retuned constant cannot pass by agreeing with itself.

import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Vector3 } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { marbleHandTuning as tune } from './marbleHandTuning'
import {
  MARBLE_HAND_CHAIN_GAIN,
  MARBLE_HAND_HINGES,
  MARBLE_HAND_TAP_HINGES,
  MARBLE_HAND_TAP_NONE,
  MARBLE_HAND_TAP_PHASE,
  buildMarbleHandTapAttribute,
  marbleHandChainPivot,
  marbleHandChainWeight,
  marbleHandTapBound,
  marbleHandTapEnvelope,
  marbleHandTapPlaneDistance,
  marbleHandTapWeight,
  stepMarbleHandSpring,
  type MarbleHandTapHinge,
} from './marbleHandTapLaw'

const bytes = Uint8Array.from(readFileSync(
  new URL('../../../public/models/marble-hand/classical-hand.stl', import.meta.url),
))
const source = new STLLoader().parse(bytes.buffer)

// The STL repeats a vertex per face. Weld at the exporter's own precision so
// a count of "vertices in a region" means points on the hand, not corners.
const WELD_PRECISION = 10000
const welded = new Map<string, Vector3>()
{
  const positions = source.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    const point = new Vector3().fromBufferAttribute(positions, index)
    welded.set(
      [point.x, point.y, point.z].map((value) => Math.round(value * WELD_PRECISION)).join(','),
      point,
    )
  }
}
const points = [...welded.values()]

// One weight per welded point, through the same arbitration the attribute
// builder uses, by baking a geometry that holds exactly those points.
const probe = new BufferGeometry()
probe.setAttribute('position', new Float32BufferAttribute(
  points.flatMap((point) => [point.x, point.y, point.z]),
  3,
))
const baked = buildMarbleHandTapAttribute(probe)
const owners = points.map((_, index) => baked.getX(index))
const weights = points.map((_, index) => baked.getY(index))
const chains = points.map((_, index) => baked.getZ(index))

// The index finger points forward along +x with its tip at local zero; the
// three curled fingers all hang below y=-18. The wrist was sawn at x=-215.
const INDEX_MIN_X = -60
const INDEX_MIN_Y = -18
const WRIST_MAX_X = -200
// A finger has to move enough stone to read at the authored 0.69 scale.
const MIN_REGION_VERTICES = 150

afterAll(() => {
  source.dispose()
  probe.dispose()
})

describe('the marble-hand finger regions', () => {
  it('leaves the sawn wrist at zero weight under every hinge', () => {
    const wrist = points.filter((point) => point.x < WRIST_MAX_X)
    expect(wrist.length).toBeGreaterThan(0)
    for (const point of wrist) {
      for (const hinge of MARBLE_HAND_HINGES) {
        expect(marbleHandTapWeight(hinge, point.x, point.y, point.z)).toBe(0)
      }
    }
  })

  it('keeps the drum hinges off the pointing index — only the pinch moves it', () => {
    const index = points.filter((point) => point.x > INDEX_MIN_X && point.y > INDEX_MIN_Y)
    expect(index.length).toBeGreaterThan(MIN_REGION_VERTICES)
    // A drum capsule's fade band may graze the index base with a faint
    // claim, but a graze only moves stone if it wins ownership. Two lines
    // hold: no drum capsule fully claims an index vertex, and no index
    // vertex ever bends with a drum hinge.
    for (const point of index) {
      for (const hinge of MARBLE_HAND_TAP_HINGES) {
        expect(marbleHandTapBound(hinge, point.x, point.y, point.z)).toBeLessThan(1)
      }
    }
    const drumOwners = MARBLE_HAND_TAP_HINGES.map((_, finger) => finger)
    for (const [at, point] of points.entries()) {
      if (point.x > INDEX_MIN_X && point.y > INDEX_MIN_Y) {
        expect(drumOwners).not.toContain(owners[at])
      }
    }
  })

  it('gives each of the five digits a region of its own', () => {
    const claimed = MARBLE_HAND_HINGES.map((_, finger) =>
      owners.filter((owner) => owner === finger).length)
    for (const count of claimed) expect(count).toBeGreaterThanOrEqual(MIN_REGION_VERTICES)
    expect(claimed.reduce((sum, count) => sum + count, 0))
      .toBe(weights.filter((weight) => weight > 0).length)
  })

  it('arbitrates: full capsules by nearer curl plane, fades by larger claim', () => {
    let contested = 0
    let fullContested = 0
    for (const [index, point] of points.entries()) {
      const claims = MARBLE_HAND_HINGES
        .map((hinge, finger) => ({
          finger,
          weight: marbleHandTapWeight(hinge, point.x, point.y, point.z),
          plane: marbleHandTapPlaneDistance(hinge, point.x, point.y, point.z),
          full: marbleHandTapBound(hinge, point.x, point.y, point.z) >= 1,
        }))
        .filter((claim) => claim.weight > 0)
      if (claims.length > 1) contested += 1
      // A full-capsule claim outranks any fade-band claim: without the tier,
      // a distant finger's fade grazing another digit's tip at claim 0.01
      // could take the vertex on plane distance and tear the tip off.
      const fullClaims = claims.filter((claim) => claim.full)
      if (fullClaims.length > 1) fullContested += 1
      const expected = fullClaims.length > 0
        ? fullClaims.reduce((best, claim) => (claim.plane < best.plane ? claim : best))
        : claims.reduce(
          (best, claim) => (claim.weight > best.weight ? claim : best),
          { finger: MARBLE_HAND_TAP_NONE, weight: 0, plane: Infinity, full: false },
        )
      expect(owners[index]).toBe(expected.finger)
      expect(weights[index]).toBeCloseTo(expected.weight, 6)
    }
    // The fade bands overlap freely, so faint contests are common; the
    // vertices two capsules both FULLY claim are the webs the curl planes
    // have to split, and those stay rare. Without arbitration they would
    // bend with a neighbour at full weight.
    expect(contested).toBeGreaterThanOrEqual(20)
    expect(fullContested).toBeGreaterThanOrEqual(20)
    expect(fullContested).toBeLessThan(200)
  })

  it('carries full weight at the far end of every digit', () => {
    for (const [finger, hinge] of MARBLE_HAND_HINGES.entries()) {
      const pivot = new Vector3(...hinge.pivot)
      let farthest = -1
      let weight = 0
      for (const [index, point] of points.entries()) {
        if (owners[index] !== finger) continue
        const distance = point.distanceTo(pivot)
        if (distance <= farthest) continue
        farthest = distance
        weight = weights[index]
      }
      // The pinned reach is rounded to 2 decimals, which can round below
      // the true farthest vertex and push it just outside the capsule.
      expect(farthest).toBeGreaterThan(hinge.reach - 0.2)
      expect(weight).toBe(1)
    }
  })

  it('holds the distal joint weight at zero until past the chain pivot', () => {
    for (const [index, point] of points.entries()) {
      const finger = owners[index]
      if (finger === MARBLE_HAND_TAP_NONE) {
        expect(chains[index]).toBe(0)
        continue
      }
      expect(chains[index]).toBeCloseTo(
        marbleHandChainWeight(MARBLE_HAND_HINGES[finger], point.x, point.y, point.z), 6)
    }
    for (const hinge of MARBLE_HAND_HINGES) {
      // At the knuckle pivot the distal joint has no claim at all.
      expect(marbleHandChainWeight(hinge, ...hinge.pivot)).toBe(0)
      // At the digit's far end it is fully engaged.
      const tip = hinge.pivot.map((value, k) => value + hinge.proximal[k] * hinge.reach)
      expect(marbleHandChainWeight(hinge, tip[0], tip[1], tip[2])).toBe(1)
    }
  })
})

describe('the marble-hand tap rhythm', () => {
  it('starts and ends every cycle at exactly the rest pose', () => {
    expect(marbleHandTapEnvelope(0)).toBe(0)
    expect(marbleHandTapEnvelope(1)).toBe(0)
    // Rest fills the back of the period, so the roll reads as separate taps.
    for (const phase of [0.6, 0.75, 0.99]) expect(marbleHandTapEnvelope(phase)).toBe(0)
    expect(marbleHandTapEnvelope(0.35)).toBe(1)
  })

  it('never leaves the 0..1 range at any phase, including negatives', () => {
    for (let step = -200; step <= 400; step++) {
      const value = marbleHandTapEnvelope(step / 100)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('rolls middle, ring, little with no two fingers peaking together', () => {
    expect(MARBLE_HAND_TAP_PHASE).toHaveLength(MARBLE_HAND_TAP_HINGES.length)
    expect(MARBLE_HAND_TAP_HINGES.map((hinge) => hinge.finger)).toEqual(['middle', 'ring', 'little'])
    const peaks = MARBLE_HAND_TAP_PHASE.map((offset) => {
      let best = -1
      let at = 0
      for (let step = 0; step < 1000; step++) {
        const value = marbleHandTapEnvelope(step / 1000 + offset)
        if (value <= best) continue
        best = value
        at = step / 1000
      }
      return at
    })
    expect(new Set(peaks).size).toBe(peaks.length)
  })
})

describe('a marble-hand tap', () => {
  // Same 54-pose envelope marbleHandGeometry.test.ts sweeps for clearance.
  const sculpture = new Matrix4().makeRotationFromEuler(
    new Euler(tune.sculptureRoll, tune.sculpturePitch, 0, 'YXZ'),
  )
  const poses: Matrix4[] = []
  for (const pressPitch of [0, tune.pressPitch]) {
    for (const rx of [-tune.maxTilt, 0, tune.maxTilt]) {
      for (const ry of [-tune.maxTilt, 0, tune.maxTilt]) {
        for (const rz of [-tune.maxSpin, 0, tune.maxSpin]) {
          poses.push(new Matrix4()
            .makeRotationFromEuler(new Euler(rx + pressPitch, ry, tune.baseRotation + rz, 'XYZ'))
            .scale(new Vector3(tune.scale, tune.scale, tune.scale))
            .multiply(sculpture))
        }
      }
    }
  }

  // The same two-joint composition the vertex shader applies: the distal
  // turn about the chain pivot first, then the knuckle turn carries both.
  function turn(point: Vector3, pivot: Vector3, axis: Vector3, angle: number): Vector3 {
    const arm = point.clone().sub(pivot)
    return arm
      .clone().multiplyScalar(Math.cos(angle))
      .add(axis.clone().cross(arm).multiplyScalar(Math.sin(angle)))
      .add(axis.clone().multiplyScalar(axis.dot(arm) * (1 - Math.cos(angle))))
      .add(pivot)
  }

  function bend(angles: (finger: number, hinge: MarbleHandTapHinge) => number): Vector3[] {
    return points.map((point, index) => {
      const finger = owners[index]
      if (finger === MARBLE_HAND_TAP_NONE) return point.clone()
      const hinge = MARBLE_HAND_HINGES[finger]
      const angle = angles(finger, hinge)
      const axis = new Vector3(...hinge.axis)
      const curled = turn(point, new Vector3(...marbleHandChainPivot(hinge)), axis,
        angle * MARBLE_HAND_CHAIN_GAIN * chains[index])
      return turn(curled, new Vector3(...hinge.pivot), axis, angle * weights[index])
    })
  }

  const still = () => 0
  const tapping = (finger: number) => (finger < MARBLE_HAND_TAP_PHASE.length ? tune.tapLiftRad : 0)
  const unrolled = (finger: number) => (finger < MARBLE_HAND_TAP_PHASE.length ? -tune.tapLiftRad : 0)
  const pinching = (_finger: number, hinge: MarbleHandTapHinge) => {
    if (hinge.finger === 'index') return tune.pinchIndexRad
    if (hinge.finger === 'thumb') return tune.pinchThumbRad
    return 0
  }

  function clearance(bent: Vector3[]): number {
    const height = Math.min(tune.heightPx, tune.pressHeightPx)
    const point = new Vector3()
    let lowest = Infinity
    for (const pose of poses) {
      for (const vertex of bent) {
        point.copy(vertex).applyMatrix4(pose)
        lowest = Math.min(lowest, point.z + height)
      }
    }
    return lowest
  }

  it('lifts the stone off the page instead of driving it through', () => {
    const rest = clearance(bend(still))
    expect(clearance(bend(tapping))).toBeGreaterThan(rest)
    // The mirrored angle is the sign mistake this test exists to catch.
    expect(clearance(bend(unrolled))).toBeLessThan(rest)
  })

  it('closes the pinch without touching the page or the other digit', () => {
    const rest = clearance(bend(still))
    // The pinch may dip below the tap's lift but never below the page.
    expect(clearance(bend(pinching))).toBeGreaterThan(0)
    expect(clearance(bend(pinching))).toBeGreaterThan(rest - 30)

    // The gap the gesture closes: nearest distance between the index and
    // thumb surfaces, at rest and pinched. Closing under half the resting
    // gap is what makes the gesture legible; never touching is what keeps
    // the marble from intersecting itself.
    const gap = (bent: Vector3[]) => {
      const indexOrder = MARBLE_HAND_HINGES.findIndex((hinge) => hinge.finger === 'index')
      const thumbOrder = MARBLE_HAND_HINGES.findIndex((hinge) => hinge.finger === 'thumb')
      const indexTips = bent.filter((_, index) => owners[index] === indexOrder && chains[index] === 1)
      const thumbTips = bent.filter((_, index) => owners[index] === thumbOrder && chains[index] === 1)
      let nearest = Infinity
      for (const a of indexTips) for (const b of thumbTips) nearest = Math.min(nearest, a.distanceTo(b))
      return nearest
    }
    const restGap = gap(bend(still))
    const pinchGap = gap(bend(pinching))
    expect(pinchGap).toBeLessThan(restGap * 0.5)
    expect(pinchGap).toBeGreaterThan(5)
  })
})

describe('the marble-hand joint spring', () => {
  const settle = (target: number, ms: number, spring = { bend: 0, velocity: 0 }) => {
    for (let step = 0; step < ms / 8; step++) stepMarbleHandSpring(spring, target, 8)
    return spring
  }

  it('reaches its target and stays there', () => {
    const spring = settle(0.3, 1500)
    expect(spring.bend).toBeCloseTo(0.3, 3)
    expect(Math.abs(spring.velocity)).toBeLessThan(0.001)
  })

  it('overshoots on the way — the settle is what reads as flesh, not servo', () => {
    const spring = { bend: 0, velocity: 0 }
    let peak = 0
    for (let step = 0; step < 200; step++) {
      stepMarbleHandSpring(spring, 0.3, 8)
      peak = Math.max(peak, spring.bend)
    }
    expect(peak).toBeGreaterThan(0.3 * 1.02)
    expect(peak).toBeLessThan(0.3 * 1.25)
  })

  it('never swings below rest, which would unroll the curl into the page', () => {
    const spring = settle(0.3, 1500)
    let lowest = Infinity
    for (let step = 0; step < 400; step++) {
      stepMarbleHandSpring(spring, 0, 8)
      lowest = Math.min(lowest, spring.bend)
    }
    expect(lowest).toBe(0)
    expect(spring.bend).toBe(0)
  })

  it('survives a long frame without exploding', () => {
    const spring = { bend: 0, velocity: 0 }
    stepMarbleHandSpring(spring, 0.3, 5000)
    expect(spring.bend).toBeGreaterThanOrEqual(0)
    expect(spring.bend).toBeLessThan(0.4)
  })
})
