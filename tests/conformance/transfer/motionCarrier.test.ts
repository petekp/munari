// The motion carrier contract.
//
// A carrier is what lets motion cross custody mid-flight: one clock,
// one program, and every output — page style, mesh transform — reading
// the same number in the same frame. The contract pins the discipline,
// because the discipline IS the guarantee: a second evaluation at a
// second time inside one frame would reintroduce the two-clocks fault
// the carrier exists to remove.

import { describe, expect, it } from 'vitest'
import { createMotionCarrier } from '@munari/core'

describe('the carrier clock', () => {
  it('begins at its own birth: the first tick hands the program time zero', () => {
    const seen: number[] = []
    const carrier = createMotionCarrier((t) => {
      seen.push(t)
      return t
    })
    carrier.tick(123_456)
    expect(seen.at(-1)).toBe(0)
  })

  it('flows as the difference between ticks, wherever the epoch fell', () => {
    const seen: number[] = []
    const carrier = createMotionCarrier((t) => {
      seen.push(t)
      return t
    })
    carrier.tick(5_000)
    carrier.tick(5_250)
    carrier.tick(5_266)
    // seen opens with two zeros — birth, then the epoch tick — before
    // time starts to flow.
    expect(seen).toEqual([0, 0, 250, 266])
  })
})

describe('one evaluation per frame', () => {
  it('evaluates the program exactly once per tick, however many readers sample it', () => {
    let evaluations = 0
    const carrier = createMotionCarrier((t) => {
      evaluations++
      return Math.sin(t)
    })
    const atBirth = evaluations
    carrier.tick(1_000)
    for (let reader = 0; reader < 6; reader++) carrier.sample()
    expect(evaluations).toBe(atBirth + 1)
  })

  it('hands every reader in a frame the identical value — six letters, one number', () => {
    const carrier = createMotionCarrier((t) => ({ y: t * 0.01 }))
    carrier.tick(2_000)
    carrier.tick(2_400)
    const first = carrier.sample()
    for (let reader = 0; reader < 6; reader++) expect(carrier.sample()).toBe(first)
  })

  it('sampling never advances the clock', () => {
    const seen: number[] = []
    const carrier = createMotionCarrier((t) => {
      seen.push(t)
      return t
    })
    carrier.tick(100)
    carrier.tick(116)
    const ticks = seen.length
    carrier.sample()
    carrier.sample()
    expect(seen.length).toBe(ticks)
  })
})

describe('before the first tick', () => {
  it('sample is the birth value: a carrier never has nothing to say', () => {
    const carrier = createMotionCarrier((t) => 7 - t)
    expect(carrier.sample()).toBe(7)
  })
})
