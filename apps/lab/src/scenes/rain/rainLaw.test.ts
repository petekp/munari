// Rain law's contract — landing, merging, rolling, splashing, and the cap.
//
// Each case isolates one transition by holding spawnDue high enough that
// the spawn loop never fires, so a single stepRainWorld call tests exactly
// one rule instead of one rule plus whatever else the RNG did that tick.

import { describe, expect, it } from 'vitest'
import {
  RAIN_FIXED_DT,
  RAIN_MAX_DROPS,
  RAIN_MERGE_RADIUS_CAP,
  RAIN_ROLL_ACCEL,
  RAIN_ROLL_BASE_SPEED,
  RAIN_ROLL_CARRY,
  RAIN_ROLL_OFF_VY,
  RAIN_SPILL_COALESCE_VOLUME_PX,
  RAIN_SPLASH_COUNT_MAX,
  RAIN_SPLASH_COUNT_MIN,
  RAIN_SPLASH_LIFE_S,
  makeRainRng,
  stepRainWorld,
  type GlyphTerrain,
  type Ledge,
  type RainDrop,
  type RainWorld,
} from './rainLaw'
import { RAIN_NO_SURFACE } from './rainWater'

const VIEWPORT = { width: 400, height: 300 }
const NO_SPAWN = Number.POSITIVE_INFINITY

function worldOf(drops: readonly RainDrop[], spawnDue = NO_SPAWN): RainWorld {
  return { drops, spawnDue }
}

describe('landing', () => {
  it('pins a falling drop to the ledge segment it crosses this step', () => {
    const ledges: Ledge[] = [{ x0: 0, x1: 100, y: 50 }]
    const world = worldOf([{ kind: 'falling', x: 40, y: 49, vy: 300, driftVx: 0, r: 2 }])
    const result = stepRainWorld(world, ledges, VIEWPORT, makeRainRng(1))
    expect(result.drops).toHaveLength(1)
    const drop = result.drops[0]
    expect(drop?.kind).toBe('sitting')
    if (drop?.kind === 'sitting') {
      expect(drop.ledge).toBe(0)
      expect(drop.y).toBe(50)
      expect(drop.x).toBeGreaterThanOrEqual(0)
      expect(drop.x).toBeLessThanOrEqual(100)
    }
  })

  it('lets a drop outside the ledge span fall straight through', () => {
    const ledges: Ledge[] = [{ x0: 0, x1: 100, y: 50 }]
    const world = worldOf([{ kind: 'falling', x: 150, y: 49, vy: 300, driftVx: 0, r: 2 }])
    const result = stepRainWorld(world, ledges, VIEWPORT, makeRainRng(1))
    expect(result.drops[0]?.kind).toBe('falling')
  })
})

describe('h1 glyph terrain', () => {
  it('a drop over a NO_SURFACE column falls straight through — between the letters', () => {
    // Column 5, under the drop's x, has no ink; its neighbours do.
    const topInk = [50, 50, 50, 50, 50, RAIN_NO_SURFACE, 50, 50, 50, 50]
    const terrain: GlyphTerrain = { left: 0, topInk }
    const world = worldOf([{ kind: 'falling', x: 5, y: 49, vy: 300, driftVx: 0, r: 2 }])
    const result = stepRainWorld(world, [], VIEWPORT, makeRainRng(8), terrain)
    expect(result.drops).toHaveLength(1)
    expect(result.drops[0]?.kind).toBe('falling')
  })

  it('a drop crossing an ink column is consumed and deposits into the headline water', () => {
    const topInk = [50, 50, 50, 50, 50]
    const terrain: GlyphTerrain = { left: 0, topInk }
    const world = worldOf([{ kind: 'falling', x: 2, y: 49, vy: 300, driftVx: 0, r: 3 }])
    const result = stepRainWorld(world, [], VIEWPORT, makeRainRng(9), terrain)
    // The drop lands in the water, not as a sitting bead on a box ledge.
    expect(result.drops).toHaveLength(0)
    expect(result.h1Water).not.toBeNull()
    const depth = result.h1Water?.depth ?? []
    expect(depth.some((d) => d > 0)).toBe(true)
  })

  it('coalesces an open column\'s runoff instead of spawning a falling drop on every crossing', () => {
    // Column 0 sits at the terrain's own edge (always spill-eligible).
    // Trickling a little more than a film's worth into it every step, the
    // way steady rain does, must not turn into a new falling drop every
    // step — only once the accumulated runoff reaches a real drop's volume.
    const topInk = [50, 50, 50]
    const terrain: GlyphTerrain = { left: 0, topInk }
    const rng = makeRainRng(11)
    const TRICKLE_PX = 0.3
    let world: RainWorld = {
      drops: [],
      spawnDue: NO_SPAWN,
      h1Water: { terrain, depth: [0, 0, 0] },
      h1SpillAccum: null,
    }

    const trickleThenStep = () => {
      const water = world.h1Water
      if (!water) throw new Error('expected h1Water')
      const depth = water.depth.slice()
      depth[0] += TRICKLE_PX
      world = stepRainWorld({ ...world, h1Water: { terrain, depth } }, [], VIEWPORT, rng, terrain)
    }

    for (let i = 0; i < 5; i++) trickleThenStep()
    // Five steps of a trickle well under the coalescing threshold have not
    // produced a drop yet — the runoff is still held, not already spawned.
    expect(world.drops).toHaveLength(0)
    expect(world.h1SpillAccum?.[0]).toBeGreaterThan(0)
    expect(world.h1SpillAccum?.[0]).toBeLessThan(RAIN_SPILL_COALESCE_VOLUME_PX)

    for (let i = 0; i < 60; i++) trickleThenStep()
    // Sixty more steps of the same trickle do eventually cross the
    // threshold — but as a handful of real drops, not sixty tiny ones.
    expect(world.drops.length).toBeGreaterThan(0)
    expect(world.drops.length).toBeLessThan(10)
    // 'splash' is also acceptable — a spilled drop that later reached the
    // floor is still evidence of a coalesced spill, not a stray spawn.
    for (const drop of world.drops) expect(['falling', 'splash']).toContain(drop.kind)
  })
})

describe('merging', () => {
  it('combines two close beads by volume, radius = cbrt(r1³+r2³)', () => {
    const ledges: Ledge[] = [{ x0: 0, x1: 200, y: 50 }]
    const world = worldOf([
      { kind: 'sitting', ledge: 0, x: 50, y: 50, r: 3, wobble: 0, rolling: false, rollDir: 1, rollSpeed: 0 },
      { kind: 'sitting', ledge: 0, x: 52, y: 50, r: 3, wobble: 0, rolling: false, rollDir: 1, rollSpeed: 0 },
    ])
    const result = stepRainWorld(world, ledges, VIEWPORT, makeRainRng(2))
    expect(result.drops).toHaveLength(1)
    const bead = result.drops[0]
    expect(bead?.kind).toBe('sitting')
    if (bead?.kind === 'sitting') {
      expect(bead.r).toBeCloseTo(Math.cbrt(27 + 27), 5)
      expect(bead.x).toBeCloseTo(51, 5)
    }
  })

  it('never lets a merge exceed the radius cap', () => {
    const ledges: Ledge[] = [{ x0: 0, x1: 200, y: 50 }]
    const world = worldOf([
      // cbrt(8^3 + 8^3) ~= 10.08, past the 9px cap, so the clamp must bind.
      { kind: 'sitting', ledge: 0, x: 50, y: 50, r: 8, wobble: 0, rolling: false, rollDir: 1, rollSpeed: 0 },
      { kind: 'sitting', ledge: 0, x: 53, y: 50, r: 8, wobble: 0, rolling: false, rollDir: 1, rollSpeed: 0 },
    ])
    const result = stepRainWorld(world, ledges, VIEWPORT, makeRainRng(3))
    expect(result.drops).toHaveLength(1)
    const bead = result.drops[0]
    if (bead?.kind === 'sitting') expect(bead.r).toBe(RAIN_MERGE_RADIUS_CAP)
  })
})

describe('rolling off the end', () => {
  it('a bead pushed past its ledge becomes a falling drop, carrying roll speed', () => {
    const ledges: Ledge[] = [{ x0: 0, x1: 20, y: 50 }]
    const world = worldOf([
      { kind: 'sitting', ledge: 0, x: 21, y: 50, r: 2, wobble: 0, rolling: false, rollDir: 1, rollSpeed: 0 },
    ])
    const result = stepRainWorld(world, ledges, VIEWPORT, makeRainRng(4))
    expect(result.drops).toHaveLength(1)
    const drop = result.drops[0]
    expect(drop?.kind).toBe('falling')
    if (drop?.kind === 'falling') {
      expect(drop.y).toBe(50)
      expect(drop.vy).toBe(RAIN_ROLL_OFF_VY)
      const expectedRollSpeed = RAIN_ROLL_BASE_SPEED + RAIN_ROLL_ACCEL * RAIN_FIXED_DT
      expect(drop.driftVx).toBeCloseTo(expectedRollSpeed * RAIN_ROLL_CARRY, 5)
    }
  })
})

describe('splashing', () => {
  it('a drop reaching the floor dies and spawns 2–3 short-lived splashes', () => {
    const world = worldOf([{ kind: 'falling', x: 10, y: 299, vy: 400, driftVx: 0, r: 2 }])
    const result = stepRainWorld(world, [], VIEWPORT, makeRainRng(5))
    expect(result.drops.length).toBeGreaterThanOrEqual(RAIN_SPLASH_COUNT_MIN)
    expect(result.drops.length).toBeLessThanOrEqual(RAIN_SPLASH_COUNT_MAX)
    for (const drop of result.drops) expect(drop.kind).toBe('splash')
  })

  it('a splash dies once its age reaches its life span', () => {
    const world = worldOf([{ kind: 'splash', x: 10, y: 290, vx: 0, vy: -10, age: 0, r: 1 }])
    let current = world
    const rng = makeRainRng(6)
    const steps = Math.ceil(RAIN_SPLASH_LIFE_S / (1 / 60)) + 2
    for (let i = 0; i < steps; i++) current = stepRainWorld(current, [], VIEWPORT, rng)
    expect(current.drops).toHaveLength(0)
  })
})

describe('the live-drop cap', () => {
  it('stops spawning once RAIN_MAX_DROPS is already live', () => {
    const drops: RainDrop[] = []
    for (let i = 0; i < RAIN_MAX_DROPS; i++) {
      drops.push({ kind: 'sitting', ledge: 0, x: i * 100, y: 50, r: 1, wobble: 0, rolling: false, rollDir: 1, rollSpeed: 0 })
    }
    const world = worldOf(drops, -1)
    const result = stepRainWorld(world, [], VIEWPORT, makeRainRng(7))
    expect(result.drops.length).toBe(RAIN_MAX_DROPS)
  })
})

describe('determinism', () => {
  it('the same seed replays the same sequence', () => {
    const a = makeRainRng(99)
    const b = makeRainRng(99)
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).toEqual(seqB)
  })
})
