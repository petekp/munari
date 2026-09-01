// Rain law — drops as a discrete world stepped at a fixed rate.
//
// The law: rain does not know what the page looks like. It knows where the
// page IS — a flat list of ledge segments, {x0, x1, y}, measured live from
// real elements, plus (for the headline only) a per-column ink terrain from
// rainWater.ts. A falling drop that crosses a ledge segment, or an ink
// column's surface, this step lands there; nothing here reads a class
// name, a tag, or a pixel of ink itself — rainGlyphMask.ts already reduced
// the headline to plain numbers before this file ever sees them.
//
// Ownership: this module owns drop state and its evolution — spawning,
// falling, landing, merging, rolling, splashing, and (via rainWater.ts)
// depositing into and re-spawning out of the headline's standing water. A
// column's runoff (rainWater.ts's per-step spill) accumulates here across
// steps and only leaves as a falling drop once it reaches a real drop's
// volume, so an open rim reads as occasional rain, not a solid stream.
// The scene turns real elements into ledges and terrain and turns this
// module's drops into pixels; neither concern belongs here, so this file
// imports nothing from `three` or `dom`.

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

export type { GlyphTerrain } from './rainWater'

/** One collision segment: a real element's top edge, inset 2px on each end. */
export interface Ledge {
  readonly x0: number
  readonly x1: number
  readonly y: number
}

export interface RainViewport {
  readonly width: number
  readonly height: number
}

interface FallingDrop {
  readonly kind: 'falling'
  x: number
  y: number
  vy: number
  driftVx: number
  r: number
}

interface SittingBead {
  readonly kind: 'sitting'
  ledge: number
  x: number
  y: number
  r: number
  wobble: number
  rolling: boolean
  rollDir: -1 | 1
  rollSpeed: number
}

interface Splash {
  readonly kind: 'splash'
  x: number
  y: number
  vx: number
  vy: number
  age: number
  r: number
}

export type RainDrop = FallingDrop | SittingBead | Splash

export interface RainWorld {
  readonly drops: readonly RainDrop[]
  readonly spawnDue: number
  // Optional so a world literal built without a headline in play (every
  // existing test, and any scene with no h1) still satisfies this type.
  readonly h1Water?: WaterField | null
  // Runoff volume waiting to become a falling drop, per h1 terrain column.
  // Optional for the same reason as h1Water.
  readonly h1SpillAccum?: readonly number[] | null
}

export type RainRng = () => number

/** A small deterministic PRNG (mulberry32) — same seed, same rain, every run. */
export function makeRainRng(seed: number): RainRng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Physics steps at a fixed rate regardless of display refresh, so the same
// ledge layout and RNG sequence always replay the same rain.
export const RAIN_FIXED_DT = 1 / 60

// Fall: gentle release, quick accel to a calm terminal speed. At these
// numbers a drop crosses an 800px viewport in a little over a second —
// fast enough to read as weather, slow enough to watch a bead form.
export const RAIN_GRAVITY = 2200
export const RAIN_INITIAL_VY = 60
export const RAIN_TERMINAL_VY = 900

// Wind sway: a bounded random walk on horizontal drift, not a fixed drift.
// A constant drift reads as diagonal rain; this reads as air moving.
export const RAIN_SWAY_MAX = 26
export const RAIN_SWAY_JITTER = 110

// Spawns arrive on a jittered interval so the field never pulses in lockstep.
export const RAIN_SPAWN_INTERVAL_MIN = 0.018
export const RAIN_SPAWN_INTERVAL_MAX = 0.05
export const RAIN_SPAWN_ABOVE_PX = 24
export const RAIN_DROP_RADIUS_MIN = 2.2
export const RAIN_DROP_RADIUS_MAX = 4.8

// Merge: two beads within (r1+r2+gap)px combine by volume, capped so a
// ledge cannot grow one infinite bead.
export const RAIN_MERGE_GAP_PX = 2
export const RAIN_MERGE_RADIUS_CAP = 9
export const RAIN_SETTLE_WOBBLE_KICK = 1
export const RAIN_WOBBLE_DECAY = 0.9

// Roll: a bead too big, or pushed past its ledge's end, slides toward the
// nearer end and picks up speed until it falls off.
export const RAIN_ROLL_RADIUS_THRESHOLD = 7
export const RAIN_ROLL_BASE_SPEED = 24
export const RAIN_ROLL_ACCEL = 90
export const RAIN_ROLL_OFF_VY = 20
export const RAIN_ROLL_CARRY = 0.5

// Splash: a light, short pop rather than full gravity — these are gone
// before full-speed fall would matter.
export const RAIN_SPLASH_COUNT_MIN = 2
export const RAIN_SPLASH_COUNT_MAX = 3
export const RAIN_SPLASH_SPEED = 50
export const RAIN_SPLASH_LIFT_MIN = 30
export const RAIN_SPLASH_LIFT_MAX = 70
export const RAIN_SPLASH_LIFE_S = 0.22
export const RAIN_SPLASH_GRAVITY_SCALE = 0.3
export const RAIN_SPLASH_RADIUS_MIN = 0.5
export const RAIN_SPLASH_RADIUS_MAX = 1.2

// A live-drop cap protects the frame budget; spawns stop, everything
// already falling or sitting keeps going.
export const RAIN_MAX_DROPS = 400

// A dew bead's radius is kept under the roll threshold — reduced motion
// shows rest, not a scene one tick from rolling.
export const RAIN_DEW_SPACING_PX = 34
export const RAIN_DEW_RADIUS_MAX = 4.5

// Deposited volume is px·columns: a bowl ~60 columns wide and 30px deep
// holds ~1800, and basin leveling spreads every deposit across the whole
// bowl. Scaling by r² keeps big drops mattering more, and 18 makes an
// average landing (r≈3) worth ~160 px·columns — a bowl visibly rises
// with each drop and fills in ten-odd landings instead of hundreds.
export const RAIN_WATER_VOLUME_SCALE = 18
// A spilled puddle re-enters the ordinary fall physics at the same gentle
// release speed as a freshly spawned drop, not the terminal speed it would
// have had if it had fallen the whole page.
export const RAIN_SPILL_VY = RAIN_INITIAL_VY
// An open boundary column (the rim of a bowl, or a letter's outer edge next
// to a kerning gap) can cross RAIN_WATER_FILM_PX on nearly every fixed
// step once its basin is feeding it — spilling each of those crossings as
// its own drop reads as a solid vertical chain, not individual rain.
// Runoff accumulates per column instead, and only leaves as a falling drop
// once it adds up to a real drop's worth of volume.
export const RAIN_SPILL_COALESCE_VOLUME_PX = 6

// Reduced motion's h1 pre-fill: a few seed deposits, each this many px of
// depth, then settled a few steps so real bowls (not just the seeded
// column) end up holding the water — the rest frame uses the same physics
// as the live scene, not a hand-picked static image.
export const RAIN_DEW_H1_SEED_VOLUME_PX = 5
export const RAIN_DEW_H1_SETTLE_STEPS = 40

export function createRainWorld(): RainWorld {
  return { drops: [], spawnDue: 0, h1Water: null, h1SpillAccum: null }
}

function spawnFallingDrop(rng: RainRng, viewport: RainViewport): FallingDrop {
  return {
    kind: 'falling',
    x: rng() * viewport.width,
    y: -RAIN_SPAWN_ABOVE_PX,
    vy: RAIN_INITIAL_VY,
    driftVx: (rng() - 0.5) * RAIN_SWAY_MAX,
    r: RAIN_DROP_RADIUS_MIN + rng() * (RAIN_DROP_RADIUS_MAX - RAIN_DROP_RADIUS_MIN),
  }
}

function spawnSplash(x: number, y: number, rng: RainRng): Splash[] {
  const count = RAIN_SPLASH_COUNT_MIN + Math.floor(rng() * (RAIN_SPLASH_COUNT_MAX - RAIN_SPLASH_COUNT_MIN + 1))
  const drops: Splash[] = []
  for (let i = 0; i < count; i++) {
    drops.push({
      kind: 'splash',
      x,
      y,
      vx: (rng() - 0.5) * 2 * RAIN_SPLASH_SPEED,
      vy: -(RAIN_SPLASH_LIFT_MIN + rng() * (RAIN_SPLASH_LIFT_MAX - RAIN_SPLASH_LIFT_MIN)),
      age: 0,
      r: RAIN_SPLASH_RADIUS_MIN + rng() * (RAIN_SPLASH_RADIUS_MAX - RAIN_SPLASH_RADIUS_MIN),
    })
  }
  return drops
}

/** A landed drop's diameter becomes water depth, spread by rainWater.ts. */
function dropDepositVolume(radius: number): number {
  return radius * radius * RAIN_WATER_VOLUME_SCALE
}

interface FallResult {
  readonly drops: readonly RainDrop[]
  // Present only when this drop actually deposited into the headline's
  // water this step — absent, not null, so a caller threading water state
  // through a whole tick's worth of drops can tell "unchanged" from "there
  // is no headline" without a second flag.
  readonly water?: WaterField
}

function stepFalling(
  drop: FallingDrop,
  dt: number,
  ledges: readonly Ledge[],
  h1Terrain: GlyphTerrain | null,
  h1Water: WaterField | null,
  viewport: RainViewport,
  rng: RainRng,
): FallResult {
  const vy = Math.min(drop.vy + RAIN_GRAVITY * dt, RAIN_TERMINAL_VY)
  const driftVx = Math.max(-RAIN_SWAY_MAX, Math.min(RAIN_SWAY_MAX, drop.driftVx + (rng() - 0.5) * RAIN_SWAY_JITTER * dt))
  const x = drop.x + driftVx * dt
  const yPrev = drop.y
  const y = yPrev + vy * dt

  // The headline's ink terrain, checked before the box ledges: a column
  // with no ink (RAIN_NO_SURFACE, between two letters) never matches, so
  // the drop falls straight through to whatever is beneath the headline.
  if (h1Terrain && h1Water) {
    const column = terrainColumn(h1Terrain, x)
    if (column >= 0) {
      const top = h1Terrain.topInk[column]
      if (top !== RAIN_NO_SURFACE) {
        const surface = top - h1Water.depth[column]
        if (surface > yPrev && surface <= y) {
          return { drops: [], water: depositWater(h1Water, column, dropDepositVolume(drop.r)) }
        }
      }
    }
  }

  // The first ledge the drop's path crosses this step, not the nearest —
  // a fast drop skipping two stacked ledges must stop at the top one.
  let landed: Ledge | null = null
  let landedIndex = -1
  for (let i = 0; i < ledges.length; i++) {
    const ledge = ledges[i]
    if (x < ledge.x0 || x > ledge.x1) continue
    if (ledge.y <= yPrev || ledge.y > y) continue
    if (!landed || ledge.y < landed.y) {
      landed = ledge
      landedIndex = i
    }
  }
  if (landed) {
    return {
      drops: [{
        kind: 'sitting',
        ledge: landedIndex,
        x: Math.min(landed.x1, Math.max(landed.x0, x)),
        y: landed.y,
        r: drop.r,
        wobble: RAIN_SETTLE_WOBBLE_KICK,
        rolling: false,
        rollDir: 1,
        rollSpeed: 0,
      }],
    }
  }
  if (y >= viewport.height) return { drops: spawnSplash(x, viewport.height, rng) }
  return { drops: [{ kind: 'falling', x, y, vy, driftVx, r: drop.r }] }
}

function stepSitting(bead: SittingBead, ledges: readonly Ledge[], dt: number): RainDrop[] {
  const wobble = bead.wobble * RAIN_WOBBLE_DECAY
  const ledge = ledges[bead.ledge]
  // The element this bead sat on left the layout (a resize dropped a
  // ledge). Keep it resting at its last known place rather than teleport
  // or vanish — the next resize that restores the ledge picks it back up.
  if (!ledge) return [{ ...bead, wobble }]

  let rolling = bead.rolling
  let rollDir = bead.rollDir
  let rollSpeed = bead.rollSpeed
  if (!rolling && (bead.r > RAIN_ROLL_RADIUS_THRESHOLD || bead.x < ledge.x0 || bead.x > ledge.x1)) {
    rolling = true
    rollDir = bead.x - ledge.x0 < ledge.x1 - bead.x ? -1 : 1
    rollSpeed = RAIN_ROLL_BASE_SPEED
  }
  if (!rolling) return [{ ...bead, y: ledge.y, wobble }]

  rollSpeed += RAIN_ROLL_ACCEL * dt
  const x = bead.x + rollDir * rollSpeed * dt
  if (x < ledge.x0 || x > ledge.x1) {
    return [{
      kind: 'falling',
      x,
      y: ledge.y,
      vy: RAIN_ROLL_OFF_VY,
      driftVx: rollDir * rollSpeed * RAIN_ROLL_CARRY,
      r: bead.r,
    }]
  }
  return [{ ...bead, x, y: ledge.y, wobble, rolling, rollDir, rollSpeed }]
}

function stepSplash(splash: Splash, dt: number): RainDrop[] {
  const age = splash.age + dt
  if (age >= RAIN_SPLASH_LIFE_S) return []
  const vy = splash.vy + RAIN_GRAVITY * RAIN_SPLASH_GRAVITY_SCALE * dt
  return [{
    kind: 'splash',
    x: splash.x + splash.vx * dt,
    y: splash.y + vy * dt,
    vx: splash.vx,
    vy,
    age,
    r: splash.r,
  }]
}

/** Bigger absorbs smaller: volume-weighted position, cube-root-summed radius. */
function mergeLedgeBeads(beads: readonly SittingBead[]): SittingBead[] {
  const merged = [...beads].sort((a, b) => a.x - b.x)
  let i = 0
  while (i < merged.length - 1) {
    const a = merged[i]
    const b = merged[i + 1]
    if (!a || !b) break
    if (Math.abs(b.x - a.x) >= a.r + b.r + RAIN_MERGE_GAP_PX) {
      i++
      continue
    }
    const volumeA = a.r ** 3
    const volumeB = b.r ** 3
    const r = Math.min(Math.cbrt(volumeA + volumeB), RAIN_MERGE_RADIUS_CAP)
    const x = (a.x * volumeA + b.x * volumeB) / (volumeA + volumeB)
    merged.splice(i, 2, {
      kind: 'sitting',
      ledge: a.ledge,
      x,
      y: a.y,
      r,
      wobble: Math.max(a.wobble, b.wobble) + RAIN_SETTLE_WOBBLE_KICK,
      rolling: false,
      rollDir: 1,
      rollSpeed: 0,
    })
    // Re-check the merged bead against its new neighbour instead of
    // advancing — a third bead can now be within range of the combined one.
  }
  return merged
}

function mergeAllLedges(drops: readonly RainDrop[]): RainDrop[] {
  const byLedge = new Map<number, SittingBead[]>()
  const rest: RainDrop[] = []
  for (const drop of drops) {
    if (drop.kind !== 'sitting') {
      rest.push(drop)
      continue
    }
    const list = byLedge.get(drop.ledge)
    if (list) list.push(drop)
    else byLedge.set(drop.ledge, [drop])
  }
  const merged = rest
  for (const beads of byLedge.values()) merged.push(...mergeLedgeBeads(beads))
  return merged
}

/** A spilled puddle re-enters ordinary fall physics at a radius sized off its own volume. */
function spillToDrop(x: number, y: number, volume: number): FallingDrop {
  const r = Math.min(RAIN_DROP_RADIUS_MAX, Math.max(RAIN_DROP_RADIUS_MIN, volume / 2))
  return { kind: 'falling', x, y, vy: RAIN_SPILL_VY, driftVx: 0, r }
}

interface WaterAdvanceResult {
  readonly water: WaterField
  readonly spillAccum: number[]
  readonly drops: readonly FallingDrop[]
}

/**
 * Levels and spills the headline's water one step, then turns each column's
 * accumulated runoff into a falling drop once it reaches a real drop's
 * volume — see RAIN_SPILL_COALESCE_VOLUME_PX for why this doesn't spawn one
 * on every crossing.
 */
function advanceH1Water(terrain: GlyphTerrain, water: WaterField, spillAccum: readonly number[], dt: number): WaterAdvanceResult {
  const stepped = stepWaterField(water, dt)
  const accum = spillAccum.slice()
  for (const spill of stepped.spills) {
    const column = terrainColumn(terrain, spill.x)
    if (column >= 0) accum[column] += spill.volume
  }
  const drops: FallingDrop[] = []
  for (let column = 0; column < accum.length; column++) {
    const volume = accum[column]
    if (volume < RAIN_SPILL_COALESCE_VOLUME_PX) continue
    const top = terrain.topInk[column]
    if (top !== RAIN_NO_SURFACE) drops.push(spillToDrop(terrain.left + column, top - RAIN_WATER_FILM_PX, volume))
    accum[column] = 0
  }
  return { water: stepped.field, spillAccum: accum, drops }
}

/** Advance the world one fixed step. Ledges, terrain and viewport are read-only input. */
export function stepRainWorld(
  world: RainWorld,
  ledges: readonly Ledge[],
  viewport: RainViewport,
  rng: RainRng,
  h1Terrain: GlyphTerrain | null = null,
): RainWorld {
  const dt = RAIN_FIXED_DT
  let h1Water: WaterField | null = null
  let h1SpillAccum: number[] | null = null
  if (h1Terrain) {
    h1Water = world.h1Water && world.h1Water.terrain === h1Terrain ? world.h1Water : createWaterField(h1Terrain)
    h1SpillAccum =
      world.h1SpillAccum && world.h1SpillAccum.length === h1Terrain.topInk.length
        ? world.h1SpillAccum.slice()
        : h1Terrain.topInk.map(() => 0)
  }

  const next: RainDrop[] = []
  for (const drop of world.drops) {
    if (drop.kind === 'falling') {
      const result = stepFalling(drop, dt, ledges, h1Terrain, h1Water, viewport, rng)
      next.push(...result.drops)
      if (result.water) h1Water = result.water
    } else if (drop.kind === 'sitting') next.push(...stepSitting(drop, ledges, dt))
    else next.push(...stepSplash(drop, dt))
  }

  let spawnDue = world.spawnDue - dt
  while (spawnDue <= 0 && next.length < RAIN_MAX_DROPS) {
    next.push(spawnFallingDrop(rng, viewport))
    spawnDue += RAIN_SPAWN_INTERVAL_MIN + rng() * (RAIN_SPAWN_INTERVAL_MAX - RAIN_SPAWN_INTERVAL_MIN)
  }

  if (h1Terrain && h1Water && h1SpillAccum) {
    const advanced = advanceH1Water(h1Terrain, h1Water, h1SpillAccum, dt)
    h1Water = advanced.water
    h1SpillAccum = advanced.spillAccum
    next.push(...advanced.drops)
  }

  return { drops: mergeAllLedges(next), spawnDue, h1Water, h1SpillAccum }
}

/** Reduced motion's rest frame: beads already sitting, spaced along each ledge. */
export function staticDew(ledges: readonly Ledge[], rng: RainRng): readonly RainDrop[] {
  const drops: RainDrop[] = []
  for (let l = 0; l < ledges.length; l++) {
    const ledge = ledges[l]
    if (!ledge) continue
    const span = ledge.x1 - ledge.x0
    if (span <= 0) continue
    const count = Math.max(1, Math.round(span / RAIN_DEW_SPACING_PX))
    for (let i = 0; i < count; i++) {
      const jitter = (rng() - 0.5) * RAIN_DEW_SPACING_PX * 0.4
      const x = Math.min(ledge.x1, Math.max(ledge.x0, ledge.x0 + ((i + 0.5) / count) * span + jitter))
      drops.push({
        kind: 'sitting',
        ledge: l,
        x,
        y: ledge.y,
        r: RAIN_DROP_RADIUS_MIN + rng() * (RAIN_DEW_RADIUS_MAX - RAIN_DROP_RADIUS_MIN),
        wobble: 0,
        rolling: false,
        rollDir: 1,
        rollSpeed: 0,
      })
    }
  }
  return drops
}

/** Reduced motion's h1 rest frame: a modest, already-settled water level in its bowls. */
export function staticDewWater(terrain: GlyphTerrain | null, rng: RainRng): WaterField | null {
  if (!terrain) return null
  let water = createWaterField(terrain)
  // One seed deposit roughly every 60 columns, then real fixed steps to
  // let each bowl find its own level — the rest frame uses the same
  // physics as the live scene instead of a hand-placed puddle.
  const seeds = Math.max(1, Math.round(terrain.topInk.length / 60))
  for (let i = 0; i < seeds; i++) {
    const column = Math.floor(rng() * terrain.topInk.length)
    water = depositWater(water, column, RAIN_DEW_H1_SEED_VOLUME_PX)
  }
  for (let i = 0; i < RAIN_DEW_H1_SETTLE_STEPS; i++) water = stepWaterField(water, RAIN_FIXED_DT).field
  return water
}
