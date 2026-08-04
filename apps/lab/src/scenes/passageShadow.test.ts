// Where the shadow is, and what shape it is.
//
// The whole reason this is a pure function with a test rather than four lines
// inline in the scene is a bug that a screenshot could not name: the shadow
// was authored at the world origin, so it drew a card-sized smear at the
// CENTRE OF THE VIEWPORT while the card flew off to the left. On screen that
// looked like a hard dark block beside the card — because the card's depth
// write was deleting the half of it that overlapped, and what survived was
// the remainder, with a straight edge where the silhouette ended.
//
// It reads as a shader problem. It was an arithmetic problem, and arithmetic
// is testable.

import { describe, expect, it } from 'vitest'

import { shadowFrame } from './passageShadow'

const LIFT = 150

describe('shadowFrame', () => {
  it('sits under the card, on the document plane, however high the card is', () => {
    // Two claims in one assertion, and both are physics rather than taste. It
    // is cast ONTO the page, so its z does not follow the card up; and it is
    // cast BY the card, so its x and y do follow it across.
    const low = shadowFrame(-275, -40, 0, 400, 300, LIFT)
    const high = shadowFrame(-275, -40, LIFT, 400, 300, LIFT)
    expect(low.position[0]).toBe(-275)
    expect(low.position[1]).toBe(-40)
    expect(high.position[0]).toBe(-275)
    expect(high.position[1]).toBe(-40)
    expect(high.position[2]).toBe(low.position[2])
    expect(Math.abs(high.position[2])).toBeLessThan(2)
  })

  /**
   * BEHIND the document plane, and the sign is the whole finding.
   *
   * The clip that keeps a shadow outside its caster is a DEPTH TEST, not a
   * blend (three-ui decisions #58, and the note at the top of this file). That
   * test only works while the caster is nearer the camera than the shadow —
   * which is true for every frame of the flight except the two that matter,
   * because a LANDED card is at z = 0 and the shadow was authored at z = +1.
   *
   * The reading was not "a shadow in the wrong place". It was the entire card
   * at HALF BRIGHTNESS at both ends of every flight and correct in the middle:
   * measured 2026-08-04 by forcing the card's fragment shader to opaque red
   * and reading the drawing buffer back — 128, exactly half, and 255 the
   * instant this quad moved behind the plane. Compared against the landed DOM
   * at the same pixels the artwork read (28, 37, 77) against (54, 72, 152),
   * every channel a factor of two down.
   */
  it('sits behind the document plane, so a landed card occludes it', () => {
    // Negative: a card at rest is ON the plane, and it has to win the depth
    // test against its own shadow. Small: the separation a floating card reads
    // as must come from the card's height and nothing else.
    const z = shadowFrame(0, 0, 0, 400, 300, LIFT).position[2]
    expect(z).toBeLessThan(0)
    expect(z).toBeGreaterThan(-2)
  })

  it('softens and pales as the card rises', () => {
    // Holding either constant is the single most reliable way to make a
    // floating thing read as a sticker.
    const low = shadowFrame(0, 0, 0, 400, 300, LIFT)
    const high = shadowFrame(0, 0, LIFT, 400, 300, LIFT)
    expect(high.sigma).toBeGreaterThan(low.sigma * 3)
    expect(high.alpha).toBeLessThan(low.alpha)
  })

  it('carries enough quad for its own blur, and no arbitrary amount', () => {
    // Too little and the tail ends on a straight cut; the margin is derived
    // from sigma so it cannot drift out of step with a retune.
    for (const z of [0, 60, LIFT]) {
      const f = shadowFrame(0, 0, z, 400, 300, LIFT)
      expect(f.quadHalf[0] - 200).toBeCloseTo(f.sigma * 3, 6)
      expect(f.quadHalf[1] - 150).toBeCloseTo(f.sigma * 3, 6)
    }
  })

  it('is the card plus margin, so the SDF inside it is still the card', () => {
    const f = shadowFrame(0, 0, 80, 640, 420, LIFT)
    expect(f.cardHalf).toEqual([320, 210])
    expect(f.quadHalf[0]).toBeGreaterThan(f.cardHalf[0])
    expect(f.quadHalf[1]).toBeGreaterThan(f.cardHalf[1])
  })

  it('cannot be pushed past its own extremes by a z outside the arc', () => {
    // The spring overshoots nothing, but `hold` and a mid-flight reversal both
    // hand this z values it did not derive.
    const over = shadowFrame(0, 0, LIFT * 3, 400, 300, LIFT)
    const top = shadowFrame(0, 0, LIFT, 400, 300, LIFT)
    expect(over.sigma).toBe(top.sigma)
    expect(over.alpha).toBe(top.alpha)
    const under = shadowFrame(0, 0, -50, 400, 300, LIFT)
    expect(under.sigma).toBe(shadowFrame(0, 0, 0, 400, 300, LIFT).sigma)
  })
})
