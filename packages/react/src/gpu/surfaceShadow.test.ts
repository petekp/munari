import { describe, expect, it } from 'vitest'
import { computeShadowProjection } from './surfaceShadow'

describe('computeShadowProjection', () => {
  it('expands the shadow quad margin to fit CSS rest shadow offsets and key projection at altitude', () => {
    const opts = { blur: 16, spread: 0, elevationScale: 0.45 }
    const atRest = computeShadowProjection(
      [340, 200],
      { x: 0, y: 0, z: 0 },
      [0, 0, 750],
      opts,
      54,
    )
    expect(atRest.visible).toBe(true)
    expect(atRest.cardHalf[0]).toBeCloseTo(170, 0)
    expect(atRest.cardHalf[1]).toBeCloseTo(100, 0)
    expect(atRest.quadHalf[0]).toBeGreaterThanOrEqual(224)
    expect(atRest.quadHalf[1]).toBeGreaterThanOrEqual(154)

    const lifted = computeShadowProjection(
      [340, 200],
      { x: 0, y: 0, z: 32 },
      [-200, 150, 750],
      opts,
    )
    expect(lifted.visible).toBe(true)
    const centerX = (lifted.verts[0] + lifted.verts[2] + lifted.verts[4] + lifted.verts[6]) * 0.25
    const centerY = (lifted.verts[1] + lifted.verts[3] + lifted.verts[5] + lifted.verts[7]) * 0.25
    expect(centerX).toBeGreaterThan(5)
    expect(centerY).toBeLessThan(-4)

    const scaledFlat = computeShadowProjection([340, 200], { x: 0, y: 0, z: 0, sx: 1.2, sy: 0.85 }, [0, 0, 750], opts)
    const scaledJustLifted = computeShadowProjection(
      [340, 200],
      { x: 0, y: 0, z: 0.02, sx: 1.2, sy: 0.85 },
      [0, 0, 750],
      opts,
    )
    expect(scaledFlat.cardHalf[0]).toBeCloseTo(scaledJustLifted.cardHalf[0], 0)
    expect(scaledFlat.cardHalf[1]).toBeCloseTo(scaledJustLifted.cardHalf[1], 0)
    expect(scaledFlat.quadHalf[0]).toBeCloseTo(scaledJustLifted.quadHalf[0], 0)
    expect(scaledFlat.quadHalf[1]).toBeCloseTo(scaledJustLifted.quadHalf[1], 0)
  })
})
