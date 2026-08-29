// The filter policy — what a resolution mode implies of GL storage
// and sampling.
//
// Reading tiers mip-free — "the tier ladder IS the mip chain" — holds
// only while the tier tracks screen density. A PINNED tier
// deliberately oversupplies at range, and bilinear minification
// without mips is aliasing by construction (measured: shredded fine
// text and grid moiré under a pinned maximum resolution), so pinned
// carries mips and trilinear; ladder-tracked stays plain linear. The
// anisotropy knob does nothing without a mip chain to select from —
// order matters: allocation first, then filtering, then the shader.

export interface FilterPolicy {
  /** Allocate mip storage for this tier's texture. */
  mips: boolean
  /** Sample with trilinear (mip-interpolating) minification. */
  trilinear: boolean
}

/** The policy a resolution mode implies. Pinning is a documented
 * trade: deterministic memory + zero re-rasters, softer than auto
 * wherever partially minified. */
export function filterPolicy(pinned: boolean): FilterPolicy {
  return pinned
    ? { mips: true, trilinear: true }
    : { mips: false, trilinear: false }
}
