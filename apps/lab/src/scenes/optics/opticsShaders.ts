// The GLSL half of the optics. The other half is `opticsLaw.ts`, and the
// two are twins: `lensNormal`, `refract` and `landOffset` appear below
// line for line. The shader decides which page texel a fragment shows;
// the law decides which element a click reaches. Change one, change both.
//
// Everything here works in WORLD xy — the scene's camera is
// pixel-calibrated, so a world unit is a CSS px, and the lens plane is a
// disc parked `standoff` units above the page at z = 0. Page coordinates
// (y down, origin at the sheet's corner) exist only on the CPU, where the
// layout table lives.
//
// Three rules, all learned the expensive way in the spike, all silent
// when broken:
//   · end with `#include <colorspace_fragment>` — a raw ShaderMaterial
//     gets none of three's output encoding, and the glass renders a
//     perfect image of the page, uniformly too dark.
//   · write uniforms through the material ref, never the memoized object.
//   · bind the page texture in the frame loop; it does not exist on the
//     first render.

/** How many blocks the paint scope can label at once. */
export const SCOPE_RECTS = 8

// ── the mounts ─────────────────────────────────────────────────────────
//
// Rim and collar, from one shader with one switch. No lights and no
// environment map anywhere in this scene: the sheet is paint and the
// instruments are turned metal, and both are drawn rather than lit — so
// the scene has nothing to fetch and nothing to go dark if a preset fails
// to load. `uRibs` at 0 is a smooth rim; at 88 it is a knurled collar you
// can see turn.

export const OPTICS_METAL_VERT = /* glsl */ `
varying vec2 vPos;

void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const OPTICS_METAL_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform float uInner;
uniform float uOuter;
uniform float uRibs;

varying vec2 vPos;

void main() {
  float r = length(vPos);
  vec2 d = vPos / max(r, 1.0e-4);

  // A cylindrical bevel across the ring's width — bright along the crown,
  // falling to both edges. This is what reads as a turned part rather
  // than as a flat annulus.
  float t = clamp((r - uInner) / max(uOuter - uInner, 1.0e-4), 0.0, 1.0);
  float crown = sin(t * 3.14159265);
  float key = 0.5 + 0.5 * dot(d, normalize(vec2(-0.5, 0.78)));
  float rib = uRibs > 0.5
    ? 0.62 + 0.38 * pow(0.5 + 0.5 * cos(atan(vPos.y, vPos.x) * uRibs), 1.4)
    : 1.0;

  vec3 col = uColor * (0.30 + 0.62 * key) * (0.52 + 0.72 * crown) * rib;
  col += vec3(1.0) * 0.30 * pow(key, 14.0) * crown;
  gl_FragColor = vec4(col, 1.0);

  #include <colorspace_fragment>
}
`

// ── the free sheet's frame ─────────────────────────────────────────────
//
// The turned instruments wear a ring and a knurled collar. The sheet is
// bare glass, so its whole mount is a thin band around the edge, and that
// band carries all three grips: the sides move it, the corner squares
// resize it, and a knurled track along the bottom sets its power.
//
// The track is the reason this is a shader and not four boxes. As the
// sheet grows, its corner moves further from the axis and CAP_MARGIN takes
// powers away from both ends of the collar — so the reachable part of the
// track is drawn lit and the rest dark. Enlarge the sheet and you watch the
// usable band close in. That is the law, on the instrument, without a word
// of explanation.
//
// The mesh is a unit plane scaled to the outer size, so `vPos` is the
// offset from the sheet's centre in world px and every extent below is a
// real distance rather than a fraction.

export const OPTICS_FRAME_VERT = /* glsl */ `
varying vec2 vPos;

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 o = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vPos = w.xy - o.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const OPTICS_FRAME_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform vec2  uHalf;
uniform float uBand;
uniform float uGrip;
// Where the collar sits, and the part of the track it can still reach,
// both as fractions of the instrument's DECLARED range.
uniform float uTick;
uniform vec2  uTrack;

varying vec2 vPos;

void main() {
  vec2 d = abs(vPos) - uHalf;
  float inner = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  // Inside is glass and outside is bench; this shader owns only the band.
  if (inner < 0.0 || inner > uBand) discard;

  float t = clamp(inner / uBand, 0.0, 1.0);
  float crown = sin(t * 3.14159265);
  float key = 0.5 + 0.5 * dot(normalize(vPos), normalize(vec2(-0.5, 0.78)));
  vec3 col = uColor * (0.34 + 0.56 * key) * (0.55 + 0.68 * crown);

  if (d.x > 0.0 && d.y > 0.0) {
    // A corner square. Flat and pale, so it reads as something to take
    // hold of rather than as more frame.
    col = mix(uColor * 1.4, vec3(0.95), 0.24) * (0.74 + 0.42 * crown);
  } else if (vPos.y < 0.0 && d.y > 0.0 && abs(vPos.x) < uGrip) {
    // Ribs at a fixed spatial frequency: resizing the sheet must not
    // stretch the knurl, or the grip would read as a different part.
    col *= 0.66 + 0.34 * pow(0.5 + 0.5 * cos(vPos.x * 0.7), 1.4);
    float u = (vPos.x / uGrip) * 0.5 + 0.5;
    if (u < uTrack.x || u > uTrack.y) col *= 0.40;
    float tick = abs(vPos.x - (uTick * 2.0 - 1.0) * uGrip);
    col = mix(vec3(0.07, 0.08, 0.10), col, smoothstep(0.0, 1.7, tick));
  }

  gl_FragColor = vec4(col, 1.0);

  #include <colorspace_fragment>
}
`

export const OPTICS_LENS_VERT = /* glsl */ `
varying vec3 vWorld;

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const OPTICS_LENS_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uPage;
// The offscreen pass frames exactly the disc that opticsLaw's
// footprint() reports: centre in .xy, half-extent in .zw, world units.
uniform vec4  uFrame;
uniform vec3  uCamPos;
uniform vec2  uCenter;
uniform float uAperture;
// Half-width and half-height when the face is a rectangle; (0,0) for a
// disc. opticsLaw.inAperture, as a distance field.
uniform vec2  uHalf;
uniform float uCurvature;
uniform float uStandoff;
uniform float uIor;
uniform float uTint;
// 0 — glass. 1 — the paint scope, which looks through a flat face and
// spends its contrast on the ledger instead of on the page.
uniform float uMode;
uniform vec4  uRects[${SCOPE_RECTS}];
uniform float uHeat[${SCOPE_RECTS}];

varying vec3 vWorld;

// opticsLaw.lensNormal
vec3 lensNormal(vec2 p, float curvature) {
  if (abs(curvature) > 1.0e7) return vec3(0.0, 0.0, 1.0);
  float k = sqrt(max(curvature * curvature - dot(p, p), 1.0e-6));
  return normalize(vec3(curvature < 0.0 ? -p : p, k));
}

// Signed distance to the edge of the glass: negative inside, 0 on the edge.
// The disc branch is r minus the aperture and the rect branch the usual box
// field, so everything downstream — the cut, the cell vignette, the
// feathered edge — is written once against a number instead of twice
// against a shape.
float faceEdge(vec2 p) {
  if (uHalf.x <= 0.0) return length(p) - uAperture;
  vec2 d = abs(p) - uHalf;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// A cool-to-hot ramp for paints per second. Deliberately not a rainbow:
// the reading that matters is "is this block painting at all", and a ramp
// that starts at the page's own grey answers it without a legend.
vec3 heat(float t) {
  vec3 calm  = vec3(0.24, 0.62, 0.47);
  vec3 warm  = vec3(0.93, 0.72, 0.22);
  vec3 hot   = vec3(0.92, 0.27, 0.22);
  return t < 0.5 ? mix(calm, warm, t * 2.0) : mix(warm, hot, (t - 0.5) * 2.0);
}

void main() {
  vec2 p = vWorld.xy - uCenter;
  float edge = faceEdge(p);
  if (edge > 0.0) discard;

  // Under a perspective eye the incident ray is per-fragment. This one
  // line is the whole difference from the orthographic spike.
  vec3 I = normalize(vWorld - uCamPos);

  vec3 n = lensNormal(p, uCurvature);
  vec3 rd = refract(I, n, 1.0 / uIor);
  // GLSL reports total internal reflection as a zero vector; a ray bent
  // back up never reaches the page either.
  if (rd.z >= -1.0e-9) discard;

  vec2 landed = uCenter + p + (uStandoff / -rd.z) * rd.xy;
  vec2 uv = (landed - uFrame.xy) / (2.0 * uFrame.zw) + 0.5;
  vec3 col = texture2D(uPage, clamp(uv, 0.0, 1.0)).rgb;

  if (uMode > 0.5) {
    // Drain the page to a ghost, then paint the ledger over it. The
    // outlines are the second reading: they are the Surface boundaries,
    // invisible on the page and the reason the loupe can sharpen one
    // block without paying for the rest.
    float g = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(g), col, 0.14) * 0.85 + 0.09;
    for (int i = 0; i < ${SCOPE_RECTS}; i++) {
      vec4 q = uRects[i];
      if (q.z <= 0.0) continue;
      vec2 d = abs(landed - q.xy) - q.zw;
      float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      if (outside > 0.0) continue;
      col = mix(col, heat(clamp(uHeat[i], 0.0, 1.0)), 0.16 + 0.42 * clamp(uHeat[i], 0.0, 1.0));
      col = mix(col, vec3(0.10, 0.11, 0.13), smoothstep(-1.6, -0.2, outside));
    }
  }

  // A cell, not a decoration: a real loupe's mount vignettes the last
  // couple of millimetres, and the eye reads the darkening as thickness.
  // Measured inward from the edge, so a rectangle darkens along its sides
  // rather than in a circle that would ignore the corners.
  float depth = uHalf.x > 0.0 ? min(uHalf.x, uHalf.y) : uAperture;
  col *= 1.0 - 0.30 * smoothstep(-0.12 * depth, 0.0, edge);
  // One glint off the curved face, steep enough to stay at the rim where
  // the curvature is, so it never sits on top of the thing being read.
  col += uTint * pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.70))), 0.0), 9.0);

  float alpha = 1.0 - smoothstep(-1.0, 0.0, edge);
  gl_FragColor = vec4(col * alpha, alpha);

  #include <colorspace_fragment>
}
`
