import { describe, expect, it } from 'vitest'
import { VEIL_DEFAULTS, veilLod, veilRadius, veilReturn, veilSeamAlpha, veilStrip } from './veilLaw'

// The seam constraints and the shape guarantees the scene leans on.
// Loose enough to survive tuning height/maxRadius/curve; tight enough
// that a regression that would show on screen fails here first.

const P = VEIL_DEFAULTS

describe('veil profile', () => {
  it('the seam is exactly sharp — radius(0) = 0, and stays 0 above the band', () => {
    expect(veilRadius(0, P)).toBe(0)
    expect(veilRadius(-40, P)).toBe(0)
  })

  it('the far edge reaches full radius exactly, and holds beyond', () => {
    expect(veilRadius(P.height, P)).toBe(P.maxRadius)
    expect(veilRadius(P.height * 2, P)).toBe(P.maxRadius)
  })

  it('ramps monotonically — deeper is never sharper', () => {
    let prev = -1
    for (let d = 0; d <= P.height; d += P.height / 200) {
      const r = veilRadius(d, P)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })

  it('both edges arrive flat — no crease at the band boundaries', () => {
    // Slope near each edge must be a small fraction of the mean slope,
    // or the band's outline is visible as a line across the content.
    const mean = P.maxRadius / P.height
    const eps = P.height / 1000
    const slopeAt = (d: number) => (veilRadius(d + eps, P) - veilRadius(d, P)) / eps
    expect(slopeAt(0)).toBeLessThan(mean / 10)
    expect(slopeAt(P.height - eps)).toBeLessThan(mean / 10)
  })

  it('the band contributes nothing at the seam row, everything by fade depth', () => {
    // The seam row must be PURE live page — continuity there is then
    // the compositor's own, immune to anything ours (a copy at any
    // opacity on that row turns every rendering error into a visible
    // line).
    expect(veilSeamAlpha(0, P)).toBe(0)
    expect(veilSeamAlpha(-10, P)).toBe(0)
    expect(veilSeamAlpha(P.fade, P)).toBe(1)
    expect(veilSeamAlpha(P.height, P)).toBe(1)
  })

  it('the fade ramps monotonically and arrives flat at both ends', () => {
    let prev = -1
    for (let d = 0; d <= P.fade; d += P.fade / 200) {
      const a = veilSeamAlpha(d, P)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    const eps = P.fade / 1000
    const mean = 1 / P.fade
    const slopeAt = (d: number) => (veilSeamAlpha(d + eps, P) - veilSeamAlpha(d, P)) / eps
    expect(slopeAt(0)).toBeLessThan(mean / 10)
    expect(slopeAt(P.fade - eps)).toBeLessThan(mean / 10)
  })

  it('the fade finishes only where the blur can hide small errors', () => {
    // Wherever the band is fully opaque, a couple of pixels of offset
    // must already be swallowed by blur — otherwise the fade just
    // moves visible misalignment deeper instead of hiding it. 2px of
    // radius is the floor: under it, sharp text visibly doubles
    // against its live twin; over it, the echo is inside the kernel.
    expect(veilRadius(P.fade, P)).toBeGreaterThanOrEqual(2)
  })

  it('the strip contains every tap of every window row', () => {
    // The final pass blurs vertically: a fragment at band row d samples
    // rows d ± radius(d), past both edges of the window — those rows
    // exist in the article, but only land in the strip if the offscreen
    // passes rendered them. A tap outside the strip clamps to its edge
    // row, and the clamped smear changes with every scroll step
    // (observed as bottom-edge flicker, 2026-08-08). The window here is
    // the scene's: band plus underhang.
    const windowH = 300
    const strip = veilStrip(windowH, P)
    for (let d = 0; d <= windowH; d += 1) {
      const r = veilRadius(d, P)
      expect(d - r).toBeGreaterThanOrEqual(strip.top)
      expect(d + r).toBeLessThanOrEqual(strip.top + strip.height)
    }
  })

  it('taps at the seam sample the pristine base level', () => {
    // Zero spacing (and any spacing inside one texel) must map to
    // level 0, or the seam loses its to-the-pixel exactness to mip
    // averaging.
    expect(veilLod(0, 1)).toBe(0)
    expect(veilLod(0.4, 0.5)).toBe(0)
    expect(veilLod(1, 1)).toBe(0)
  })

  it('the sampling level plugs the gap between taps at any density', () => {
    // Level L integrates ~2^L texels: the level chosen must make one
    // tap's footprint cover at least half the spacing to the next tap
    // (no gaps — the lattice), but no more than twice it (no double
    // blur). Checked across the radii and densities the scene uses.
    for (const dpr of [1, 2]) {
      const texel = 1 / dpr
      for (let r = 0.5; r <= P.maxRadius; r += 0.5) {
        const spacing = r / 6
        const footprint = Math.pow(2, veilLod(spacing, texel)) * texel
        expect(footprint).toBeGreaterThanOrEqual(Math.min(spacing, texel) / 2)
        expect(footprint).toBeLessThanOrEqual(Math.max(spacing * 2, texel))
      }
    }
  })

  it('the sampling level grows monotonically with spacing', () => {
    let prev = -1
    for (let s = 0; s <= 8; s += 0.25) {
      const l = veilLod(s, 0.5)
      expect(l).toBeGreaterThanOrEqual(prev)
      prev = l
    }
  })
})

// The return ramp: how the blur comes back once a resize's mismatched
// generations agree again. Mirrors the shape tests above (veilRadius,
// veilSeamAlpha) because the ramp is the same smoothstep, over a clock
// instead of a distance — but the floor at the bottom is new: this is the
// one constant in the file with a perceptual budget instead of a purely
// geometric one, because nothing on screen tells you what the "right"
// speed is except a person watching it happen.
describe('veil return — the generation gate', () => {
  it('is exactly 0 at the moment of match, and stays 0 before it', () => {
    expect(veilReturn(0, P)).toBe(0)
    expect(veilReturn(-40, P)).toBe(0)
  })

  it('reaches exactly 1 at returnMs, and holds beyond', () => {
    expect(veilReturn(P.returnMs, P)).toBe(1)
    expect(veilReturn(P.returnMs * 2, P)).toBe(1)
  })

  it('ramps monotonically — later is never less open than earlier', () => {
    let prev = -1
    for (let t = 0; t <= P.returnMs; t += P.returnMs / 200) {
      const g = veilReturn(t, P)
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
  })

  it('both edges arrive flat — no pop at the start or at the settle', () => {
    const mean = 1 / P.returnMs
    const eps = P.returnMs / 1000
    const slopeAt = (t: number) => (veilReturn(t + eps, P) - veilReturn(t, P)) / eps
    expect(slopeAt(0)).toBeLessThan(mean / 10)
    expect(slopeAt(P.returnMs - eps)).toBeLessThan(mean / 10)
  })

  // THE PERCEPTUAL FLOOR. Under ~120ms the return reads as a pop — the
  // exact discontinuity a smoothstep ramp exists to avoid, just moved to
  // the timing axis. Over ~250ms a settled eye is already reading text
  // before the blur has finished coming back, which is the opposite
  // failure: a veil that appears to be loading rather than settling.
  it("the budget lands where a resize's return can afford", () => {
    expect(VEIL_DEFAULTS.returnMs).toBeGreaterThanOrEqual(120)
    expect(VEIL_DEFAULTS.returnMs).toBeLessThanOrEqual(250)
  })
})
