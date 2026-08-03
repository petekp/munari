// CONFORMANCE — transfer (flipped 2026-08-02)
// New contract (owed by seed manifest): the density schedule — page density at handoff, altitude density at cruise, hysteresis on plate z; descent flips low immediately, a dying sheet freezes its pin (archive#52, archive#53)
//
// The toggle law from three-ui's flight card, extracted pure. The
// mapping suite pins the identity (texelDemand = dpr × planeScale);
// this file pins WHEN a flight is allowed to re-evaluate it: rising
// past 0.65 × liftZ, falling below 0.5 × liftZ, the band between them
// repeating the previous answer so a card bobbing on its spring cannot
// flap the pin into re-raster churn.
import { describe, expect, it } from 'vitest'

import {
  DENSITY_FALL_FACTOR,
  DENSITY_RISE_FACTOR,
  cameraDistance,
  densityScheduleStep,
  densitySupply,
  texelDemand,
} from '@anamorph/core'

const LIFT_Z = 96

describe('the hysteresis on plate z', () => {
  it('cruise pins altitude density', () => {
    expect(densityScheduleStep(false, { z: LIFT_Z, liftZ: LIFT_Z })).toBe(true)
  })

  it('rest pins page density', () => {
    expect(densityScheduleStep(true, { z: 0, liftZ: LIFT_Z })).toBe(false)
  })

  it('flips high only past 0.65 × liftZ — the approach is not altitude', () => {
    const rise = LIFT_Z * DENSITY_RISE_FACTOR // 62.4
    expect(DENSITY_RISE_FACTOR).toBe(0.65)
    expect(densityScheduleStep(false, { z: rise, liftZ: LIFT_Z })).toBe(false) // strict >
    expect(densityScheduleStep(false, { z: rise + 0.1, liftZ: LIFT_Z })).toBe(true)
  })

  it('holds high until 0.5 × liftZ — the same z answers by history', () => {
    // THE hysteresis assertion: at z = 50 (inside the band), a pin that
    // is high stays high and a pin that is low stays low. A spring bob
    // crossing one threshold cannot re-cross the other.
    expect(DENSITY_FALL_FACTOR).toBe(0.5)
    expect(densityScheduleStep(true, { z: 50, liftZ: LIFT_Z })).toBe(true)
    expect(densityScheduleStep(false, { z: 50, liftZ: LIFT_Z })).toBe(false)
  })

  it('drops at exactly 0.5 × liftZ', () => {
    expect(densityScheduleStep(true, { z: LIFT_Z * DENSITY_FALL_FACTOR, liftZ: LIFT_Z })).toBe(
      false,
    )
  })
})

describe('the two overrides', () => {
  it('returning forces page density from any height — the fall is the mask', () => {
    expect(densityScheduleStep(true, { z: LIFT_Z, liftZ: LIFT_Z, returning: true })).toBe(false)
    expect(densityScheduleStep(false, { z: LIFT_Z, liftZ: LIFT_Z, returning: true })).toBe(false)
  })

  it('frozen repeats the pin at any height, in both states', () => {
    // A crumpling card must not spend a re-raster on a sheet about to
    // stop being a card — the pin holds even where the hysteresis or
    // the returning rule would have flipped it.
    expect(densityScheduleStep(true, { z: 0, liftZ: LIFT_Z, frozen: true })).toBe(true)
    expect(densityScheduleStep(false, { z: LIFT_Z, liftZ: LIFT_Z, frozen: true })).toBe(false)
    expect(
      densityScheduleStep(true, { z: 0, liftZ: LIFT_Z, frozen: true, returning: true }),
    ).toBe(true) // frozen outranks returning
  })
})

describe('the supply each pin names', () => {
  const CAM = cameraDistance(1000, 42)

  it('page density is dpr EXACTLY — born at the display density, no arithmetic', () => {
    for (const dpr of [1, 1.5, 2, 2.25, 3]) {
      expect(densitySupply(false, dpr, CAM, LIFT_Z)).toBe(dpr)
    }
  })

  it('altitude density is the mapping identity at cruise', () => {
    expect(densitySupply(true, 2, CAM, LIFT_Z)).toBe(texelDemand(2, CAM, LIFT_Z))
    expect(densitySupply(true, 2, CAM, LIFT_Z)).toBeCloseTo(2.1592, 3)
  })
})
