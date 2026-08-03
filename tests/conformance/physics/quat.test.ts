// CONFORMANCE — physics (landed 2026-08-03, with the lab app)
// New with the binding's consumer: Lab 014's toss applies topspin as
// `plate.q.premultiply(spin)` (archive#61) — the kernel Quat grows the
// world-frame twin of `multiply`, sized to that consumer.

// The quaternion substrate under the plate. `multiply` and `premultiply`
// are the same Hamilton product with the operands swapped; the contract
// pins the swap exactly (same arithmetic, so exact equality — a twin that
// drifts by an epsilon is not a twin) and the semantics that make the
// swap matter: premultiply composes in the WORLD frame — the original
// pose rotates first, the increment lands on top.

import { describe, expect, it } from 'vitest'

import { Quat, Vec3 } from '@anamorph/core'

/** 90° about +X and 90° about +Z — a non-commuting pair, so operand
 *  order is visible in every assertion below. */
function pair(): [Quat, Quat] {
  const qx = new Quat().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2)
  const qz = new Quat().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2)
  return [qx, qz]
}

describe('Quat.premultiply', () => {
  it('is exactly multiply with the operands swapped', () => {
    const [qx, qz] = pair()
    const pre = qx.clone().premultiply(qz)
    const swapped = qz.clone().multiply(qx)
    // Same product, same operand order, same arithmetic path — bitwise
    // equality is the point, not an approximation of it.
    expect([pre.x, pre.y, pre.z, pre.w]).toEqual([swapped.x, swapped.y, swapped.z, swapped.w])
  })

  it('composes in the world frame: original pose first, increment on top', () => {
    const [pose, spin] = pair()
    const composed = pose.clone().premultiply(spin)

    const oneStep = new Vec3().set(0, 1, 0).applyQuaternion(composed)
    const twoStep = new Vec3().set(0, 1, 0).applyQuaternion(pose).applyQuaternion(spin)

    expect(oneStep.x).toBeCloseTo(twoStep.x, 12)
    expect(oneStep.y).toBeCloseTo(twoStep.y, 12)
    expect(oneStep.z).toBeCloseTo(twoStep.z, 12)
  })

  it('differs from multiply for non-commuting rotations — the twin is not an alias', () => {
    const [qx, qz] = pair()
    const pre = qx.clone().premultiply(qz)
    const post = qx.clone().multiply(qz)
    const gap =
      Math.abs(pre.x - post.x) +
      Math.abs(pre.y - post.y) +
      Math.abs(pre.z - post.z) +
      Math.abs(pre.w - post.w)
    expect(gap).toBeGreaterThan(0.1)
  })

  it('preserves unit length, so a stepped pose never needs re-normalizing per call', () => {
    const [qx, qz] = pair()
    expect(qx.premultiply(qz).length()).toBeCloseTo(1, 12)
  })
})
