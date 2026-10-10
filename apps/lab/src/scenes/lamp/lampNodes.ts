// Lamp light — one fragment shader multiplies the page by a single point
// light and the shadow only the headline's raised glyphs cast.
//
// The law: every value this shader writes is a calibrated multiplier meant
// to land on the composited paper exactly as authored, not artistic color
// to be mixed in linear light — so the light material returns its values
// through encodedOutput, which lands them on the canvas unchanged. The
// lantern's flame is written the same way; the lantern's metal and glass
// apply ACES themselves, because the renderer runs without tone mapping and
// the flame was never tone-mapped.
//
// Ownership: this module owns the light and shadow math, the material
// that carries it, the flame's material, and the lantern materials' tone
// mapping. Lamp.tsx owns the renderers, the lamp's position, and what the
// mask texture currently shows. lampLantern.ts owns the model and writes
// the flame's values. lampMask.ts owns the four ink channels this shader
// reads: sharp glyph coverage in red, progressively wider pre-blurred
// coverage in green/blue/alpha (see MASK_BLUR_RADII, imported below so the
// two files' blur levels can't drift apart). lampTuning.ts owns the
// reviewer-facing defaults for the uniforms below (round 6); Lamp.tsx reads
// the live tuning value and hands it to setLampTuningUniforms every frame,
// which is what keeps this shader's own light height agreeing with
// lampLantern.ts's flame instead of the two drifting apart the way two
// separately-hand-picked constants could.

import * as THREE from 'three'
import {
  MeshBasicNodeMaterial,
  type MeshPhysicalNodeMaterial,
  type Node,
  type TextureNode,
  type UniformNode,
} from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  distance,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  output,
  positionGeometry,
  pow,
  screenCoordinate,
  screenSize,
  sin,
  smoothstep,
  sRGBTransferOETF,
  texture,
  toneMapping,
  transpose,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'
import { MASK_BLUR_RADII } from './lampMask'
import type { LampTuning } from './lampTuning'

// ── page light ─────────────────────────────────────────────────────────

/** The light material and the values Lamp.tsx writes into it. */
export interface LampLight {
  readonly material: MeshBasicNodeMaterial
  readonly resolution: UniformNode<'vec2', THREE.Vector2>
  readonly lampPos: UniformNode<'vec2', THREE.Vector2>
  readonly basePos: UniformNode<'vec2', THREE.Vector2>
  readonly maskRect: UniformNode<'vec4', THREE.Vector4>
  readonly mask: TextureNode
  /** Bound in place of the headline mask while none exists. */
  readonly emptyMask: THREE.Texture
  readonly maskReady: UniformNode<'float', number>
  // The flame's own brightness wobble (lampLantern.ts's flickerIntensity),
  // compressed to a smaller amplitude here than in the 3D flame itself —
  // Lamp.tsx scales it before assignment so the light pool visibly breathes
  // but the body text underneath stays comfortably readable (round 4).
  readonly flicker: UniformNode<'float', number>
  // Round 6 tuning uniforms — lampTuning.ts owns the reviewer-facing default
  // for each (equal to the constant it replaced, so untouched sliders render
  // identically to round 5). lampHeight replaces the old interpolated
  // LAMP_HEIGHT const: Lamp.tsx sets it from the same tuning.lampHeight value
  // it hands lampLantern.ts's update(), so this shader's light height and the
  // rendered flame still can't disagree, just via a shared live value instead
  // of a shared compile-time constant.
  readonly lampHeight: UniformNode<'float', number>
  readonly penumbraGrowthScale: UniformNode<'float', number>
  readonly maxBlurLevel: UniformNode<'float', number>
  readonly opacityFalloffScale: UniformNode<'float', number>
  readonly shadowFloor: UniformNode<'float', number>
  readonly poolIntensity: UniformNode<'float', number>
  readonly poolWarmth: UniformNode<'float', number>
  readonly poolRadiusScale: UniformNode<'float', number>
  dispose(): void
}

// The glyphs' own standoff above the page, CSS pixels — shrinking a
// fragment toward the lamp by H / (H + h) finds where the glyph plane
// occludes the ray from lamp to that fragment, the way a taller gnomon
// throws a longer shadow. Not exposed as a tuning control (round 6 only
// asked for the lamp's own height, not each glyph's).
const GLYPH_HEIGHT = 26

const INNER_RADIUS = 180
const OUTER_RADIUS = 900
const AMBIENT = 0.42
const POOL_TINT = [1.0, 0.949, 0.863] as const
const AMBIENT_TINT = [0.875, 0.886, 0.933] as const
// Past this many pixels beyond the mask's own box, no shadow reaches — it
// fades out over the range instead of stopping dead at the rectangle.
const FADE_RANGE = 160

// The lantern's contact shadow — the multiply pass darkens the page under
// its own base, since darkening is this pass's job, not the lit 3D
// renderer's. Anchored on basePos (the drag anchor, where the base
// actually rests) rather than lampPos (the flame's projected position,
// offset from the base once the 3D camera's tilt is in play) — the
// footprint belongs under the object's feet, not under its light source.
// An ellipse rather than a circle: scaling y before measuring distance
// compresses the shadow vertically, reading as a footprint seen from above
// rather than a flat disc.
const CONTACT_RADIUS = 46
const CONTACT_ANISOTROPY = 1.8
const CONTACT_STRENGTH = 0.22

// Near field: a shadow falling only a few px from its own glyph used to
// still read almost sharp, so it looked like a second, lighter copy of the
// headline rather than a shadow (reported 2026-08-31). MIN_PENUMBRA keeps
// even a fresh shadow soft; the opacity ramp below keeps it faint until it
// has visibly separated from the letter that cast it.
const MIN_PENUMBRA = 6
const MAX_PENUMBRA = 46
// A real penumbra's width grows with throw at a rate set by the light's own
// apparent size over its height above the receiver (a bigger or lower light
// casts a faster-widening penumbra) — grounding the growth rate in
// FLAME_APPARENT_SIZE / lampHeight rather than a bare tuned number (round
// 5: "penumbra ∝ throw × flameSize / lampHeight"). FLAME_APPARENT_SIZE
// mirrors FLAME_QUAD_WIDTH in lampLantern.ts. penumbraGrowthScale is the
// one dimensionless knob actually being tuned (round 6 exposes it live);
// its shipped default (0.5) yields the same 0.25 rate this was at round 5,
// which was already verified to read as near-razor close in and soft at
// range.
const FLAME_APPARENT_SIZE = 22
// Shadow opacity ramps in over this much throw (near GLYPH_HEIGHT, so the
// fade-in finishes shortly after the shadow clears its own glyph), holds,
// then fades back out between FAR_FADE_START and FAR_FADE_END. NEAR_RAMP_END
// is a page-pixel separation from the glyph, not tied to LAMP_HEIGHT, so it
// doesn't move when the flame's height does. FAR_FADE_START/END are tied to
// how far a shadow travels for a given drag distance, which does move with
// LAMP_HEIGHT — dropping it from 230 to 110 (LANTERN_FLAME_HEIGHT) grows
// shadowLen for the same drag by (26/136)/(26/256) =~ 1.88x, so these are
// scaled by that factor to keep the same drag-distance feel rather than
// fading shadows out for drags that used to leave them comfortably visible
// (2026-09-01).
const NEAR_RAMP_END = 34
const FAR_FADE_START = 340
const FAR_FADE_END = 560
// Past MAX_PENUMBRA's own softness, the shadow's tail also loses opacity as
// it blurs, the way a real penumbra thins toward invisibility rather than
// staying fully dark while merely getting fuzzier — scaled by level (0..3)
// so the fade tracks the same continuous softness the channel mix below
// uses, not a separate distance threshold.
const LEVEL_OPACITY_FLOOR = 0.6

// The four pre-blurred ink channels (packed R/G/B/A, sharp through widest)
// are a standing blur pyramid baked once on the CPU — leaning on it for
// long throws is cheap high-quality penumbra compared to widening every
// tap's radius. These are lampMask.ts's own MASK_BLUR_RADII so the
// per-pixel level computed below always lands between the two channels its
// blur amount actually sits between.
const [BLUR_R0, BLUR_R1, BLUR_R2, BLUR_R3] = MASK_BLUR_RADII

// Maps the shader's own continuous penumbra (px) onto a continuous channel
// index 0..3 by finding which pair of baked blur radii it falls between —
// so the pre-baked blur and the per-pixel Poisson taps describe the same
// softness at every throw instead of the mask jumping between two fixed
// states (round 5).
function levelForPenumbra(px: Node<'float'>): Node<'float'> {
  const near = mix(float(0), float(1), clamp(px.sub(BLUR_R0).div(BLUR_R1 - BLUR_R0), 0, 1))
  const middle = mix(float(1), float(2), clamp(px.sub(BLUR_R1).div(BLUR_R2 - BLUR_R1), 0, 1))
  const far = mix(float(2), float(3), clamp(px.sub(BLUR_R2).div(BLUR_R3 - BLUR_R2), 0, 1))
  return px.lessThanEqual(BLUR_R1).select(near, px.lessThanEqual(BLUR_R2).select(middle, far))
}

// Mixes between the two packed channels adjacent to a continuous level.
function channelAt(ink: Node<'vec4'>, level: Node<'float'>): Node<'float'> {
  const lo = floor(level)
  const hi = min(lo.add(1), 3)
  const pick = (index: Node<'float'>): Node<'float'> =>
    index.lessThan(0.5).select(ink.r, index.lessThan(1.5).select(ink.g, index.lessThan(2.5).select(ink.b, ink.a)))
  return mix(pick(lo), pick(hi), level.sub(lo))
}

// Twelve Poisson-distributed offsets in the unit disc, not a regular ring:
// a symmetric ring pattern re-introduces the banded-copy look at certain
// radii the same way too few taps did (2026-08-31 capture). The center tap
// is weighted higher since it best represents the shadow's own axis.
const POISSON: readonly (readonly [number, number])[] = [
  [-0.326212, -0.405805],
  [-0.840144, -0.07358],
  [-0.695914, 0.457137],
  [-0.203345, 0.620716],
  [0.96234, -0.194983],
  [0.473434, -0.480026],
  [0.519456, 0.767022],
  [0.185461, -0.893124],
  [0.507431, 0.064425],
  [0.89642, 0.412458],
  [-0.32194, -0.932615],
  [-0.791559, -0.597705],
]
const CENTER_WEIGHT = 4
const RING_WEIGHT = 1
const TOTAL_WEIGHT = CENTER_WEIGHT + RING_WEIGHT * 12

function rectDistance(p: Node<'vec2'>, rect: Node<'vec4'>): Node<'float'> {
  const d = max(max(rect.xy.sub(p), p.sub(rect.xy.add(rect.zw))), vec2(0))
  return length(d)
}

export function createLampLightMaterial(): LampLight {
  // maskReady keeps this unread; it only gives the sampler a binding.
  const emptyMask = new THREE.Texture()
  const light = {
    resolution: uniform(new THREE.Vector2(1, 1)),
    lampPos: uniform(new THREE.Vector2(0, 0)),
    basePos: uniform(new THREE.Vector2(0, 0)),
    maskRect: uniform(new THREE.Vector4(0, 0, 1, 1)),
    mask: texture(emptyMask),
    maskReady: uniform(0),
    flicker: uniform(1),
    // Seeded with lampTuning.ts's own shipped defaults so a frame rendered
    // before Lamp.tsx's first setLampTuningUniforms call still matches
    // round 5's output rather than reading as untuned zeros.
    lampHeight: uniform(44),
    penumbraGrowthScale: uniform(0.5),
    maxBlurLevel: uniform(3),
    opacityFalloffScale: uniform(1),
    shadowFloor: uniform(0.55),
    poolIntensity: uniform(1),
    poolWarmth: uniform(1),
    poolRadiusScale: uniform(1),
  }
  const material = new MeshBasicNodeMaterial({ name: 'lamp-light', depthTest: false, depthWrite: false })

  // level selects and mixes between the packed ink channels; 0 reads the
  // sharp channel used for near shadows, 3 the widest standing blur used far.
  // The sample is taken before the bounds test so it stays in uniform
  // control flow, which WGSL requires of a texture sample.
  const sampleInk = (pagePoint: Node<'vec2'>, level: Node<'float'>): Node<'float'> => {
    const coords = pagePoint.sub(light.maskRect.xy).div(light.maskRect.zw)
    const outside = coords.x.lessThan(0).or(coords.y.lessThan(0)).or(coords.x.greaterThan(1)).or(coords.y.greaterThan(1))
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const ink = light.mask.sample(vec2(coords.x, float(1).sub(coords.y))) as Node<'vec4'>
    return outside.select(float(0), channelAt(ink, level))
  }

  material.outputNode = Fn(() => {
    const coords = uv()
    const p = vec2(coords.x, float(1).sub(coords.y)).mul(light.resolution)

    const dist = distance(p, light.lampPos)
    const falloff = smoothstep(light.poolRadiusScale.mul(INNER_RADIUS), light.poolRadiusScale.mul(OUTER_RADIUS), dist)
    const brightness = mix(float(1), float(AMBIENT), falloff).mul(light.poolIntensity)
    // poolWarmth lerps the whole pool toward neutral white at 0 and leaves
    // it exactly as authored at its shipped default of 1 (mix(white, tint, 1)
    // is tint unchanged), rather than picking a second pair of tint colors.
    const tintColor = mix(vec3(1), mix(vec3(...POOL_TINT), vec3(...AMBIENT_TINT), falloff), light.poolWarmth)
    const lit = brightness.mul(tintColor).mul(light.flicker).toVar()

    const contactOffset = p.sub(light.basePos)
    const contactDelta = vec2(contactOffset.x, contactOffset.y.mul(CONTACT_ANISOTROPY))
    const contactShadow = float(1).sub(smoothstep(0, CONTACT_RADIUS, length(contactDelta))).mul(CONTACT_STRENGTH)
    lit.mulAssign(float(1).sub(contactShadow))

    If(light.maskReady.greaterThan(0.5), () => {
      const q = light.lampPos.add(
        p.sub(light.lampPos).mul(light.lampHeight.div(light.lampHeight.add(GLYPH_HEIGHT))),
      )
      const shadowLen = distance(p, q)
      const penumbraGrowth = light.penumbraGrowthScale.mul(FLAME_APPARENT_SIZE).div(light.lampHeight)
      const penumbra = clamp(shadowLen.mul(penumbraGrowth), MIN_PENUMBRA, MAX_PENUMBRA)
      // maxBlurLevel caps how far into the blur pyramid a shadow can reach;
      // at its shipped default (3, the pyramid's own top channel) this is a
      // no-op min() against the unclamped level (round 6).
      const level = min(levelForPenumbra(penumbra), light.maxBlurLevel)

      // Rotate the whole disc per pixel (interleaved gradient noise). With a
      // fixed disc, 13 taps leave discrete offset copies of the glyph stems —
      // vertical banding across the mid-throw shadow (2026-09-01 capture).
      // Rotation turns that banding into fine grain the blur channel absorbs.
      // screenCoordinate counts from the top; the noise was tuned on a
      // bottom-up fragment coordinate, so y is flipped back.
      const fragCoord = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y))
      const ign = fract(fract(dot(fragCoord, vec2(0.06711056, 0.00583715))).mul(52.9829189))
      const rot = ign.mul(6.2831853)
      const c = cos(rot)
      const s = sin(rot)

      const coverage = sampleInk(q, level).mul(CENTER_WEIGHT).toVar()
      for (const [x, y] of POISSON) {
        const offset = vec2(c.mul(x).sub(s.mul(y)), s.mul(x).add(c.mul(y)))
        coverage.addAssign(sampleInk(q.add(offset.mul(penumbra)), level).mul(RING_WEIGHT))
      }
      coverage.divAssign(TOTAL_WEIGHT)

      // Fades in as the shadow clears its own glyph, holds, then fades out
      // by FAR_FADE_END the way a real contact shadow thins with distance.
      // opacityFalloffScale scales both fade-out distances together — at its
      // shipped default of 1 this reproduces the unscaled constants exactly.
      const opacityRamp = smoothstep(0, NEAR_RAMP_END, shadowLen).mul(
        float(1).sub(
          smoothstep(
            light.opacityFalloffScale.mul(FAR_FADE_START),
            light.opacityFalloffScale.mul(FAR_FADE_END),
            shadowLen,
          ),
        ),
      )
      coverage.mulAssign(opacityRamp)
      // The blurrier the tail, the fainter it reads — a real penumbra thins
      // as it widens rather than staying fully dark (round 5).
      coverage.mulAssign(mix(float(1), float(LEVEL_OPACITY_FLOOR), level.div(3)))

      // A fragment that is itself glyph ink must not also darken as its own
      // shadow receiver, or the letters print as mud instead of standing
      // clear of the page. Reading the widest blur channel here (rather than
      // the sharp one) keeps the boundary between a glyph and its immediate
      // shadow from ringing.
      coverage.mulAssign(float(1).sub(sampleInk(p, float(3))))
      coverage.mulAssign(float(1).sub(smoothstep(0, FADE_RANGE, rectDistance(p, light.maskRect))))

      lit.mulAssign(mix(float(1), light.shadowFloor, coverage))
    })

    return encodedOutput(vec4(min(lit, vec3(1)), 1))
  })()

  return {
    material,
    emptyMask,
    ...light,
    dispose() {
      material.dispose()
      emptyMask.dispose()
    },
  }
}

export function setLampLightFrame(
  light: LampLight,
  width: number,
  height: number,
  lampX: number,
  lampY: number,
  baseX: number,
  baseY: number,
  flicker: number,
) {
  light.resolution.value.set(width, height)
  light.lampPos.value.set(lampX, lampY)
  light.basePos.value.set(baseX, baseY)
  light.flicker.value = flicker
}

// Writes the round-6 tuning bag's shadow and light-pool fields straight
// into their uniforms — one call per frame from Lamp.tsx, alongside
// setLampLightFrame, keeping this shader's own light height synced to
// whatever height lampLantern.ts is rendering the flame at.
export function setLampTuningUniforms(light: LampLight, tuning: LampTuning) {
  light.lampHeight.value = tuning.lampHeight
  light.penumbraGrowthScale.value = tuning.penumbraGrowth
  light.maxBlurLevel.value = tuning.maxBlurLevel
  light.opacityFalloffScale.value = tuning.opacityFalloff
  light.shadowFloor.value = tuning.shadowStrength
  light.poolIntensity.value = tuning.poolIntensity
  light.poolWarmth.value = tuning.poolWarmth
  light.poolRadiusScale.value = tuning.poolRadius
}

export interface LampMaskRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function setLampMaskFrame(light: LampLight, texture: THREE.Texture | null, rect: LampMaskRect | null) {
  light.mask.value = texture ?? light.emptyMask
  light.maskReady.value = texture && rect ? 1 : 0
  if (!rect) return
  light.maskRect.value.set(rect.x, rect.y, rect.width, rect.height)
}

// ── lantern flame ──────────────────────────────────────────────────────

/** The flame material and the values lampLantern.ts writes each frame. */
export interface LampFlame {
  readonly material: MeshBasicNodeMaterial
  readonly time: UniformNode<'float', number>
  readonly flicker: UniformNode<'float', number>
  readonly coreBrightness: UniformNode<'float', number>
}

// Light, not paint: additive blending (see the material below) means every
// pixel this material writes only adds brightness over the glass and page
// behind it, so a soft, low-alpha edge reads as a glow's own falloff
// instead of an anti-aliased sticker outline (round 6: "a real flame is
// light, not paint" — the previous opaque hard-edge teardrop is what Pete's
// screenshot called "bad clipart").
export function createLampFlameMaterial(): LampFlame {
  const time = uniform(0)
  const flicker = uniform(1)
  const coreBrightness = uniform(1)
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  // The flame quad ignores its own object's rotation and scale and instead
  // rebuilds itself in the camera's own right/up basis every vertex,
  // extracted from the view matrix's rows — the textbook camera-facing
  // billboard. Without this the quad inherits the model's 68deg tilt like
  // any other mesh and foreshortens into a flat ellipse, which is why the
  // previous (unbillboarded) flame read as a dead decal rather than fire
  // (round 4, Pete, 2026-09-01). A world-space billboard has no local
  // position to return, so this replaces the whole clip-space transform.
  material.vertexNode = Fn(() => {
    // The view matrix's first two rows, as columns of its transpose.
    const viewRows = transpose(cameraViewMatrix)
    const cameraRight = viewRows.mul(vec4(1, 0, 0, 0)).xyz
    const cameraUp = viewRows.mul(vec4(0, 1, 0, 0)).xyz
    const worldAnchor = modelWorldMatrix.mul(vec4(0, 0, 0, 1))
    const worldPos = worldAnchor.xyz.add(cameraRight.mul(positionGeometry.x)).add(cameraUp.mul(positionGeometry.y))
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(worldPos, 1))
  })()

  // Same three-frequency mix as flickerSignal() in lampLantern.ts, at two
  // more phases, so the tip's lean and its height stretch don't pulse in
  // lockstep with each other or with the brightness wobble driving flicker.
  const flickerAt = (phase: number): Node<'float'> => {
    const t = time.add(phase)
    return sin(t.mul(6.2831853).mul(1.7))
      .mul(0.5)
      .add(sin(t.mul(6.2831853).mul(2.9)).mul(0.3))
      .add(sin(t.mul(6.2831853).mul(0.4)).mul(0.2))
  }

  // Cheap value noise (no texture fetch) used only to perturb the envelope's
  // own edge — a hand-width hash is enough to break the silhouette's
  // perfect symmetry without a gradient-noise library.
  const hash = (n: Node<'float'>): Node<'float'> => fract(sin(n.mul(127.1)).mul(43758.5453))

  material.outputNode = Fn(() => {
    const coords = uv()
    const stretch = float(1).add(flickerAt(0.37).mul(0.12))
    const y = clamp(coords.y.div(stretch), 0, 1)
    const lean = flickerAt(0).mul(0.16)
    const x = coords.x.sub(0.5).sub(lean.mul(y).mul(y))

    // Wide near the wick, tapering to a point at the tip — a teardrop that
    // wraps the wick region instead of pinching to a point at both ends the
    // way a symmetric sin(y*pi) curve does. Compressing y before the sin
    // pulls the belly down near the base, so the envelope opens up fast
    // right where it meets the burner cone (round 6). A slow, low-amplitude
    // wobble riding on the envelope (not on the hard edge test below) keeps
    // the outline visibly alive rather than a fixed geometric curve.
    const wobble = hash(floor(y.mul(9)).add(floor(time.mul(3)))).sub(0.5).mul(0.05)
    const shaped = pow(y, 0.4)
    const envelope = pow(sin(clamp(shaped, 0, 1).mul(3.14159265)), 0.6).mul(float(1).add(wobble))
    const halfWidth = envelope.mul(0.24).add(0.015)
    const edge = abs(x).div(max(halfWidth, 0.001))
    // A wide smoothstep span (not a near-binary one) is the feathered edge
    // itself — several px of falloff at this quad's own size, replacing the
    // previous 0.6-1.05 near-hard cutoff.
    const body = float(1).sub(smoothstep(0.25, 1.15, edge))
    // Base and tip both fade rather than clip: the wick end blends into the
    // burner instead of the quad's bottom edge showing as a straight line
    // (the "visible gap above the cone" Pete's screenshot showed came from
    // the old body*tipFade cutting sharply right at the quad's own edges).
    const baseFade = smoothstep(0, 0.06, y)
    const tipFade = float(1).sub(smoothstep(0.85, 1.05, y))
    const alpha = body.mul(baseFade).mul(tipFade)
    Discard(alpha.lessThanEqual(0.003))

    // Bottom to top: a dim, blue-tinged base at the wick, a small bright
    // white-yellow core just above center, yellow through the body, and a
    // thin deep-orange rim/tip — most of the envelope is soft gradient, not
    // core (round 6: "the core should be small relative to the envelope").
    const heat = clamp(float(1).sub(y.mul(0.9)).sub(edge.mul(0.55)), 0, 1)
    const baseColor = vec3(0.22, 0.32, 0.55)
    const rimColor = vec3(0.8, 0.29, 0.07)
    const midColor = vec3(1.0, 0.74, 0.24)
    const coreColor = vec3(1.0, 0.97, 0.86)
    const color = mix(rimColor, midColor, smoothstep(0, 0.55, heat)).toVar()
    color.assign(mix(color, coreColor, smoothstep(0.72, 0.97, heat)))
    // The base tint only matters right at the wick, where y and heat are
    // both still low — elsewhere this mix collapses to color unchanged.
    color.assign(mix(baseColor, color, smoothstep(0, 0.18, y)))

    const written = vec4(color.mul(flicker).mul(alpha).mul(coreBrightness), alpha.mul(flicker))
    // The 8-bit canvas clamped this to [0, 1] before blending. encodedOutput
    // divides by alpha, so it must see the alpha the blend will use.
    return encodedOutput(clamp(written, 0, 1))
  })()

  return { material, time, flicker, coreBrightness }
}

// ── lantern tone mapping ───────────────────────────────────────────────

// The lantern's lit metal and glass are tuned under ACES at exposure 1, the
// conventional pairing with a PMREM-generated environment map (round 5:
// "actual PBR level graphics"). The lantern renderer runs without tone
// mapping, so each lit material applies ACES here; the flame is not
// tone-mapped. The glass is straight-alpha and translucent: Three's output
// conversion unpremultiplies before encoding, so the color goes out already
// encoded through encodedOutput.
const LANTERN_EXPOSURE = 1

export function applyLanternToneMapping(material: MeshPhysicalNodeMaterial): void {
  material.outputNode = Fn(() => {
    const toned = toneMapping(THREE.ACESFilmicToneMapping, LANTERN_EXPOSURE, output)
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const encoded = sRGBTransferOETF(toned.rgb) as Node<'vec3'>
    return encodedOutput(vec4(encoded, output.a))
  })()
}
