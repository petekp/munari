// Home light — one fragment shader multiplies the page by a single point
// light and the shadows the page's own matter casts under it: the headline
// glyphs, every raised control and thumbnail, and the rim of every well.
//
// The law: the pass only darkens. It writes a multiplier the page is
// composited through (mix-blend-mode: multiply on the host), so a lit pixel
// of 1.0 means "leave the page alone" and the brightest thing on screen is
// still the page's own wash. The glow around the light is the fixture's
// job, not this pass's.
//
// Fault: the lamp spike (2026-09-01) shaded only the headline. A button next
// to a shadowed headline that cast nothing read as a sticker on the page,
// which is the exact impression the masthead exists to kill.
//
// Ownership: this module owns the light and shadow math and the material.
// homeRelief.ts owns the two masks it samples (glyph ink in four blur
// levels; relief in raised/well pairs). homeLightLaw.ts owns the projection
// and standoffs this mirrors. HomeMasthead.tsx owns the renderer, the light's
// position, and when the masks are rebuilt.

import * as THREE from 'three'
import { GLYPH_STANDOFF, LIGHT_HEIGHT, RAISED_STANDOFF, WELL_DEPTH } from './homeLightLaw'
import { INK_BLUR_RADII, RAISED_BLUR, type Mask } from './homeRelief'

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */`
uniform vec2 uResolution;
uniform vec2 uLight;
uniform vec4 uInkRect;
uniform sampler2D uInk;
uniform float uInkReady;
uniform vec4 uReliefRect;
uniform sampler2D uRelief;
uniform float uReliefReady;
// The lifted postcard: four corners, x/y in canvas px and z above the page.
uniform vec3 uFlyer[4];
uniform float uFlyerReady;
uniform float uFlyerLift;
varying vec2 vUv;

const float LIGHT_HEIGHT = ${LIGHT_HEIGHT.toFixed(1)};
const float GLYPH_STANDOFF = ${GLYPH_STANDOFF.toFixed(1)};
const float RAISED_STANDOFF = ${RAISED_STANDOFF.toFixed(1)};
const float WELL_DEPTH = ${WELL_DEPTH.toFixed(1)};

// No light pool: the page's wash is the brightest thing on screen and stays
// one colour top to bottom (a pool that eased to 0.9 read as a second,
// duller wash below the fold, 2026-09-05). The light only casts shadows.
// How dark the deepest shadow gets, per kind of matter.
const float GLYPH_FLOOR = 0.6;
const float RAISED_FLOOR = 0.6;
const float WELL_FLOOR = 0.66;
// The soft darkening that hugs a raised element's foot regardless of light.
const float CONTACT_STRENGTH = 0.14;

// A shadow's throw is capped: the light is a point, so a button four
// screens below it would otherwise throw its shadow 120px clear of itself
// (2026-09-05). Past the cap the direction still tracks the light and the
// length holds, the way a distant light reads.
const float MAX_GLYPH_THROW = 44.0;
const float MAX_RAISED_THROW = 22.0;
const float MAX_WELL_THROW = 5.0;

// Penumbra: soft even close in (a shadow a few px from its glyph read as a
// second, lighter copy of the headline), widening with throw at a rate set
// by the light's apparent size over its height.
const float MIN_PENUMBRA = 5.0;
const float MAX_PENUMBRA = 40.0;
const float LIGHT_APPARENT_SIZE = 70.0;
const float NEAR_RAMP_END = 26.0;
const float FAR_FADE_START = 300.0;
const float FAR_FADE_END = 520.0;
const float LEVEL_OPACITY_FLOOR = 0.6;
const float FADE_RANGE = 160.0;

const float RAISED_BLUR = ${RAISED_BLUR.toFixed(1)};
const float BLUR_R0 = ${INK_BLUR_RADII[0]}.0;
const float BLUR_R1 = ${INK_BLUR_RADII[1]}.0;
const float BLUR_R2 = ${INK_BLUR_RADII[2]}.0;
const float BLUR_R3 = ${INK_BLUR_RADII[3]}.0;

float levelForPenumbra(float px) {
  if (px <= BLUR_R1) return clamp((px - BLUR_R0) / (BLUR_R1 - BLUR_R0), 0.0, 1.0);
  if (px <= BLUR_R2) return 1.0 + clamp((px - BLUR_R1) / (BLUR_R2 - BLUR_R1), 0.0, 1.0);
  return 2.0 + clamp((px - BLUR_R2) / (BLUR_R3 - BLUR_R2), 0.0, 1.0);
}

float channelAt(vec4 ink, float level) {
  float lo = floor(level);
  float hi = min(lo + 1.0, 3.0);
  float loValue = lo < 0.5 ? ink.r : (lo < 1.5 ? ink.g : (lo < 2.5 ? ink.b : ink.a));
  float hiValue = hi < 0.5 ? ink.r : (hi < 1.5 ? ink.g : (hi < 2.5 ? ink.b : ink.a));
  return mix(loValue, hiValue, level - lo);
}

vec4 sampleRect(sampler2D tex, vec4 rect, vec2 p) {
  vec2 uv = (p - rect.xy) / rect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture2D(tex, vec2(uv.x, 1.0 - uv.y));
}

float rectDistance(vec2 p, vec4 rect) {
  vec2 d = max(max(rect.xy - p, p - (rect.xy + rect.zw)), vec2(0.0));
  return length(d);
}

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

float glyphInk(vec2 p, float level) {
  return channelAt(sampleRect(uInk, uInkRect, p), level);
}

// The offset from a fragment back toward the light for matter standing off
// the page (or sunk into it, via the well form), capped in length.
vec2 throwOffset(vec2 p, float factor, float maxLen) {
  vec2 off = (p - uLight) * factor;
  float len = length(off);
  return len > maxLen ? off * (maxLen / len) : off;
}

// The headline's shadow: twelve rotated Poisson taps over the blur pyramid.
float glyphShadow(vec2 p) {
  vec2 q = p - throwOffset(p, GLYPH_STANDOFF / LIGHT_HEIGHT, MAX_GLYPH_THROW);
  float throwLen = distance(p, q);
  float penumbra = clamp(throwLen * (LIGHT_APPARENT_SIZE / LIGHT_HEIGHT), MIN_PENUMBRA, MAX_PENUMBRA);
  float level = levelForPenumbra(penumbra);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float rot = ign * 6.2831853;
  mat2 disc = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  float coverage = 4.0 * glyphInk(q, level);
  coverage += glyphInk(q + disc * POISSON_0 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_1 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_2 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_3 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_4 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_5 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_6 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_7 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_8 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_9 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_10 * penumbra, level);
  coverage += glyphInk(q + disc * POISSON_11 * penumbra, level);
  coverage /= 16.0;
  coverage *= smoothstep(0.0, NEAR_RAMP_END, throwLen) * (1.0 - smoothstep(FAR_FADE_START, FAR_FADE_END, throwLen));
  coverage *= mix(1.0, LEVEL_OPACITY_FLOOR, level / 3.0);
  // A glyph is not its own shadow's receiver.
  coverage *= 1.0 - glyphInk(p, 3.0);
  coverage *= 1.0 - smoothstep(0.0, FADE_RANGE, rectDistance(p, uInkRect));
  return coverage;
}

// Relief: R raised sharp, G raised blurred, B well sharp, A well blurred.
// Raised controls throw a short soft shadow; a well's floor is shaded where
// its own rim, projected from the light, covers it.
vec3 reliefShade(vec2 p) {
  vec4 here = sampleRect(uRelief, uReliefRect, p);
  // Raised.
  vec2 qr = p - throwOffset(p, RAISED_STANDOFF / LIGHT_HEIGHT, MAX_RAISED_THROW);
  float throwLen = distance(p, qr);
  vec4 at = sampleRect(uRelief, uReliefRect, qr);
  float raised = mix(at.r, at.g, clamp(throwLen / 24.0, 0.0, 1.0));
  raised *= 1.0 - smoothstep(0.0, 6.0, -throwLen);
  raised *= 1.0 - here.r;
  raised *= 1.0 - smoothstep(0.0, FADE_RANGE, rectDistance(p, uReliefRect));
  // Ambient contact: the blurred foot minus the element itself.
  float contact = max(0.0, here.g - here.r) * (1.0 - here.r);
  // Wells: the floor is shaded where the ray to it crosses the page outside the well.
  vec2 qw = p - throwOffset(p, WELL_DEPTH / (LIGHT_HEIGHT + WELL_DEPTH), MAX_WELL_THROW);
  vec4 rim = sampleRect(uRelief, uReliefRect, qw);
  float inset = here.b * (1.0 - rim.a);
  return vec3(raised, contact, inset);
}

float erfApprox(float x) {
  float sgn = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return sgn * y;
}

float phi(float x) {
  return 0.5 * (1.0 + erfApprox(x * 0.70710678));
}

// A box blurred by a Gaussian of the given sigma, in the box's own axes:
// sa/sb are the point's coordinates along each axis, la/lb the lengths.
// This is exactly what the relief mask holds for a painted box, so the
// flyer at rest and the holder it replaces shade the page identically.
float boxBlur(float sa, float la, float sb, float lb, float sigma) {
  sigma = max(sigma, 0.35);
  return (phi(sa / sigma) - phi((sa - la) / sigma)) * (phi(sb / sigma) - phi((sb - lb) / sigma));
}

// The flyer's shadow, as (raised, contact). At rest it reproduces the
// relief's raised term exactly: the same capped throw, the same sharp-to-
// blurred mix by throw length, the same contact foot. As the card lifts
// those crossfade into the solved shadow of a tilted card in three
// dimensions: the ray from the light to this page point meets the card's
// plane, and the hit is shaded by a penumbra that widens with its height.
vec2 flyerShade(vec2 p) {
  vec3 L = vec3(uLight, LIGHT_HEIGHT);
  vec3 c0 = uFlyer[0];
  vec3 u = uFlyer[1] - c0;
  vec3 v = uFlyer[3] - c0;
  float lift = clamp(uFlyerLift, 0.0, 1.0);

  // Footprint: the card projected straight down, in its own axes.
  vec2 fu = u.xy;
  vec2 fv = v.xy;
  float det = fu.x * fv.y - fu.y * fv.x;
  if (abs(det) < 1e-4) return vec2(0.0);
  vec2 w = p - c0.xy;
  float fa = (w.x * fv.y - w.y * fv.x) / det;
  float fb = (fu.x * w.y - fu.y * w.x) / det;
  float flu = length(fu);
  float flv = length(fv);
  float footprint = boxBlur(fa * flu, flu, fb * flv, flv, 0.0);
  float foot = boxBlur(fa * flu, flu, fb * flv, flv, RAISED_BLUR);
  float contact = max(0.0, foot - footprint) * (1.0 - lift);

  // The hit on the card's plane.
  vec3 d = vec3(p, 0.0) - L;
  vec3 n = cross(u, v);
  float denom = dot(n, d);
  if (abs(denom) < 1e-4) return vec2(0.0, contact);
  float t = dot(n, c0 - L) / denom;
  if (t <= 0.0 || t >= 1.0) return vec2(0.0, contact);
  vec3 x = L + d * t;
  // The relief caps a raised throw; the cap lifts away with the card.
  vec2 off = x.xy - p;
  float throwLen = length(off);
  float cap = mix(MAX_RAISED_THROW, 1.0e5, lift);
  if (throwLen > cap) {
    x.xy = p + off * (cap / throwLen);
    throwLen = cap;
  }
  vec3 wx = x - c0;
  float lu = length(u);
  float lv = length(v);
  float sa = dot(wx, u) / lu;
  float sb = dot(wx, v) / lv;

  float rest = mix(boxBlur(sa, lu, sb, lv, 0.0), boxBlur(sa, lu, sb, lv, RAISED_BLUR), clamp(throwLen / 24.0, 0.0, 1.0));
  float h = clamp(x.z, 0.0, LIGHT_HEIGHT - 1.0);
  float pen = clamp(MIN_PENUMBRA + LIGHT_APPARENT_SIZE * h / (LIGHT_HEIGHT - h), MIN_PENUMBRA, MAX_PENUMBRA);
  float flight = boxBlur(sa, lu, sb, lv, max(RAISED_BLUR, pen * 0.4));
  float raised = mix(rest, flight, lift) * (1.0 - footprint);
  return vec2(raised, contact);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
  float light = 1.0;

  if (uInkReady > 0.5) {
    light *= mix(1.0, GLYPH_FLOOR, glyphShadow(p));
  }
  if (uReliefReady > 0.5) {
    vec3 relief = reliefShade(p);
    light *= mix(1.0, RAISED_FLOOR, relief.x);
    light *= 1.0 - CONTACT_STRENGTH * relief.y;
    light *= mix(1.0, WELL_FLOOR, relief.z);
  }
  if (uFlyerReady > 0.5) {
    vec2 flyer = flyerShade(p);
    light *= mix(1.0, RAISED_FLOOR, flyer.x);
    light *= 1.0 - CONTACT_STRENGTH * flyer.y;
  }
  gl_FragColor = vec4(vec3(min(light, 1.0)), 1.0);
}
`

export interface MaskFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function createHomeLightMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'home-light',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uLight: { value: new THREE.Vector2(0, 0) },
      uInkRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uInk: { value: null },
      uInkReady: { value: 0 },
      uReliefRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRelief: { value: null },
      uReliefReady: { value: 0 },
      uFlyer: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uFlyerReady: { value: 0 },
      uFlyerLift: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })
}

export function setHomeLightFrame(material: THREE.ShaderMaterial, width: number, height: number, lightX: number, lightY: number) {
  // SAFETY: createHomeLightMaterial is the only constructor of this material
  // and seeds uResolution with a Vector2; nothing replaces it.
  const resolution = material.uniforms.uResolution.value as THREE.Vector2
  resolution.set(width, height)
  // SAFETY: createHomeLightMaterial is the only constructor of this material
  // and seeds uLight with a Vector2; nothing replaces it.
  const light = material.uniforms.uLight.value as THREE.Vector2
  light.set(lightX, lightY)
}

export function setHomeInkMask(material: THREE.ShaderMaterial, texture: THREE.Texture | null, frame: MaskFrame | null) {
  material.uniforms.uInk.value = texture
  material.uniforms.uInkReady.value = texture && frame ? 1 : 0
  if (!frame) return
  // SAFETY: createHomeLightMaterial is the only constructor of this material
  // and seeds uInkRect with a Vector4; nothing replaces it.
  const rect = material.uniforms.uInkRect.value as THREE.Vector4
  rect.set(frame.x, frame.y, frame.width, frame.height)
}

/** The flyer's corners (see homeFlyer.ts) moved into canvas px, with its lift, or none. */
export function setHomeFlyerUniform(material: THREE.ShaderMaterial, corners: Float32Array | null, lift: number, originX: number, originY: number) {
  material.uniforms.uFlyerReady.value = corners ? 1 : 0
  if (!corners) return
  material.uniforms.uFlyerLift.value = lift
  // SAFETY: createHomeLightMaterial is the only constructor of this material
  // and seeds uFlyer with four Vector3s; nothing replaces them.
  const targets = material.uniforms.uFlyer.value as THREE.Vector3[]
  for (let index = 0; index < 4; index++) {
    targets[index].set(corners[index * 3] - originX, corners[index * 3 + 1] - originY, corners[index * 3 + 2])
  }
}

export function setHomeReliefMask(material: THREE.ShaderMaterial, texture: THREE.Texture | null, frame: MaskFrame | null) {
  material.uniforms.uRelief.value = texture
  material.uniforms.uReliefReady.value = texture && frame ? 1 : 0
  if (!frame) return
  // SAFETY: createHomeLightMaterial is the only constructor of this material
  // and seeds uReliefRect with a Vector4; nothing replaces it.
  const rect = material.uniforms.uReliefRect.value as THREE.Vector4
  rect.set(frame.x, frame.y, frame.width, frame.height)
}

/** Uploads a mask's packed bytes as-is; no colour space, no premultiplying. */
export function maskTexture(mask: Mask): THREE.DataTexture {
  const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.flipY = true
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
