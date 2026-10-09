// The candidates' node materials — six deformations of one captured page.
//
// Every material here samples a DOM capture, so every one of them obeys the
// same rules and states them once:
//
//   PREMULTIPLIED (decisions.md #5). The texture arrives with rgb already
//   scaled by alpha. Adding light is therefore `c.rgb += k * c.a` — an
//   unscaled add lights the transparent margin around a control's corner
//   and draws a square halo where the radius mask just cut one. Fading is
//   `c *= f` on the whole vec4, not on alpha alone.
//
//   THE SILHOUETTE IS THE CONTROL'S, NOT THE EFFECT'S. Anything that
//   displaces geometry is masked to zero at the quad's border. A button
//   whose outline moves stops reading as that button, and every one of
//   these effects is supposed to be something happening TO a component,
//   not instead of it.
//
//   NO pow() BASE TOUCHES 0.0. The GLSL spec defines pow(0, y>0) as 0,
//   but ANGLE compiles pow to exp2(y * log2(x)) and log2(0) delivers NaN,
//   which a premultiplied fragment writes to the framebuffer as solid
//   black. Found 2026-08-20 on a glass strip whose interior plateau put
//   an exactly-0.0 base into pow: it drew an opaque black bar across
//   itself while its rim stayed clean, because only the rim's base was
//   nonzero. Every pow base here is clamped to at least 1e-4.
//
//   THE OUTPUT LANDS AS THE GLSL'S gl_FragColor DID. SurfaceCanvas converts
//   each fragment's output to the canvas's sRGB by unpremultiplying,
//   encoding and premultiplying; WebGL encoded the premultiplied color
//   directly (surfaceOutput.ts has the measurement). The Surface texture is
//   SRGBColorSpace, so a sample is linear, and the shaders ended in
//   `#include <colorspace_fragment>` (without it the candidates' #f2f0e4
//   panel measured 226,222,198 in Chrome on 2026-08-20). Those materials
//   return `premultipliedOutput(c)`. The ones that scaled a fade AFTER the
//   include (premultiplied rgb pushed through the transfer curve at
//   fractional alpha comes out lifted, and the closing coil flashed white)
//   build that canvas-space vec4 and return `encodedOutput(...)`.
//
// The corner mask is applied inside each material rather than inherited: a
// custom material is the one thing Munari cannot cut corners for, because
// only the material knows its own varyings and alpha mode.
//
// Ownership: this module owns the shading and the uniform nodes it reads.
// The Candidate*.tsx files own the geometry, the clocks, and every write to
// those nodes.

import * as THREE from 'three'
import {
  MeshBasicNodeMaterial,
  type Node,
  type TextureNode,
  type UniformArrayNode,
  type UniformNode,
} from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  attribute,
  cameraProjectionMatrix,
  clamp,
  cos,
  cross,
  distance,
  dot,
  exp,
  float,
  floor,
  fract,
  frontFacing,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  normalViewGeometry,
  normalize,
  pow,
  positionGeometry,
  positionLocal,
  sRGBTransferOETF,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput, premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'
import { analyzeTuning, copyTuning, deleteTuning, dissolveTuning, rippleTuning } from './candidateTuning'

/** Light direction shared by every candidate, so one hand lit them all. */
export const LIGHT: readonly [number, number, number] = [-0.34, 0.52, 0.78]

const LIGHT_DIR = vec3(LIGHT[0], LIGHT[1], LIGHT[2]).normalize()

const PI = Math.PI

/** The lab's paper stock, for the back of a rolled sheet. */
const PAPER = uniform(new THREE.Color('#e6e3d4'))

function candidateMaterial(options: { depthWrite?: boolean; side?: THREE.Side } = {}): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: options.depthWrite ?? false,
    toneMapped: false,
    side: options.side ?? THREE.FrontSide,
  })
}

// SAFETY: a texture sample is a vec4; Three's types return a bare Node.
const sampleAt = (map: TextureNode, at: Node<'vec2'>) => map.sample(at) as Node<'vec4'>

// A fade the GLSL applied after its own sRGB encode, so it scales the
// canvas-space vec4 rather than the linear one.
function fadedAfterEncode(color: Node<'vec4'>, fade: Node<'float'>): Node<'vec4'> {
  // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const encoded = sRGBTransferOETF(color.rgb) as Node<'vec3'>
  return encodedOutput(vec4(encoded, color.a).mul(fade))
}

function hash11(x: Node<'float'>): Node<'float'> {
  const p = fract(x.mul(0.1031))
  const q = p.mul(p.add(33.33))
  return fract(q.mul(q.add(q)))
}

// ── 1. ripple ────────────────────────────────────────────────────────────
//
// The control is a sticker pinned under the finger. The press holds the
// point of contact to the page; everything AWAY from the finger lifts and
// flaps like a flag, waves radiating outward from the press, then settles
// flat. Three consequences carry the whole read:
//
//   THE SILHOUETTE MOVES. The wave is real displacement, big enough to
//   bend the control's own edge. The first version kept the outline still
//   and shaded an interior ring, which is the CSS ripple with extra steps.
//
//   THE RISE IS REAL DEPTH. One world unit is one CSS pixel, so the far
//   corners coming 56px off the page is 5% of honest perspective gain —
//   the control grows and leans, which no transform: scale() reproduces.
//
//   THE LIGHT IS BALANCED. Shading is the surface normal against the
//   shared light, MINUS the flat surface's own response, so a flat region
//   shades to exactly zero. The first version summed slope magnitudes,
//   which biased negative and darkened the whole control to its clamp.
//
//   PRESSES ADD. Each press is its own wave with its own clock, and the
//   field is their sum — a second click mid-flight raises a second ring
//   through the first instead of restarting it. Every wave ends through
//   the settle window: past `settle` its envelope tapers to zero height
//   AND zero velocity, so the sheet is flat and still before the DOM
//   takes the pixels back. The first version landed at sin's full exit
//   slope, and the swap read as a stop rather than a settle.

/** Concurrent press waves a ripple field carries; excess presses recycle
 *  the oldest slot. */
export const RIPPLE_MAX_WAVES = 6

/**
 * The wave field's inputs. The control and its shadow each own one, and the
 * frame loop writes both, so the two stay in step only as long as it does.
 */
export interface RippleField {
  readonly size: UniformNode<'vec2', THREE.Vector2>
  /** The wave slots, written in place; the field reads the first `count`. */
  readonly origins: THREE.Vector2[]
  readonly times: number[]
  readonly originNode: UniformArrayNode<'vec2'>
  readonly timeNode: UniformArrayNode<'float'>
  readonly count: UniformNode<'float', number>
  readonly lift: UniformNode<'float', number>
  readonly bend: UniformNode<'float', number>
  readonly waveLen: UniformNode<'float', number>
  readonly flap: UniformNode<'float', number>
  readonly settle: UniformNode<'float', number>
  readonly tail: UniformNode<'float', number>
}

function createRippleField(): RippleField {
  const origins = Array.from({ length: RIPPLE_MAX_WAVES }, () => new THREE.Vector2())
  const times = new Array<number>(RIPPLE_MAX_WAVES).fill(1)
  return {
    size: uniform(new THREE.Vector2(1, 1)),
    origins,
    times,
    originNode: uniformArray(origins, 'vec2'),
    timeNode: uniformArray(times, 'float'),
    count: uniform(0),
    lift: uniform(rippleTuning.lift),
    bend: uniform(rippleTuning.bend),
    waveLen: uniform(60),
    flap: uniform(rippleTuning.flapCycles * 2 * PI),
    settle: uniform(rippleTuning.settle),
    tail: uniform(rippleTuning.tail),
  }
}

// The wave field, shared verbatim by the control's vertex stage and the
// shadow's — the shadow is believable exactly as long as the two agree on
// where the surface is. Returns (height, in-plane slope gradient) of the
// summed field at content point p (content y runs down).
function rippleField(p: Node<'vec2'>, field: RippleField): Node<'vec3'> {
  return Fn(() => {
    const z = float(0).toVar()
    const grad = vec2(0).toVar()
    const span = max(length(field.size).mul(0.5), 1).toVar()
    for (let i = 0; i < RIPPLE_MAX_WAVES; i++) {
      If(field.count.greaterThan(i), () => {
        const origin = field.originNode.element(i)
        const t = clamp(field.timeNode.element(i), 1e-4, 1).toVar()
        const d = distance(p, origin).toVar()
        const far = clamp(d.div(span), 0, 1).toVar()

        // Up fast — the 0.7 power puts the peak around a third of the run,
        // where a finger's own press peaks — then out through the settle
        // window, value and velocity both zero at t = 1.
        const env = sin(pow(t, 0.7).mul(PI)).mul(float(1).sub(smoothstep(field.settle, 1, t))).toVar()

        // Pinned at the finger: both terms carry the far-field weight, so
        // the pressed point never moves and the free corners do the flapping.
        const rise = field.lift.mul(pow(max(far, 1e-4), 1.4))

        // The wave travels. xi is the retarded phase in cycles — how many
        // wavelengths have swept past this point; negative means the front
        // has not arrived and the sheet is still flat there. Without the
        // front the sinusoid is a standing pattern the whole sheet wears
        // from the first frame (seen 2026-08-20: rings spanning the surface
        // within two frames of the click). The lead-in keeps the front C1
        // so the light shows no crease at the leading ring; the decay calms
        // the train so one ring leads and a couple follow.
        const xi = field.flap.mul(t).div(2 * PI).sub(d.div(field.waveLen)).toVar()
        const lead = smoothstep(0, 0.35, xi).toVar()
        const decay = exp(max(xi, 0).negate().div(field.tail)).toVar()
        const phase = xi.mul(2 * PI).toVar()
        const wave = xi.lessThanEqual(0).select(float(0), sin(phase).mul(decay).mul(lead))
        z.addAssign(env.mul(rise.add(field.bend.mul(wave).mul(far))))

        // dz/dd, analytically (dxi/dd = -1/waveLen). The far-field ramp of
        // the wave term contributes an order less than the wave itself and
        // is dropped.
        const ls = clamp(xi.div(0.35), 0, 1)
        const dLead = ls.mul(float(1).sub(ls)).mul(6).div(0.35)
        const dWave = xi.greaterThan(0).select(
          cos(phase).mul(2 * PI).mul(lead).add(sin(phase).mul(dLead.sub(lead.div(field.tail)))).mul(decay),
          float(0),
        )
        const slope = env.mul(
          field.lift
            .mul(1.4)
            .mul(pow(max(far, 1e-3), 0.4))
            .div(span)
            .sub(field.bend.mul(dWave).mul(far).div(field.waveLen)),
        )
        const dir = d.greaterThan(1e-3).select(p.sub(origin).div(d), vec2(0))
        grad.addAssign(dir.mul(slope))
      })
    }
    return vec3(z, grad.x, grad.y)
  })()
}

// uv.y runs bottom → top; the click arrives in content coordinates, which
// run top → bottom.
function contentPoint(at: Node<'vec2'>, size: Node<'vec2'>): Node<'vec2'> {
  return vec2(at.x.mul(size.x), float(1).sub(at.y).mul(size.y))
}

export interface RippleValues extends RippleField {
  // Gain on the balanced lambert term. The wave's steepest face is
  // ~25° off flat here; 0.9 puts its highlight around +0.35 on a white
  // control, which is visible without bleaching the label.
  readonly shadeGain: UniformNode<'float', number>
}

export function createRippleMaterial(surface: SurfaceNodes) {
  const values: RippleValues = { ...createRippleField(), shadeGain: uniform(rippleTuning.shadeGain) }
  const material = candidateMaterial()
  const at = uv()
  const field = rippleField(contentPoint(at, values.size), values).toVar()
  material.positionNode = positionLocal.add(vec3(0, 0, field.x))
  // Content y runs down; the world's runs up. Flip so the shared light
  // means the same thing here as everywhere else.
  const normal = varying(vec3(field.y.negate(), field.z, 1).normalize())
  material.outputNode = Fn(() => {
    const c = sampleAt(surface.map, at).toVar()
    const n = normalize(normal)
    // Relative to flat: a face turned toward the light brightens, turned
    // away darkens, and an undisplaced pixel is untouched — which is what
    // keeps the control its own colour for the whole press.
    const facing = dot(n, LIGHT_DIR).toVar()
    const lit = facing.sub(LIGHT_DIR.z).mul(values.shadeGain)
    const spec = pow(max(facing, 1e-4), 34).sub(pow(max(LIGHT_DIR.z, 1e-4), 34))
    const rgb = c.rgb.add(clamp(lit.add(spec.mul(0.5)), -0.35, 0.6).mul(c.a))
    return premultipliedOutput(vec4(rgb, c.a).mul(surface.radiusMask()))
  })()
  return { material, values }
}

export interface RippleShadowValues extends RippleField {
  readonly shadowAlpha: UniformNode<'float', number>
  readonly shadowSoft: UniformNode<'float', number>
}

// The shadow is the same grid, relit as its own projection: each vertex
// slides along the light onto the page plane, so the dark shape IS the
// deformed sheet's outline — it spreads where the sheet lifts, keeps the
// pinned point dark and tight, and vanishes with the settle window because
// its height does. No blur pass: the penumbra is the edge feather widening
// with the caster's height.
export function createRippleShadowMaterial() {
  const values: RippleShadowValues = {
    ...createRippleField(),
    shadowAlpha: uniform(rippleTuning.shadowAlpha),
    shadowSoft: uniform(rippleTuning.shadowSoft),
  }
  const material = candidateMaterial()
  const at = uv()
  const field = rippleField(contentPoint(at, values.size), values).toVar()
  const height = varying(field.x)
  // Project the lifted point along the light onto the page. The grid
  // stretches past the quad where the sheet rises, which is the whole
  // reason this is a mesh and not a repainted rectangle.
  const slide = LIGHT_DIR.xy.div(LIGHT_DIR.z).mul(field.x)
  material.positionNode = vec3(positionLocal.xy.sub(slide), 0)
  material.outputNode = Fn(() => {
    const k = clamp(max(height, 0).div(max(values.lift, 1)), 0, 1).toVar()
    // Distance to the caster's own edge, in content px. Feather widens
    // with height: contact-tight where the sheet is pinned, penumbral
    // where it flies.
    const edge = min(
      min(at.x, float(1).sub(at.x)).mul(values.size.x),
      min(at.y, float(1).sub(at.y)).mul(values.size.y),
    )
    const feather = mix(1, max(values.shadowSoft, 1), k)
    const body = smoothstep(0, feather, edge)
    // Zero at contact — a landed sticker is page again, and pages do not
    // shadow themselves — rising fast, then thinning as the gap grows.
    const occ = clamp(k.mul(3), 0, 1).mul(float(1).sub(k.mul(0.45)))
    return premultipliedOutput(vec4(0, 0, 0, values.shadowAlpha.mul(body).mul(occ)))
  })()
  return { material, values }
}

// ── 3 & 7b. the rolled sheet ─────────────────────────────────────────────
//
// Shared by the dropdown that unrolls and the peel-away delete. The winding
// happens on the CPU (candidateCurlLaw.ts) rather than here, for the reason
// the fisheye scene is named after: three raycasts CPU geometry, so a
// vertex-shader-only warp bends the pixels and leaves the hit test on the
// flat sheet — a menu row that responds where it USED to be. Vertices move,
// normals come with them, and the material only lights what it is given.

export interface SheetValues {
  readonly shade: UniformNode<'float', number>
  /** The tuck fade. A caller that animates it passes its own node. */
  readonly opacity: UniformNode<'float', number>
}

export function createSheetMaterial(
  surface: SurfaceNodes,
  shade: number,
  opacity: UniformNode<'float', number> = uniform(1),
) {
  const values: SheetValues = { shade: uniform(shade), opacity }
  // Depth is the only occlusion between the turns of the roll: the sheet
  // overlaps itself three layers deep when wound (the peel's ~7 plies blend
  // into one grey brick), and without the depth buffer every wound row's
  // text blends into one garble on the coil's face (2026-08-20). The cost is
  // the usual transparent-writer artifact, confined to the corner-radius
  // pixels.
  const material = candidateMaterial({ depthWrite: true, side: THREE.DoubleSide })
  const at = uv()
  material.outputNode = Fn(() => {
    const facing = normalize(normalViewGeometry)
    const n = frontFacing.select(facing, facing.negate()).toVar()
    const lambert = max(dot(n, LIGHT_DIR), 0)
    const shade = mix(float(1).sub(values.shade), 1, lambert).toVar()
    // Sampled for both faces: a texture sample under the non-uniform
    // front-facing branch is not valid in WGSL.
    const c = sampleAt(surface.map, at).toVar()
    // A specular streak along the roll: the only cue that separates a
    // cylinder from a gradient.
    const spec = pow(max(dot(n, LIGHT_DIR), 1e-4), 24)
    const front = vec4(c.rgb.mul(shade).add(spec.mul(0.3).mul(c.a)), c.a).mul(surface.radiusMask())
    // The far side of a roll is the back of the sheet. Showing the
    // capture there would mirror the menu's own text onto the underside,
    // which is the single loudest way to say "this is a texture on a
    // cylinder" instead of "this is paper".
    const back = vec4(PAPER.mul(shade), 1)
    // The tuck fade scales AFTER the encode, so the closing coil fades
    // behind the trigger instead of flashing white.
    return fadedAfterEncode(frontFacing.select(front, back), values.opacity)
  })()
  return { material, values }
}

// ── 4. the pixel cloud ───────────────────────────────────────────────────
//
// One quad per texel-block of the capture, flown along a bowed path with a
// per-particle phase offset. Two clouds run at once — one leaving the tile
// it came from, one arriving at the tile it becomes — because a material
// can only reach the texture of the Surface it belongs to, so the crossing
// is staged as two presenters overlapping in the middle rather than one
// cloud that changes its mind.
//
// THE GRAIN RESOLVES. At rest a grain is not a block of one colour: its
// quad interpolates uv across its own footprint, so the field of grains
// reconstructs the capture exactly, texel for texel. In flight the spread
// collapses to a point sample and the grain is a chunky mote. Easing that
// spread back in as a grain lands is what dissolves "pixels" into the
// full-resolution element with no step anywhere — the pop this replaces
// was the landed cloud being a 1.7px mosaic that then swapped for the
// real thing.

export interface CloudValues {
  readonly t: UniformNode<'float', number>
  readonly travel: UniformNode<'vec3', THREE.Vector3>
  readonly swirl: UniformNode<'float', number>
  readonly bulge: UniformNode<'float', number>
  readonly twist: UniformNode<'float', number>
  readonly stagger: UniformNode<'float', number>
  readonly reverse: UniformNode<'float', number>
  readonly fade: UniformNode<'float', number>
  readonly spark: UniformNode<'float', number>
  readonly flare: UniformNode<'color', THREE.Color>
  readonly flareGain: UniformNode<'float', number>
}

/**
 * @param grain One texel-block in px: the grains are square at rest, so at
 *   this size they tile the capture with no gap.
 * @param pitchUv The grain's footprint in uv, for the landing resolve.
 */
export function createCloudMaterial(surface: SurfaceNodes, grain: number, pitchUv: THREE.Vector2) {
  const values: CloudValues = {
    t: uniform(0),
    travel: uniform(new THREE.Vector3()),
    // Lateral wander. At 34px the cloud is visibly a cloud without any
    // grain travelling far enough to be read as a separate object.
    swirl: uniform(dissolveTuning.swirl),
    bulge: uniform(dissolveTuning.bulge),
    twist: uniform(dissolveTuning.twist),
    // Fraction of the flight spent handing out start times. Without the
    // stagger every grain arrives on the same frame and the landing is a
    // shutter rather than a settling.
    stagger: uniform(dissolveTuning.stagger),
    reverse: uniform(0),
    fade: uniform(1),
    // Near zero. The figures are mostly pale field, and at the old 0.22
    // the two overlapping clouds saturated to a white blob mid-crossing
    // (2026-08-20) — the flare colour, not added light, carries the
    // flight now.
    spark: uniform(dissolveTuning.spark),
    flare: uniform(new THREE.Color()),
    // How far toward the other figure's colour a grain gets at the top of
    // its arc. High on purpose: the tiles carry almost no ink, so the
    // flare hue is the only thing that keeps the mid-crossing cloud from
    // reading as white. The outline still survives — 0.85 leaves 15% of
    // the grain's own colour, and the stroke is 3px against a pale field.
    flareGain: uniform(dissolveTuning.flareGain),
  }
  const material = candidateMaterial({ side: THREE.DoubleSide })
  const corner = attribute<'vec2'>('aCorner', 'vec2')
  const seed = attribute<'vec3'>('aSeed', 'vec3')
  const grainUv = varying(attribute<'vec2'>('aUv', 'vec2'))
  const quad = varying(corner)

  const s = clamp(values.t.sub(seed.z.mul(values.stagger)).div(float(1).sub(values.stagger)), 0, 1)
  const e = s.mul(s).mul(float(3).sub(s.mul(2)))
  // Arriving clouds run the same path backwards, so both halves of the
  // crossing share one arc and meet travelling the same way.
  const phase = mix(e, float(1).sub(e), values.reverse).toVar()
  const arc = sin(phase.mul(PI)).toVar()
  const flown = mix(positionGeometry, positionGeometry.add(values.travel), phase)
  const ang = seed.x.mul(2 * PI).add(phase.mul(values.twist))
  const r = values.swirl.mul(arc).mul(seed.y.add(0.35))
  const p = flown.add(vec3(cos(ang).mul(r), sin(ang).mul(r), arc.mul(values.bulge).mul(seed.y.add(0.3))))

  // Billboarded in view space. Grains swell in the middle of the flight
  // so the cloud reads as a cloud rather than as a grid in transit, and
  // shrink back to exactly one texel-block at both ends.
  const mv = modelViewMatrix.mul(vec4(p, 1)).toVar()
  const swell = corner.mul(grain).mul(arc.mul(1.35).add(1))
  material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(swell), mv.z, mv.w))
  const reach = varying(arc)

  material.outputNode = Fn(() => {
    // The resolve, staged by how far this grain is from rest. In the air a
    // grain shows one sample of a COARSE mosaic cell — up to seven grains
    // share each cell, so what settles first is a field of big soft
    // pixels. As the arc falls the cell pitch shrinks to one grain, and only
    // at rest does the sharp term spread the sample across its own texel
    // footprint, at which point the field IS the capture and the DOM swap
    // at t = 1 has nothing left to reveal. 2026-08-20: the pitch was
    // missing from the material and silently zero, so no grain ever
    // resolved past one texel and the swap arrived as a pop.
    const pitch = vec2(pitchUv.x, pitchUv.y)
    const fullUv = grainUv.add(quad.mul(pitch))
    // The coarse pass is a BUMP, not a ramp: cells swell only while a
    // grain is just off rest, so the pixelation reads as an image-space
    // mosaic on the assembling figure. Mid-flight the bump is over and a
    // grain is back to its own texel — a ramp held the whole flight at
    // 7-grain cells, whose centres mostly miss the 3px stroke, and the
    // cloud stopped carrying the figure at all.
    const cells = smoothstep(0.015, 0.06, reach)
      .mul(5)
      .mul(float(1).sub(smoothstep(0.12, 0.38, reach)))
      .add(1)
    const cell = pitch.mul(cells)
    const mosaic = floor(fullUv.div(cell)).add(0.5).mul(cell)
    const clamped = clamp(mosaic, pitch.mul(0.5), vec2(1).sub(pitch.mul(0.5)))
    const sharp = float(1).sub(smoothstep(0, 0.03, reach))
    const c = sampleAt(surface.map, mix(clamped, fullUv, sharp)).toVar()
    Discard(c.a.lessThan(0.02))

    // Each cloud carries its colour toward the OTHER tile's as it crosses,
    // so where the two clouds hand over they are the same colour and the
    // seam has nothing to show. Premultiplied: the target colour is scaled
    // by the grain's own alpha.
    const carried = mix(c.rgb, values.flare.mul(c.a), reach.mul(values.flareGain))
    const rgb = carried.add(values.spark.mul(reach).mul(c.a))

    // Square while it is part of the element, round while it is a particle in
    // the air.
    const disc = float(1).sub(smoothstep(0.34, 0.5, length(quad)))
    const m = mix(1, disc, smoothstep(0, 0.18, reach))
    // The disc edge and the crossfade scale AFTER the encode — the
    // transfer curve lifts premultiplied rgb at fractional alpha, and with
    // the whole flight spent below full fade the lift stacked across
    // overlapping grains into a white-hot core (2026-08-20).
    return fadedAfterEncode(vec4(rgb, c.a), m.mul(values.fade))
  })()
  return { material, values }
}

// ── 5. the analyzed block ────────────────────────────────────────────────
//
// A thin sheet of glass laid over one block for as long as something is
// reading it. The dispersion is driven by the sheet's own curvature, so the
// colour appears where the glass bends and nowhere else — a flat pass over
// the whole block would be a filter, and a filter says nothing about which
// part is being read.
//
// TWO COLOURS, NOT SIX. The first version cycled a full spectrum along the
// block's width, which is the shape every "AI is thinking" widget on the
// web already has and reads as a loading bar rather than as glass. What
// replaced it is a duotone: the sheet leans one way and the glyph edges go
// cool, leans the other and they go warm, with the split driven by the
// same normal that drives the refraction. It also only happens under the
// read head, so the colour says WHERE the reader is rather than THAT
// something is running.

export interface PrismValues {
  readonly texel: UniformNode<'vec2', THREE.Vector2>
  readonly time: UniformNode<'float', number>
  readonly on: UniformNode<'float', number>
  readonly lift: UniformNode<'float', number>
  readonly wave: UniformNode<'float', number>
  readonly scan: UniformNode<'float', number>
  readonly scanWidth: UniformNode<'float', number>
  readonly disperse: UniformNode<'float', number>
  readonly prism: UniformNode<'float', number>
  readonly glow: UniformNode<'float', number>
  readonly edgeGain: UniformNode<'float', number>
  readonly backGain: UniformNode<'float', number>
}

// The two ends of the split. A cold blue and a soft amber, both well
// off saturation — a duotone at full chroma is a rainbow with two
// colours in it.
const COOL = uniform(new THREE.Color('#5fa8e8'))
const WARM = uniform(new THREE.Color('#e8a55f'))
// Warm, and about a fifth the strength of the specular. This is the
// "something is lit behind the page" term; past ~0.2 it stops being
// backlight and starts being a highlighter.
const BACKLIGHT = uniform(new THREE.Color('#ffcf8a'))

const luminance = (c: Node<'vec3'>) => dot(c, vec3(0.299, 0.587, 0.114))

export function createPrismMaterial(surface: SurfaceNodes) {
  const values: PrismValues = {
    texel: uniform(new THREE.Vector2(1 / 512, 1 / 512)),
    time: uniform(0),
    on: uniform(0),
    // 6px of lift. Enough that the shadowless sheet still reads as being
    // off the page through parallax alone when the reader scrolls.
    lift: uniform(analyzeTuning.lift),
    // 1.6px of ripple. The dispersion below is proportional to the
    // sheet's slope, so this number sets the rainbow's strength as much
    // as `prism` does — they are one knob wearing two names, and the
    // wave is the one to reach for first because it is also the shape.
    wave: uniform(analyzeTuning.wave),
    scan: uniform(1),
    scanWidth: uniform(analyzeTuning.scanWidth),
    disperse: uniform(analyzeTuning.disperse),
    // Raised, because the colour is now gated by the scan band and only
    // reaches full strength on the few glyph rows under it.
    prism: uniform(analyzeTuning.prism),
    glow: uniform(analyzeTuning.glow),
    edgeGain: uniform(analyzeTuning.edgeGain),
    backGain: uniform(analyzeTuning.backGain),
  }
  const material = candidateMaterial()
  const at = uv()

  const a = at.x.mul(6.2).add(values.time.mul(1.35)).toVar()
  const b = at.y.mul(4.1).sub(values.time.mul(1.05)).toVar()
  const w = sin(a).mul(cos(b))
  material.positionNode = positionLocal.add(vec3(0, 0, values.lift.add(values.wave.mul(w)).mul(values.on)))
  // Analytic normal of the same surface, in content px.
  const dx = vec3(1, 0, values.wave.mul(cos(a)).mul(cos(b)).mul(6.2).mul(values.on))
  const dy = vec3(0, 1, values.wave.mul(sin(a).negate()).mul(sin(b)).mul(4.1).mul(values.on))
  const normal = varying(normalize(cross(dx, dy)))

  material.outputNode = Fn(() => {
    const n = normalize(normal).toVar()
    const disp = n.xy.mul(values.disperse).mul(values.on)

    const c = sampleAt(surface.map, at).toVar()
    const red = sampleAt(surface.map, at.add(disp)).r
    const blue = sampleAt(surface.map, at.sub(disp)).b
    const split = vec3(mix(c.r, red, values.on), c.g, mix(c.b, blue, values.on))

    // Where the glyphs are, in gradient terms. The block's background is
    // opaque, so alpha says nothing here and luminance has to.
    const stepX = vec2(values.texel.x, 0)
    const stepY = vec2(0, values.texel.y)
    const gx = luminance(sampleAt(surface.map, at.add(stepX)).rgb).sub(
      luminance(sampleAt(surface.map, at.sub(stepX)).rgb),
    )
    const gy = luminance(sampleAt(surface.map, at.add(stepY)).rgb).sub(
      luminance(sampleAt(surface.map, at.sub(stepY)).rgb),
    )
    const edge = clamp(length(vec2(gx, gy)).mul(values.edgeGain), 0, 1)

    // The read head: a band that walks the block top to bottom.
    const band = at.y.sub(values.scan).div(values.scanWidth)
    const scan = exp(band.mul(band).negate()).toVar()

    // Which way the sheet is leaning decides which of the two colours the
    // glyph edge picks up. Multiplied by the scan so the colour is only
    // ever where the reader is.
    const duo = mix(COOL, WARM, clamp(n.x.mul(26).add(0.5), 0, 1))
    const prism = edge.mul(duo).mul(values.prism).mul(values.on).mul(scan).mul(c.a)

    // The backlight: warm, broad, and behind the read head rather than on
    // it. The 0.55 power is what spreads it past the band's own width —
    // a glow the same width as the scan looks like a scanner, and a glow
    // wider than it looks like something behind the page is lit.
    const backlight = BACKLIGHT.mul(pow(max(scan, 1e-4), 0.55))
      .mul(values.backGain)
      .add(scan.mul(values.glow))
      .mul(values.on)
      .mul(c.a)

    const spec = pow(max(dot(n, LIGHT_DIR), 1e-4), 30)
    const sheen = spec.mul(0.22).mul(values.on).mul(c.a)

    return premultipliedOutput(vec4(split.add(prism).add(backlight).add(sheen), c.a).mul(surface.radiusMask()))
  })()
  return { material, values }
}

// ── 6. the copy, drawn into the cursor ───────────────────────────────────
//
// The page keeps its code block: this is a Twin, and the thing that flies
// is a second presentation of the same content. That is the whole reason
// the gesture reads as COPY rather than as move — the original never left,
// and there was no moment when it was not there to be seen.

export interface SuckValues {
  readonly cursor: UniformNode<'vec2', THREE.Vector2>
  readonly t: UniformNode<'float', number>
  readonly span: UniformNode<'float', number>
  readonly twist: UniformNode<'float', number>
  readonly arc: UniformNode<'float', number>
  readonly lag: UniformNode<'float', number>
  readonly sway: UniformNode<'vec2', THREE.Vector2>
  readonly diffuse: UniformNode<'float', number>
  readonly specPow: UniformNode<'float', number>
  readonly specGain: UniformNode<'float', number>
}

export function createSuckMaterial(surface: SurfaceNodes) {
  const values: SuckValues = {
    cursor: uniform(new THREE.Vector2()),
    t: uniform(0),
    span: uniform(1),
    // A little over half a turn. Past ~4 radians the sheet passes edge-on
    // twice and flickers; below ~1.5 it reads as a slide, not a draw-in.
    twist: uniform(copyTuning.twist),
    // Peak height off the page, mid-flight. The sheet has to pass OVER
    // the block it came from, or the copy looks like it is being filed
    // behind the original rather than taken away from it.
    arc: uniform(copyTuning.arc),
    // Fraction of the flight spent handing out per-vertex start times by
    // distance from the cursor. This is the whole gesture: at 0 the block
    // scales toward a point, which is a transform, not a suction.
    lag: uniform(copyTuning.lag),
    sway: uniform(new THREE.Vector2()),
    diffuse: uniform(copyTuning.diffuse),
    specPow: uniform(copyTuning.specPow),
    specGain: uniform(copyTuning.specGain),
  }
  const material = candidateMaterial({ side: THREE.DoubleSide })
  const at = uv()
  const rel0 = positionGeometry.xy.sub(values.cursor)
  const dist = length(rel0).toVar()
  const reach = dist.div(max(values.span, 1e-4)).toVar()
  // The near corner goes first and the far corner trails. Without the
  // lag the block scales toward a point, which is a transform anyone can
  // write; with it the sheet is drawn in like cloth through a ring.
  const t = clamp(values.t.sub(values.lag.mul(reach)).div(float(1).sub(values.lag)), 0, 1).toVar()
  const e = t.mul(t).mul(float(3).sub(t.mul(2))).toVar()

  const ang = e.mul(values.twist).mul(float(1).sub(clamp(reach, 0, 1)))
  const ca = cos(ang)
  const sa = sin(ang)
  const rel = vec2(rel0.x.mul(ca).sub(rel0.y.mul(sa)), rel0.x.mul(sa).add(rel0.y.mul(ca))).toVar()

  // The normal includes radial shrink and sway, not just arc height.
  // Twist's radial derivative is parallel to the angular tangent and
  // cancels from their cross product; dir still needs the rotated basis.
  const easeSlope = t
    .mul(float(1).sub(t))
    .mul(6)
    .mul(values.lag)
    .div(max(values.span, 1e-4).mul(max(float(1).sub(values.lag), 1e-3)))
  const bowSlope = cos(e.mul(PI)).mul(PI).mul(easeSlope)
  const radialScale = float(1).sub(e).add(dist.mul(easeSlope))
  const dir = dist.greaterThan(1e-3).select(rel.div(dist), vec2(0))
  const deformed = vec3(
    values.arc.mul(bowSlope).mul(dir.x),
    values.arc.mul(bowSlope).mul(dir.y),
    radialScale.sub(bowSlope.mul(dot(values.sway, dir))),
  ).toVar()
  // Fully collapsed points have no tangent plane and must not emit NaN.
  const normal = varying(dot(deformed, deformed).greaterThan(1e-12).select(normalize(deformed), vec3(0, 0, 1)))

  // The bow: a per-run sideways drift, zero at both ends of the flight,
  // so the sheet still leaves the block and lands in the cursor — only
  // the road between them changes run to run.
  const bow = sin(e.mul(PI))
  material.positionNode = vec3(
    values.cursor.add(rel.mul(float(1).sub(e))).add(values.sway.mul(bow)),
    bow.mul(values.arc),
  )

  material.outputNode = Fn(() => {
    const c = sampleAt(surface.map, at).toVar()
    // Specular relative to flat, so an untipped pixel is untouched: the
    // sheet glints as it turns without ever changing its own colour. The
    // first version added a flat "heat" term instead, and the whole block
    // washed out on its way in.
    const n = normalize(normal)
    const facing = dot(n, LIGHT_DIR).toVar()
    // Two bounds, not one. The diffuse tip shading is capped at ±diffuse
    // (default 0.1), because the block is near-black and any broad
    // addition is a large relative shift — one shared 0.45 cap turned the
    // whole flying sheet mid-grey (2026-08-20). The glint is tight
    // (specPow, default 48) and strong: a narrow highlight can be bright
    // without changing the sheet's colour.
    const lit = clamp(facing.sub(LIGHT_DIR.z).mul(0.5), values.diffuse.negate(), values.diffuse)
    const spec = pow(max(facing, 1e-4), values.specPow).sub(pow(max(LIGHT_DIR.z, 1e-4), values.specPow))
    const rgb = c.rgb.add(lit.add(clamp(spec, 0, 1).mul(values.specGain)).mul(c.a))
    const exit = float(1).sub(smoothstep(0.72, 1, values.t))
    // The exit fade scales AFTER the encode, or the whole block whitens on
    // its way into the cursor (2026-08-20).
    return fadedAfterEncode(vec4(rgb, c.a).mul(surface.radiusMask()), exit)
  })()
  return { material, values }
}

// ── 7a. melt ─────────────────────────────────────────────────────────────
//
// The row goes liquid and runs off the bottom of the page as streams of
// ooze. Three constraints, learned in order:
//
//   BOUNDED SMEAR. The head leads the tail by a fixed slice of the
//   timeline, so the vertical stretch is the speed times that slice — a
//   couple of row heights at its worst — and both edges leave the screen.
//   The first version stretched the head by the whole exit distance and
//   the row became a page-tall blur ("gets way too large").
//
//   NOTHING FADES. The trailing tip of each stream tapers to a rounded
//   point, and everything else keeps its full body until it is past the
//   bottom of the viewport.
//
//   STREAMS SEPARATE, THEN COMBINE. Columns gather into a handful of
//   rivulets as they fall, and further down the rivulets merge pairwise —
//   which is the "separates and combines" a sheet of liquid actually does.

export interface MeltValues {
  readonly t: UniformNode<'float', number>
  readonly size: UniformNode<'vec2', THREE.Vector2>
  readonly exit: UniformNode<'float', number>
  readonly waver: UniformNode<'float', number>
  readonly streams: UniformNode<'float', number>
  readonly gather: UniformNode<'float', number>
}

export function createMeltMaterial(surface: SurfaceNodes) {
  const values: MeltValues = {
    t: uniform(0),
    size: uniform(new THREE.Vector2(1, 1)),
    exit: uniform(0),
    // Sideways travel of a rivulet as it snakes, in px. Above ~14 the
    // streams cross each other and the row reads as being shredded
    // rather than running.
    waver: uniform(deleteTuning.waver),
    // Rivulets across the row. Five over a 430px row puts a stream every
    // ~86px, which is wide enough that the gaps between them open before
    // the row is off the list — the moment the sheet stops being a sheet.
    streams: uniform(deleteTuning.streams),
    // How completely a column gives up its own x for its stream's. Full
    // gathering pulls the row into five hard threads and loses the ink;
    // 0.82 keeps enough spread that the glyphs stay in the liquid.
    gather: uniform(deleteTuning.gather),
  }
  const material = candidateMaterial()
  const at = uv()
  // uv.y = 1 is the content's top edge; the bottom leads the fall.
  const depth = float(1).sub(at.y)

  // The melting front is SMOOTH in x — value noise, ~90px wavelength.
  // The first pass staggered discrete 24px lanes, and adjacent lanes
  // letting go at different times cut the row into stepped plates
  // (2026-08-20, "looks really rough").
  const lx = at.x.mul(values.size.x).div(90).toVar()
  const lane = mix(
    hash11(floor(lx).mul(12.9898)),
    hash11(floor(lx).add(1).mul(12.9898)),
    smoothstep(0, 1, fract(lx)),
  )

  // First-stage stream, and the pair it merges into further down. The
  // index is clamped: the geometry's right-edge column has uv.x exactly
  // 1.0, and floor handed it a stream past the last one, whose centre
  // sat off the row's right edge — the whole edge cell smeared out over
  // the card's margin as it fell (2026-08-20). The pair divisor is
  // (n+1)/2, not n/2, for the same reason at the pair stage.
  const si = min(floor(at.x.mul(values.streams)), values.streams.sub(1)).toVar()
  const sh = hash11(si.mul(37.13).add(4.7))
  const streamX = si.add(0.25).add(sh.mul(0.5)).div(values.streams).mul(values.size.x)
  const pairX = floor(si.div(2)).add(0.5).div(values.streams.add(1).mul(0.5)).mul(values.size.x)

  // The head leads the tail by 0.07 of the timeline and the front's
  // waves add 0.22 more; both are folded into the normalization so the
  // LAST vertex still completes by t = 1 and the row is off screen.
  // The wave share is the larger term on purpose — at 0.1 the whole
  // row let go inside a tenth of the clock and fell as one sheet.
  const t = clamp(values.t.sub(lane.mul(0.22)).sub(float(1).sub(depth).mul(0.07)).div(0.71), 0, 1).toVar()
  // The square is gravity: slow enough to read at the top of the fall,
  // fast enough at the bottom to feel like the row let go.
  const fall = t.mul(t).mul(values.exit.add(values.size.y)).toVar()

  // Necking follows how far the material has RUN, not the clock: liquid
  // still in the list keeps the row's own x, and only the running
  // streams gather and merge. Gathering by time slid the whole row
  // sideways into plates while it was still on the page. One row height
  // of run is full necking — by the second row down, streams, not sheet.
  const neck = smoothstep(0, values.size.y.mul(1.2), fall).toVar()
  const run = neck.mul(values.gather).toVar()
  const merge = smoothstep(0.5, 0.95, t)
  const rowX = at.x.mul(values.size.x)
  const x = mix(rowX, mix(streamX, pairX, merge), run).add(sin(fall.mul(0.028).add(si.mul(7))).mul(values.waver).mul(run))
  material.positionNode = vec3(x.sub(values.size.x.mul(0.5)), positionLocal.y.sub(fall), positionLocal.z)

  // The material that sits across a stream boundary. Gathering alone
  // never separates the streams — the boundary quads just stretch and
  // smear across the gap, and the fall reads as one curtain. These
  // fragments thin away as the liquid necks, which is what opens the
  // daylight between rivulets.
  const f = fract(at.x.mul(values.streams))
  const gap = varying(float(1).sub(smoothstep(0, 0.3, min(f, float(1).sub(f)).mul(2))))
  const necking = varying(neck)
  const run01 = varying(t)

  material.outputNode = Fn(() => {
    const c = sampleAt(surface.map, at).toVar()
    // Only the last tenth of the material — the very top of the row —
    // tapers, so each stream ends in a rounded drip rather than a cut
    // edge. Everything below it keeps its full body all the way down.
    // Written as 1 - smoothstep(0.9, 1, y) because smoothstep with its
    // edges reversed is undefined in WGSL; the value is the same.
    const tip = float(1).sub(smoothstep(0.9, 1, at.y))
    // Liquid darkens as it draws out — enough that cream ooze still
    // reads against the cream card it is crossing.
    const rgb = c.rgb.mul(mix(1, 0.82, clamp(run01.mul(1.4), 0, 1)))
    // Both tapers scale AFTER the encode, or the drip tips whiten as they
    // taper (2026-08-20).
    return fadedAfterEncode(
      vec4(rgb, c.a).mul(surface.radiusMask()),
      mix(1, tip, smoothstep(0.15, 0.6, run01)).mul(float(1).sub(gap.mul(necking))),
    )
  })()
  return { material, values }
}

// ── 7c. shatter ──────────────────────────────────────────────────────────
//
// The row is rebuilt as loose quads before anything moves, each carrying
// its own center and its own seed, so the break is rigid-body rather than a
// warp. Shards near the button that was pressed leave first: the crack
// starts where the hand was, and for the two frames before they scatter
// there is a flash along the break.
//
// Like the melt, this does not fade — the shards fall past the bottom of
// the viewport and the row is gone because it went somewhere.

export interface ShatterValues {
  readonly t: UniformNode<'float', number>
  readonly origin: UniformNode<'vec2', THREE.Vector2>
  readonly span: UniformNode<'float', number>
  readonly spread: UniformNode<'float', number>
  readonly pop: UniformNode<'float', number>
  readonly spin: UniformNode<'float', number>
  readonly gravity: UniformNode<'float', number>
  readonly kick: UniformNode<'float', number>
}

export function createShatterMaterial(surface: SurfaceNodes) {
  const values: ShatterValues = {
    t: uniform(0),
    origin: uniform(new THREE.Vector2()),
    span: uniform(1),
    spread: uniform(deleteTuning.spread),
    // Toward the camera. Without it the break is flat and reads as a
    // sliding puzzle; with it the shards pass over the rows below and
    // the row is unmistakably in front of the list, not part of it.
    pop: uniform(deleteTuning.pop),
    spin: uniform(deleteTuning.spin),
    // Enough to carry the far shards past the bottom edge within the
    // effect's own duration, so nothing has to be faded away. Written
    // every render from the row's exit distance.
    gravity: uniform(0),
    // Radial, away from the press. This is what makes the break have a
    // direction — a row that bursts evenly reads as an explosion effect
    // rather than as something that was struck at a point.
    kick: uniform(deleteTuning.kick),
  }
  const material = candidateMaterial({ side: THREE.DoubleSide })
  const at = uv()
  const center = attribute<'vec3'>('aCenter', 'vec3')
  const seed = attribute<'vec4'>('aSeed', 'vec4')

  const near = clamp(distance(center.xy, values.origin).div(max(values.span, 1e-4)), 0, 1)
  // The crack runs outward from the press at about six row-widths per
  // second; 0.16 of the effect is how long it takes to reach the far end.
  const t = clamp(values.t.sub(near.mul(0.16)).div(0.84), 0, 1).toVar()
  const flash = varying(float(1).sub(smoothstep(0, 0.22, t)).mul(step(0.0001, t)))

  const rel = positionGeometry.sub(center)
  // Tumble about an axis of its own, not about z: a shard that only
  // spins in the page plane reads as a sticker being shuffled.
  const ang = seed.x.sub(0.5).mul(values.spin).mul(t)
  const ca = cos(ang)
  const sa = sin(ang)
  const spunX = rel.x.mul(ca).sub(rel.y.mul(sa))
  const spunY = rel.x.mul(sa).add(rel.y.mul(ca))
  const tilt = seed.z.sub(0.5).mul(values.spin).mul(0.7).mul(t)
  const spun = vec3(spunX, spunY.mul(cos(tilt)), spunY.mul(sin(tilt)))

  // The kick is radial from the press, so the break has a direction and
  // is not an even puff. The random spread is what stops it being a ring.
  const away = normalize(center.xy.sub(values.origin).add(vec2(1e-3)))
  const vel = vec3(
    away.x.mul(values.kick).add(seed.y.sub(0.5).mul(values.spread)),
    away.y
      .mul(values.kick)
      .mul(0.5)
      .add(seed.z.sub(0.5).mul(values.spread).mul(0.5))
      .add(values.kick.mul(0.35)),
    seed.w.mul(values.pop),
  )

  const p = center.add(spun).add(vel.mul(t))
  material.positionNode = vec3(p.x, p.y.sub(values.gravity.mul(t).mul(t)), p.z)

  material.outputNode = Fn(() => {
    const c = sampleAt(surface.map, at).toVar()
    // A shard that has tumbled past edge-on shows its back. Unlit rather
    // than mirrored, for the same reason the roll's underside is.
    const shown = frontFacing.select(c.rgb, c.rgb.mul(0.42))
    // The break itself. Premultiplied add, so it lights the shard and not
    // the transparent gap between shards.
    return premultipliedOutput(vec4(shown.add(flash.mul(0.5).mul(c.a)), c.a))
  })()
  return { material, values }
}
