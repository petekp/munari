// The LOD schedule — the phase distribution a scene of N presenters leans on.
//
// One phase per presenter across all of LOD_EVERY before any repeats, and a
// key that never steals from the phase budget. The buggy shape — one shared
// counter behind phase and key — folded ten slots to five (even residues
// only), so the sixth presenter onward collided with an earlier one and ran
// stepLod on the same frame. These pins hold the two sequences independent.

import { describe, expect, it } from 'vitest'
import { createLodSchedule } from './lodSchedule'

describe('a LOD schedule', () => {
  it('spreads one phase per presenter across every slot before repeating', () => {
    // The production call order — one nextPhase then one nextKey per
    // presenter. The shared-counter bug returned [0,2,4,6,8,0,2,4,6,8]:
    // five slots, the sixth presenter colliding with the first.
    const schedule = createLodSchedule(10)
    const phases: number[] = []
    for (let i = 0; i < 10; i++) {
      phases.push(schedule.nextPhase())
      schedule.nextKey()
    }
    expect(phases).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('repeats a phase only after a full pass through the budget', () => {
    const schedule = createLodSchedule(10)
    const phases: number[] = []
    for (let i = 0; i < 12; i++) {
      phases.push(schedule.nextPhase())
      schedule.nextKey()
    }
    expect(phases).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1])
  })

  it('hands out unique keys independent of the phase sequence', () => {
    const schedule = createLodSchedule(10)
    const keys: number[] = []
    for (let i = 0; i < 10; i++) {
      schedule.nextPhase()
      keys.push(schedule.nextKey())
    }
    expect(keys).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps the phase and key counters independent', () => {
    const schedule = createLodSchedule(10)
    expect(schedule.nextPhase()).toBe(0)
    schedule.nextKey()
    schedule.nextKey()
    expect(schedule.nextPhase()).toBe(1) // two key draws did not advance the phase
    expect(schedule.nextKey()).toBe(2) // two phase draws did not skip a key
  })

  it('spreads the budget for any period, not only ten', () => {
    const schedule = createLodSchedule(4)
    const phases: number[] = []
    for (let i = 0; i < 6; i++) {
      phases.push(schedule.nextPhase())
      schedule.nextKey()
    }
    expect(phases).toEqual([0, 1, 2, 3, 0, 1])
  })
})
