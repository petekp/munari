// The filter-policy state machine — pinned means mips + trilinear,
// ladder-tracked means plain linear, and UNPINNING must restore the
// dynamic policy even when the tier does not change.
//
// Reading tiers are mip-free. A PINNED tier carries mips and trilinear
// filtering (deterministic memory, softness wherever partially
// minified — the documented trade), while ladder-tracked tiers stay
// plain linear. The regression this contract exists to prevent is a
// silent no-op: an applier keyed on tier delta alone skips the unpin
// transition when the tier happens to be unchanged, and the source
// keeps trilinear sampling forever — no error, just texture that stays
// softer than the ladder says it should be.
import { describe, expect, it } from 'vitest'

import { filterPolicy, filterPolicyTransition } from '@anamorph/core'

describe('the filter policy', () => {
  it('pinned carries mips and trilinear', () => {
    expect(filterPolicy(true)).toEqual({ mips: true, trilinear: true })
  })

  it('ladder-tracked is mip-free and plain linear', () => {
    expect(filterPolicy(false)).toEqual({ mips: false, trilinear: false })
  })
})

describe('the transitions — keyed on the pair, never on tier alone', () => {
  it('pinning at an unchanged tier reallocates (mips must appear)', () => {
    expect(filterPolicyTransition({ pinned: false, tier: 2 }, { pinned: true, tier: 2 })).toBe(
      'reallocate',
    )
  })

  it('UNPINNING at an unchanged tier reallocates — the silent no-op', () => {
    // The bug: pin → unpin with the tier coincidentally equal was
    // treated as "nothing changed", and the dynamic policy never came
    // back. The transition function must look at the whole pair.
    expect(filterPolicyTransition({ pinned: true, tier: 2 }, { pinned: false, tier: 2 })).toBe(
      'reallocate',
    )
  })

  it('a tier change while tracked reallocates (immutable storage)', () => {
    expect(filterPolicyTransition({ pinned: false, tier: 1 }, { pinned: false, tier: 2 })).toBe(
      'reallocate',
    )
  })

  it('a tier change while pinned reallocates — pinning fixes policy, not storage', () => {
    expect(filterPolicyTransition({ pinned: true, tier: 1 }, { pinned: true, tier: 3 })).toBe(
      'reallocate',
    )
  })

  it('an identical state retains', () => {
    expect(filterPolicyTransition({ pinned: true, tier: 2 }, { pinned: true, tier: 2 })).toBe(
      'retain',
    )
    expect(filterPolicyTransition({ pinned: false, tier: 0 }, { pinned: false, tier: 0 })).toBe(
      'retain',
    )
  })
})
