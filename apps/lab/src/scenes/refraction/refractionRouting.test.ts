// The routing law's contract — which of two live documents a pointer lands in.
//
// The material already decides this per fragment. Routing decides it once,
// on the CPU, for the point under the pointer, so a hover goes into the
// subtree the viewer is actually looking at. That makes one law exist in two
// languages, and the failure mode of a language pair is specific: the
// picture stays perfectly right and only the pointer goes to the wrong
// document. Nothing on screen reports it.
//
// What is pinned here is the PURE half. `roundedCoord` is transcribed from
// `roundedUv` in refractionShaders.ts and the numbers below were computed
// from that GLSL by hand, so a transcription error fails here rather than in
// a browser. The half that needs a GPU — that the CPU mirror of the spread
// field agrees with the field the shader samples — is
// `gate:gallery-pointer`, because only a browser can fill those targets.

import { describe, expect, it } from 'vitest'
import { apertureEdge, approachUv, roundedCoord } from './refractionLaw'

describe('roundedCoord', () => {
  // `frontRounding: 0` is the straight bilinear ramp the field had before
  // 2026-08-24. It must be the identity, or turning the knob down would
  // move the picture as well as the easing.
  it('is the identity with no rounding', () => {
    for (const x of [0, 0.013, 0.25, 0.5, 0.734, 1]) {
      expect(roundedCoord(x, 1 / 29, 0)).toBeCloseTo(x, 12)
    }
  })

  // A texel CENTRE is a fixed point at every rounding: there f is 0.5 and
  // smoothstep(0.5) is 0.5, so the eased ramp and the linear one agree. If
  // this ever moved, the eased field would be shifted against the one the
  // spread passes actually wrote.
  it('leaves every texel centre where it was', () => {
    const texel = 1 / 18
    for (let i = 0; i < 18; i++) {
      const centre = (i + 0.5) * texel
      expect(roundedCoord(centre, texel, 1)).toBeCloseTo(centre, 12)
      expect(roundedCoord(centre, texel, 0.5)).toBeCloseTo(centre, 12)
    }
  })

  // Fully eased, a point a quarter of the way past a centre is pulled back
  // toward it: f = 0.25 becomes smoothstep(0.25) = 0.15625. On a 1/29 grid
  // that is (0.5 + 0.15625) / 29, and the linear answer is (0.5 + 0.25) / 29.
  it('pulls a point between centres toward the nearer one', () => {
    const texel = 1 / 29
    const quarter = (0.5 + 0.25) * texel
    expect(roundedCoord(quarter, texel, 1)).toBeCloseTo((0.5 + 0.15625) * texel, 12)
    expect(roundedCoord(quarter, texel, 0)).toBeCloseTo(quarter, 12)
  })
})

describe('approachUv', () => {
  // The incoming view arrives large and settles to 1:1, so at zoom 1 the
  // mapping is the identity — which is what makes routing exact at the
  // landing, the only moment a click can actually follow a link.
  it('is the identity at 1:1', () => {
    expect(approachUv(0.3, 0.7, 1)).toEqual([0.3, 0.7])
  })

  // Zoomed in, the sheet shows a smaller window of the document, so a point
  // of the sheet looks at a point NEARER the centre.
  it('looks nearer the centre while the view is still large', () => {
    const [u, v] = approachUv(1, 1, 1.125)
    expect(u).toBeCloseTo(0.5 + 0.5 / 1.125, 12)
    expect(v).toBeCloseTo(0.5 + 0.5 / 1.125, 12)
    expect(u).toBeLessThan(1)
  })

  it('holds the centre fixed at every zoom', () => {
    for (const z of [1, 1.05, 1.125, 1.3]) expect(approachUv(0.5, 0.5, z)).toEqual([0.5, 0.5])
  })
})

describe('routing against the aperture', () => {
  // The routing predicate is `field > apertureEdge(...)`, the same
  // comparison the shader makes before its seam is smoothed. The ends are
  // what matter: at both of them exactly one document owns the whole sheet,
  // so a pointer at a landing can never be handed to the copy nobody sees.
  const OVERSHOOT = 0.23

  it('gives the whole sheet to the outgoing document at t = 0', () => {
    const edge = apertureEdge(0, OVERSHOOT)
    // The field is a normalised 0..1, so nothing can be above this.
    expect(edge).toBeGreaterThan(1)
  })

  it('gives the whole sheet to the incoming document at t = 1', () => {
    const edge = apertureEdge(1, OVERSHOOT)
    expect(edge).toBeLessThan(0)
  })

  // Mid-crossing both documents own part of the sheet, which is the only
  // state where routing has any work to do.
  it('splits the sheet in between', () => {
    const edge = apertureEdge(0.5, OVERSHOOT)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
  })
})
