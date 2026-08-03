// The density identity: dpr × planeScale(camZ, z) is the exact texel
// demand for a plane at z under a calibrated camera.
//
// Under the calibration (world unit = CSS pixel on z = 0), a plane at
// altitude z is magnified by planeScale(camZ, z), so the backing
// density that makes its texture texel-for-pixel with the display is
// exactly dpr × planeScale — no more (wasted upload), no less (soup).
// "Born at the display's density" is this identity at the seed; the
// density schedule is this identity evaluated at the two plate
// altitudes (page density at handoff, altitude density at cruise).
// The kernel owns the identity; consumers own geometries.
import { describe, expect, it } from 'vitest'

import { cameraDistance, planeScale, texelDemand } from '@anamorph/core'

const VH = 1000
const FOV = 42
const CAM = cameraDistance(VH, FOV)
const LIFT = 96

describe('the density identity', () => {
  it('is exactly dpr on the calibrated plane — born at the display density', () => {
    // z = 0 is where world unit == CSS px, so the demand is the device
    // pixel ratio itself, exactly — the "born at the display's density"
    // seed.
    for (const dpr of [1, 1.5, 2, 2.25, 3]) {
      expect(texelDemand(dpr, CAM, 0)).toBe(dpr)
    }
  })

  it('is dpr × planeScale everywhere, to the last bit', () => {
    const zs = [0, 12, 55, LIFT, 200]
    const dprs = [1, 2, 2.25]
    for (const z of zs) {
      for (const dpr of dprs) {
        expect(texelDemand(dpr, CAM, z)).toBeCloseTo(dpr * planeScale(CAM, z), 12)
      }
    }
  })

  it('pins the lift-plane demand for the lab geometry', () => {
    // planeScale(CAM, 96) ≈ 1.0796 for VH 1000 / FOV 42 (the camera
    // contract pins it); at dpr 2 the lift demand is its double. The
    // flight card's "pinned at 2.22807, zero tier swaps" was this same
    // identity on the real window's geometry.
    expect(texelDemand(2, CAM, LIFT)).toBeCloseTo(2.1592, 3)
    expect(texelDemand(1, CAM, LIFT)).toBeCloseTo(1.0796, 4)
  })

  it('grows monotonically with altitude — closer to the eye always demands more', () => {
    let prev = texelDemand(2, CAM, 0)
    for (const z of [12, 55, 96, 200, 400]) {
      const d = texelDemand(2, CAM, z)
      expect(d).toBeGreaterThan(prev)
      prev = d
    }
  })
})
