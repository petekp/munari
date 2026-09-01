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
import { marbleHandTuning, type MarbleHandNumberKey, type MarbleHandTuning } from './marbleHandTuning'

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
uniform float uWavesZoom;
uniform float uWavesWarp;
uniform float uWavesRipple;
uniform float uWavesContrast;
uniform float uWavesShift;
uniform float uWavesSheen;
uniform float uWavesGloss;
uniform float uWavesVignette;

vec3 wavePalette(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(ROSE, MINT, smoothstep(0.00, 0.30, x));
  c = mix(c, ACID, smoothstep(0.26, 0.52, x));
  c = mix(c, CORAL, smoothstep(0.48, 0.74, x));
  return mix(c, BLUE, smoothstep(0.70, 1.00, x));
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * uWavesZoom;

  // Two warps at separate tempos. One warp lets the field settle into the
  // shape of its own noise; the second keeps folding that shape apart.
  vec2 first = vec2(
    fbm2(p + vec2(drift(0.019), 0.0)),
    fbm2(p + vec2(4.7, 2.1) - vec2(0.0, drift(0.015))));
  vec2 second = vec2(
    fbm3(p + uWavesWarp * 2.4 * first + vec2(1.3, 8.4) + vec2(0.0, drift(0.031))),
    fbm3(p + uWavesWarp * 2.4 * first + vec2(6.9, 3.6) - vec2(drift(0.027), 0.0)));
  float field = fbm4(p + uWavesWarp * 3.1 * second);
  // A fine ripple on a third clock, small enough never to band the ramp.
  field += uWavesRipple * sin((p.x + p.y) * 9.0 - turn(1.65) + second.x * 6.0);

  vec3 color = wavePalette(field * uWavesContrast + uWavesShift);

  // Fake specular. The difference of the two warps stands in for the
  // surface slope, so the sheen rides the folds with no extra field read.
  vec2 slope = second - first;
  float facing = dot(normalize(slope + 0.0001), vec2(0.62, 0.78)) * 0.5 + 0.5;
  color += pow(clamp(facing, 0.0, 1.0), 7.0) * uWavesSheen * vec3(1.0, 0.87, 0.67);
  // A wide travelling gloss, so the silk reads as lit rather than printed.
  float gloss = exp(-sq((vUv.x * uAspect - 1.1 - 0.9 * sin(turn(0.09))) * 1.4));
  color += gloss * uWavesGloss;

  float vignette = 1.0 - uWavesVignette * dot(vUv - 0.5, vUv - 0.5) * 2.4;
  gl_FragColor = vec4(toLinear(color * vignette), 1.0);
  #include <colorspace_fragment>
}
`

// ── tide ──────────────────────────────────────────────────────────────

const TIDE = /* glsl */`
uniform float uTideHorizon;
uniform float uTideLift;
uniform float uTideEclipseSize;
uniform float uTideSwell;
uniform float uTideGlow;
uniform float uTideHueShift;
uniform float uTideSurgeRate;
uniform float uTideGlitter;
uniform float uTideGlade;
uniform float uTideFlare;
uniform float uTideStarDensity;

const vec3 SKY_ZENITH = vec3(0.043, 0.035, 0.141);
const vec3 SKY_VIOLET = vec3(0.231, 0.161, 0.451);
const vec3 HORIZON_DUST = vec3(0.722, 0.459, 0.502);
const vec3 RIM_GOLD = vec3(1.000, 0.878, 0.659);
const vec3 AURORA_MINT = vec3(0.451, 0.851, 0.749);
const vec3 ECLIPSE_STONE = vec3(0.031, 0.024, 0.059);

// The glow's spectrum: a band from mint through blue and violet to rose,
// deliberately short of a full rainbow so the sea stays nocturnal.
vec3 seaPalette(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(AURORA_MINT, vec3(0.353, 0.620, 0.949), smoothstep(0.00, 0.35, x));
  c = mix(c, vec3(0.620, 0.420, 0.949), smoothstep(0.30, 0.65, x));
  return mix(c, vec3(0.949, 0.549, 0.620), smoothstep(0.60, 1.00, x));
}

// A star's brightness follows a power law — a field is mostly faint dust
// with a handful of blazing exceptions — and its colour follows its
// temperature, blue-white through white into warm. Each pixel scans its
// 3x3 cell neighbourhood, so a star's light must die inside 1.5 cells or
// it clips into a rectangle: sigmaHi and the cross budget are sized per
// layer, and only the coarse layer can afford giants. Radii are floored
// at a pixel so nothing aliases.
vec3 starLayer(vec2 sp, float px, vec2 grid, vec2 offset, float density, float sigmaHi, float giant) {
  vec3 light = vec3(0.0);
  vec2 base = floor(sp * grid + offset);
  for (int cy = -1; cy <= 1; cy++) {
    for (int cx = -1; cx <= 1; cx++) {
      vec2 cell = base + vec2(float(cx), float(cy));
      float seed = hash21(cell);
      if (seed < 1.0 - density) continue;
      vec2 pos = (cell + 0.1 + 0.8 * hash22(cell) - offset) / grid;
      float mag = pow(hash21(cell + 9.0), 4.0);
      float temp = hash21(cell + 23.0);
      vec3 tint = mix(mix(vec3(0.62, 0.74, 1.0), vec3(1.0), smoothstep(0.0, 0.55, temp)),
        vec3(1.0, 0.82, 0.60), smoothstep(0.55, 1.0, temp));
      vec2 d = sp - pos;
      float r = length(d);
      float sigma = max(mix(0.0026, sigmaHi, mag), px * 0.9);
      float glow = exp(-sq(r / sigma)) * (0.16 + 1.1 * mag)
        + exp(-sq(r / (sigma * 3.2))) * mag * (0.08 + 0.24 * giant);
      float thick = max(sigma * 0.4, px * 0.8);
      float arm = sigma * 7.0;
      glow += (exp(-sq(d.x / arm)) * exp(-sq(d.y / thick))
        + exp(-sq(d.y / arm)) * exp(-sq(d.x / thick))) * smoothstep(0.5, 0.9, mag) * 0.30 * giant;
      // Faint stars shimmer hard; the bright ones barely breathe.
      float twinkle = 1.0 - mix(0.5, 0.12, mag) * (0.5 + 0.5 * sin(turn(0.4 + seed) + seed * TAU));
      light += tint * glow * twinkle;
    }
  }
  return light;
}

void main() {
  // A slow breathing zoom and roll: the lens moves, the floor does not.
  float roll = 0.026 * sin(turn(0.11));
  vec2 s = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5) * 2.0 * (1.0 + 0.030 * sin(turn(0.15)));
  s = vec2(s.x * cos(roll) - s.y * sin(roll), s.x * sin(roll) + s.y * cos(roll));

  float horizon = uTideHorizon;
  // The eclipse holds the centre of the sky: the lens flare below hangs
  // ghosts on the line from it through the frame centre, and a drifting
  // source would drag them across the headline.
  vec2 orb = vec2(0.0, horizon + uTideLift);

  // Night on an airless plain: one dusty band of rose at the horizon,
  // violet above it, and a zenith close to black so the rim can blaze.
  float lift = clamp((s.y - horizon) / 1.1, 0.0, 1.0);
  vec3 color = mix(HORIZON_DUST, mix(SKY_VIOLET, SKY_ZENITH, smoothstep(0.12, 0.8, lift)),
    smoothstep(0.0, 0.30, lift));

  // One violet nebula lobe, barely there — depth, not decoration.
  float neb = fbm3(vec2(s.x * 0.9 + drift(0.011), s.y * 1.3 + 3.7));
  color = mix(color, SKY_VIOLET, smoothstep(0.55, 0.9, neb)
    * smoothstep(0.0, 0.3, s.y - horizon) * 0.35);

  // Three star layers, fine to coarse, under atmospheric extinction that
  // dims the field toward the horizon. A pale galactic haze leans behind.
  float extinction = smoothstep(0.06, 0.5, lift);
  float milk = exp(-sq((s.y - 0.72 - s.x * 0.28) * 2.1));
  color += vec3(0.72, 0.78, 0.95) * milk * (0.35 + 0.65 * fbm3(s * vec2(2.6, 4.2) + 8.3)) * 0.055 * extinction;
  float starPx = 2.0 / uResolution.y;
  color += (starLayer(s, starPx, vec2(46.0, 34.0), vec2(61.0, 17.0), uTideStarDensity * 0.5, 0.0042, 0.0)
    + starLayer(s, starPx, vec2(27.0, 20.0), vec2(23.0, 89.0), uTideStarDensity * 0.35, 0.0060, 0.0)
    + starLayer(s, starPx, vec2(14.0, 10.0), vec2(47.0, 5.0), uTideStarDensity * 0.22, 0.0095, 1.0)) * extinction;

  // One aurora curtain, thin and slow, hung on a swinging centre line.
  float ribbonLine = 0.66 + 0.15 * sin(turn(0.031) + s.x * 1.1);
  float ribbon = exp(-sq((s.y - ribbonLine) * 6.5));
  float ribbonWeave = fbm2(vec2(s.x * 1.9 + drift(0.017), s.y * 3.3));
  color += AURORA_MINT * ribbon * ribbonWeave * 0.22;

  // The eclipse: a matte stone disc, a thin blazing rim, and a corona
  // whose flare leans with a slow-breathing noise so it reads as plasma
  // rather than a drawn ring.
  vec2 po = s - orb;
  float pd = length(po);
  float flare = 0.7 + 0.6 * fbm2(vec2(po.x * 3.0 + drift(0.008), po.y * 3.0 - drift(0.006)));
  color += RIM_GOLD * exp(-sq((pd - uTideEclipseSize) * 9.0)) * 0.30 * flare;
  color += RIM_GOLD * exp(-sq((pd - uTideEclipseSize) * 55.0)) * 0.85;
  color = mix(color, ECLIPSE_STONE, fall(uTideEclipseSize - 0.008, uTideEclipseSize, pd));

  // The horizon keeps a quiet luminous seam where sky meets floor.
  color += HORIZON_DUST * 0.35 * exp(-sq((s.y - horizon) * 11.0));

  // A photographic flare, laid over sky and floor alike at the very end
  // of main — the flare lives in the lens, not the scene. Ghost images
  // sit on the line from the light through the frame centre, where a
  // camera's internal reflections land: warm near the source, cooling as
  // they cross the centre. The halo is three offset rings, which is what
  // makes its chromatic fringe.
  float flareBreath = (0.85 + 0.15 * sin(turn(0.043))) * uTideFlare;

  if (s.y < horizon) {
    // Two fixed-point steps intersect the ray with the swell. The flat
    // solution is the first guess; each step re-solves the plane at the
    // height the previous hit found.
    float down = horizon - s.y;
    float dist = 1.0 / down;
    float height = 0.0;
    for (int step2 = 0; step2 < 2; step2++) {
      vec2 hit2 = vec2(s.x * dist, dist);
      height = uTideSwell * (0.15 * sin(hit2.y * 0.55 - turn(0.50))
        + 0.10 * sin(hit2.x * 0.85 + turn(0.34))
        + 0.05 * sin((hit2.x + hit2.y) * 1.6 - turn(0.83)));
      dist = (1.0 + height) / down;
    }
    vec2 hit = vec2(s.x * dist, dist);

    // The liquid is lit from beneath: filaments of glow inside a dark
    // body, the way bioluminescence outlines the water that moves.
    vec2 flow = vec2(hit.x * 0.42, hit.y * 0.42 + drift(0.10));
    vec2 churn = vec2(
      fbm2(flow + vec2(drift(0.05), 0.0)),
      fbm2(flow + vec2(7.3, 2.9)));
    float vein = fbm3(flow + 1.9 * churn);
    float filament = pow(1.0 - abs(2.0 * vein - 1.0), 6.0);
    float lace = pow(1.0 - abs(2.0 * fbm3(flow * 2.7 + 1.3 * churn.yx + vec2(4.2, 8.8)) - 1.0), 8.0);
    // The finest thread only the near water can resolve.
    float thread = pow(1.0 - abs(2.0 * fbm2(flow * 6.3 + 2.1 * churn + vec2(9.7, 1.3)) - 1.0), 10.0);

    // The glow's hue wanders the spectral band across the plane, slowly
    // enough that no two swells share a colour but nothing strobes.
    float hue = clamp(fbm2(vec2(hit.x * 0.11 + drift(0.013), hit.y * 0.11)) * 1.7 - 0.15 + uTideHueShift, 0.0, 1.0);
    vec3 glow = seaPalette(hue);

    // Fine filaments must dissolve before the horizon can alias them.
    float sharp = fall(5.0, 22.0, dist);

    vec3 sea = mix(SKY_ZENITH * 0.9, SKY_VIOLET * 0.60, 0.30 + 0.90 * max(height, 0.0));
    sea += glow * filament * 0.85 * uTideGlow * (0.35 + 0.65 * sharp);
    sea += glow * lace * 0.38 * uTideGlow * sharp;
    sea += mix(glow, vec3(1.0), 0.25) * thread * 0.30 * uTideGlow * fall(2.0, 9.0, dist);

    // A surge of bioluminescence rolls from the near edge to the horizon,
    // lighting the filaments as it passes. Its envelope is zero at both
    // ends of the phase, so the restart is silent.
    float surgePhase = mod(uTime * uTideSurgeRate, 1.0);
    float surge = exp(-sq((hit.y - surgePhase * 26.0) * 0.30)) * sq(sin(3.14159265 * surgePhase));
    sea += glow * (filament + lace * 0.5) * surge * 1.1 * uTideGlow;

    // Crests refract toward the next hue over, the way a thin film does.
    vec3 crestTint = seaPalette(clamp(hue + 0.35, 0.0, 1.0));
    sea += mix(crestTint, vec3(1.0), 0.35) * smoothstep(0.14, 0.30, height) * 0.32;

    // The near water is deep, and something far below it is lit.
    sea += vec3(0.043, 0.216, 0.243) * fall(1.0, 3.5, dist) * 0.55;

    // Distant water mirrors the night, as a calm sea does.
    float sheen = smoothstep(3.5, 16.0, dist);
    sea = mix(sea, mix(HORIZON_DUST, SKY_VIOLET, 0.45), sheen * 0.45);

    // The eclipse itself lies mirrored on the water: stone disc and
    // blazing rim folded across the horizon, stretched toward the viewer,
    // displaced by the swell, and broken into streaks along the waves.
    vec2 rp = vec2(s.x + (vein - 0.5) * 0.08, 2.0 * horizon - s.y + height * 0.22);
    vec2 rv = rp - orb;
    rv.y *= 0.45;
    float rd = length(rv);
    float streak = 0.55 + 0.45 * sin(hit.y * 2.6 + turn(0.5) + vein * 3.0);
    float mirrorFade = 0.7 * fall(0.02, 1.1, horizon - s.y);
    sea += RIM_GOLD * exp(-sq((rd - uTideEclipseSize) * 30.0)) * (0.5 + 0.9 * streak) * mirrorFade;
    sea += RIM_GOLD * exp(-sq((rd - uTideEclipseSize) * 7.0)) * 0.25 * mirrorFade;
    sea = mix(sea, ECLIPSE_STONE,
      fall(uTideEclipseSize - 0.012, uTideEclipseSize + 0.01, rd) * mirrorFade * 0.85 * (0.5 + 0.5 * streak));

    // The eclipse's glade: the rim's light broken over the swell, gold at
    // the horizon and cooling as it nears, flickering with the wave phase.
    float path = exp(-sq((s.x - orb.x) * (2.6 + 0.14 * dist)));
    float sparkle = 0.5 + 0.5 * sin(turn(1.3) + hit.y * 5.1 + hit.x * 2.3 + vein * 9.0);
    vec3 gladeTint = mix(HORIZON_DUST, RIM_GOLD, smoothstep(2.0, 12.0, dist));
    sea += gladeTint * path * (0.30 + 0.70 * sq(sparkle)) * uTideGlade * smoothstep(0.35, 2.6, dist);

    // Glitter rides the surface itself: glint cells live in hit space,
    // so they foreshorten with distance and scroll with the water. Each
    // flashes on its own phase, favours the crests, and doubles inside
    // the glade, where a real sea throws its sparkle.
    vec2 gp = vec2(hit.x * 5.0, hit.y * 5.0 + drift(0.55));
    vec2 gCell = floor(gp);
    float gSeed = hash21(gCell + 7.0);
    float glint = exp(-sq(length(gp - gCell - 0.2 - 0.6 * hash22(gCell)) * 8.0));
    float flash = pow(0.5 + 0.5 * sin(turn(1.1) + gSeed * TAU), 6.0);
    // A shimmer front ripples through the glints toward the viewer, so
    // the sparkle reads as one surface moving, not separate lamps.
    float shimmer = 0.45 + 0.55 * sin(turn(0.9) - hit.y * 1.7);
    float crest = 0.35 + 0.65 * smoothstep(0.02, 0.22, height);
    sea += mix(glow, vec3(1.0), 0.6) * step(0.5, gSeed) * glint * flash * shimmer * crest
      * (0.35 + 0.85 * path) * smoothstep(0.55, 1.2, dist) * fall(4.0, 16.0, dist) * 1.3 * uTideGlitter;

    float fog = 1.0 - exp(-dist * 0.05);
    color = mix(sea, color, clamp(fog, 0.0, 1.0));
  }


  {
    vec2 fo = s - orb;
    float halo = length(fo);
    color += vec3(1.00, 0.45, 0.35) * exp(-sq((halo - 0.355) * 38.0)) * 0.070 * flareBreath;
    color += vec3(0.55, 1.00, 0.60) * exp(-sq((halo - 0.380) * 38.0)) * 0.060 * flareBreath;
    color += vec3(0.45, 0.55, 1.00) * exp(-sq((halo - 0.405) * 38.0)) * 0.070 * flareBreath;
    color += RIM_GOLD * exp(-sq(fo.y * 30.0)) * exp(-sq(fo.x * 1.6)) * 0.16 * flareBreath;
    color += vec3(1.00, 0.85, 0.60) * exp(-sq(length(s - orb * 0.65) * 34.0)) * 0.17 * flareBreath;
    color += vec3(0.55, 0.85, 0.80) * exp(-sq((length(s - orb * 0.38) - 0.052) * 70.0)) * 0.100 * flareBreath;
    color += vec3(0.95, 0.60, 0.65) * exp(-sq(length(s) * 18.0)) * 0.090 * flareBreath;
    color += vec3(0.60, 0.55, 0.95) * exp(-sq(length(s + orb * 0.35) * 11.0)) * 0.080 * flareBreath;
    color += vec3(1.00, 0.80, 0.55) * exp(-sq((length(s + orb * 0.75) - 0.125) * 55.0)) * 0.090 * flareBreath;
  }

  // The dark gradients band without a breath of grain.
  color += (hash21(gl_FragCoord.xy) - 0.5) * 0.012;

  gl_FragColor = vec4(toLinear(color), 1.0);
  #include <colorspace_fragment>
}
`

// ── prism ─────────────────────────────────────────────────────────────

const PRISM = /* glsl */`
uniform float uPrismSegments;
uniform float uPrismZoom;
uniform float uPrismDispersion;
uniform float uPrismCells;
uniform float uPrismEdge;
uniform float uPrismGlint;
uniform float uPrismCore;
uniform float uPrismSpin;
uniform float uPrismMorph;
uniform float uPrismPlates;
uniform float uPrismPlateTint;
uniform float uPrismDepth;
uniform float uPrismSpark;

// Nearest and second-nearest cell distances plus the nearest cell's id.
// The difference of the two distances is the cell boundary — where glass
// shows its edges — and each feature point orbits inside its cell, so
// walls slide and plates trade territory instead of holding a mosaic.
// The orbit multiplies turn() by a per-cell integer: any other factor
// would snap when the folded angle wraps.
vec4 cells(vec2 p, float rate) {
  vec2 base = floor(p);
  vec2 f = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 h = hash22(base + offset);
      vec2 point = offset + 0.5 + 0.38 * sin(turn(rate) * (1.0 + floor(h * 3.0)) + h.yx * TAU) - f;
      float d = length(point);
      second = min(second, max(nearest, d));
      if (d < nearest) { nearest = d; id = base + offset; }
      second = max(second, nearest);
    }
  }
  return vec4(nearest, second, id);
}

vec3 prismPalette(float t) {
  return 0.60 + 0.36 * cos(TAU * (vec3(0.95, 0.84, 0.70) * t + vec3(0.02, 0.26, 0.52)));
}

void main() {
  vec2 c = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5) * 2.0;
  float radius = length(c);
  // Changing the count pops a whole mirror line into existence, so the
  // panel steps it in whole mirrors; the field turns underneath the fold.
  float segment = TAU / uPrismSegments;
  float angle = atan(c.y, c.x) + turn(uPrismSpin);
  angle = abs(mod(angle + segment * 0.5, segment) - segment * 0.5);
  // A slow radial breath keeps the fold from reading as a still wheel.
  vec2 q = vec2(cos(angle), sin(angle)) * radius * (1.0 + 0.10 * sin(turn(0.07)));

  vec2 warp = vec2(drift(0.011), -drift(0.008));
  // Dispersion: three radii, one per channel, as glass separates them.
  float r = fbm3(q * uPrismZoom * (1.0 + uPrismDispersion) + warp);
  float g = fbm3(q * uPrismZoom + warp);
  float b = fbm3(q * uPrismZoom * (1.0 - uPrismDispersion) + warp);
  vec3 color = vec3(prismPalette(r * 1.6).r, prismPalette(g * 1.6).g, prismPalette(b * 1.6).b);

  // A deeper dispersion field counter-rotates under the first, so the
  // glass reads as two thicknesses sliding past each other.
  float deepAngle = turn(0.02);
  vec2 deepQ = mat2(cos(deepAngle), -sin(deepAngle), sin(deepAngle), cos(deepAngle)) * q * 1.7 + warp.yx;
  color *= mix(vec3(1.0), 0.60 + 0.48 * prismPalette(fbm3(deepQ * uPrismZoom) * 1.6 + 0.35), uPrismDepth);

  // Three cell layers. Plates: big, slow, each leaning the palette its
  // own way like panes of different cut. Facets: the walls and caustic
  // glints. Sparks: tiny fast facets that only ever flash.
  // Every wall and glint fades toward the fold's centre, where the
  // mirror compresses all three lattices into a white-hot pile.
  float edgeFade = smoothstep(0.04, 0.32, radius);
  vec4 plate = cells(q * uPrismCells * uPrismPlates + vec2(-drift(0.004), drift(0.005)), 0.045 * uPrismMorph);
  float plateSeed = hash21(plate.zw + 7.0);
  color *= mix(vec3(1.0), 0.85 + 0.30 * prismPalette(plateSeed + g * 0.9), uPrismPlateTint);
  color += prismPalette(plateSeed + 0.15) * uPrismEdge * 0.5 * edgeFade * fall(0.0, 0.06, plate.y - plate.x);

  vec4 facet = cells(q * uPrismCells + vec2(0.0, drift(0.006)), 0.12 * uPrismMorph);
  color += vec3(1.0, 0.98, 0.94) * uPrismEdge * 0.85 * edgeFade * fall(0.0, 0.065, facet.y - facet.x);
  float glint = fall(0.0, 0.14, facet.x) *
    (0.5 + 0.5 * sin(turn(0.9) + (facet.x + radius) * 24.0));
  color += vec3(1.0, 0.95, 0.86) * uPrismGlint * edgeFade * pow(glint, 3.0);

  vec4 spark = cells(q * uPrismCells * 2.3 + vec2(drift(0.009), 0.0), 0.2 * uPrismMorph);
  float sparkle = fall(0.0, 0.09, spark.x) *
    (0.5 + 0.5 * sin(turn(1.3) + spark.z * 3.1 + radius * 30.0));
  color += vec3(1.0) * uPrismSpark * edgeFade * pow(sparkle, 4.0);

  // The centre keeps a bright core so the fold reads as one crystal.
  color += CREAM * uPrismCore * exp(-sq(radius * 2.4));
  color *= 1.0 - 0.14 * dot(vUv - 0.5, vUv - 0.5) * 2.4;

  gl_FragColor = vec4(toLinear(color), 1.0);
  #include <colorspace_fragment>
}
`

export const MARBLE_BACKGROUND_SHADERS = {
  waves: `${PRELUDE}${WAVES}`,
  tide: `${PRELUDE}${TIDE}`,
  prism: `${PRELUDE}${PRISM}`,
} satisfies Record<MarbleHandThemeId, string>

// Every panel-tunable number in each field, in tuning-bag key form. The
// uniform name is the key with a `u` prefix; a key listed here without a
// matching uniform declaration in its shader is silently dead, which is
// why setMarbleBackgroundFrame applies by lookup rather than by list.
const MARBLE_BACKGROUND_TUNING = {
  waves: ['wavesZoom', 'wavesWarp', 'wavesRipple', 'wavesContrast', 'wavesShift', 'wavesSheen', 'wavesGloss', 'wavesVignette'],
  tide: ['tideHorizon', 'tideLift', 'tideEclipseSize', 'tideSwell', 'tideGlow', 'tideHueShift', 'tideSurgeRate', 'tideGlitter', 'tideGlade', 'tideFlare', 'tideStarDensity'],
  prism: ['prismSegments', 'prismZoom', 'prismDispersion', 'prismCells', 'prismEdge', 'prismGlint', 'prismCore', 'prismSpin', 'prismMorph', 'prismPlates', 'prismPlateTint', 'prismDepth', 'prismSpark'],
} satisfies Record<MarbleHandThemeId, readonly MarbleHandNumberKey[]>

function marbleBackgroundUniformName(key: string): string {
  return `u${key[0].toUpperCase()}${key.slice(1)}`
}

// The reflection re-bakes only when its key string changes, so a moved
// background slider has to move the key too or the hand keeps reflecting
// the old field until something else re-bakes it.
export function marbleBackgroundTuningStamp(tuning: MarbleHandTuning, theme: MarbleHandThemeId): string {
  return MARBLE_BACKGROUND_TUNING[theme].map((key) => tuning[key]).join(',')
}

export function createMarbleBackgroundMaterial(theme: MarbleHandThemeId): THREE.ShaderMaterial {
  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    ...Object.fromEntries(MARBLE_BACKGROUND_TUNING[theme].map((key) =>
      [marbleBackgroundUniformName(key), { value: marbleHandTuning[key] }])),
  }
  return new THREE.ShaderMaterial({
    name: `marble-hand-background-${theme}`,
    vertexShader: MARBLE_BACKGROUND_VERTEX,
    fragmentShader: MARBLE_BACKGROUND_SHADERS[theme],
    uniforms,
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
  tuning: MarbleHandTuning,
) {
  material.uniforms.uTime.value = time
  // Both canvases — page and reflection — pass through here every draw, so
  // the two copies of a field can never show two different panel values.
  for (const keys of Object.values(MARBLE_BACKGROUND_TUNING)) {
    for (const key of keys) {
      const uniform = material.uniforms[marbleBackgroundUniformName(key)]
      if (uniform) uniform.value = tuning[key]
    }
  }
  material.uniforms.uAspect.value = height > 0 ? width / height : 1
  // SAFETY: createMarbleBackgroundMaterial is the only constructor of these
  // materials and seeds uResolution with a Vector2; nothing replaces it.
  const resolution = material.uniforms.uResolution.value as THREE.Vector2
  resolution.set(width, height)
}
