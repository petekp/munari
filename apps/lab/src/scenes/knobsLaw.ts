// The knobs-and-switches scene's parameter bag, and the pure law that turns
// it into a frame of generative artwork.
//
// Same doctrine as genieKnobs.ts: a live mutable bag a hand can drag, read
// every frame by whatever draws the picture — no push, no React state, so a
// knob turning sixty times a second never asks anything to re-render.
//
// generateArt is the other half: given the bag and a clock reading, it is a
// pure function all the way down — same (values, t) always draws the same
// frame, which is what makes it something a test can pin.

export interface KnobsValues {
  /** Base hue, degrees around the wheel. */
  hue: number
  /** Hue fan across the layers, degrees: 0 paints them all one color,
   *  360 spreads them around the full wheel. */
  palette: number
  /** Concentric layers drawn, clamped to [2, 8]. */
  layers: number
  /** Vertices per layer's polygon, clamped to [3, 12]. */
  complexity: number
  /** Rotation rate, turns/second at the outermost layer. */
  speed: number
  /** How far the layers reach toward the frame edge, 0.4–1. */
  spread: number
  /** Power on/off — off freezes the clock and lets the picture die
   *  dark (`artClock.lit` fades to 0, and the room's light with it). */
  power: boolean
  /** Star-facet wobble on each layer's silhouette, off draws plain polygons. */
  mirror: boolean
}

export const knobsValues: KnobsValues = {
  hue: 210,
  palette: 150,
  layers: 5,
  complexity: 6,
  speed: 0.6,
  spread: 0.85,
  power: true,
  mirror: true,
}

export interface KnobDef {
  key: 'hue' | 'palette' | 'layers' | 'complexity' | 'speed' | 'spread'
  label: string
  min: number
  max: number
  step: number
}

// Steps are also the detent pitch: every crossing is one audible click
// and one felt stop, so a coarser step is a chunkier, more deliberate
// dial. The two hue-fan dials sweep 0–360 in tens; the counts stay
// integer; speed and spread keep their fine pitch — their whole point
// is the last few hundredths.
export const KNOBS_ROTARY: KnobDef[] = [
  { key: 'hue', label: 'hue', min: 0, max: 360, step: 10 },
  { key: 'palette', label: 'palette', min: 0, max: 360, step: 10 },
  { key: 'layers', label: 'layers', min: 2, max: 8, step: 1 },
  { key: 'complexity', label: 'facets', min: 3, max: 12, step: 1 },
  { key: 'speed', label: 'speed', min: 0, max: 2, step: 0.05 },
  { key: 'spread', label: 'spread', min: 0.4, max: 1, step: 0.02 },
]

/** The dial sweep both renderers agree on: the DOM's ticks and the
 *  hardware's spring target come from the same two numbers. Degrees,
 *  clockwise, 0 = straight up. */
export const KNOB_ANGLE_MIN = -135
export const KNOB_ANGLE_SWEEP = 270

/** Where a knob points for a value — the one mapping from the bag to a
 *  dial angle, shared by the captured ticks and the 3D grip. */
export function knobAngle(def: KnobDef, value: number): number {
  const clamped = Math.min(def.max, Math.max(def.min, value))
  const frac = (clamped - def.min) / (def.max - def.min)
  return KNOB_ANGLE_MIN + frac * KNOB_ANGLE_SWEEP
}

/** The art's clock and its life, a live bag like `knobsValues`: KnobsArt
 *  advances `t` each rAF (and freezes it with the power switch), and
 *  fades `lit` between 1 (the picture glows) and 0 (power is off and the
 *  picture has died dark). The WebGL side reads both — the glints orbit
 *  in the art's exact phase, and every light the picture casts scales by
 *  `lit`, so killing the artwork kills the room. */
export const artClock = { t: 0, lit: 1 }

/** How fast the picture dies and relights: seconds to close 63% of the
 *  gap. Slow enough to read as phosphor dying, fast enough to feel
 *  wired to the switch. */
export const POWER_FADE_TAU = 0.35

/** One frame of the power fade: pure — same (lit, target, dt) always
 *  lands the same place, and any frame rate walks the same curve. */
export function stepFade(lit: number, target: number, dt: number): number {
  return target + (lit - target) * Math.exp(-Math.max(dt, 0) / POWER_FADE_TAU)
}

/** Live bag for the carry gesture. The DOM handle owns the DECISION (its
 *  forwarded pointerdown arms this); the scene owns the GEOMETRY (the
 *  real screen pointer moves the slab, and the real document pointerup
 *  disarms it). Split that way because the forwarded stream's
 *  coordinates live on the panel — the very thing the gesture moves. */
export const panelDrag = { active: false, pointerId: null as number | null }

/** Live bag for the resize gesture, split the same way and for the same
 *  reason: the corner grip is captured DOM, and its coordinates live on
 *  the panel whose width the gesture is changing. The grip arms this and
 *  records the width it started from; `startX` is left NaN, and the
 *  scene seeds it from the first REAL screen move before applying
 *  `resizeWidth`. */
export const panelResize = {
  active: false,
  pointerId: null as number | null,
  startX: Number.NaN,
  startW: 0,
}

export interface ToggleDef {
  key: 'power' | 'mirror'
  label: string
}

export const KNOBS_TOGGLES: ToggleDef[] = [
  { key: 'power', label: 'power' },
  { key: 'mirror', label: 'mirror' },
]

/**
 * An annunciator. One per switch, and only per switch — a lamp stands
 * beside the toggle it reports on, so `key` indexes BOTH lists and the
 * two stay in step by construction.
 *
 * There is no label here on purpose. The lamp used to carry its own,
 * which read the same word as the switch two rows away; now that they
 * share a cell the switch's label serves both, and the lamp is
 * `aria-hidden` because `aria-pressed` on the switch already says what
 * it says.
 */
export interface LampDef {
  key: ToggleDef['key']
  tone: 'ok' | 'signal'
  /** The lit lens color — one value shared by the captured bulb's CSS
   *  and the emissive core + point light standing over it in WebGL. */
  color: string
}

export const KNOBS_LAMPS: LampDef[] = [
  { key: 'power', tone: 'ok', color: '#2ee065' },
  { key: 'mirror', tone: 'signal', color: '#ff5c3f' },
]

/** Whether a lamp is lit — the one mapping from the bag to an
 *  annunciator state, shared by the captured bulb and the glowing core
 *  the hardware stands over it. */
export function lampLit(def: LampDef, values: KnobsValues): boolean {
  switch (def.key) {
    case 'power':
      return values.power
    case 'mirror':
      return values.mirror
  }
}

export interface ArtLayer {
  /** SVG `points` attribute value for a `<polygon>`. */
  points: string
  fill: string
  stroke: string
  opacity: number
}

export interface ArtScene {
  layers: ArtLayer[]
  backdropFrom: string
  backdropTo: string
}

/** Upper bound on layers a knob turn can ever request — the fixed count of
 *  `<polygon>` elements a consumer needs to pre-mount. */
export const ART_MAX_LAYERS = 8
const MAX_LAYERS = ART_MAX_LAYERS
const MIN_LAYERS = 2
const MIN_FACETS = 3
const MAX_FACETS = 12
const OUTER_R = 92
const INNER_R = 14
/** Wobble amplitude cap (see the `mirror` term below) — bounds a layer's
 *  drawn radius so a test can pin a single number for every knob range. */
const WOBBLE = 0.3

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** The farthest a drawn point can land from the origin, any knob setting. */
export const ART_MAX_RADIUS = OUTER_R * (1 + WOBBLE)

/** One layer's shared parameters — the single source both `generateArt`
 *  (which draws the layer) and `artGlow` (which lights the scene with
 *  it) read, so the reflection in the metal can never drift out of
 *  phase with the picture on the page. */
function layerSpec(values: KnobsValues, i: number, layerCount: number) {
  const spread = clamp(values.spread, 0.4, 1)
  const baseHue = ((values.hue % 360) + 360) % 360
  const t01 = layerCount === 1 ? 0 : i / (layerCount - 1)
  const radius = (INNER_R + t01 * (OUTER_R - INNER_R)) * spread
  const dir = i % 2 === 0 ? 1 : -1
  /** × speed × tSeconds gives the layer's current rotation. */
  const rotRate = dir * (0.15 + t01 * 0.35)
  const fan = clamp(values.palette, 0, 360)
  const hue = (baseHue + t01 * fan) % 360
  return { t01, radius, rotRate, hue }
}

/** Pure and deterministic: the same `(values, t)` always draws the same frame. */
export function generateArt(values: KnobsValues, tSeconds: number): ArtScene {
  const layerCount = clampInt(values.layers, MIN_LAYERS, MAX_LAYERS)
  const facets = clampInt(values.complexity, MIN_FACETS, MAX_FACETS)
  const speed = clamp(values.speed, 0, 2)
  const baseHue = ((values.hue % 360) + 360) % 360

  const layers: ArtLayer[] = []
  for (let i = 0; i < layerCount; i++) {
    const { t01: t, radius, rotRate, hue } = layerSpec(values, i, layerCount)
    const rot = tSeconds * speed * rotRate
    const pts: string[] = []
    for (let p = 0; p < facets; p++) {
      const a = rot + (p / facets) * Math.PI * 2
      const wobble = values.mirror ? 1 + WOBBLE * Math.cos(a * 3) : 1
      const r = radius * wobble
      pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`)
    }
    layers.push({
      points: pts.join(' '),
      fill: `hsla(${hue.toFixed(1)}, 82%, 58%, 0.85)`,
      stroke: `hsla(${((hue + 40) % 360).toFixed(1)}, 90%, 72%, 0.9)`,
      opacity: 0.55 + 0.45 * (1 - t),
    })
  }

  return {
    layers,
    backdropFrom: `hsl(${((baseHue + 260) % 360).toFixed(1)}, 55%, 10%)`,
    backdropTo: `hsl(${((baseHue + 200) % 360).toFixed(1)}, 60%, 4%)`,
  }
}

/** What the artwork casts: one emitter per big outer layer. The scene
 *  turns these into actual colored lights, so the metal is lit by the
 *  same picture the page shows. */
export interface GlowSource {
  /** The layer's hue, degrees. */
  hue: number
  /** The layer's current rotation, radians — the glint orbits with it. */
  angle: number
  /** The layer's radius relative to the full frame, 0..1. */
  reach: number
  /** Relative luminous weight, 0..1 — opacity × coverage. */
  weight: number
}

/** The slab's footprint on the art plane (CSS px, viewport-center
 *  origin — the scene's world units): center and full extent. */
export interface PanelFootprint {
  x: number
  y: number
  w: number
  h: number
}

/** The artwork's anchor, as a fraction of the viewport width left of
 *  center — where the luminous disc actually hangs on the page. */
export const ART_ANCHOR_FRACTION = -0.1

/**
 * Where a glow source's emitter stands in world space. ONE orbit
 * mapping, shared by the light rig (which puts a real light there),
 * the halo (which re-emits the light the slab hides), and
 * `backlightAmount` — so the glint that dies behind the slab and the
 * bloom that replaces it are always the same light.
 */
export function glowPoint(src: GlowSource, viewportW: number): { x: number; y: number } {
  const orbit = 90 + 260 * src.reach
  return {
    x: viewportW * ART_ANCHOR_FRACTION + Math.cos(src.angle) * orbit,
    y: Math.sin(src.angle) * orbit * 0.7,
  }
}

/**
 * How much the slab hides a point on the art plane: 0 clear of the
 * slab, 1 fully behind it. Signed distance to the slab's edge, ramped
 * linearly across a `soft` px band — a glowing layer is an area, not a
 * point, so it dims as it slides behind the slab instead of snapping.
 */
export function slabOcclusion(px: number, py: number, panel: PanelFootprint, soft = 80): number {
  const dx = Math.abs(px - panel.x) - panel.w / 2
  const dy = Math.abs(py - panel.y) - panel.h / 2
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const inside = Math.min(Math.max(dx, dy), 0)
  return clamp(0.5 - (outside + inside) / soft, 0, 1)
}

/** Ceiling of `artGlow`'s summed weights (layers 8, spread 1) — the
 *  normalizer that makes `backlightAmount` read as a 0..1 level. */
const GLOW_WEIGHT_MAX = 1.6

/**
 * The luminous energy the slab is actually standing in front of: each
 * glow source's weight, scaled by how hidden its emitter is right now.
 * 0 with every glint clear of the slab; toward 1 when a bright
 * picture's emitters are all behind it. This is physical occlusion,
 * not proximity — a glint that swings out past the slab's edge is
 * visible again, and its light comes back.
 */
export function backlightAmount(
  panel: PanelFootprint,
  values: KnobsValues,
  tSeconds: number,
  viewportW: number,
): number {
  let blocked = 0
  for (const src of artGlow(values, tSeconds)) {
    const p = glowPoint(src, viewportW)
    blocked += src.weight * slabOcclusion(p.x, p.y, panel)
  }
  return clamp(blocked / GLOW_WEIGHT_MAX, 0, 1)
}

/**
 * The corona's falloff profile — the shape the backlight shader uses
 * for every support it must END: (1-t)^2 over t in 0..1 of the reach.
 * Pinned here because GLSL cannot carry a test, and this session paid
 * three times for falloffs that could not reach zero: an exponential's
 * leftover at the quad edge crops into a hard rectangle, and a window
 * that only reaches zero in VALUE still kinks in slope (a Mach band).
 * This profile dies at t=1 with zero value AND zero slope.
 */
export function veilProfile(t: number): number {
  const c = clamp(t, 0, 1)
  return (1 - c) * (1 - c)
}

/** Pure like `generateArt`, and phase-locked to it: same `(values, t)`,
 *  same picture, same light. Up to three sources, outermost layer first
 *  (the big emitters). */
export function artGlow(values: KnobsValues, tSeconds: number): GlowSource[] {
  const layerCount = clampInt(values.layers, MIN_LAYERS, MAX_LAYERS)
  const speed = clamp(values.speed, 0, 2)
  const sources: GlowSource[] = []
  const count = Math.min(3, layerCount)
  for (let n = 0; n < count; n++) {
    const i = layerCount - 1 - n
    const spec = layerSpec(values, i, layerCount)
    sources.push({
      hue: spec.hue,
      angle: tSeconds * speed * spec.rotRate,
      reach: spec.radius / OUTER_R,
      weight: (0.55 + 0.45 * (1 - spec.t01)) * (spec.radius / OUTER_R),
    })
  }
  return sources
}
