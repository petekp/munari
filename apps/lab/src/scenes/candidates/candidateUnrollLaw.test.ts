import { describe, expect, it } from 'vitest'
import { unrollStep, type RollDrive } from './candidateUnrollLaw'
import { unrollTuning } from './candidateTuning'

describe('Unroll cleanup', () => {
  it('keeps an open request mounted while its first scene presentation is pending', () => {
    const pending: RollDrive = { open: true, target: 0, t: 0 }
    expect(unrollStep(pending, 1 / 60, unrollTuning.tau)).toEqual({ t: 0, closed: false })
  })

  it('closes a cancelled open without needing a scene frame or nonzero progress', () => {
    const cancelled: RollDrive = { open: false, target: 0, t: 0 }
    expect(unrollStep(cancelled, 0, unrollTuning.tau)).toEqual({ t: 0, closed: true })
  })

  it('retains an open sheet until its close reaches exact zero', () => {
    const drive: RollDrive = { open: false, target: 0, t: 1 }
    const first = unrollStep(drive, 1 / 60, unrollTuning.tau)
    expect(first.closed).toBe(false)
    expect(first.t).toBeGreaterThan(0)
    let closed = false
    for (let frame = 0; frame < 120 && !closed; frame++) {
      const next = unrollStep(drive, 1 / 60, unrollTuning.tau)
      drive.t = next.t
      closed = next.closed
    }
    expect(closed).toBe(true)
    expect(drive.t).toBe(0)
  })

  it('reverses a close when the menu is reopened', () => {
    const closing = unrollStep({ open: false, target: 0, t: 0.5 }, 1 / 60, unrollTuning.tau)
    const reopened = unrollStep({ open: true, target: 1, t: closing.t }, 1 / 60, unrollTuning.tau)
    expect(reopened.closed).toBe(false)
    expect(reopened.t).toBeGreaterThan(closing.t)
  })
})
