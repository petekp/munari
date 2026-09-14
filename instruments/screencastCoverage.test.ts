import { describe, expect, it } from 'vitest'
import { IncompleteScreencastError, requireScreencastCoverage } from './screencastCoverage'

const frames = (times: number[]) => times.map(t => ({ t }))

describe('the recorded interval needed for a visual verdict', () => {
  it('accepts complete coverage despite gaps outside the requested interval', () => {
    expect(() => requireScreencastCoverage(frames([-40, -8, 8, 24, 40, 56, 72, 88, 120]), 0, 80, 20))
      .not.toThrow()
  })

  it('refuses a stream that misses the flash interval but records eventual arrival', () => {
    expect(() => requireScreencastCoverage(frames([-1, 400]), 0, 150, 20)).toThrow(IncompleteScreencastError)
  })

  it('refuses a missing middle frame even when both interval ends were recorded', () => {
    expect(() => requireScreencastCoverage(frames([-8, 8, 40, 56, 72, 88]), 0, 80, 20)).toThrow('gap')
  })

  it.each([{ times: [] }, { times: [10, 20, 30] }, { times: [-10, 10, 20] }])('refuses an uncovered interval: $times', ({ times }) => {
    expect(() => requireScreencastCoverage(frames(times), 0, 30, 20)).toThrow('both ends')
  })

  it.each([{ times: [0, 0, 20] }, { times: [0, 20, 10] }, { times: [0, NaN, 20] }])('refuses invalid timestamp order: $times', ({ times }) => {
    expect(() => requireScreencastCoverage(frames(times), 0, 20, 20)).toThrow('timestamps')
  })
})
