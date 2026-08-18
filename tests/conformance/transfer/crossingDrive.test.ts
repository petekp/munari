import { describe, expect, it } from 'vitest'
import {
  CROSSING_DEFAULTS,
  crossingAtRest,
  crossingDrive,
  crossingRequest,
  type CrossingState,
} from '../../../packages/core/src/transfer/crossing'

const WHOLE = { presented: 1, required: 1 }
const NONE = { presented: 0, required: 1 }

/** A crossing already past the lift gate, at the given ramp. */
const airborne = (ramp: number): CrossingState => ({ phase: 'gl', ramp, heldMs: 500 })

describe('a crossing whose ramp a scene owns', () => {
  it('leaves the rest pose alone', () => {
    const rest = crossingAtRest()
    expect(crossingDrive(rest, WHOLE, 16, 1)).toBe(rest)
  })

  // A driver decides HOW the ramp moves, never whether the page may let go.
  // Skipping the gate is the one thing a scene must not be able to buy.
  it('cannot buy its way past the lift gate', () => {
    const lifting = crossingRequest(crossingAtRest(), true)
    const next = crossingDrive(lifting, NONE, CROSSING_DEFAULTS.settleMs + 100, 1)
    expect(next.phase).toBe('lifting')
    expect(next.ramp).toBe(0)
  })

  it('opens the gate on the same evidence the timed motion needs', () => {
    const lifting = crossingRequest(crossingAtRest(), true)
    const next = crossingDrive(lifting, WHOLE, CROSSING_DEFAULTS.settleMs, 1)
    expect(next.phase).toBe('gl')
    expect(next.ramp).toBe(0)
  })

  it('takes the ramp the scene answered', () => {
    expect(crossingDrive(airborne(0), WHOLE, 16, 0.42).ramp).toBe(0.42)
  })

  // A spring overshoots. 1.04 is not a phase this machine has a rule for.
  it('clamps an overshoot to the ends of the ramp', () => {
    expect(crossingDrive(airborne(0.9), WHOLE, 16, 1.04).ramp).toBe(1)
    expect(crossingDrive(airborne(0.1), WHOLE, 16, -0.3).ramp).toBe(0)
  })

  // A spring divided by a zero timestep. Teleporting the content is worse
  // than standing still for one frame.
  it('holds the ramp where it was when the answer is not a number', () => {
    const state = airborne(0.5)
    expect(crossingDrive(state, WHOLE, 16, Number.NaN)).toBe(state)
    expect(crossingDrive(state, WHOLE, 16, Number.POSITIVE_INFINITY)).toBe(state)
  })

  it('reports a no-op by identity', () => {
    const state = airborne(0.5)
    expect(crossingDrive(state, WHOLE, 16, 0.5)).toBe(state)
  })

  // The fault: an exponential decay reaches 1e-9 and stays there. The page
  // never takes the hold back, and the content sits in WebGL at a progress
  // nobody can see is not zero.
  it('lands exactly, not asymptotically', () => {
    const landing = crossingRequest(airborne(0.4), false)
    expect(landing.phase).toBe('landing')
    const stillFalling = crossingDrive(landing, WHOLE, 16, 1e-9)
    expect(stillFalling.phase).toBe('landing')
    const landed = crossingDrive(stillFalling, WHOLE, 16, 0)
    expect(landed.phase).toBe('page')
    expect(landed.ramp).toBe(0)
    expect(landed.heldMs).toBe(0)
  })

  // Reversal is the request's business, not the driver's: a driver still
  // climbing while the scene asked to come home must not skip a phase.
  it('reverses through the phase the request chose', () => {
    const landing = crossingRequest(airborne(0.8), false)
    const climbing = crossingDrive(landing, WHOLE, 16, 0.9)
    expect(climbing.phase).toBe('landing')
    expect(climbing.ramp).toBe(0.9)
    const again = crossingRequest(climbing, true)
    expect(again.phase).toBe('gl')
    expect(again.ramp).toBe(0.9)
  })
})
