// Marble background nodes — three screensaver fields behind the poster.
//
// The law: one node graph per theme, built into TWO materials from this one
// factory — the page canvas and the hand's private reflection copy —
// because a cloned <canvas> paints nothing. The fault, 2026-08-31: the
// HTML-in-canvas capture of the page returned the background as an empty
// rectangle, so the chrome hand reflected a hole where the poster's colour
// is. The reflection therefore draws the field itself, from the same graph
// and the same published second.
//
// The second fault these graphs answer: at t = 10 000 s a float32 phase has
// lost the low bits that carry a frame's worth of motion. Every periodic
// input folds after its multiply (`turn`), and the two non-periodic drifts
// fold at a distance no session reaches (`drift`).
//
// Ownership: this module owns the field graphs and material construction.
// The page canvas owns its renderer and clock sampling; the environment owns
// the reflection mesh. Neither owns a pixel of native HTML.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  atan,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { MarbleHandThemeId } from './marbleHandThemes'
import { marbleHandTuning, type MarbleHandNumberKey, type MarbleHandTuning } from './marbleHandTuning'

type Value<T extends 'float' | 'vec2' | 'vec3'> = Node<T> | number

// ── shared program ────────────────────────────────────────────────────

const TAU = 6.28318530718

// Palette anchors: the page's own tokens, in sRGB, converted once at the
// end of the graph. Naming them keeps every field on one poster's colour set.
const ROSE = vec3(0.957, 0.663, 0.812)
const ACID = vec3(0.878, 0.957, 0.427)
const CORAL = vec3(1.0, 0.502, 0.384)
const MINT = vec3(0.565, 0.847, 0.769)
const BLUE = vec3(0.541, 0.655, 0.937)
const CREAM = vec3(1.0, 0.941, 0.812)

// A sine-free hash. One sin() costs more than this whole function on the
// integrated GPUs this page has to hold 60fps on, and the wave field takes
// fifty-six of them per pixel.
const hash21 = Fn(([p]: [Node<'vec2'>]) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
  q.addAssign(dot(q, q.yzx.add(33.33)))
  return fract(q.x.add(q.y).mul(q.z))
}, { p: 'vec2', return: 'float' })

const hash22 = Fn(([p]: [Node<'vec2'>]) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar()
  q.addAssign(dot(q, q.yxz.add(33.33)))
  return fract(q.xx.add(q.yz).mul(q.zy))
}, { p: 'vec2', return: 'vec2' })

const noise = Fn(([p]: [Node<'vec2'>]) => {
  const i = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  return mix(
    mix(hash21(i), hash21(i.add(vec2(1, 0))), u.x),
    mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), u.x),
    u.y)
}, { p: 'vec2', return: 'float' })

const fbm2 = Fn(([start]: [Node<'vec2'>]) => {
  const v = noise(start).mul(0.5)
  const p = start.mul(2.03).add(vec2(11.3, 7.7))
  return v.add(noise(p).mul(0.25))
}, { p: 'vec2', return: 'float' })

const fbm3 = Fn(([start]: [Node<'vec2'>]) => {
  const p = start.toVar()
  const v = noise(p).mul(0.5).toVar()
  p.assign(p.mul(2.03).add(vec2(11.3, 7.7)))
  v.addAssign(noise(p).mul(0.25))
  p.assign(p.mul(2.01).add(vec2(3.1, 19.7)))
  return v.add(noise(p).mul(0.125))
}, { p: 'vec2', return: 'float' })

const fbm4 = Fn(([start]: [Node<'vec2'>]) => {
  const p = start.toVar()
  const v = noise(p).mul(0.5).toVar()
  p.assign(p.mul(2.03).add(vec2(11.3, 7.7)))
  v.addAssign(noise(p).mul(0.25))
  p.assign(p.mul(2.01).add(vec2(3.1, 19.7)))
  v.addAssign(noise(p).mul(0.125))
  p.assign(p.mul(2.07).add(vec2(23.9, 5.3)))
  return v.add(noise(p).mul(0.0625))
}, { p: 'vec2', return: 'float' })

function toLinear(c: Node<'vec3'>): Node<'vec3'> {
  return pow(max(c, vec3(0)), vec3(2.2))
}

function sq(x: Node<'float'>): Node<'float'> {
  return x.mul(x)
}

// The falling edge of smoothstep. smoothstep with edge0 > edge1 is
// undefined in GLSL and WGSL alike.
function fall(edge0: Value<'float'>, edge1: Value<'float'>, x: Node<'float'>): Node<'float'> {
  return float(1).sub(smoothstep(edge0, edge1, x))
}

/** The values one field material reads, written in place each draw. */
export interface MarbleBackgroundValues {
  readonly time: UniformNode<'float', number>
  readonly resolution: UniformNode<'vec2', THREE.Vector2>
  readonly aspect: UniformNode<'float', number>
  /** The panel-tunable numbers this theme's graph reads, by tuning key. */
  readonly tuning: Partial<Record<MarbleHandNumberKey, UniformNode<'float', number>>>
}

interface FieldKit {
  readonly values: MarbleBackgroundValues
  /** A phase for sin/cos. Folding AFTER the multiply keeps the low bits
   *  that carry one frame of motion, and TAU folds exactly, so the wrap is
   *  silent. */
  turn: (speed: Value<'float'>) => Node<'float'>
  /** Noise has no period, so a drifting domain cannot fold silently. 1024
   *  units is more than nine hours at the slowest speed used here, and
   *  float32 still resolves a frame's step at that magnitude. */
  drift: (speed: number) => Node<'float'>
  knob: (key: MarbleHandNumberKey) => UniformNode<'float', number>
}

function fieldKit(values: MarbleBackgroundValues): FieldKit {
  return {
    values,
    turn: (speed) => mod(values.time.mul(speed), TAU),
    drift: (speed) => mod(values.time.mul(speed), 1024),
    knob: (key) => {
      const node = values.tuning[key]
      if (!node) throw new Error(`The marble field has no uniform for ${key}`)
      return node
    },
  }
}

// ── waves ─────────────────────────────────────────────────────────────

function wavePalette(input: Node<'float'>): Node<'vec3'> {
  const x = clamp(input, 0, 1)
  const a = mix(ROSE, MINT, smoothstep(0.0, 0.3, x))
  const b = mix(a, ACID, smoothstep(0.26, 0.52, x))
  const c = mix(b, CORAL, smoothstep(0.48, 0.74, x))
  return mix(c, BLUE, smoothstep(0.7, 1.0, x))
}

function waves({ values, turn, drift, knob }: FieldKit): Node<'vec3'> {
  const vUv = uv()
  const p = vec2(vUv.x.mul(values.aspect), vUv.y).mul(knob('wavesZoom'))
  const warp = knob('wavesWarp')

  // Two warps at separate tempos. One warp lets the field settle into the
  // shape of its own noise; the second keeps folding that shape apart.
  const first = vec2(
    fbm2(p.add(vec2(drift(0.019), 0))),
    fbm2(p.add(vec2(4.7, 2.1)).sub(vec2(0, drift(0.015)))))
  const warped = warp.mul(2.4).mul(first)
  const second = vec2(
    fbm3(p.add(warped).add(vec2(1.3, 8.4)).add(vec2(0, drift(0.031)))),
    fbm3(p.add(warped).add(vec2(6.9, 3.6)).sub(vec2(drift(0.027), 0))))
  const field = fbm4(p.add(warp.mul(3.1).mul(second)))
    // A fine ripple on a third clock, small enough never to band the ramp.
    .add(knob('wavesRipple').mul(sin(p.x.add(p.y).mul(9).sub(turn(1.65)).add(second.x.mul(6)))))

  const color = wavePalette(field.mul(knob('wavesContrast')).add(knob('wavesShift'))).toVar()

  // Fake specular. The difference of the two warps stands in for the
  // surface slope, so the sheen rides the folds with no extra field read.
  const slope = second.sub(first)
  const facing = dot(normalize(slope.add(0.0001)), vec2(0.62, 0.78)).mul(0.5).add(0.5)
  color.addAssign(pow(clamp(facing, 0, 1), 7).mul(knob('wavesSheen')).mul(vec3(1.0, 0.87, 0.67)))
  // A wide travelling gloss, so the silk reads as lit rather than printed.
  const gloss = exp(sq(vUv.x.mul(values.aspect).sub(1.1).sub(sin(turn(0.09)).mul(0.9)).mul(1.4)).negate())
  color.addAssign(gloss.mul(knob('wavesGloss')))

  const centered = vUv.sub(0.5)
  const vignette = float(1).sub(knob('wavesVignette').mul(dot(centered, centered)).mul(2.4))
  return toLinear(color.mul(vignette))
}

// ── tide ──────────────────────────────────────────────────────────────

const SKY_ZENITH = vec3(0.043, 0.035, 0.141)
const SKY_VIOLET = vec3(0.231, 0.161, 0.451)
const HORIZON_DUST = vec3(0.722, 0.459, 0.502)
const RIM_GOLD = vec3(1.0, 0.878, 0.659)
const AURORA_MINT = vec3(0.451, 0.851, 0.749)
const ECLIPSE_STONE = vec3(0.031, 0.024, 0.059)

// The glow's spectrum: a band from mint through blue and violet to rose,
// deliberately short of a full rainbow so the sea stays nocturnal.
function seaPalette(input: Node<'float'>): Node<'vec3'> {
  const x = clamp(input, 0, 1)
  const a = mix(AURORA_MINT, vec3(0.353, 0.62, 0.949), smoothstep(0.0, 0.35, x))
  const b = mix(a, vec3(0.62, 0.42, 0.949), smoothstep(0.3, 0.65, x))
  return mix(b, vec3(0.949, 0.549, 0.62), smoothstep(0.6, 1.0, x))
}

// A star's brightness follows a power law — a field is mostly faint dust
// with a handful of blazing exceptions — and its colour follows its
// temperature, blue-white through white into warm. Each pixel scans its
// 3x3 cell neighbourhood, so a star's light must die inside 1.5 cells or
// it clips into a rectangle: sigmaHi and the cross budget are sized per
// layer, and only the coarse layer can afford giants. Radii are floored
// at a pixel so nothing aliases.
function starLayer(
  { turn }: FieldKit,
  sp: Node<'vec2'>,
  px: Node<'float'>,
  grid: readonly [number, number],
  offset: readonly [number, number],
  density: Node<'float'>,
  sigmaHi: number,
  giant: number,
): Node<'vec3'> {
  const light = vec3(0).toVar()
  const gridNode = vec2(...grid)
  const offsetNode = vec2(...offset)
  const base = floor(sp.mul(gridNode).add(offsetNode))
  Loop({ type: 'int', start: -1, end: 1, condition: '<=' }, { type: 'int', start: -1, end: 1, condition: '<=' }, ({ i: cy, j: cx }) => {
    const cell = base.add(vec2(float(cx), float(cy)))
    const seed = hash21(cell)
    If(seed.greaterThanEqual(float(1).sub(density)), () => {
      const pos = cell.add(0.1).add(hash22(cell).mul(0.8)).sub(offsetNode).div(gridNode)
      const mag = pow(hash21(cell.add(9)), 4)
      const temp = hash21(cell.add(23))
      const tint = mix(mix(vec3(0.62, 0.74, 1.0), vec3(1), smoothstep(0.0, 0.55, temp)),
        vec3(1.0, 0.82, 0.6), smoothstep(0.55, 1.0, temp))
      const d = sp.sub(pos)
      const r = length(d)
      const sigma = max(mix(0.0026, sigmaHi, mag), px.mul(0.9))
      const glow = exp(sq(r.div(sigma)).negate()).mul(mag.mul(1.1).add(0.16))
        .add(exp(sq(r.div(sigma.mul(3.2))).negate()).mul(mag).mul(0.08 + 0.24 * giant))
        .toVar()
      const thick = max(sigma.mul(0.4), px.mul(0.8))
      const arm = sigma.mul(7)
      glow.addAssign(exp(sq(d.x.div(arm)).negate()).mul(exp(sq(d.y.div(thick)).negate()))
        .add(exp(sq(d.y.div(arm)).negate()).mul(exp(sq(d.x.div(thick)).negate())))
        .mul(smoothstep(0.5, 0.9, mag)).mul(0.3).mul(giant))
      // Faint stars shimmer hard; the bright ones barely breathe.
      const twinkle = float(1).sub(mix(0.5, 0.12, mag).mul(sin(turn(seed.add(0.4)).add(seed.mul(TAU))).mul(0.5).add(0.5)))
      light.addAssign(tint.mul(glow).mul(twinkle))
    })
  })
  return light
}

function tide(kit: FieldKit): Node<'vec3'> {
  const { values, turn, drift, knob } = kit
  const vUv = uv()
  const eclipse = knob('tideEclipseSize')
  const glowGain = knob('tideGlow')

  // A slow breathing zoom and roll: the lens moves, the floor does not.
  const roll = sin(turn(0.11)).mul(0.026)
  const lens = vec2(vUv.x.sub(0.5).mul(values.aspect), vUv.y.sub(0.5)).mul(2).mul(sin(turn(0.15)).mul(0.03).add(1))
  const s = vec2(
    lens.x.mul(cos(roll)).sub(lens.y.mul(sin(roll))),
    lens.x.mul(sin(roll)).add(lens.y.mul(cos(roll)))).toVar()

  const horizon = knob('tideHorizon')
  // The eclipse holds the centre of the sky: the lens flare below hangs
  // ghosts on the line from it through the frame centre, and a drifting
  // source would drag them across the headline.
  const orb = vec2(0, horizon.add(knob('tideLift')))

  // Night on an airless plain: one dusty band of rose at the horizon,
  // violet above it, and a zenith close to black so the rim can blaze.
  const lift = clamp(s.y.sub(horizon).div(1.1), 0, 1)
  const color = mix(HORIZON_DUST, mix(SKY_VIOLET, SKY_ZENITH, smoothstep(0.12, 0.8, lift)),
    smoothstep(0.0, 0.3, lift)).toVar()

  // One violet nebula lobe, barely there — depth, not decoration.
  const neb = fbm3(vec2(s.x.mul(0.9).add(drift(0.011)), s.y.mul(1.3).add(3.7)))
  color.assign(mix(color, SKY_VIOLET, smoothstep(0.55, 0.9, neb)
    .mul(smoothstep(0.0, 0.3, s.y.sub(horizon))).mul(0.35)))

  // Three star layers, fine to coarse, under atmospheric extinction that
  // dims the field toward the horizon. A pale galactic haze leans behind.
  const extinction = smoothstep(0.06, 0.5, lift)
  const milk = exp(sq(s.y.sub(0.72).sub(s.x.mul(0.28)).mul(2.1)).negate())
  color.addAssign(vec3(0.72, 0.78, 0.95).mul(milk)
    .mul(fbm3(s.mul(vec2(2.6, 4.2)).add(8.3)).mul(0.65).add(0.35)).mul(0.055).mul(extinction))
  const starPx = float(2).div(values.resolution.y)
  const density = knob('tideStarDensity')
  color.addAssign(starLayer(kit, s, starPx, [46, 34], [61, 17], density.mul(0.5), 0.0042, 0)
    .add(starLayer(kit, s, starPx, [27, 20], [23, 89], density.mul(0.35), 0.006, 0))
    .add(starLayer(kit, s, starPx, [14, 10], [47, 5], density.mul(0.22), 0.0095, 1))
    .mul(extinction))

  // One aurora curtain, thin and slow, hung on a swinging centre line.
  const ribbonLine = sin(turn(0.031).add(s.x.mul(1.1))).mul(0.15).add(0.66)
  const ribbon = exp(sq(s.y.sub(ribbonLine).mul(6.5)).negate())
  const ribbonWeave = fbm2(vec2(s.x.mul(1.9).add(drift(0.017)), s.y.mul(3.3)))
  color.addAssign(AURORA_MINT.mul(ribbon).mul(ribbonWeave).mul(0.22))

  // The eclipse: a matte stone disc, a thin blazing rim, and a corona
  // whose flare leans with a slow-breathing noise so it reads as plasma
  // rather than a drawn ring.
  const po = s.sub(orb)
  const pd = length(po)
  const flare = fbm2(vec2(po.x.mul(3).add(drift(0.008)), po.y.mul(3).sub(drift(0.006)))).mul(0.6).add(0.7)
  color.addAssign(RIM_GOLD.mul(exp(sq(pd.sub(eclipse).mul(9)).negate())).mul(0.3).mul(flare))
  color.addAssign(RIM_GOLD.mul(exp(sq(pd.sub(eclipse).mul(55)).negate())).mul(0.85))
  color.assign(mix(color, ECLIPSE_STONE, fall(eclipse.sub(0.008), eclipse, pd)))

  // The horizon keeps a quiet luminous seam where sky meets floor.
  color.addAssign(HORIZON_DUST.mul(0.35).mul(exp(sq(s.y.sub(horizon).mul(11)).negate())))

  // A photographic flare, laid over sky and floor alike at the very end
  // of the graph — the flare lives in the lens, not the scene. Ghost images
  // sit on the line from the light through the frame centre, where a
  // camera's internal reflections land: warm near the source, cooling as
  // they cross the centre. The halo is three offset rings, which is what
  // makes its chromatic fringe.
  const flareBreath = sin(turn(0.043)).mul(0.15).add(0.85).mul(knob('tideFlare'))

  If(s.y.lessThan(horizon), () => {
    // Two fixed-point steps intersect the ray with the swell. The flat
    // solution is the first guess; each step re-solves the plane at the
    // height the previous hit found.
    const down = horizon.sub(s.y)
    const dist = float(1).div(down).toVar()
    const height = float(0).toVar()
    for (let iteration = 0; iteration < 2; iteration++) {
      const hit2 = vec2(s.x.mul(dist), dist)
      height.assign(knob('tideSwell').mul(
        sin(hit2.y.mul(0.55).sub(turn(0.5))).mul(0.15)
          .add(sin(hit2.x.mul(0.85).add(turn(0.34))).mul(0.1))
          .add(sin(hit2.x.add(hit2.y).mul(1.6).sub(turn(0.83))).mul(0.05))))
      dist.assign(height.add(1).div(down))
    }
    const hit = vec2(s.x.mul(dist), dist)

    // The liquid is lit from beneath: filaments of glow inside a dark
    // body, the way bioluminescence outlines the water that moves.
    const flow = vec2(hit.x.mul(0.42), hit.y.mul(0.42).add(drift(0.1)))
    const churn = vec2(
      fbm2(flow.add(vec2(drift(0.05), 0))),
      fbm2(flow.add(vec2(7.3, 2.9))))
    const vein = fbm3(flow.add(churn.mul(1.9)))
    const filament = pow(float(1).sub(vein.mul(2).sub(1).abs()), 6)
    const lace = pow(float(1).sub(fbm3(flow.mul(2.7).add(churn.yx.mul(1.3)).add(vec2(4.2, 8.8))).mul(2).sub(1).abs()), 8)
    // The finest thread only the near water can resolve.
    const thread = pow(float(1).sub(fbm2(flow.mul(6.3).add(churn.mul(2.1)).add(vec2(9.7, 1.3))).mul(2).sub(1).abs()), 10)

    // The glow's hue wanders the spectral band across the plane, slowly
    // enough that no two swells share a colour but nothing strobes.
    const hue = clamp(fbm2(vec2(hit.x.mul(0.11).add(drift(0.013)), hit.y.mul(0.11))).mul(1.7).sub(0.15).add(knob('tideHueShift')), 0, 1)
    const glow = seaPalette(hue)

    // Fine filaments must dissolve before the horizon can alias them.
    const sharp = fall(5, 22, dist)

    const sea = mix(SKY_ZENITH.mul(0.9), SKY_VIOLET.mul(0.6), max(height, 0).mul(0.9).add(0.3)).toVar()
    sea.addAssign(glow.mul(filament).mul(0.85).mul(glowGain).mul(sharp.mul(0.65).add(0.35)))
    sea.addAssign(glow.mul(lace).mul(0.38).mul(glowGain).mul(sharp))
    sea.addAssign(mix(glow, vec3(1), 0.25).mul(thread).mul(0.3).mul(glowGain).mul(fall(2, 9, dist)))

    // A surge of bioluminescence rolls from the near edge to the horizon,
    // lighting the filaments as it passes. Its envelope is zero at both
    // ends of the phase, so the restart is silent.
    const surgePhase = mod(values.time.mul(knob('tideSurgeRate')), 1)
    const surge = exp(sq(hit.y.sub(surgePhase.mul(26)).mul(0.3)).negate()).mul(sq(sin(surgePhase.mul(3.14159265))))
    sea.addAssign(glow.mul(filament.add(lace.mul(0.5))).mul(surge).mul(1.1).mul(glowGain))

    // Crests refract toward the next hue over, the way a thin film does.
    const crestTint = seaPalette(clamp(hue.add(0.35), 0, 1))
    sea.addAssign(mix(crestTint, vec3(1), 0.35).mul(smoothstep(0.14, 0.3, height)).mul(0.32))

    // The near water is deep, and something far below it is lit.
    sea.addAssign(vec3(0.043, 0.216, 0.243).mul(fall(1, 3.5, dist)).mul(0.55))

    // Distant water mirrors the night, as a calm sea does.
    const sheen = smoothstep(3.5, 16, dist)
    sea.assign(mix(sea, mix(HORIZON_DUST, SKY_VIOLET, 0.45), sheen.mul(0.45)))

    // The eclipse itself lies mirrored on the water: stone disc and
    // blazing rim folded across the horizon, stretched toward the viewer,
    // displaced by the swell, and broken into streaks along the waves.
    const rp = vec2(s.x.add(vein.sub(0.5).mul(0.08)), horizon.mul(2).sub(s.y).add(height.mul(0.22)))
    const rv = rp.sub(orb)
    const rd = length(vec2(rv.x, rv.y.mul(0.45)))
    const streak = sin(hit.y.mul(2.6).add(turn(0.5)).add(vein.mul(3))).mul(0.45).add(0.55)
    const mirrorFade = fall(0.02, 1.1, horizon.sub(s.y)).mul(0.7)
    sea.addAssign(RIM_GOLD.mul(exp(sq(rd.sub(eclipse).mul(30)).negate())).mul(streak.mul(0.9).add(0.5)).mul(mirrorFade))
    sea.addAssign(RIM_GOLD.mul(exp(sq(rd.sub(eclipse).mul(7)).negate())).mul(0.25).mul(mirrorFade))
    sea.assign(mix(sea, ECLIPSE_STONE,
      fall(eclipse.sub(0.012), eclipse.add(0.01), rd).mul(mirrorFade).mul(0.85).mul(streak.mul(0.5).add(0.5))))

    // The eclipse's glade: the rim's light broken over the swell, gold at
    // the horizon and cooling as it nears, flickering with the wave phase.
    const path = exp(sq(s.x.sub(orb.x).mul(dist.mul(0.14).add(2.6))).negate())
    const sparkle = sin(turn(1.3).add(hit.y.mul(5.1)).add(hit.x.mul(2.3)).add(vein.mul(9))).mul(0.5).add(0.5)
    const gladeTint = mix(HORIZON_DUST, RIM_GOLD, smoothstep(2, 12, dist))
    sea.addAssign(gladeTint.mul(path).mul(sq(sparkle).mul(0.7).add(0.3)).mul(knob('tideGlade')).mul(smoothstep(0.35, 2.6, dist)))

    // Glitter rides the surface itself: glint cells live in hit space,
    // so they foreshorten with distance and scroll with the water. Each
    // flashes on its own phase, favours the crests, and doubles inside
    // the glade, where a real sea throws its sparkle.
    const gp = vec2(hit.x.mul(5), hit.y.mul(5).add(drift(0.55)))
    const gCell = floor(gp)
    const gSeed = hash21(gCell.add(7))
    const glint = exp(sq(length(gp.sub(gCell).sub(0.2).sub(hash22(gCell).mul(0.6))).mul(8)).negate())
    const flash = pow(sin(turn(1.1).add(gSeed.mul(TAU))).mul(0.5).add(0.5), 6)
    // A shimmer front ripples through the glints toward the viewer, so
    // the sparkle reads as one surface moving, not separate lamps.
    const shimmer = sin(turn(0.9).sub(hit.y.mul(1.7))).mul(0.55).add(0.45)
    const crest = smoothstep(0.02, 0.22, height).mul(0.65).add(0.35)
    sea.addAssign(mix(glow, vec3(1), 0.6).mul(step(0.5, gSeed)).mul(glint).mul(flash).mul(shimmer).mul(crest)
      .mul(path.mul(0.85).add(0.35)).mul(smoothstep(0.55, 1.2, dist)).mul(fall(4, 16, dist)).mul(1.3).mul(knob('tideGlitter')))

    const fog = float(1).sub(exp(dist.negate().mul(0.05)))
    color.assign(mix(sea, color, clamp(fog, 0, 1)))
  })

  const fo = s.sub(orb)
  const halo = length(fo)
  const ring = (radius: number, sharpness: number) => exp(sq(halo.sub(radius).mul(sharpness)).negate())
  const ghost = (at: Node<'float'>, sharpness: number) => exp(sq(at.mul(sharpness)).negate())
  color.addAssign(vec3(1.0, 0.45, 0.35).mul(ring(0.355, 38)).mul(0.07).mul(flareBreath))
  color.addAssign(vec3(0.55, 1.0, 0.6).mul(ring(0.38, 38)).mul(0.06).mul(flareBreath))
  color.addAssign(vec3(0.45, 0.55, 1.0).mul(ring(0.405, 38)).mul(0.07).mul(flareBreath))
  color.addAssign(RIM_GOLD.mul(ghost(fo.y, 30)).mul(ghost(fo.x, 1.6)).mul(0.16).mul(flareBreath))
  color.addAssign(vec3(1.0, 0.85, 0.6).mul(ghost(length(s.sub(orb.mul(0.65))), 34)).mul(0.17).mul(flareBreath))
  color.addAssign(vec3(0.55, 0.85, 0.8).mul(ghost(length(s.sub(orb.mul(0.38))).sub(0.052), 70)).mul(0.1).mul(flareBreath))
  color.addAssign(vec3(0.95, 0.6, 0.65).mul(ghost(length(s), 18)).mul(0.09).mul(flareBreath))
  color.addAssign(vec3(0.6, 0.55, 0.95).mul(ghost(length(s.add(orb.mul(0.35))), 11)).mul(0.08).mul(flareBreath))
  color.addAssign(vec3(1.0, 0.8, 0.55).mul(ghost(length(s.add(orb.mul(0.75))).sub(0.125), 55)).mul(0.09).mul(flareBreath))

  // The dark gradients band without a breath of grain.
  color.addAssign(hash21(screenCoordinate).sub(0.5).mul(0.012))

  return toLinear(color)
}

// ── prism ─────────────────────────────────────────────────────────────

// Nearest and second-nearest cell distances plus the nearest cell's id.
// The difference of the two distances is the cell boundary — where glass
// shows its edges — and each feature point orbits inside its cell, so
// walls slide and plates trade territory instead of holding a mosaic.
// The orbit multiplies turn() by a per-cell integer: any other factor
// would snap when the folded angle wraps.
function cells({ turn }: FieldKit, p: Node<'vec2'>, rate: Node<'float'>): Node<'vec4'> {
  const base = floor(p)
  const f = fract(p)
  const nearest = float(8).toVar()
  const second = float(8).toVar()
  const id = vec2(0).toVar()
  Loop({ type: 'int', start: -1, end: 1, condition: '<=' }, { type: 'int', start: -1, end: 1, condition: '<=' }, ({ i: y, j: x }) => {
    const offset = vec2(float(x), float(y))
    const h = hash22(base.add(offset))
    const point = offset.add(0.5).add(sin(turn(rate).mul(floor(h.mul(3)).add(1)).add(h.yx.mul(TAU))).mul(0.38)).sub(f)
    const d = length(point)
    second.assign(min(second, max(nearest, d)))
    If(d.lessThan(nearest), () => {
      nearest.assign(d)
      id.assign(base.add(offset))
    })
    second.assign(max(second, nearest))
  })
  return vec4(nearest, second, id)
}

function prismPalette(t: Node<'float'>): Node<'vec3'> {
  return cos(vec3(0.95, 0.84, 0.7).mul(t).add(vec3(0.02, 0.26, 0.52)).mul(TAU)).mul(0.36).add(0.6)
}

function prism(kit: FieldKit): Node<'vec3'> {
  const { values, turn, drift, knob } = kit
  const vUv = uv()
  const zoom = knob('prismZoom')
  const dispersion = knob('prismDispersion')
  const cellScale = knob('prismCells')
  const edge = knob('prismEdge')
  const morph = knob('prismMorph')

  const c = vec2(vUv.x.sub(0.5).mul(values.aspect), vUv.y.sub(0.5)).mul(2)
  const radius = length(c)
  // Changing the count pops a whole mirror line into existence, so the
  // panel steps it in whole mirrors; the field turns underneath the fold.
  const segment = float(TAU).div(knob('prismSegments'))
  const turned = atan(c.y, c.x).add(turn(knob('prismSpin')))
  const angle = mod(turned.add(segment.mul(0.5)), segment).sub(segment.mul(0.5)).abs()
  // A slow radial breath keeps the fold from reading as a still wheel.
  const q = vec2(cos(angle), sin(angle)).mul(radius).mul(sin(turn(0.07)).mul(0.1).add(1))

  const warp = vec2(drift(0.011), drift(0.008).negate())
  // Dispersion: three radii, one per channel, as glass separates them.
  const r = fbm3(q.mul(zoom).mul(dispersion.add(1)).add(warp))
  const g = fbm3(q.mul(zoom).add(warp))
  const b = fbm3(q.mul(zoom).mul(float(1).sub(dispersion)).add(warp))
  const color = vec3(prismPalette(r.mul(1.6)).r, prismPalette(g.mul(1.6)).g, prismPalette(b.mul(1.6)).b).toVar()

  // A deeper dispersion field counter-rotates under the first, so the
  // glass reads as two thicknesses sliding past each other.
  const deepAngle = turn(0.02)
  const deepQ = vec2(
    cos(deepAngle).mul(q.x).add(sin(deepAngle).mul(q.y)),
    sin(deepAngle).negate().mul(q.x).add(cos(deepAngle).mul(q.y))).mul(1.7).add(warp.yx)
  color.mulAssign(mix(vec3(1), prismPalette(fbm3(deepQ.mul(zoom)).mul(1.6).add(0.35)).mul(0.48).add(0.6), knob('prismDepth')))

  // Three cell layers. Plates: big, slow, each leaning the palette its
  // own way like panes of different cut. Facets: the walls and caustic
  // glints. Sparks: tiny fast facets that only ever flash.
  // Every wall and glint fades toward the fold's centre, where the
  // mirror compresses all three lattices into a white-hot pile.
  const edgeFade = smoothstep(0.04, 0.32, radius)
  const plate = cells(kit, q.mul(cellScale).mul(knob('prismPlates')).add(vec2(drift(0.004).negate(), drift(0.005))), morph.mul(0.045))
  const plateSeed = hash21(plate.zw.add(7))
  color.mulAssign(mix(vec3(1), prismPalette(plateSeed.add(g.mul(0.9))).mul(0.3).add(0.85), knob('prismPlateTint')))
  color.addAssign(prismPalette(plateSeed.add(0.15)).mul(edge).mul(0.5).mul(edgeFade).mul(fall(0, 0.06, plate.y.sub(plate.x))))

  const facet = cells(kit, q.mul(cellScale).add(vec2(0, drift(0.006))), morph.mul(0.12))
  color.addAssign(vec3(1.0, 0.98, 0.94).mul(edge).mul(0.85).mul(edgeFade).mul(fall(0, 0.065, facet.y.sub(facet.x))))
  const glint = fall(0, 0.14, facet.x)
    .mul(sin(turn(0.9).add(facet.x.add(radius).mul(24))).mul(0.5).add(0.5))
  color.addAssign(vec3(1.0, 0.95, 0.86).mul(knob('prismGlint')).mul(edgeFade).mul(pow(glint, 3)))

  const spark = cells(kit, q.mul(cellScale).mul(2.3).add(vec2(drift(0.009), 0)), morph.mul(0.2))
  const sparkle = fall(0, 0.09, spark.x)
    .mul(sin(turn(1.3).add(spark.z.mul(3.1)).add(radius.mul(30))).mul(0.5).add(0.5))
  color.addAssign(vec3(1).mul(knob('prismSpark')).mul(edgeFade).mul(pow(sparkle, 4)))

  // The centre keeps a bright core so the fold reads as one crystal.
  color.addAssign(CREAM.mul(knob('prismCore')).mul(exp(sq(radius.mul(2.4)).negate())))
  const centered = vUv.sub(0.5)
  color.mulAssign(float(1).sub(dot(centered, centered).mul(0.14).mul(2.4)))

  return toLinear(color)
}

// ── materials ─────────────────────────────────────────────────────────

const MARBLE_BACKGROUND_FIELDS = { waves, tide, prism } satisfies Record<MarbleHandThemeId, (kit: FieldKit) => Node<'vec3'>>

// Every panel-tunable number in each field, in tuning-bag key form. A
// material holds uniforms only for its own theme's keys, which is why
// setMarbleBackgroundFrame applies by lookup rather than by list.
const MARBLE_BACKGROUND_TUNING = {
  waves: ['wavesZoom', 'wavesWarp', 'wavesRipple', 'wavesContrast', 'wavesShift', 'wavesSheen', 'wavesGloss', 'wavesVignette'],
  tide: ['tideHorizon', 'tideLift', 'tideEclipseSize', 'tideSwell', 'tideGlow', 'tideHueShift', 'tideSurgeRate', 'tideGlitter', 'tideGlade', 'tideFlare', 'tideStarDensity'],
  prism: ['prismSegments', 'prismZoom', 'prismDispersion', 'prismCells', 'prismEdge', 'prismGlint', 'prismCore', 'prismSpin', 'prismMorph', 'prismPlates', 'prismPlateTint', 'prismDepth', 'prismSpark'],
} satisfies Record<MarbleHandThemeId, readonly MarbleHandNumberKey[]>

// The reflection re-bakes only when its key string changes, so a moved
// background slider has to move the key too or the hand keeps reflecting
// the old field until something else re-bakes it.
export function marbleBackgroundTuningStamp(tuning: MarbleHandTuning, theme: MarbleHandThemeId): string {
  return MARBLE_BACKGROUND_TUNING[theme].map((key) => tuning[key]).join(',')
}

export type MarbleBackgroundMaterial = MeshBasicNodeMaterial & { readonly field: MarbleBackgroundValues }

export function createMarbleBackgroundMaterial(theme: MarbleHandThemeId): MarbleBackgroundMaterial {
  const values: MarbleBackgroundValues = {
    time: uniform(0),
    resolution: uniform(new THREE.Vector2(1, 1)),
    aspect: uniform(1),
    tuning: Object.fromEntries(MARBLE_BACKGROUND_TUNING[theme].map((key) => [key, uniform(marbleHandTuning[key])])),
  }
  const material = new MeshBasicNodeMaterial({
    name: `marble-hand-background-${theme}`,
    // The field is opaque and covers its whole quad, so it owes nothing to
    // the depth buffer in either scene.
    depthTest: false,
    depthWrite: false,
  })
  const field = MARBLE_BACKGROUND_FIELDS[theme]
  // Linear colour at alpha 1. The page canvas's per-fragment conversion
  // encodes it; the reflection's linear cube target stores it unconverted.
  // The graph is built inside the Fn: its If, Loop and assignments need a
  // stack.
  material.outputNode = Fn(() => vec4(field(fieldKit(values)), 1))()
  return Object.assign(material, { field: values })
}

export function setMarbleBackgroundFrame(
  material: MarbleBackgroundMaterial,
  time: number,
  width: number,
  height: number,
  tuning: MarbleHandTuning,
) {
  const { field } = material
  field.time.value = time
  // Both canvases — page and reflection — pass through here every draw, so
  // the two copies of a field can never show two different panel values.
  for (const keys of Object.values(MARBLE_BACKGROUND_TUNING)) {
    for (const key of keys) {
      const cell = field.tuning[key]
      if (cell) cell.value = tuning[key]
    }
  }
  field.aspect.value = height > 0 ? width / height : 1
  field.resolution.value.set(width, height)
}
