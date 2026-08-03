// The filter-policy state machine (archive#9, #36, #37).
//
// archive#9 made reading tiers mip-free — "the tier ladder IS the mip
// chain" — which holds only while the tier tracks screen density. A
// PINNED tier deliberately oversupplies at range, and bilinear
// minification without mips is aliasing by construction (measured:
// shredded fine text and grid moiré the moment a lab pinned 'max'), so
// archive#36 amended the rule: pinned carries mips and trilinear;
// ladder-tracked stays plain linear. The anisotropy knob does nothing
// without a mip chain to select from — order matters: allocation
// first, then filtering, then the shader.
//
// The transition half exists because of archive#37's silent no-op: an
// applier keyed on tier delta alone skipped the unpin transition when
// the tier happened to be unchanged, and the source kept trilinear
// sampling forever — no error, just texture softer than the ladder
// said. GL storage is immutable (texStorage2D, archive#10), and the
// mip count bakes at allocation, so ANY change to the (pinned, tier)
// pair reallocates; only the identical pair retains.

export interface FilterPolicy {
  /** Allocate mip storage for this tier's texture. */
  mips: boolean
  /** Sample with trilinear (mip-interpolating) minification. */
  trilinear: boolean
}

export interface PolicyState {
  pinned: boolean
  tier: number
}

/** The policy a resolution mode implies. Pinning is a documented
 * trade: deterministic memory + zero re-rasters, softer than auto
 * wherever partially minified (archive#37). */
export function filterPolicy(pinned: boolean): FilterPolicy {
  return pinned
    ? { mips: true, trilinear: true }
    : { mips: false, trilinear: false }
}

/**
 * What a state change requires of GL storage: 'reallocate' tears down
 * and re-creates (immutable storage — archive#10), 'retain' keeps the
 * allocation. Keyed on the WHOLE pair — a policy flip at an unchanged
 * tier still needs new storage, because the mip count baked at the
 * old allocation (the archive#37 regression).
 */
export function filterPolicyTransition(
  prev: PolicyState,
  next: PolicyState,
): 'reallocate' | 'retain' {
  return prev.pinned === next.pinned && prev.tier === next.tier
    ? 'retain'
    : 'reallocate'
}
