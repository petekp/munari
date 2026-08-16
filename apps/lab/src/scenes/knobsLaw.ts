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
  /** Which harmony the layers are colored by — an index into
   *  `PALETTE_SCHEMES`, not an angle. */
  palette: number
  /** How far the palette opens, 0–1. At 0 every layer takes the base hue
   *  and the picture is a true monochromatic study; at 1 each layer sits
   *  on its scheme's own stop. */
  chroma: number
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
  palette: 4,
  chroma: 0.85,
  layers: 10,
  complexity: 20,
  speed: 1.5,
  spread: 0.85,
  power: true,
  mirror: true,
}

/**
 * One color harmony — the classical wheel relationships, as hue offsets
 * from whatever the `hue` dial is pointing at.
 *
 * A scheme with fewer stops than there are layers REPEATS its stops
 * rather than inventing hues between them: a triad has three colors at
 * fifteen layers exactly as it does at three. What it must not do is
 * alternate them ring by ring — see `schemeAt`. The one scheme that
 * ramps instead of stopping is `spectrum`, which has no stops to repeat;
 * it carries `fan` and spreads that many degrees across the layers.
 *
 * Offsets are written in wheel order, innermost stop first, because that
 * order IS the order the picture walks through them.
 */
export interface PaletteScheme {
  key: 'mono' | 'analogous' | 'complement' | 'split' | 'triad' | 'tetrad' | 'spectrum'
  /** The word the seven-segment window shows. Every glyph here has to be
   *  one DSEG7-Classic can actually draw — no k, m, v, w, x or z. */
  code: string
  /** Hue offsets from the base, degrees. Null means this scheme ramps. */
  offsets: number[] | null
  /** Degrees a ramping scheme covers across the layers. */
  fan?: number
}

/**
 * Ordered by how much of the wheel the scheme touches — 0°, 120°, 180°,
 * 210°, 240°, 270°, 360°. That ordering is what makes `palette` read as
 * a single knob from monochromatic to full color rather than as an
 * arbitrary list, and it holds at every chroma setting.
 */
export const PALETTE_SCHEMES: PaletteScheme[] = [
  { key: 'mono', code: 'one', offsets: [0] },
  // Centred on the dial's hue rather than starting from it: an analogous
  // scheme is a neighbourhood, and the base belongs in the middle of it.
  { key: 'analogous', code: 'AnA', offsets: [-60, -30, 0, 30, 60] },
  { key: 'complement', code: 'duo', offsets: [0, 180] },
  { key: 'split', code: 'SPL', offsets: [0, 150, 210] },
  { key: 'triad', code: 'tri', offsets: [0, 120, 240] },
  { key: 'tetrad', code: 'tEt', offsets: [0, 90, 180, 270] },
  { key: 'spectrum', code: 'FUL', offsets: null, fan: 360 },
]

/** The scheme a `palette` knob value selects, clamped to the table. */
export function paletteAt(value: number): PaletteScheme {
  return PALETTE_SCHEMES[clampInt(value, 0, PALETTE_SCHEMES.length - 1)]
}

export interface KnobDef {
  key: 'hue' | 'palette' | 'chroma' | 'layers' | 'complexity' | 'speed' | 'spread'
  label: string
  min: number
  max: number
  step: number
  /** What the seven-segment window shows for a value. Default is the
   *  number itself, at this dial's own precision. */
  format?: (value: number) => string
  /** The window's full segment grid — every character position at
   *  capacity, drawn behind the live text as the unenergized ghost.
   *  Default is the widest number this dial can reach. */
  capacity?: string
  /** Spoken value, for a dial whose number is really a name. */
  valueText?: (value: number) => string
}

// Steps are also the detent pitch: every crossing is one audible click
// and one felt stop, so a coarser step is a chunkier, more deliberate
// dial. Hue sweeps the wheel in tens; the counts stay integer; palette
// is a seven-position SELECTOR, so its step is one whole scheme and
// every detent lands on a named harmony; speed, spread and chroma keep
// their fine pitch — their whole point is the last few hundredths.
export const KNOBS_ROTARY: KnobDef[] = [
  { key: 'hue', label: 'hue', min: 0, max: 360, step: 10 },
  {
    key: 'palette',
    label: 'palette',
    min: 0,
    max: PALETTE_SCHEMES.length - 1,
    step: 1,
    format: (v) => paletteAt(v).code,
    capacity: '888',
    valueText: (v) => paletteAt(v).key,
  },
  { key: 'chroma', label: 'chroma', min: 0, max: 1, step: 0.05 },
  { key: 'layers', label: 'layers', min: 2, max: 16, step: 1 },
  { key: 'complexity', label: 'facets', min: 6, max: 24, step: 1 },
  { key: 'speed', label: 'speed', min: 0, max: 2, step: 0.05 },
]

/** Values the picture reads that no dial exposes. `spread` sets how far
 *  the layers reach toward the frame edge, and every setting of it was a
 *  worse picture than the committed one — so it keeps its default and
 *  gives its station on the panel to a dial worth turning. The field
 *  stays in the bag rather than being folded into a constant: it is
 *  still a real parameter of the law, and the conformance suite still
 *  sweeps it. */
export const KNOBS_FIXED: (keyof KnobsValues)[] = ['spread']

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

/**
 * The most graduations a 66 px dial can wear and still be read as marks.
 *
 * The notches sit on a 29 px radius across the 270° sweep, so they are
 * strung along 2π·29·(270/360) ≈ 137 px of arc, and each one is 2 px
 * wide (knobs.css). 23 marks put 6.2 px between neighbours — a 2 px cut
 * with a 4 px land, which reads as engraving. `speed` has 41 detents; at
 * one notch each they would sit 3.3 px apart, 2 px of cut against 1.3 px
 * of land, and the ring turns into a moiré nobody can count.
 */
export const DIAL_TICK_MAX = 23

/**
 * The angles a dial's graduations are cut at.
 *
 * A graduation means a stop. The rule is one notch per detent, and when
 * a dial has more detents than the face can hold, every k-th detent —
 * with k an exact divisor of the interval count, so a notch never lands
 * between two stops. A hand counting notches is therefore always
 * counting real positions, on every dial, at every setting.
 *
 * The degenerate case is a dial whose interval count is a large prime:
 * nothing divides it but itself, and the face falls back to the two end
 * stops. That is honest — better two marks that mean something than
 * twenty that do not — and no dial in KNOBS_ROTARY reaches it.
 */
export function dialTicks(def: KnobDef): number[] {
  const intervals = Math.max(1, Math.round((def.max - def.min) / def.step))
  let k = 0
  for (let d = 1; d <= intervals; d++) {
    if (intervals % d === 0 && intervals / d + 1 <= DIAL_TICK_MAX) {
      k = d
      break
    }
  }
  const marks = k === 0 ? 1 : intervals / k
  return Array.from({ length: marks + 1 }, (_, i) => KNOB_ANGLE_MIN + (i * KNOB_ANGLE_SWEEP) / marks)
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

export interface PanelDrag {
  active: boolean
  /** The armed pointer, or null while no carry is in progress. */
  pointerId: number | null
}

/** Live bag for the carry gesture. The DOM handle owns the DECISION (its
 *  forwarded pointerdown arms this); the scene owns the GEOMETRY (the
 *  real screen pointer moves the slab, and the real document pointerup
 *  disarms it). Split that way because the forwarded stream's
 *  coordinates live on the panel — the very thing the gesture moves. */
export const panelDrag: PanelDrag = { active: false, pointerId: null }

/** Live bag for the resize gesture, split the same way and for the same
 *  reason: the corner grip is captured DOM, and its coordinates live on
 *  the panel whose width the gesture is changing. The grip arms this and
 *  records the width it started from; `startX` is left NaN, and the
 *  scene seeds it from the first REAL screen move before applying
 *  `resizeWidth`. */
export interface PanelResize {
  active: boolean
  /** The armed pointer, or null while no resize is in progress. */
  pointerId: number | null
  /** NaN until the scene seeds it from the first real screen move. */
  startX: number
  startW: number
}

export const panelResize: PanelResize = {
  active: false,
  pointerId: null,
  startX: Number.NaN,
  startW: 0,
}

/** Every command the scene lends to the DOM. Null means the scene is not
 *  mounted, which a control inside the root has to be able to see. */
export interface PanelCommands {
  resizeTo: ((width: number) => void) | null
  moveBy: ((dx: number, dy: number) => void) | null
  restore: (() => void) | null
  revealAnchor: ((key: string) => void) | null
}

/** Scene commands invoked by controls inside the captured DOM root. */
export const panelCommands: PanelCommands = {
  resizeTo: null,
  moveBy: null,
  restore: null,
  revealAnchor: null,
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
  /** In PAINT order, back to front: the widest layer first, the tightest
   *  last. Both consumers draw the array straight through — the SVG by
   *  element order, the environment bake by draw order — so the order
   *  here is the stacking, and it is decided in one place.
   *
   *  It reads outward-in because the big layers are the translucent,
   *  slow ones: stacked the other way they covered the small bright
   *  cores completely and the picture lost its center. */
  layers: ArtLayer[]
  backdropFrom: string
  backdropTo: string
}

/** Upper bound on layers a knob turn can ever request — the fixed count of
 *  `<polygon>` elements a consumer needs to pre-mount. */
export const ART_MAX_LAYERS = 16
const MAX_LAYERS = ART_MAX_LAYERS
const MIN_LAYERS = 2
const MIN_FACETS = 6
const MAX_FACETS = 24
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

/** Degrees, folded into [0, 360) — including from a negative offset. */
function wrapHue(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Where a scheme puts one layer, and where it puts that layer's outline
 * — both in degrees off the base hue.
 *
 * A discrete scheme gives each stop a CONTIGUOUS RUN of layers. It used
 * to hand out `offsets[i % offsets.length]`, which put the scheme's full
 * separation — 120° for a triad — between every pair of touching rings.
 * At three layers that is the harmony. At fifteen it is a barcode: no
 * two neighbours ever share a hue, so the picture reads as stripes and
 * the harmony itself becomes invisible.
 *
 * Runs fix it without softening anything. The drawn hues are still
 * exactly the scheme's stops and no others — nothing is interpolated,
 * nothing between the stops is ever painted — but the eye gets areas of
 * color instead of alternation, which is how a harmony is meant to be
 * seen. The lightness and saturation ramps keep running underneath, so
 * rings inside one run still separate; they separate on value, the way
 * they do in a monochromatic study.
 *
 * A ramping scheme has no stops to run, so it reads position straight.
 */
function schemeAt(scheme: PaletteScheme, t: number, tNext: number) {
  const stops = scheme.offsets
  if (!stops) {
    const fan = scheme.fan ?? 0
    return { fill: t * fan, edge: tNext * fan }
  }
  const band = Math.min(stops.length - 1, Math.floor(t * stops.length))
  /** The outline takes the next stop in the scheme — not the next
   *  layer's, which inside a run is the same one. An edge is therefore
   *  always another member of the harmony, whatever the run lengths do. */
  return { fill: stops[band], edge: stops[(band + 1) % stops.length] }
}

/** One layer's shared parameters — the single source both `generateArt`
 *  (which draws the layer) and `artGlow` (which lights the scene with
 *  it) read, so the reflection in the metal can never drift out of
 *  phase with the picture on the page. */
function layerSpec(values: KnobsValues, i: number, layerCount: number) {
  const spread = clamp(values.spread, 0.4, 1)
  const baseHue = wrapHue(values.hue)
  const denom = Math.max(1, layerCount - 1)
  const t01 = layerCount === 1 ? 0 : i / denom
  const tNext = layerCount === 1 ? 0 : (i + 1) / denom
  const radius = (INNER_R + t01 * (OUTER_R - INNER_R)) * spread
  const dir = i % 2 === 0 ? 1 : -1
  /** × speed × tSeconds gives the layer's current rotation. */
  const rotRate = dir * (0.15 + t01 * 0.35)

  const scheme = paletteAt(values.palette)
  const chroma = clamp(values.chroma, 0, 1)
  const band = schemeAt(scheme, t01, tNext)
  const hue = wrapHue(baseHue + band.fill * chroma)
  /** At mono the fill and the edge collapse, which is what monochromatic
   *  means — the edge still reads, on lightness. */
  const edgeHue = wrapHue(baseHue + band.edge * chroma)
  /** Tints and shades run outward whatever the hues are doing. This is
   *  what keeps chroma 0 a monochromatic STUDY — one hue in many values,
   *  the way a painter means the word — instead of one flat disc. */
  const sat = 70 + 20 * t01
  const light = 66 - 16 * t01
  return { t01, radius, rotRate, hue, edgeHue, sat, light }
}

/** Pure and deterministic: the same `(values, t)` always draws the same frame. */
export function generateArt(values: KnobsValues, tSeconds: number): ArtScene {
  const layerCount = clampInt(values.layers, MIN_LAYERS, MAX_LAYERS)
  const facets = clampInt(values.complexity, MIN_FACETS, MAX_FACETS)
  const speed = clamp(values.speed, 0, 2)
  const baseHue = wrapHue(values.hue)

  // Built outermost first, which is both the paint order the consumers
  // want and the order that puts the tight bright cores on top.
  const layers: ArtLayer[] = []
  for (let n = 0; n < layerCount; n++) {
    const i = layerCount - 1 - n
    const { t01: t, radius, rotRate, hue, edgeHue, sat, light } = layerSpec(values, i, layerCount)
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
      fill: `hsla(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%, 0.85)`,
      stroke: `hsla(${edgeHue.toFixed(1)}, 90%, ${(light + 16).toFixed(1)}%, 0.9)`,
      opacity: 0.55 + 0.45 * (1 - t),
    })
  }

  // The ground takes the OUTERMOST layer's hue, so opening the palette
  // pulls the two corners of the gradient apart with it. At chroma 0
  // that hue is the base hue again and the backdrop is exactly what a
  // monochromatic setting has always painted.
  const outerHue = layerSpec(values, layerCount - 1, layerCount).hue
  return {
    layers,
    backdropFrom: `hsl(${wrapHue(outerHue + 260).toFixed(1)}, 55%, 10%)`,
    backdropTo: `hsl(${wrapHue(baseHue + 200).toFixed(1)}, 60%, 4%)`,
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
/** A point in the picture's own plane, in CSS px. */
export interface GlowPoint {
  x: number
  y: number
}

export function glowPoint(src: GlowSource, viewportW: number): GlowPoint {
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

/** Ceiling of `artGlow`'s summed weights (layers 16, spread 1) — the
 *  normalizer that makes `backlightAmount` read as a 0..1 level.
 *
 *  It rises with the layer ceiling because the three outermost layers
 *  crowd toward the rim as the stack gets denser: 1.604 at 8 layers,
 *  1.630 at 12, 1.638 at 16. Left at the 8-layer value the level would
 *  saturate a hair early on a dense picture — clamped, so never wrong,
 *  just no longer telling the truth about the top of its range. */
const GLOW_WEIGHT_MAX = 1.638

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

/**
 * How much of the surround at one point is an EMITTER, 0..1 — the gate
 * that keeps the corona inside the picture's positive space.
 *
 * The corona samples the art just past the slab's edge and paints that
 * color back over the boundary. Colour alone cannot tell an emitter from
 * a background here, because the backdrop is not black: it is a dark but
 * SATURATED gradient, so sampling it returns a perfectly good teal. The
 * halo therefore drew a full hot line along every edge the background
 * touched — light standing where nothing is lit, which is exactly what
 * reads as artificial.
 *
 * The measure is the brightest CHANNEL, not luminance, and that is the
 * whole trick. Rec.709 weights blue at 0.07, so a saturated blue blade —
 * plainly an emitter, and half of what this palette paints — scores
 * lower than a teal backdrop. Swept across every scheme, chroma, hue and
 * layer count:
 *
 *     luma          backdrop 0.023..0.145   layers 0.101..0.761
 *     max channel   backdrop 0.064..0.155   layers 0.773..0.817
 *
 * Luma's two bands OVERLAP; no floor exists that separates them. The max
 * channel leaves a gap from 0.155 to 0.773, five times wider than either
 * band, and it is hue-blind, which is the property actually wanted: the
 * question is whether something bright is there, not what colour it is.
 * The contract measures both sides from `generateArt` itself, so
 * brightening the backdrop or dimming the palette fails with a number
 * rather than quietly putting the edge glow back.
 *
 * Mirrored in the corona's GLSL, like `veilProfile`, because a shader
 * cannot carry a test. Smoothstep, so the gate opens with zero slope at
 * both ends: a linear ramp would seam where a blade's blur crosses the
 * floor.
 */
export function litGate(level: number, floor: number, knee: number): number {
  const t = clamp((level - floor) / Math.max(knee - floor, 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
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
