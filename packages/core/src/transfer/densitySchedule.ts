// The density schedule (archive#52, archive#53) — the toggle law that
// decides WHICH density the mapping identity is evaluated at.
//
// texelDemand (mapping/camera) answers "how many texels per CSS px make
// a plane at z texel-for-pixel"; this module answers WHEN a flying
// card's texture is allowed to change its answer. three-ui's flight
// card drove it from the plate's measured altitude — never from a mode
// flag's opinion of where the card should be (a regrabbed float is
// `held` with its lift long finished; the plate's z is the only honest
// witness) — with hysteresis so a card bobbing on its spring near the
// boundary cannot flap the pin, and each flip motion-masked by the very
// flight that caused it (~2 re-rasters per round trip, archive#53).
//
// Kernel vocabulary: the oracle's gesture modes collapse into two
// mechanism flags. `returning` (the oracle's `home`) forces the pin low
// from any height — the fall IS the motion mask, and what matters is
// arriving at the page 1 : 1. `frozen` (the oracle's `crumple`) holds
// the pin wherever it was: flipping would spend a full re-raster and a
// texture swap on a sheet that is about to stop being a card.

import { texelDemand } from '../mapping/camera'

/** Rising edge: a pin at page density flips to altitude density only
 * above liftZ × 0.65 — past the approach, unmistakably airborne. */
export const DENSITY_RISE_FACTOR = 0.65

/** Falling edge: a pin at altitude density holds until the plate sinks
 * below liftZ × 0.5. The gap between the two factors IS the hysteresis
 * band; inside it the schedule repeats its previous answer. */
export const DENSITY_FALL_FACTOR = 0.5

export interface DensityScheduleInput {
  /** The plate's measured altitude, px above the page plane. */
  z: number
  /** The cruise altitude the thresholds scale from (the lab's LIFT_Z). */
  liftZ: number
  /** Flying home: force page density now; the descent masks the re-raster. */
  returning?: boolean
  /** Dying (crumple): hold the current pin, whatever it is. */
  frozen?: boolean
}

/**
 * One evaluation of the schedule. `prev` is the current pin
 * (true = altitude density) and the return value is the next — the
 * caller re-rasters only on the edge, exactly as the oracle's driver
 * fired `onAltitude` only when the answer changed.
 */
export function densityScheduleStep(prev: boolean, input: DensityScheduleInput): boolean {
  if (input.frozen) return prev
  if (input.returning) return false
  return input.z > input.liftZ * (prev ? DENSITY_FALL_FACTOR : DENSITY_RISE_FACTOR)
}

/**
 * The density each pin state names, in texels per CSS px. Page density
 * is the display's own ratio, exactly (archive#52: born at the
 * display's density — z = 0 is where world unit == CSS px, so the
 * identity degenerates to dpr with no arithmetic to blur it). Altitude
 * density is the same identity evaluated at cruise.
 */
export function densitySupply(hi: boolean, dpr: number, camZ: number, liftZ: number): number {
  return hi ? texelDemand(dpr, camZ, liftZ) : dpr
}
