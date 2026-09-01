// Rain water's contract — leveling within a basin, spilling past a rim,
// and depositing without losing volume.
//
// "Fall-through at a gap" (a falling drop over a NO_SURFACE column never
// landing) is a falling-drop behavior, not a water behavior — it lives in
// rainLaw.test.ts, which owns stepFalling's h1 collision check.
//
// A basin here is walled by ink columns taller than the water ever rises
// (topInk well below the floor's), not by the terrain array's own edges —
// the terrain's first and last column are themselves treated as open, the
// same as a real NO_SURFACE gap (nothing is known past the sampled rect),
// so a "sealed" test basin needs at least one wall column between its
// floor and either the array edge or a real gap.

import { describe, expect, it } from 'vitest'
import {
  RAIN_NO_SURFACE,
  RAIN_WATER_FILM_PX,
  createWaterField,
  depositWater,
  stepWaterField,
  terrainColumn,
  type GlyphTerrain,
  type WaterField,
} from './rainWater'

function sumDepth(field: WaterField): number {
  return field.depth.reduce((total, d) => total + d, 0)
}

interface SettleResult {
  readonly field: WaterField
  readonly spilled: number
}

function settle(field: WaterField, steps: number): SettleResult {
  let current = field
  let spilled = 0
  for (let i = 0; i < steps; i++) {
    const stepped = stepWaterField(current, 1 / 60)
    current = stepped.field
    for (const spill of stepped.spills) spilled += spill.volume
  }
  return { field: current, spilled }
}

describe('terrainColumn', () => {
  it('maps a viewport x to a column index relative to the terrain left edge', () => {
    const terrain: GlyphTerrain = { left: 100, topInk: [50, 50, 50] }
    expect(terrainColumn(terrain, 101)).toBe(1)
    expect(terrainColumn(terrain, 99)).toBe(-1)
    expect(terrainColumn(terrain, 200)).toBe(-1)
  })
})

describe('deposit conservation', () => {
  it('spreads a deposit across neighboring ink columns without losing volume', () => {
    // A basin walled well above anything 3px of deposit could reach, so
    // none of it is lost to the per-column or total caps.
    const terrain: GlyphTerrain = { left: 0, topInk: [10, 50, 50, 50, 10] }
    const field = createWaterField(terrain)
    const deposited = depositWater(field, 2, 3)
    expect(sumDepth(deposited)).toBeCloseTo(3, 5)
  })

  it('drops nothing into a NO_SURFACE column and leaves the field unchanged if none of the spread has ink', () => {
    const terrain: GlyphTerrain = { left: 0, topInk: [RAIN_NO_SURFACE, RAIN_NO_SURFACE, RAIN_NO_SURFACE] }
    const field = createWaterField(terrain)
    const deposited = depositWater(field, 1, 5)
    expect(sumDepth(deposited)).toBe(0)
  })
})

describe('level-seeking within a basin', () => {
  it('an uneven deposit across a flat basin floor converges toward an equal surface height', () => {
    // Walls at 40 (physically tall) bound a 60-deep floor; 6px of water
    // spread unevenly stays far below the ~20px depth that would even
    // reach the walls, so this basin never spills — it only levels.
    const terrain: GlyphTerrain = { left: 0, topInk: [40, 60, 60, 60, 40] }
    const { field, spilled } = settle({ terrain, depth: [0, 6, 0, 0, 0] }, 200)
    expect(field.depth[1]).toBeCloseTo(2, 1)
    expect(field.depth[2]).toBeCloseTo(2, 1)
    expect(field.depth[3]).toBeCloseTo(2, 1)
    expect(spilled).toBe(0)
    expect(sumDepth(field)).toBeCloseTo(6, 3)
  })

  it('does not exchange volume across a NO_SURFACE gap even when both sides are walled basins', () => {
    const terrain: GlyphTerrain = {
      left: 0,
      topInk: [40, 60, 60, 40, RAIN_NO_SURFACE, 40, 60, 60, 40],
    }
    const { field } = settle({ terrain, depth: [0, 6, 0, 0, 0, 0, 0, 0, 0] }, 200)
    expect(field.depth[1]).toBeGreaterThan(0)
    expect(field.depth[2]).toBeGreaterThan(0)
    // The right-hand basin (columns 6-7) never receives any of the left
    // basin's water — the gap at column 4 blocks every exchange across it.
    expect(field.depth[6]).toBe(0)
    expect(field.depth[7]).toBe(0)
  })
})

describe('spill at a rim', () => {
  it('an overfull basin pushes water over its interior wall and out the far, open end', () => {
    // A 3-column floor (60) walled on both sides at 20 (physically taller);
    // beyond the right wall, one more open column before the terrain edge.
    // 45px on each floor column puts its surface at y=15 — above (past)
    // the walls' own dry surface of y=20 — so the fill must cross a wall
    // to go anywhere.
    const terrain: GlyphTerrain = { left: 0, topInk: [20, 60, 60, 60, 20, 60] }
    const initial = 45 * 3
    const { field, spilled } = settle({ terrain, depth: [0, 45, 45, 45, 0, 0] }, 600)
    expect(spilled).toBeGreaterThan(0)
    // Leveling only ever redistributes; the open ends are the only volume
    // sink, so nothing manufactures water beyond what was deposited.
    expect(sumDepth(field) + spilled).toBeLessThanOrEqual(initial + 1e-6)
  })

  it('a column open to the terrain edge never holds more than a thin film', () => {
    const terrain: GlyphTerrain = { left: 0, topInk: [50, 50] }
    const { field } = settle({ terrain, depth: [8, 0] }, 200)
    expect(field.depth[0]).toBeLessThanOrEqual(RAIN_WATER_FILM_PX + 1e-6)
  })
})
