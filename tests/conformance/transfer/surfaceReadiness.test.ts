// The readiness contract — keyed proof over one lifetime.
//
// Two faults are pinned here, and neither is visible in review. A remount
// mid-warm-up fires a presenter's first-draw boundary twice, so a counted
// gate can be satisfied by fewer presenters than it required. And a
// receipt still travelling across a source replacement can prove the new
// lifetime with the old lifetime's pixels.
import { describe, expect, it } from 'vitest'
import {
  readinessAtBirth,
  readinessPending,
  readinessProve,
  readinessReborn,
  readinessRegister,
  readinessSettled,
  readinessUnregister,
} from '@munari/core'

describe('surface readiness', () => {
  it('a Surface with no presenters is never ready', () => {
    // The window that matters: the source has mounted and its presenters
    // have not. An empty set reporting ready would release the page there.
    expect(readinessSettled(readinessAtBirth())).toBe(false)
  })

  it('settles when every registered presenter has drawn once', () => {
    let state = readinessRegister(readinessRegister(readinessAtBirth(), 'a'), 'b')
    expect(readinessPending(state)).toEqual(['a', 'b'])
    state = readinessProve(state, 'a', state.lifetime)
    expect(readinessSettled(state)).toBe(false)
    state = readinessProve(state, 'b', state.lifetime)
    expect(readinessSettled(state)).toBe(true)
  })

  it('one presenter proving twice cannot stand in for another', () => {
    // The counted version of this gate reads two receipts from presenter
    // 'a' as "two of two proven" and releases the page over a presenter
    // that has never drawn.
    let state = readinessRegister(readinessRegister(readinessAtBirth(), 'a'), 'b')
    state = readinessProve(state, 'a', state.lifetime)
    const repeat = readinessProve(state, 'a', state.lifetime)
    expect(repeat).toBe(state)
    expect(readinessSettled(repeat)).toBe(false)
    expect(readinessPending(repeat)).toEqual(['b'])
  })

  it('an unregistered presenter cannot prove anything', () => {
    const state = readinessRegister(readinessAtBirth(), 'a')
    expect(readinessProve(state, 'ghost', state.lifetime)).toBe(state)
  })

  it('a source replacement voids every proof but keeps the presenters', () => {
    let state = readinessRegister(readinessRegister(readinessAtBirth(), 'a'), 'b')
    state = readinessProve(readinessProve(state, 'a', 1), 'b', 1)
    expect(readinessSettled(state)).toBe(true)
    const reborn = readinessReborn(state)
    expect(reborn.lifetime).toBe(2)
    expect(reborn.registered).toEqual(['a', 'b'])
    expect(readinessSettled(reborn)).toBe(false)
  })

  it('a receipt from the previous lifetime is refused', () => {
    // The receipt is still travelling across a renderer frame. Accepting
    // it would report the new source ready on the strength of the old
    // source's pixels — a Surface that says it has drawn content it has never seen.
    const reborn = readinessReborn(readinessRegister(readinessAtBirth(), 'a'))
    expect(readinessProve(reborn, 'a', 1)).toBe(reborn)
    expect(readinessProve(reborn, 'a', 2).proven).toEqual(['a'])
  })

  it('a presenter that leaves takes its proof with it', () => {
    let state = readinessRegister(readinessRegister(readinessAtBirth(), 'a'), 'b')
    state = readinessProve(readinessProve(state, 'a', 1), 'b', 1)
    state = readinessUnregister(state, 'b')
    expect(state.proven).toEqual(['a'])
    expect(readinessSettled(state)).toBe(true)
    // …and rejoining is unproven again: it is a new mesh with no draw yet.
    state = readinessRegister(state, 'b')
    expect(readinessSettled(state)).toBe(false)
  })
})
