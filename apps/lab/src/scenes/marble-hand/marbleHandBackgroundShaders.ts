// Marble background shaders — three screensaver fields behind the poster.
//
// The law: one fragment shader per theme, compiled into TWO materials from
// this one factory — the page canvas and the hand's private reflection copy
// — because a cloned <canvas> paints nothing. The fault, 2026-08-31: the
// HTML-in-canvas capture of the page returned the background as an empty
// rectangle, so the chrome hand reflected a hole where the poster's colour
// is. The reflection therefore draws the field itself, from the same GLSL
// and the same published second.
//
// The second fault these shaders answer: at t = 10 000 s a float32 phase has
// lost the low bits that carry a frame's worth of motion. Every periodic
// input folds after its multiply (`turn`), and the two non-periodic drifts
// fold at a distance no session reaches (`drift`).
//
// Ownership: this module owns GLSL and material construction. The page
// canvas owns its renderer and clock sampling; the environment owns the
// reflection mesh. Neither owns a pixel of native HTML.

import * as THREE from 'three'
import type { MarbleHandThemeId } from './marbleHandThemes'

// ── shared program ────────────────────────────────────────────────────

// The same transform serves a screen-filling quad under an orthographic
// camera and a page-sized plane inside the reflection scene, so the two
// renderers differ only in their camera.
const MARBLE_BACKGROUND_VERTEX = /* glsl */`
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const PRELUDE = /* glsl */`
uniform float uTime;
uniform vec2 uResolution;
uniform float uAspect;
varying vec2 vUv;

const float TAU = 6.28318530718;

// Palette anchors: the page's own tokens, in sRGB, converted once at the
// end of main. Naming them keeps every field on one poster's colour set.
const vec3 ROSE = vec3(0.957, 0.663, 0.812);
const vec3 ACID = vec3(0.878, 0.957, 0.427);
const vec3 CORAL = vec3(1.000, 0.502, 0.384);
const vec3 MINT = vec3(0.565, 0.847, 0.769);
const vec3 BLUE = vec3(0.541, 0.655, 0.937);
const vec3 NAVY = vec3(0.051, 0.078, 0.188);
const vec3 CREAM = vec3(1.000, 0.941, 0.812);

// A sine-free hash. One sin() costs more than this whole function on the
// integrated GPUs this page has to hold 60fps on, and the wave field takes
// fifty-six of them per pixel.
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm2(vec2 p) {
  float v = 0.5 * noise(p);
  p = p * 2.03 + vec2(11.3, 7.7);
  return v + 0.25 * noise(p);
}

float fbm3(vec2 p) {
  float v = 0.5 * noise(p);
  p = p * 2.03 + vec2(11.3, 7.7);
  v += 0.25 * noise(p);
  p = p * 2.01 + vec2(3.1, 19.7);
  return v + 0.125 * noise(p);
}

float fbm4(vec2 p) {
  float v = 0.5 * noise(p);
  p = p * 2.03 + vec2(11.3, 7.7);
  v += 0.25 * noise(p);
  p = p * 2.01 + vec2(3.1, 19.7);
  v += 0.125 * noise(p);
  p = p * 2.07 + vec2(23.9, 5.3);
  return v + 0.0625 * noise(p);
}

// A phase for sin/cos. Folding AFTER the multiply keeps the low bits that
// carry one frame of motion, and TAU folds exactly, so the wrap is silent.
float turn(float speed) { return mod(uTime * speed, TAU); }

// Noise has no period, so a drifting domain cannot fold silently. 1024
// units is more than nine hours at the slowest speed used here, and float32
// still resolves a frame's step at that magnitude.
float drift(float speed) { return mod(uTime * speed, 1024.0); }

vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// pow(x, 2.0) is undefined for negative x in GLSL ES 1.00, and every
// gaussian below feeds it a signed distance.
float sq(float x) { return x * x; }

// smoothstep with edge0 > edge1 is likewise undefined. This is the falling
// edge, written the way the specification allows.
float fall(float edge0, float edge1, float x) { return 1.0 - smoothstep(edge0, edge1, x); }
`

// ── waves ─────────────────────────────────────────────────────────────

const WAVES = /* glsl */`
vec3 wavePalette(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(ROSE, MINT, smoothstep(0.00, 0.30, x));
  c = mix(c, ACID, smoothstep(0.26, 0.52, x));
  c = mix(c, CORAL, smoothstep(0.48, 0.74, x));
  return mix(c, BLUE, smoothstep(0.70, 1.00, x));
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.6;

  // Two warps at separate tempos. One warp lets the field settle into the
  // shape of its own noise; the second keeps folding that shape apart.
  vec2 first = vec2(
    fbm2(p + vec2(drift(0.019), 0.0)),
    fbm2(p + vec2(4.7, 2.1) - vec2(0.0, drift(0.015))));
  vec2 second = vec2(
    fbm3(p + 2.4 * first + vec2(1.3, 8.4) + vec2(0.0, drift(0.031))),
    fbm3(p + 2.4 * first + vec2(6.9, 3.6) - vec2(drift(0.027), 0.0)));
  float field = fbm4(p + 3.1 * second);
  // A fine ripple on a third clock, small enough never to band the ramp.
  field += 0.045 * sin((p.x + p.y) * 9.0 - turn(1.65) + second.x * 6.0);

  vec3 color = wavePalette(field * 1.45 - 0.10);

  // Fake specular. The difference of the two warps stands in for the
  // surface slope, so the sheen rides the folds with no extra field read.
  vec2 slope = second - first;
  float facing = dot(normalize(slope + 0.0001), vec2(0.62, 0.78)) * 0.5 + 0.5;
  color += pow(clamp(facing, 0.0, 1.0), 7.0) * vec3(0.30, 0.26, 0.20);
  // A wide travelling gloss, so the silk reads as lit rather than printed.
  float gloss = exp(-sq((vUv.x * uAspect - 1.1 - 0.9 * sin(turn(0.09))) * 1.4));
  color += gloss * 0.10;

  float vignette = 1.0 - 0.16 * dot(vUv - 0.5, vUv - 0.5) * 2.4;
  gl_FragColor = vec4(toLinear(color * vignette), 1.0);
  #include <colorspace_fragment>
}
`

// ── checker ───────────────────────────────────────────────────────────

const CHECKER = /* glsl */`
const vec3 TILE_PEACH = vec3(0.996, 0.545, 0.333);
const vec3 TILE_LILAC = vec3(0.663, 0.494, 0.980);
const vec3 TILE_MINT = vec3(0.353, 0.878, 0.678);
const vec3 SKY_ZENITH = vec3(0.357, 0.278, 0.729);
const vec3 SKY_ROSE = vec3(0.949, 0.529, 0.686);
const vec3 SKY_GOLD = vec3(1.000, 0.796, 0.510);
const vec3 SUN_CORE = vec3(1.000, 0.906, 0.702);

void main() {
  // A slow breathing zoom and roll: the lens moves, the floor does not.
  float roll = 0.026 * sin(turn(0.11));
  vec2 s = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5) * 2.0 * (1.0 + 0.030 * sin(turn(0.15)));
  s = vec2(s.x * cos(roll) - s.y * sin(roll), s.x * sin(roll) + s.y * cos(roll));

  float horizon = 0.30;
  // The sun glides, never sets: its x is periodic and stays inside the frame.
  vec2 sun = vec2(0.34 * sin(turn(0.021)), horizon + 0.075);

  // Sunset gradient: gold at the floor line, violet at the zenith.
  float lift = clamp((s.y - horizon) / 1.1, 0.0, 1.0);
  vec3 color = mix(SKY_GOLD, mix(SKY_ROSE, SKY_ZENITH, smoothstep(0.22, 1.0, lift)),
    smoothstep(0.0, 0.55, lift));

  // Drifting cloud bands, lit from below by the sun colour. The band
  // window keeps them off the horizon line and out of the zenith.
  float cl = fbm3(vec2(s.x * 1.1 + drift(0.016), s.y * 2.6 + 4.7));
  float band = smoothstep(0.0, 0.12, s.y - horizon) * (1.0 - smoothstep(0.5, 1.1, s.y - horizon));
  color = mix(color, mix(SKY_ROSE, SUN_CORE, 0.5), smoothstep(0.55, 0.85, cl) * band * 0.7);

  // Sun disc and halo, slightly flattened as a low sun reads.
  float sd = length((s - sun) * vec2(1.0, 1.25));
  color += SUN_CORE * (0.85 * fall(0.045, 0.075, sd) + 0.50 * exp(-sq(sd * 4.2)));
  // The horizon glow sits under the sky, so the fog resolves into light.
  color += SKY_GOLD * 0.40 * exp(-sq((s.y - horizon) * 8.0));

  if (s.y < horizon) {
    // Two fixed-point steps intersect the ray with an undulating floor.
    // The flat solution is the first guess; each step re-solves the plane
    // at the height the previous hit found.
    float down = horizon - s.y;
    float dist = 1.0 / down;
    float height = 0.0;
    for (int step2 = 0; step2 < 2; step2++) {
      vec2 hit = vec2(s.x * dist, dist);
      height = 0.14 * sin(hit.y * 0.62 - turn(0.62)) + 0.10 * sin(hit.x * 0.85 + turn(0.36));
      dist = (1.0 + height) / down;
    }
    vec2 hit = vec2(s.x * dist, dist);

    // The scroll folds in cell units, at the shared period of every
    // per-cell pattern below: parity repeats every 2 rows, the row tones
    // every 3, the tile jitter is written mod 6 — so 6 rows fold silently.
    // Two earlier versions jumped at the fold (2026-08-31): one wrapped
    // before the 0.92 scale (period 1.84 against 2-row parity), one
    // wrapped at 2.0 against the 3-row tones.
    vec2 cell = vec2(hit.x, hit.y) * 0.92;
    cell.y -= mod(uTime * 0.85, 6.0);
    float dark = mod(floor(cell.x) + floor(cell.y), 2.0);
    float rowBand = mod(floor(cell.y), 3.0);
    vec3 tone = mix(mix(TILE_PEACH, TILE_LILAC, step(1.0, rowBand)),
      TILE_MINT, step(2.0, rowBand));
    // Per-tile firing variation, like glaze in a kiln. The y hash input
    // is pre-folded to the same 6-row period as the scroll.
    float glaze = hash21(vec2(floor(cell.x), mod(floor(cell.y), 6.0)));
    tone *= 0.88 + 0.24 * glaze;
    vec3 tile = mix(CREAM, tone, dark);

    // Distance blur before the fog: with no derivatives available, the
    // tiles must lose their edges before they can alias at the horizon.
    float sharp = fall(7.0, 30.0, dist) * clamp(uResolution.y / 700.0, 0.5, 1.4);
    tile = mix(mix(CREAM, tone, 0.5), tile, clamp(sharp, 0.0, 1.0));

    // The wave's own slope shades the floor.
    tile *= 0.80 + 0.30 * (height + 0.24) * 2.0;

    // Distant tiles mirror the sky, as a wet or polished floor does.
    float sheen = smoothstep(3.5, 16.0, dist);
    tile = mix(tile, mix(SKY_ROSE, SKY_GOLD, 0.5), sheen * 0.35);

    // The sun's glitter path: a column of shimmer under the disc, riding
    // the wave phase so it flickers as the floor moves through it.
    float path = exp(-sq((s.x - sun.x) * 5.0));
    float sparkle = 0.55 + 0.45 * sin(turn(1.4) + hit.y * 5.1 + hit.x * 2.3);
    tile += SUN_CORE * path * sparkle * 0.45 * smoothstep(1.0, 6.0, dist);

    float fog = 1.0 - exp(-dist * 0.05);
    color = mix(tile, color, clamp(fog, 0.0, 1.0));
  }

  gl_FragColor = vec4(toLinear(color), 1.0);
  #include <colorspace_fragment>
}
`

// ── prism ─────────────────────────────────────────────────────────────

const PRISM = /* glsl */`
// Nearest and second-nearest cell distances: their difference is the cell
// boundary, which is where glass shows its edges.
vec2 cells(vec2 p) {
  vec2 base = floor(p);
  vec2 f = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      float d = length(offset + hash22(base + offset) - f);
      second = min(second, max(nearest, d));
      nearest = min(nearest, d);
    }
  }
  return vec2(nearest, second);
}

vec3 prismPalette(float t) {
  return 0.60 + 0.36 * cos(TAU * (vec3(0.95, 0.84, 0.70) * t + vec3(0.02, 0.26, 0.52)));
}

void main() {
  vec2 c = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5) * 2.0 - vec2(0.18, 0.04);
  float radius = length(c);
  // The segment count is fixed. Turning it would pop a whole mirror line
  // into existence; the field turns underneath the fold instead.
  float segment = TAU / 8.0;
  float angle = atan(c.y, c.x) + turn(0.055);
  angle = abs(mod(angle + segment * 0.5, segment) - segment * 0.5);
  // A slow radial breath keeps the fold from reading as a still wheel.
  vec2 q = vec2(cos(angle), sin(angle)) * radius * (1.0 + 0.10 * sin(turn(0.07)));

  vec2 warp = vec2(drift(0.011), -drift(0.008));
  // Dispersion: three radii, one per channel, as glass separates them.
  float r = fbm3(q * 2.4 * 1.014 + warp);
  float g = fbm3(q * 2.4 + warp);
  float b = fbm3(q * 2.4 * 0.986 + warp);
  vec3 color = vec3(prismPalette(r * 1.6).r, prismPalette(g * 1.6).g, prismPalette(b * 1.6).b);

  vec2 near = cells(q * 3.2 + vec2(0.0, drift(0.006)));
  // Highlights along the cell walls, and a caustic glint at each centre.
  color += vec3(1.0, 0.98, 0.94) * 0.55 * fall(0.0, 0.075, near.y - near.x);
  float glint = fall(0.0, 0.14, near.x) *
    (0.5 + 0.5 * sin(turn(0.9) + (near.x + radius) * 24.0));
  color += vec3(1.0, 0.95, 0.86) * 0.35 * pow(glint, 3.0);

  // The centre keeps a bright core so the fold reads as one crystal.
  color += CREAM * 0.30 * exp(-sq(radius * 2.4));
  color *= 1.0 - 0.14 * dot(vUv - 0.5, vUv - 0.5) * 2.4;

  gl_FragColor = vec4(toLinear(color), 1.0);
  #include <colorspace_fragment>
}
`

export const MARBLE_BACKGROUND_SHADERS = {
  waves: `${PRELUDE}${WAVES}`,
  checker: `${PRELUDE}${CHECKER}`,
  prism: `${PRELUDE}${PRISM}`,
} satisfies Record<MarbleHandThemeId, string>

export function createMarbleBackgroundMaterial(theme: MarbleHandThemeId): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: `marble-hand-background-${theme}`,
    vertexShader: MARBLE_BACKGROUND_VERTEX,
    fragmentShader: MARBLE_BACKGROUND_SHADERS[theme],
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1 },
    },
    // The field is opaque and covers its whole quad, so it owes nothing to
    // the depth buffer in either scene.
    depthTest: false,
    depthWrite: false,
  })
}

export function setMarbleBackgroundFrame(
  material: THREE.ShaderMaterial,
  time: number,
  width: number,
  height: number,
) {
  material.uniforms.uTime.value = time
  material.uniforms.uAspect.value = height > 0 ? width / height : 1
  // SAFETY: createMarbleBackgroundMaterial is the only constructor of these
  // materials and seeds uResolution with a Vector2; nothing replaces it.
  const resolution = material.uniforms.uResolution.value as THREE.Vector2
  resolution.set(width, height)
}
