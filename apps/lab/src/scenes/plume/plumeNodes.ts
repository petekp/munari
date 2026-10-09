// Plume nodes — captured DOM ink carried away as smoke.
//
// The law: the source stays premultiplied from texture to framebuffer, and
// motion stays stateless — position is a function of age, seed, and home
// position only. Statelessness is what lets Restore, pause, reduced motion,
// and the gate's age sampling all land on the same pixels; a simulation
// buffer would make every one of those a different picture.
//
// Two faults are pinned here. The 2026-08-30 thread pass stretched grains
// 22–40 times along their path, so particle dimensions stay isotropic. The
// same review found the cloud reading as a spray of dots: independent
// per-grain scatter with a flat 96% tint gave no shared flow, no volume, and
// no colour of its own. Neighbouring grains now share one divergence-free
// flow field, each sprite is a shaded noise puff, and the base colour is the
// captured texel's own.
//
// The color-space fault was measured on the candidates bench, 2026-08-20:
// without the sRGB encode, #f2f0e4 arrived as 226,222,198, a 30-count blue
// drop. The shading is computed in the canvas's sRGB encoding, as it was
// tuned, and lands through encodedOutput (decisions.md #72). Ownership: this
// file owns motion and light only. Unit time and anchor placement remain JS
// laws.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import {
  Discard,
  Fn,
  Loop,
  attribute,
  cameraProjectionMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  modelViewMatrix,
  positionGeometry,
  pow,
  sRGBTransferOETF,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'
import type { PlumeGrid } from './plumeCloud'
import { plumeTuning } from './plumeTuning'

/** The cloud's live values, written by Plume.tsx. */
export interface PlumeValues {
  readonly time: UniformNode<'float', number>
  readonly duration: UniformNode<'float', number>
  readonly stagger: UniformNode<'float', number>
  readonly rise: UniformNode<'float', number>
  readonly spread: UniformNode<'float', number>
  readonly depth: UniformNode<'float', number>
  readonly turbulence: UniformNode<'float', number>
  readonly billow: UniformNode<'float', number>
  readonly shading: UniformNode<'float', number>
  readonly depthFog: UniformNode<'float', number>
  readonly turbulenceSpeed: UniformNode<'float', number>
  readonly draftStrength: UniformNode<'float', number>
  readonly particleSize: UniformNode<'float', number>
  readonly sizeVariation: UniformNode<'float', number>
  readonly particleGrowth: UniformNode<'float', number>
  readonly particleOpacity: UniformNode<'float', number>
  readonly particleSoftness: UniformNode<'float', number>
  readonly lifetimeVariation: UniformNode<'float', number>
  readonly sparkAmount: UniformNode<'float', number>
  readonly tint: UniformNode<'float', number>
  readonly wisps: UniformNode<'float', number>
  readonly draftOn: UniformNode<'float', number>
  readonly reduced: UniformNode<'float', number>
  readonly draft: UniformNode<'vec2', THREE.Vector2>
  readonly grain: UniformNode<'vec2', THREE.Vector2>
  readonly pitchUv: UniformNode<'vec2', THREE.Vector2>
  readonly smoke: UniformNode<'color', THREE.Color>
  readonly ember: UniformNode<'color', THREE.Color>
  readonly paper: UniformNode<'color', THREE.Color>
  readonly embers: UniformNode<'float', number>
}

export function createPlumeValues(grid: PlumeGrid): PlumeValues {
  return {
    time: uniform(0),
    duration: uniform(plumeTuning.durationMs / 1000),
    stagger: uniform(plumeTuning.staggerMs / 1000),
    rise: uniform(plumeTuning.rise),
    spread: uniform(plumeTuning.spread),
    depth: uniform(plumeTuning.depth),
    turbulence: uniform(plumeTuning.turbulence),
    billow: uniform(plumeTuning.billow),
    shading: uniform(plumeTuning.shading),
    depthFog: uniform(plumeTuning.depthFog),
    turbulenceSpeed: uniform(plumeTuning.turbulenceSpeed),
    draftStrength: uniform(plumeTuning.draftStrength),
    particleSize: uniform(plumeTuning.particleSize),
    sizeVariation: uniform(plumeTuning.sizeVariation),
    particleGrowth: uniform(plumeTuning.particleGrowth),
    particleOpacity: uniform(plumeTuning.particleOpacity),
    particleSoftness: uniform(plumeTuning.particleSoftness),
    lifetimeVariation: uniform(plumeTuning.lifetimeVariation),
    sparkAmount: uniform(plumeTuning.sparkAmount),
    tint: uniform(plumeTuning.tint),
    wisps: uniform(1),
    draftOn: uniform(1),
    reduced: uniform(0),
    draft: uniform(new THREE.Vector2()),
    grain: uniform(new THREE.Vector2(grid.cellWidth, grid.cellHeight)),
    pitchUv: uniform(new THREE.Vector2(1 / grid.cols, 1 / grid.rows)),
    smoke: uniform(new THREE.Color(plumeTuning.particleColor)),
    ember: uniform(new THREE.Color(plumeTuning.sparkColor)),
    paper: uniform(new THREE.Color(plumeTuning.backgroundColor)),
    embers: uniform(1),
  }
}

// ── motion ──────────────────────────────────────────────────────────────

// Substeps of the particle's own age. Five is where the folded billow
// stopped changing shape between counts; more only costs transcendentals.
const STEPS = 5
// Eddy size in CSS px at 1x billow: 2*pi/0.0125 is about 500px across,
// so one line of type sits inside a single turn of the field.
const EDDY = 0.0125

// The analytic curl of a sine vector potential. Divergence-free by
// construction, which is what keeps a word rising as one body instead of
// dispersing evenly. Frequency divides back out so both octaves arrive
// at the same amplitude, and each partial reuses the six phases below.
function curlField(p: Node<'vec3'>, t: Node<'float'>, f: Node<'float'>): Node<'vec3'> {
  const first = vec3(p.y.mul(f), p.z.mul(f).mul(1.10), p.x.mul(f).mul(0.90))
    .add(t.mul(vec3(0.90, 0.78, 1.22)))
  const second = vec3(p.z.mul(f).mul(0.80), p.x.mul(f).mul(0.70), p.y.mul(f).mul(1.20))
    .add(t.mul(vec3(0.62, 1.05, 0.71)))
  const sf = first.sin()
  const cf = first.cos()
  const ss = second.sin()
  const cs = second.cos()
  const dZdy = sf.z.negate().mul(ss.z).mul(1.20)
  const dYdz = cf.y.mul(cs.y).mul(1.10)
  const dXdz = sf.x.negate().mul(ss.x).mul(0.80)
  const dZdx = cf.z.mul(cs.z).mul(0.90)
  const dYdx = sf.y.negate().mul(ss.y).mul(0.70)
  const dXdy = cf.x.mul(cs.x)
  return vec3(dZdy.sub(dYdz), dXdz.sub(dZdx), dYdx.sub(dXdy))
}

// Buoyancy: the column accelerates out of the page, then eases as it
// cools. The quarter of linear travel keeps it from parking mid-flight.
function riseCurve(u: Node<'float'>): Node<'float'> {
  return float(0.75).mul(u.mul(u).mul(float(3).sub(u.mul(2)))).add(float(0.25).mul(u))
}

// ── light ───────────────────────────────────────────────────────────────

const LIGHT = vec2(-0.622, 0.783)

function hash21(p: Node<'vec2'>): Node<'float'> {
  const q0 = fract(vec3(p.x, p.y, p.x).mul(0.1031))
  const q = q0.add(dot(q0, q0.yzx.add(33.33)))
  return fract(q.x.add(q.y).mul(q.z))
}

function noise2(p: Node<'vec2'>): Node<'float'> {
  const cell = floor(p)
  const f0 = fract(p)
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)))
  const a = hash21(cell)
  const b = hash21(cell.add(vec2(1, 0)))
  const c = hash21(cell.add(vec2(0, 1)))
  const d = hash21(cell.add(vec2(1, 1)))
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y)
}

function fbm2(p: Node<'vec2'>): Node<'float'> {
  return noise2(p).mul(0.62).add(noise2(p.mul(2.31).add(7.3)).mul(0.38))
}

// SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
// published types leave the result untyped.
const encode = (rgb: Node<'vec3'>) => sRGBTransferOETF(rgb) as Node<'vec3'>

// ── material ────────────────────────────────────────────────────────────

export function createPlumeMaterial(map: THREE.Texture, v: PlumeValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const corner = attribute<'vec2'>('aCorner', 'vec2')
  const seed = attribute<'vec3'>('aSeed', 'vec3')
  const release = attribute<'float'>('aRelease', 'float')
  const position = positionGeometry

  const elapsed = v.time.sub(release)
  // Even the largest stagger must finish within the unit's lifetime.
  // Otherwise React stops requesting frames before the last grain fades.
  const duration = v.duration.max(0.001)
  const delay = seed.z.mul(v.stagger.min(duration.mul(0.85)))
  const span = duration.sub(delay).max(0.001).mul(mix(float(1).sub(v.lifetimeVariation), 1, seed.y))
  const age = clamp(elapsed.sub(delay).div(span), 0, 1)

  const moved = Fn(() => {
    const eased = float(1).sub(pow(float(1).sub(age), 2))
    const lift = v.rise.mul(riseCurve(age)).mul(mix(0.68, 1.32, seed.y))
    const reach = v.spread.mul(v.turbulence).mul(mix(0.75, 1.25, seed.x))
    const draft = v.draft.mul(v.draftOn).mul(v.draftStrength).mul(riseCurve(age)).mul(vec2(0.42, 0.06))

    // Forward Euler along the grain's own path: sampling the field where the
    // grain has already arrived is what folds the sheet instead of pushing
    // every grain the same way. Fixed step count keeps cost bounded and the
    // result a pure function of age.
    const flow = vec3(0).toVar()
    const walk = vec3(position).toVar()
    const du = age.div(STEPS)
    Loop(STEPS, ({ i }) => {
      const u = float(i).add(0.5).mul(du)
      // Displacement grows as age^0.6; this weight is that curve's slope,
      // so the cloud opens quickly and then coasts.
      const slow = float(0.6).div(pow(u.max(0.03), 0.4))
      const air = u.mul(span).mul(v.turbulenceSpeed)
      // The small octave arrives late, which is what tears the coherent
      // body into wisps rather than starting the life already shredded.
      const field = curlField(walk, air, v.billow.mul(EDDY)).add(
        curlField(walk.add(41.7), air.mul(1.63), v.billow.mul(EDDY * 2.7))
          .mul(float(0.6).mul(smoothstep(0.05, 0.7, u))),
      )
      flow.addAssign(field.mul(slow).mul(du))
      walk.assign(position.add(flow.mul(reach)).add(vec3(0, v.rise.mul(riseCurve(u)), 0)))
    })

    const xy = position.xy
      .add(flow.xy.mul(reach).add(vec2(0, lift)).mul(v.wisps).add(draft))
      // Grain-scale jitter under the shared field: without it a 3px grid
      // stays legible as a grid inside the billow.
      .add(seed.xy.sub(0.5).mul(eased).mul(5).mul(v.wisps))
      // With updraft off, only local drift and pointer wind remain. Reduced
      // motion removes all travel and leaves only the fragment dissolve.
      .add(seed.xy.sub(0.5).mul(eased).mul(18).mul(float(1).sub(v.wisps)))
    const z = position.z.add(flow.z.mul(v.depth).mul(v.wisps))
    return mix(vec3(xy, z), position, v.reduced)
  })()

  // The captured footprint is exact at rest. Once released, equal X/Y
  // dimensions make every sprite round at any camera depth or flow angle.
  const released = smoothstep(0.012, 0.16, age)
  const diameter = v.particleSize
    .mul(mix(float(1).sub(v.sizeVariation), float(1).add(v.sizeVariation), seed.z))
    .mul(mix(1, v.particleGrowth, smoothstep(0, 0.5, age)))
    // Smoke keeps expanding as it thins. The former late shrink snapped
    // every puff back to a dot just before it faded.
    .mul(float(1).add(float(0.6).mul(age)))
  const offset = corner.mul(mix(v.grain, vec2(diameter), released.mul(float(1).sub(v.reduced))))
  // Billboarded in view space, so the offset is added after modelView.
  const mv = modelViewMatrix.mul(vec4(moved, 1))
  material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.z, mv.w))

  const vUv = varying(attribute<'vec2'>('aUv', 'vec2'))
  const vQuad = varying(corner)
  const vSeed = varying(seed)
  const vAge = varying(age)
  const vElapsed = varying(elapsed)
  const vDepthCue = varying(moved.z.div(v.depth.max(1)))
  const mapNode = texture(map)

  material.outputNode = Fn(() => {
    const fullUv = vUv.add(vQuad.mul(v.pitchUv))
    // Full footprint at home reconstructs the source. Once loose, one sample
    // becomes one puff. Reduced motion keeps the full glyph footprint.
    const point = smoothstep(0.025, 0.12, vAge).mul(float(1).sub(v.reduced))
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const c = mapNode.sample(mix(fullUv, vUv, point)) as Node<'vec4'>
    Discard(c.a.lessThan(0.012))

    // Everything below works in straight colour and re-associates once, at
    // the end. Shading a premultiplied value is what used to lift a
    // thin-edge grain's channels above its own alpha.
    const base = encode(c.rgb.div(c.a.max(1e-4))).toVar()
    const smokeColor = encode(v.smoke.rgb)
    const emberColor = encode(v.ember.rgb)
    const paperColor = encode(v.paper.rgb)

    // Every per-puff treatment is gated by this: at rest each quad still
    // holds a 3px slice of a glyph, and shading those slices would tile a
    // gradient across intact type.
    const loose = smoothstep(0.02, 0.18, vAge).mul(float(1).sub(v.reduced))
    const far = clamp(vDepthCue.negate(), 0, 1).mul(v.depthFog)

    const grain = vQuad.mul(3.6).mul(v.billow).add(vSeed.xy.mul(31.7)).add(vAge.mul(0.55))
    const density = fbm2(grain)
    const slope = vec2(fbm2(grain.add(vec2(0.45, 0))), fbm2(grain.add(vec2(0, 0.45)))).sub(density)
    // A dome term gives the whole puff a lit and a shaded side; the noise
    // gradient adds the curdled relief inside it.
    const form = clamp(dot(LIGHT, vQuad).mul(1.9).sub(dot(LIGHT, slope).mul(5)), -1, 1)
    const contrast = v.shading.mul(loose).mul(mix(1, 0.4, far))
    base.assign(mix(base, smokeColor, v.tint))
    base.assign(mix(base, vec3(1), form.max(0).mul(contrast).mul(0.72)))
    base.assign(mix(base, vec3(0), form.negate().max(0).mul(contrast).mul(0.5)))
    base.assign(mix(base, paperColor, far.mul(loose).mul(0.75)))

    const disc = float(1).sub(smoothstep(float(0.5).mul(float(1).sub(v.particleSoftness)), 0.5, length(vQuad)))
    const puff = disc.mul(float(0.55).add(float(0.45).mul(density)))
    const shape = mix(1, puff, loose)
    const handoff = smoothstep(0, mix(0.12, 0.055, v.reduced), vElapsed)
    const fade = float(1).sub(smoothstep(0.24, 1, vAge))

    // A few independent grains catch warm light as they enter the cloud.
    const emberStart = float(1).sub(v.sparkAmount.max(0.0001))
    const emberEnd = emberStart.add(0.06).min(1)
    const emberSeed = smoothstep(emberStart, emberEnd, vSeed.x).mul(step(0.0001, v.sparkAmount))
    const emberLife = smoothstep(0.02, 0.16, vAge).mul(float(1).sub(smoothstep(0.42, 0.78, vAge)))
    base.assign(mix(base, emberColor, emberSeed.mul(emberLife).mul(v.embers).mul(0.95)))

    const opacity = v.particleOpacity.mul(mix(0.83, 1.17, vSeed.y)).min(1)
    const body = mix(1, opacity, smoothstep(0.018, 0.28, vAge))
    const alpha = c.a.mul(shape).mul(handoff).mul(fade).mul(body).mul(mix(1, 0.55, far.mul(loose)))
    return encodedOutput(vec4(clamp(base, 0, 1).mul(alpha), alpha))
  })()

  // Browser probes read the live uniform values and the sampled capture here.
  material.userData.plumeValues = v
  material.userData.plumeMap = map

  return material
}
