// The identity contract — one controller, one epoch, and a part set that
// is complete or it is nothing.
//
// The cases below are the ones that cannot be caught by reading the code:
// a mount order that only React produces (Strict Mode's double invoke), a
// second declaration of the same content, and a part set that looks whole
// while a part has no presenter.
import { describe, expect, it } from 'vitest'
import {
  partSetEmpty,
  partSetExpect,
  partSetMissing,
  partSetRegister,
  surfaceAcquire,
  surfaceEpochCurrent,
  surfaceHolds,
  surfaceRelease,
  surfaceUnclaimed,
} from '@munari/core'

describe('surface identity', () => {
  it('starts unclaimed at epoch zero', () => {
    const state = surfaceUnclaimed()
    expect(state.controller).toBeNull()
    expect(state.epoch).toBe(0)
    // Nothing can be current against an identity nobody holds — including
    // the epoch it is literally carrying.
    expect(surfaceEpochCurrent(state, 0)).toBe(false)
  })

  it('an acquire advances the epoch and installs the controller', () => {
    const state = surfaceAcquire(surfaceUnclaimed(), 7)
    expect(state.epoch).toBe(1)
    expect(surfaceHolds(state, 7)).toBe(true)
    expect(surfaceEpochCurrent(state, 1)).toBe(true)
  })

  it('a second controller is refused by identity, and the incumbent keeps it', () => {
    // The duplicate-controller fault: two <Surface> declarations of one
    // handle. Refusing the newcomer rather than the incumbent is what stops
    // a second declaration from taking content away from the tree that is
    // already presenting it.
    const first = surfaceAcquire(surfaceUnclaimed(), 1)
    const second = surfaceAcquire(first, 2)
    expect(second).toBe(first)
    expect(surfaceHolds(second, 1)).toBe(true)
    expect(surfaceHolds(second, 2)).toBe(false)
  })

  it('re-acquiring with the live token is a no-op, not a new epoch', () => {
    const held = surfaceAcquire(surfaceUnclaimed(), 1)
    expect(surfaceAcquire(held, 1)).toBe(held)
  })

  it('only the live controller can release', () => {
    const held = surfaceAcquire(surfaceUnclaimed(), 1)
    expect(surfaceRelease(held, 99)).toBe(held)
    const free = surfaceRelease(held, 1)
    expect(free.controller).toBeNull()
  })

  it('a released epoch does not fall back, so a receipt still travelling reads stale', () => {
    const held = surfaceAcquire(surfaceUnclaimed(), 1)
    const free = surfaceRelease(held, 1)
    expect(free.epoch).toBe(1)
    const next = surfaceAcquire(free, 2)
    expect(next.epoch).toBe(2)
    // The old lifetime's receipt is refused against the new one.
    expect(surfaceEpochCurrent(next, 1)).toBe(false)
    expect(surfaceEpochCurrent(next, 2)).toBe(true)
  })

  it('a stale cleanup cannot release the replacement controller', () => {
    const first = surfaceAcquire(surfaceUnclaimed(), 1)
    const second = surfaceAcquire(first, 2) // refused; token 1 still holds
    const afterFirstCleanup = surfaceRelease(second, 1)
    expect(afterFirstCleanup.controller).toBeNull()
    const remount = surfaceAcquire(afterFirstCleanup, 2)
    expect(surfaceHolds(remount, 2)).toBe(true)
    // The stale token cannot tear down the live mount.
    expect(surfaceRelease(remount, 1)).toBe(remount)
  })
})

describe('part sets', () => {
  it('a duplicate part id is refused by identity', () => {
    // Reorderable parts that fall back to array index produce two parts
    // claiming one id. The set would then look whole while one part has no
    // presenter at all.
    const one = partSetExpect(partSetEmpty(), 'a')
    expect(partSetExpect(one, 'a')).toBe(one)
  })

  it('misses a declared part until a presenter covers it', () => {
    let set = partSetExpect(partSetExpect(partSetEmpty(), 'a'), 'b')
    expect(partSetMissing(set)).toEqual(['a', 'b'])
    set = partSetRegister(set, 'a')
    expect(partSetMissing(set)).toEqual(['b'])
    set = partSetRegister(set, 'b')
    expect(partSetMissing(set)).toEqual([])
  })

  it('several presenters may share one part', () => {
    // The API allows more than one scene presentation per part, so
    // registration is a set membership and never a tally.
    const set = partSetRegister(partSetExpect(partSetEmpty(), 'a'), 'a')
    expect(partSetRegister(set, 'a')).toBe(set)
  })

  it('a presenter for an undeclared part covers nothing', () => {
    const set = partSetExpect(partSetEmpty(), 'a')
    expect(partSetRegister(set, 'ghost')).toBe(set)
    expect(partSetMissing(set)).toEqual(['a'])
  })
})
