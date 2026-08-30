// Marble-hand support tests — the hull must agree with the shipped stone.
//
// The law: the floor guard uses the same lowest point as the full mesh.
// The 2026-08-30 panel exposes complete rotations and 0.25–1.6 scale, so
// the old default-only clearance test cannot protect an explored pose.
//
// Ownership: this suite loads the real STL and checks the hull against a
// full vertex transform. It does not substitute a box for the anatomy.

import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { Euler, Matrix4, Vector3 } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { buildMarbleHandSupport, marbleHandSafeHeight, minimumMarbleHandZ } from './marbleHandPose'
import { marbleHandTuning as tune } from './marbleHandTuning'

const geometry = new STLLoader().parse(Uint8Array.from(readFileSync(
  new URL('../../../public/models/marble-hand/classical-hand.stl', import.meta.url),
)).buffer)
const positions = geometry.getAttribute('position')
const vertices = Array.from({ length: positions.count }, (_, index) =>
  new Vector3().fromBufferAttribute(positions, index))
const support = buildMarbleHandSupport(geometry)

function fullMinimum(transform: Matrix4): number {
  let minimum = Infinity
  const point = new Vector3()
  for (const vertex of vertices) minimum = Math.min(minimum, point.copy(vertex).applyMatrix4(transform).z)
  return minimum
}

afterAll(() => geometry.dispose())

describe('marble-hand floor support', () => {
  it('matches the full mesh through complete rotations and the panel scale range', () => {
    expect(support.length).toBeLessThan(vertices.length / 10)
    for (const scale of [0.25, tune.scale, 1.6]) {
      for (let step = 0; step < 24; step++) {
        const transform = new Matrix4()
          .makeRotationFromEuler(new Euler(step * Math.PI / 7, step * Math.PI / 5, step * Math.PI / 3, 'YXZ'))
          .scale(new Vector3(scale, scale, scale))
        expect(minimumMarbleHandZ(support, transform)).toBeCloseTo(fullMinimum(transform), 9)
        const height = marbleHandSafeHeight(support, transform, 4)
        expect(fullMinimum(transform) + height).toBeGreaterThanOrEqual(1 - 1e-9)
      }
    }
  })

  it('leaves the reviewed hover and press heights unchanged', () => {
    const sculpture = new Matrix4().makeRotationFromEuler(
      new Euler(tune.sculptureRoll, tune.sculpturePitch, 0, 'YXZ'),
    )
    for (const pressed of [false, true]) {
      const requested = pressed ? tune.pressHeightPx : tune.heightPx
      const transform = new Matrix4()
        .makeRotationFromEuler(new Euler(pressed ? tune.pressPitch : 0, 0, tune.baseRotation, 'XYZ'))
        .scale(new Vector3(tune.scale, tune.scale, tune.scale))
        .multiply(sculpture)
      expect(marbleHandSafeHeight(support, transform, requested)).toBe(requested)
    }
  })
})
