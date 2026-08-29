// The filter policy — pinned means mips + trilinear, ladder-tracked
// means plain linear.
//
// A PINNED tier carries mips and trilinear filtering (deterministic
// memory, softness wherever partially minified — the documented trade),
// while ladder-tracked tiers stay mip-free and plain linear. The
// transition half this suite used to pin — reallocation keyed on the
// (pinned, tier) pair — retired with its law (decisions.md #37): #15
// stores texels in a density band, so no runtime keys storage on that
// pair any more.
import { describe, expect, it } from 'vitest'

import { filterPolicy } from '@munari/core'

describe('the filter policy', () => {
  it('pinned carries mips and trilinear', () => {
    expect(filterPolicy(true)).toEqual({ mips: true, trilinear: true })
  })

  it('ladder-tracked is mip-free and plain linear', () => {
    expect(filterPolicy(false)).toEqual({ mips: false, trilinear: false })
  })
})
