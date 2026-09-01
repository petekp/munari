// Lamp light — one fragment shader multiplies the page by a single point
// light and the shadow only the headline's raised glyphs cast.
//
// The law: every value this shader writes is a calibrated multiplier meant
// to land on the composited paper exactly as authored, not artistic color
// to be mixed in linear light — so this material skips the usual
// toLinear()/colorspace_fragment round trip and expects a passthrough
// output color space from its renderer.
//
// Ownership: this module owns the light and shadow math and the material
// that carries it. Lamp.tsx owns the renderer, the lamp's position, and
// what the mask texture currently shows. lampMask.ts owns the four ink
// channels this shader reads: sharp glyph coverage in red, progressively
// wider pre-blurred coverage in green/blue/alpha (see MASK_BLUR_RADII,
// imported below so the two files' blur levels can't drift apart).
// lampTuning.ts owns the reviewer-facing defaults for the uniforms below
// (round 6); Lamp.tsx reads the live tuning value and hands it to
// setLampTuningUniforms every frame, which is what keeps this shader's own
// light height agreeing with lampLantern.ts's flame instead of the two
// drifting apart the way two separately-hand-picked constants could.

import * as THREE from 'three'
import { MASK_BLUR_RADII } from './lampMask'
import type { LampTuning } from './lampTuning'

export const LAMP_VERTEX = /* glsl */`
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const LAMP_FRAGMENT = /* glsl */`
uniform vec2 uResolution;
uniform vec2 uLampPos;
uniform vec2 uBasePos;
uniform vec4 uMaskRect;
uniform sampler2D uMaskTex;
uniform float uMaskReady;
// The flame's own brightness wobble (lampLantern.ts's flickerIntensity),
// compressed to a smaller amplitude here than in the 3D flame itself —
// Lamp.tsx scales it before assignment so the light pool visibly breathes
// but the body text underneath stays comfortably readable (round 4).
uniform float uFlicker;
// Round 6 tuning uniforms — lampTuning.ts owns the reviewer-facing default
// for each (equal to the constant it replaced, so untouched sliders render
// identically to round 5). uLampHeight replaces the old GLSL-interpolated
// LAMP_HEIGHT const: Lamp.tsx sets it from the same tuning.lampHeight value
// it hands lampLantern.ts's update(), so this shader's light height and the
// rendered flame still can't disagree, just via a shared live value instead
// of a shared compile-time constant.
uniform float uLampHeight;
uniform float uPenumbraGrowthScale;
uniform float uMaxBlurLevel;
uniform float uOpacityFalloffScale;
uniform float uShadowFloor;
uniform float uPoolIntensity;
uniform float uPoolWarmth;
uniform float uPoolRadiusScale;
varying vec2 vUv;

// The glyphs' own standoff above the page, CSS pixels — shrinking a
// fragment toward the lamp by H / (H + h) finds where the glyph plane
// occludes the ray from lamp to that fragment, the way a taller gnomon
// throws a longer shadow. Not exposed as a tuning control (round 6 only
// asked for the lamp's own height, not each glyph's).
const float GLYPH_HEIGHT = 26.0;

const float INNER_RADIUS = 180.0;
const float OUTER_RADIUS = 900.0;
const float AMBIENT = 0.42;
const vec3 POOL_TINT = vec3(1.000, 0.949, 0.863);
const vec3 AMBIENT_TINT = vec3(0.875, 0.886, 0.933);
// Past this many pixels beyond the mask's own box, no shadow reaches — it
// fades out over the range instead of stopping dead at the rectangle.
const float FADE_RANGE = 160.0;

// The lantern's contact shadow — the multiply pass darkens the page under
// its own base, since darkening is this pass's job, not the lit 3D
// renderer's. Anchored on uBasePos (the drag anchor, where the base
// actually rests) rather than uLampPos (the flame's projected position,
// offset from the base once the 3D camera's tilt is in play) — the
// footprint belongs under the object's feet, not under its light source.
// An ellipse rather than a circle: scaling y before measuring distance
// compresses the shadow vertically, reading as a footprint seen from above
// rather than a flat disc.
const float CONTACT_RADIUS = 46.0;
const float CONTACT_ANISOTROPY = 1.8;
const float CONTACT_STRENGTH = 0.22;

// Near field: a shadow falling only a few px from its own glyph used to
// still read almost sharp, so it looked like a second, lighter copy of the
// headline rather than a shadow (reported 2026-08-31). MIN_PENUMBRA keeps
// even a fresh shadow soft; the opacity ramp below keeps it faint until it
// has visibly separated from the letter that cast it.
const float MIN_PENUMBRA = 6.0;
const float MAX_PENUMBRA = 46.0;
// A real penumbra's width grows with throw at a rate set by the light's own
// apparent size over its height above the receiver (a bigger or lower light
// casts a faster-widening penumbra) — grounding the growth rate in
// FLAME_APPARENT_SIZE / uLampHeight rather than a bare tuned number (round
// 5: "penumbra ∝ throw × flameSize / lampHeight"). FLAME_APPARENT_SIZE
// mirrors FLAME_QUAD_WIDTH in lampLantern.ts. uPenumbraGrowthScale is the
// one dimensionless knob actually being tuned (round 6 exposes it live);
// its shipped default (0.5) yields the same 0.25 rate this was at round 5,
// which was already verified to read as near-razor close in and soft at
// range. Computed per-fragment in main() rather than as a top-level const,
// since uLampHeight is a uniform and GLSL ES 1.00 forbids a const
// initializer that isn't itself a constant expression.
const float FLAME_APPARENT_SIZE = 22.0;
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
const float NEAR_RAMP_END = 34.0;
const float FAR_FADE_START = 340.0;
const float FAR_FADE_END = 560.0;
// Past MAX_PENUMBRA's own softness, the shadow's tail also loses opacity as
// it blurs, the way a real penumbra thins toward invisibility rather than
// staying fully dark while merely getting fuzzier — scaled by level (0..3)
// so the fade tracks the same continuous softness the channel mix below
// uses, not a separate distance threshold.
const float LEVEL_OPACITY_FLOOR = 0.6;

// The four pre-blurred ink channels (packed R/G/B/A, sharp through widest)
// are a standing blur pyramid baked once on the CPU — leaning on it for
// long throws is cheap high-quality penumbra compared to widening every
// tap's radius. These mirror lampMask.ts's own MASK_BLUR_RADII so the
// per-pixel level computed below always lands between the two channels its
// blur amount actually sits between.
const float BLUR_R0 = ${MASK_BLUR_RADII[0]}.0;
const float BLUR_R1 = ${MASK_BLUR_RADII[1]}.0;
const float BLUR_R2 = ${MASK_BLUR_RADII[2]}.0;
const float BLUR_R3 = ${MASK_BLUR_RADII[3]}.0;

// Maps the shader's own continuous penumbra (px) onto a continuous channel
// index 0..3 by finding which pair of baked blur radii it falls between —
// so the pre-baked blur and the per-pixel Poisson taps describe the same
// softness at every throw instead of the mask jumping between two fixed
// states (round 5).
float levelForPenumbra(float px) {
  if (px <= BLUR_R1) return mix(0.0, 1.0, clamp((px - BLUR_R0) / (BLUR_R1 - BLUR_R0), 0.0, 1.0));
  if (px <= BLUR_R2) return mix(1.0, 2.0, clamp((px - BLUR_R1) / (BLUR_R2 - BLUR_R1), 0.0, 1.0));
  return mix(2.0, 3.0, clamp((px - BLUR_R2) / (BLUR_R3 - BLUR_R2), 0.0, 1.0));
}

// Mixes between the two packed channels adjacent to a continuous level.
// GLSL ES 1.00 forbids indexing a vec4 by a non-constant integer, so the
// four channels are selected with a small ternary chain rather than ink[i].
float channelAt(vec4 ink, float level) {
  float lo = floor(level);
  float hi = min(lo + 1.0, 3.0);
  float loValue = lo < 0.5 ? ink.r : (lo < 1.5 ? ink.g : (lo < 2.5 ? ink.b : ink.a));
  float hiValue = hi < 0.5 ? ink.r : (hi < 1.5 ? ink.g : (hi < 2.5 ? ink.b : ink.a));
  return mix(loValue, hiValue, level - lo);
}

// Twelve Poisson-distributed offsets in the unit disc, not a regular ring:
// a symmetric ring pattern re-introduces the banded-copy look at certain
// radii the same way too few taps did (2026-08-31 capture). The center tap
// is weighted higher since it best represents the shadow's own axis.
const vec2 POISSON_0 = vec2(-0.326212, -0.405805);
const vec2 POISSON_1 = vec2(-0.840144, -0.073580);
const vec2 POISSON_2 = vec2(-0.695914,  0.457137);
const vec2 POISSON_3 = vec2(-0.203345,  0.620716);
const vec2 POISSON_4 = vec2( 0.962340, -0.194983);
const vec2 POISSON_5 = vec2( 0.473434, -0.480026);
const vec2 POISSON_6 = vec2( 0.519456,  0.767022);
const vec2 POISSON_7 = vec2( 0.185461, -0.893124);
const vec2 POISSON_8 = vec2( 0.507431,  0.064425);
const vec2 POISSON_9 = vec2( 0.896420,  0.412458);
const vec2 POISSON_10 = vec2(-0.321940, -0.932615);
const vec2 POISSON_11 = vec2(-0.791559, -0.597705);
const float CENTER_WEIGHT = 4.0;
const float RING_WEIGHT = 1.0;
const float TOTAL_WEIGHT = CENTER_WEIGHT + RING_WEIGHT * 12.0;

// level selects and mixes between the packed ink channels; 0 reads the
// sharp channel used for near shadows, 3 the widest standing blur used far.
float sampleInk(vec2 pagePoint, float level) {
  vec2 uv = (pagePoint - uMaskRect.xy) / uMaskRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  vec4 ink = texture2D(uMaskTex, vec2(uv.x, 1.0 - uv.y));
  return channelAt(ink, level);
}

float rectDistance(vec2 p, vec4 rect) {
  vec2 d = max(max(rect.xy - p, p - (rect.xy + rect.zw)), vec2(0.0));
  return length(d);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uResolution;

  float dist = distance(p, uLampPos);
  float falloff = smoothstep(INNER_RADIUS * uPoolRadiusScale, OUTER_RADIUS * uPoolRadiusScale, dist);
  float brightness = mix(1.0, AMBIENT, falloff) * uPoolIntensity;
  // uPoolWarmth lerps the whole pool toward neutral white at 0 and leaves
  // it exactly as authored at its shipped default of 1 (mix(white, tint, 1)
  // is tint unchanged), rather than picking a second pair of tint colors.
  vec3 tintColor = mix(vec3(1.0), mix(POOL_TINT, AMBIENT_TINT, falloff), uPoolWarmth);
  vec3 light = brightness * tintColor * uFlicker;

  vec2 contactDelta = p - uBasePos;
  contactDelta.y *= CONTACT_ANISOTROPY;
  float contactShadow = (1.0 - smoothstep(0.0, CONTACT_RADIUS, length(contactDelta))) * CONTACT_STRENGTH;
  light *= 1.0 - contactShadow;

  if (uMaskReady > 0.5) {
    vec2 q = uLampPos + (p - uLampPos) * (uLampHeight / (uLampHeight + GLYPH_HEIGHT));
    float shadowLen = distance(p, q);
    float penumbraGrowth = uPenumbraGrowthScale * FLAME_APPARENT_SIZE / uLampHeight;
    float penumbra = clamp(shadowLen * penumbraGrowth, MIN_PENUMBRA, MAX_PENUMBRA);
    // uMaxBlurLevel caps how far into the blur pyramid a shadow can reach;
    // at its shipped default (3, the pyramid's own top channel) this is a
    // no-op min() against the unclamped level (round 6).
    float level = min(levelForPenumbra(penumbra), uMaxBlurLevel);

    // Rotate the whole disc per pixel (interleaved gradient noise). With a
    // fixed disc, 13 taps leave discrete offset copies of the glyph stems —
    // vertical banding across the mid-throw shadow (2026-09-01 capture).
    // Rotation turns that banding into fine grain the blur channel absorbs.
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float rot = ign * 6.2831853;
    mat2 disc = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));

    float coverage = CENTER_WEIGHT * sampleInk(q, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_0 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_1 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_2 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_3 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_4 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_5 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_6 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_7 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_8 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_9 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_10 * penumbra, level);
    coverage += RING_WEIGHT * sampleInk(q + disc * POISSON_11 * penumbra, level);
    coverage /= TOTAL_WEIGHT;

    // Fades in as the shadow clears its own glyph, holds, then fades out
    // by FAR_FADE_END the way a real contact shadow thins with distance.
    // uOpacityFalloffScale scales both fade-out distances together — at its
    // shipped default of 1 this reproduces the unscaled constants exactly.
    float opacityRamp = smoothstep(0.0, NEAR_RAMP_END, shadowLen)
      * (1.0 - smoothstep(FAR_FADE_START * uOpacityFalloffScale, FAR_FADE_END * uOpacityFalloffScale, shadowLen));
    coverage *= opacityRamp;
    // The blurrier the tail, the fainter it reads — a real penumbra thins
    // as it widens rather than staying fully dark (round 5).
    coverage *= mix(1.0, LEVEL_OPACITY_FLOOR, level / 3.0);

    // A fragment that is itself glyph ink must not also darken as its own
    // shadow receiver, or the letters print as mud instead of standing
    // clear of the page. Reading the widest blur channel here (rather than
    // the sharp one) keeps the boundary between a glyph and its immediate
    // shadow from ringing.
    coverage *= 1.0 - sampleInk(p, 3.0);
    coverage *= 1.0 - smoothstep(0.0, FADE_RANGE, rectDistance(p, uMaskRect));

    light *= mix(1.0, uShadowFloor, coverage);
  }

  gl_FragColor = vec4(min(light, vec3(1.0)), 1.0);
}
`

export function createLampLightMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'lamp-light',
    vertexShader: LAMP_VERTEX,
    fragmentShader: LAMP_FRAGMENT,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uLampPos: { value: new THREE.Vector2(0, 0) },
      uBasePos: { value: new THREE.Vector2(0, 0) },
      uMaskRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uMaskTex: { value: null },
      uMaskReady: { value: 0 },
      uFlicker: { value: 1 },
      // Seeded with lampTuning.ts's own shipped defaults so a frame rendered
      // before Lamp.tsx's first setLampTuningUniforms call still matches
      // round 5's output rather than reading as untuned zeros.
      uLampHeight: { value: 44 },
      uPenumbraGrowthScale: { value: 0.5 },
      uMaxBlurLevel: { value: 3 },
      uOpacityFalloffScale: { value: 1 },
      uShadowFloor: { value: 0.55 },
      uPoolIntensity: { value: 1 },
      uPoolWarmth: { value: 1 },
      uPoolRadiusScale: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
  })
}

export function setLampLightFrame(
  material: THREE.ShaderMaterial,
  width: number,
  height: number,
  lampX: number,
  lampY: number,
  baseX: number,
  baseY: number,
  flicker: number,
) {
  // SAFETY: createLampLightMaterial is the only constructor of this
  // material and seeds uResolution with a Vector2; nothing replaces it.
  const resolution = material.uniforms.uResolution.value as THREE.Vector2
  resolution.set(width, height)
  // SAFETY: createLampLightMaterial is the only constructor of this
  // material and seeds uLampPos with a Vector2; nothing replaces it.
  const lamp = material.uniforms.uLampPos.value as THREE.Vector2
  lamp.set(lampX, lampY)
  // SAFETY: createLampLightMaterial is the only constructor of this
  // material and seeds uBasePos with a Vector2; nothing replaces it.
  const base = material.uniforms.uBasePos.value as THREE.Vector2
  base.set(baseX, baseY)
  material.uniforms.uFlicker.value = flicker
}

// Writes the round-6 tuning bag's shadow and light-pool fields straight
// into their uniforms — one call per frame from Lamp.tsx, alongside
// setLampLightFrame, keeping this shader's own light height synced to
// whatever height lampLantern.ts is rendering the flame at.
export function setLampTuningUniforms(material: THREE.ShaderMaterial, tuning: LampTuning) {
  material.uniforms.uLampHeight.value = tuning.lampHeight
  material.uniforms.uPenumbraGrowthScale.value = tuning.penumbraGrowth
  material.uniforms.uMaxBlurLevel.value = tuning.maxBlurLevel
  material.uniforms.uOpacityFalloffScale.value = tuning.opacityFalloff
  material.uniforms.uShadowFloor.value = tuning.shadowStrength
  material.uniforms.uPoolIntensity.value = tuning.poolIntensity
  material.uniforms.uPoolWarmth.value = tuning.poolWarmth
  material.uniforms.uPoolRadiusScale.value = tuning.poolRadius
}

export interface LampMaskRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function setLampMaskFrame(
  material: THREE.ShaderMaterial,
  texture: THREE.Texture | null,
  rect: LampMaskRect | null,
) {
  material.uniforms.uMaskTex.value = texture
  material.uniforms.uMaskReady.value = texture && rect ? 1 : 0
  if (!rect) return
  // SAFETY: createLampLightMaterial is the only constructor of this
  // material and seeds uMaskRect with a Vector4; nothing replaces it.
  const maskRect = material.uniforms.uMaskRect.value as THREE.Vector4
  maskRect.set(rect.x, rect.y, rect.width, rect.height)
}
