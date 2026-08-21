// The candidates' shaders — seven deformations of one captured page.
//
// Every shader here samples a DOM capture, so every one of them obeys the
// same two rules and states them once:
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
//   black. 2026-08-20: every selection strip drew an opaque black bar
//   across its interior — the plateau is where `1.0 - fill` is exactly
//   0.0, and its rim stayed clean because only there was the base
//   nonzero. Every pow base here is clamped to at least 1e-4.
//
// The corner mask is spliced rather than inherited: a custom material is
// the one thing Munari cannot cut corners for, because only the shader
// knows its own varyings and alpha mode.

import { SURFACE_RADIUS_GLSL } from '@petepetrash/munari'

/** Light direction shared by every candidate, so one hand lit them all. */
// Every fragment shader here ends with `#include <colorspace_fragment>`.
// The Surface texture is SRGBColorSpace, so the sampler hands this shader
// LINEAR values, and a raw ShaderMaterial writes straight to the
// framebuffer with none of the encoding three injects into its own
// materials. Without the chunk the whole capture goes through one extra
// sRGB→linear decode and lands dark: the candidates' #f2f0e4 panel
// measured 226,222,198 in Chrome on 2026-08-20 — a 30-count drop in blue,
// which reads as the white background vanishing for the length of the
// effect and snapping back at the end.

export const LIGHT: readonly [number, number, number] = [-0.34, 0.52, 0.78]

const HASH = /* glsl */ `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }
`

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

export const RIPPLE_VERT = /* glsl */ `
  uniform vec2 uSize;
  uniform vec2 uOrigin;
  uniform float uT;
  uniform float uLift;
  uniform float uBend;
  uniform float uWaveLen;
  uniform float uFlap;
  varying vec2 vUv;
  varying vec3 vNormal;

  const float PI = 3.141592653589793;

  void main() {
    vUv = uv;
    // uv.y runs bottom → top; the click arrives in content coordinates,
    // which run top → bottom.
    vec2 p = vec2(uv.x * uSize.x, (1.0 - uv.y) * uSize.y);
    float d = distance(p, uOrigin);
    float span = max(0.5 * length(uSize), 1.0);
    float far = clamp(d / span, 0.0, 1.0);

    // Up fast, settle slow. The 0.7 power puts the peak around a third of
    // the effect, where a finger's own press peaks.
    float env = sin(PI * pow(clamp(uT, 1e-4, 1.0), 0.7));

    // Pinned at the finger: both terms carry the far-field weight, so the
    // pressed point never moves and the free corners do the flapping.
    float rise = uLift * pow(max(far, 1e-4), 1.4);
    float phase = 2.0 * PI * d / uWaveLen - uFlap * uT;
    float flap = uBend * sin(phase) * far;
    float z = env * (rise + flap);

    // dz/dd, analytically, for the normal. The far-field ramp of the flap
    // term contributes an order less than the wave itself and is dropped.
    float slope = env * (
      uLift * 1.4 * pow(max(far, 1e-3), 0.4) / span +
      uBend * cos(phase) * (2.0 * PI / uWaveLen) * far
    );
    vec2 dir = d > 1e-3 ? (p - uOrigin) / d : vec2(0.0);
    // Content y runs down; the world's runs up. Flip so the shared light
    // means the same thing here as everywhere else.
    vNormal = normalize(vec3(-slope * dir.x, slope * dir.y, 1.0));

    vec3 moved = position;
    moved.z += z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
  }
`

export const RIPPLE_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec3 uLightDir;
  uniform float uShadeGain;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 c = texture2D(tMap, vUv);
    vec3 n = normalize(vNormal);
    vec3 L = normalize(uLightDir);
    // Relative to flat: a face turned toward the light brightens, turned
    // away darkens, and an undisplaced pixel is untouched — which is what
    // keeps the control its own colour for the whole press.
    float lit = (dot(n, L) - L.z) * uShadeGain;
    float spec = pow(max(dot(n, L), 1e-4), 34.0) - pow(max(L.z, 1e-4), 34.0);
    c.rgb += clamp(lit + spec * 0.5, -0.35, 0.6) * c.a;
    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`

// ── 2. the selection bubble ──────────────────────────────────────────────
//
// One strip of glass per selected LINE, and the strips do not know about
// each other. That independence is the whole design and it was learned the
// hard way: the first version welded every client rect into a single blob
// with a smooth-min and magnified about the blob's centroid, so extending
// a selection onto a third line moved the centroid and every word on the
// first two lines jumped. Nothing was wrong with the refraction — the
// refraction was correct about a shape that had just changed.
//
// So the field takes the NEAREST rect rather than a welded union, and
// hands the fragment stage that rect's own centre and half-height. A line
// added below cannot move a sample above it, because no term in the first
// line's shading refers to anything outside the first line's rect.
//
// The page copy hides the selected glyphs with a transparent `::selection`
// and nothing else — the parked source never carries a selection, so the
// capture keeps the text the glass is showing. That split is the only
// reason the glass is not a double image.

const BUBBLE_FIELD = /* glsl */ `
  uniform vec4 uRects[8];
  uniform int uRectCount;
  uniform float uCorner;
  uniform float uEdge;
  uniform float uHeight;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + r;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }

  // Content px, top-left origin. Returns the nearest strip's signed
  // distance (negative inside), its centre, and its half-height — a plain
  // min, so a strip's own answer is never a function of its neighbours.
  vec4 bubbleNear(vec2 p) {
    float d = 1e5;
    vec2 c = vec2(0.0);
    float hh = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uRectCount) break;
      vec4 r = uRects[i];
      float rr = min(uCorner, min(r.z, r.w) * 0.5);
      vec2 ci = r.xy + r.zw * 0.5;
      float di = sdRoundBox(p - ci, r.zw * 0.5, rr);
      if (di < d) {
        d = di;
        c = ci;
        hh = r.w * 0.5;
      }
    }
    return vec4(d, c, hh);
  }

  float bubbleSd(vec2 p) {
    return bubbleNear(p).x;
  }

  // A circular arc from the rim to the flat top: vertical at the edge,
  // which is what gives a droplet its bright thin border.
  float bubbleHeight(float d) {
    float t = clamp(-d / uEdge, 0.0, 1.0);
    return uHeight * sqrt(t * (2.0 - t));
  }
`

export const BUBBLE_VERT = /* glsl */ `
  uniform vec2 uSize;
  uniform float uT;
  ${BUBBLE_FIELD}
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec2 p = vec2(uv.x * uSize.x, (1.0 - uv.y) * uSize.y);
    vec3 moved = position;
    moved.z += bubbleHeight(bubbleSd(p)) * uT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
  }
`

export const BUBBLE_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uSize;
  uniform float uT;
  uniform float uMagnify;
  uniform float uRefract;
  uniform float uDisperse;
  uniform vec2 uShadowOffset;
  uniform float uShadowSoft;
  uniform float uShadowAlpha;
  uniform vec3 uLightDir;
  uniform vec3 uTint;
  uniform float uTintGain;
  uniform float uDepth;
  uniform float uSpec;
  uniform float uSheen;
  uniform float uRim;
  ${BUBBLE_FIELD}
  varying vec2 vUv;

  vec2 toUv(vec2 p) {
    return clamp(vec2(p.x / uSize.x, 1.0 - p.y / uSize.y), vec2(0.0), vec2(1.0));
  }

  void main() {
    vec2 p = vec2(vUv.x * uSize.x, (1.0 - vUv.y) * uSize.y);
    vec4 near = bubbleNear(p);
    float d = near.x;
    vec2 center = near.yz;
    float halfH = max(near.w, 1.0);

    if (d > 0.0) {
      // Outside the glass: the only thing drawn is the shadow it casts on
      // the page it is floating over. Premultiplied black darkens the DOM
      // underneath without tinting it.
      float sd = bubbleSd(p - uShadowOffset);
      float a = uShadowAlpha * uT * (1.0 - smoothstep(-uShadowSoft, uShadowSoft, sd));
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      #include <colorspace_fragment>
      return;
    }

    float e = 1.25;
    float h = bubbleHeight(d);
    float hx = bubbleHeight(bubbleSd(p + vec2(e, 0.0))) - bubbleHeight(bubbleSd(p - vec2(e, 0.0)));
    float hy = bubbleHeight(bubbleSd(p + vec2(0.0, e))) - bubbleHeight(bubbleSd(p - vec2(0.0, e)));
    vec3 n = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));
    float fill = h / max(uHeight, 1e-4);

    // The top is a lens: it pulls the page in toward THIS strip's centre.
    // The rim is a bevel: it bends the sample outward along the normal, so
    // words compress into the border rather than stopping at it.
    vec2 lensed = mix(p, center, uMagnify * fill * uT);
    vec2 bend = vec2(n.x, n.y) * uRefract * (1.0 - fill) * uT;

    // Real glass does not bend every wavelength the same amount, and the
    // rim is where the difference is large enough to see. Sampled as three
    // offsets of one bend rather than three bends, so the split is always
    // along the surface normal and cannot smear a glyph sideways.
    vec4 mid = texture2D(tMap, toUv(lensed + bend));
    vec4 c = vec4(
      texture2D(tMap, toUv(lensed + bend * (1.0 + uDisperse))).r,
      mid.g,
      texture2D(tMap, toUv(lensed + bend * (1.0 - uDisperse))).b,
      mid.a
    );

    // A body of glass is lit from above: brighter along a strip's top
    // edge, shaded along its bottom. Measured against the strip's own
    // centre, which is why this term does not move when a line is added.
    float up = clamp((center.y - p.y) / halfH, -1.0, 1.0);
    c.rgb *= mix(1.0, 1.0 + uDepth * up, uT * fill);

    // Glass adds light, it does not replace pixels: a body tint that grows
    // with thickness, a broad sheen, a tight specular, and a bright rim
    // where the arc turns vertical.
    vec3 L = normalize(uLightDir);
    float lambert = max(dot(n, L), 1e-4);
    float spec = pow(lambert, 48.0);
    float sheen = pow(lambert, 6.0);
    float rim = pow(max(1.0 - fill, 1e-4), 2.5);
    c.rgb += (uTint * uTintGain * fill + spec * uSpec + sheen * uSheen + rim * uRim) * uT * c.a;

    float aa = fwidth(d) + 1e-4;
    c *= 1.0 - smoothstep(-aa, aa, d);
    // The whole strip rides the ease. Without this the glass at uT ≈ 0
    // still draws the texture's copy of the paragraph over the page's at
    // full alpha — invisible when they agree, a faint permanent blur where
    // the resampling doesn't.
    c *= min(uT * 3.0, 1.0);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`

// ── 3 & 7b. the rolled sheet ─────────────────────────────────────────────
//
// Shared by the dropdown that unrolls and the peel-away delete. The winding
// happens on the CPU (candidateCurlLaw.ts) rather than here, for the reason
// the fisheye scene is named after: three raycasts CPU geometry, so a
// vertex-shader-only warp bends the pixels and leaves the hit test on the
// flat sheet — a menu row that responds where it USED to be. Vertices move,
// normals come with them, and the shader only lights what it is given.

export const SHEET_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const SHEET_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec3 uLightDir;
  uniform vec3 uBackColor;
  uniform float uShade;
  uniform float uOpacity;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 L = normalize(uLightDir);
    float lambert = max(dot(n, L), 0.0);
    float shade = mix(1.0 - uShade, 1.0, lambert);

    if (!gl_FrontFacing) {
      // The far side of a roll is the back of the sheet. Showing the
      // capture there would mirror the menu's own text onto the underside,
      // which is the single loudest way to say "this is a texture on a
      // cylinder" instead of "this is paper".
      gl_FragColor = vec4(uBackColor * shade, 1.0);
    } else {
      vec4 c = texture2D(tMap, vUv);
      c.rgb *= shade;
      // A specular streak along the roll: the only cue that separates a
      // cylinder from a gradient.
      float spec = pow(max(dot(n, L), 1e-4), 24.0);
      c.rgb += spec * 0.30 * c.a;
      c *= munariRadiusMask(vUv);
      gl_FragColor = c;
    }
    #include <colorspace_fragment>
    // The tuck fade scales AFTER the sRGB conversion: the transfer curve is
    // nonlinear, and premultiplied rgb pushed through it at fractional
    // alpha comes out lifted. 2026-08-20: the closing coil flashed WHITE
    // over its last frames instead of fading behind the trigger.
    gl_FragColor *= uOpacity;
  }
`

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

export const CLOUD_VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec2 aUv;
  attribute vec3 aSeed;
  uniform float uT;
  uniform vec3 uTravel;
  uniform float uSwirl;
  uniform float uBulge;
  uniform float uTwist;
  uniform float uStagger;
  uniform float uGrain;
  uniform float uReverse;
  varying vec2 vUv;
  varying vec2 vQuad;
  varying float vArc;

  const float PI = 3.141592653589793;

  void main() {
    vUv = aUv;
    vQuad = aCorner;
    float s = clamp((uT - aSeed.z * uStagger) / (1.0 - uStagger), 0.0, 1.0);
    float e = s * s * (3.0 - 2.0 * s);
    // Arriving clouds run the same path backwards, so both halves of the
    // crossing share one arc and meet travelling the same way.
    float phase = mix(e, 1.0 - e, uReverse);
    vArc = sin(PI * phase);

    vec3 p = mix(position, position + uTravel, phase);
    float ang = aSeed.x * 2.0 * PI + phase * uTwist;
    float r = uSwirl * vArc * (0.35 + aSeed.y);
    p += vec3(cos(ang) * r, sin(ang) * r, vArc * uBulge * (0.3 + aSeed.y));

    // Billboarded in view space. Grains swell in the middle of the flight
    // so the cloud reads as a cloud rather than as a grid in transit, and
    // shrink back to exactly one texel-block at both ends.
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += aCorner * uGrain * (1.0 + 1.35 * vArc);
    gl_Position = projectionMatrix * mv;
  }
`

export const CLOUD_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uPitchUv;
  uniform float uFade;
  uniform float uSpark;
  uniform vec3 uFlare;
  uniform float uFlareGain;
  varying vec2 vUv;
  varying vec2 vQuad;
  varying float vArc;

  void main() {
    // The resolve, staged by how far this grain is from rest. In the air a
    // grain shows one sample of a COARSE mosaic cell — up to seven grains
    // share each cell, so what settles first is a field of big soft
    // pixels. As vArc falls the cell pitch shrinks to one grain, and only
    // at rest does the sharp term spread the sample across its own texel
    // footprint, at which point the field IS the capture and the DOM swap
    // at t = 1 has nothing left to reveal. 2026-08-20: uPitchUv was
    // missing from the material and silently zero, so no grain ever
    // resolved past one texel and the swap arrived as a pop.
    vec2 fullUv = vUv + vQuad * uPitchUv;
    // The coarse pass is a BUMP, not a ramp: cells swell only while a
    // grain is just off rest, so the pixelation reads as an image-space
    // mosaic on the assembling figure. Mid-flight the bump is over and a
    // grain is back to its own texel — a ramp held the whole flight at
    // 7-grain cells, whose centres mostly miss the 3px stroke, and the
    // cloud stopped carrying the figure at all.
    float cells = 1.0 + 5.0 * smoothstep(0.015, 0.06, vArc) * (1.0 - smoothstep(0.12, 0.38, vArc));
    vec2 pitch = uPitchUv * cells;
    vec2 mosaic = (floor(fullUv / pitch) + 0.5) * pitch;
    mosaic = clamp(mosaic, uPitchUv * 0.5, 1.0 - uPitchUv * 0.5);
    float sharp = 1.0 - smoothstep(0.0, 0.03, vArc);
    vec4 c = texture2D(tMap, mix(mosaic, fullUv, sharp));
    if (c.a < 0.02) discard;

    // Each cloud carries its colour toward the OTHER tile's as it crosses,
    // so where the two clouds hand over they are the same colour and the
    // seam has nothing to show. Premultiplied: the target colour is scaled
    // by the grain's own alpha.
    c.rgb = mix(c.rgb, uFlare * c.a, vArc * uFlareGain);
    c.rgb += uSpark * vArc * c.a;

    // Square while it is part of the element, round while it is matter in
    // the air.
    float disc = 1.0 - smoothstep(0.34, 0.5, length(vQuad));
    float m = mix(1.0, disc, smoothstep(0.0, 0.18, vArc));
    gl_FragColor = c;
    #include <colorspace_fragment>
    // The disc edge and the crossfade scale AFTER the sRGB conversion —
    // the transfer curve lifts premultiplied rgb at fractional alpha, and
    // with the whole flight spent below full fade the lift stacked across
    // overlapping grains into a white-hot core (2026-08-20).
    gl_FragColor *= m * uFade;
  }
`

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

export const PRISM_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uOn;
  uniform float uLift;
  uniform float uWave;
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    float a = uv.x * 6.2 + uTime * 1.35;
    float b = uv.y * 4.1 - uTime * 1.05;
    float w = sin(a) * cos(b);
    vec3 moved = position;
    moved.z += (uLift + uWave * w) * uOn;
    // Analytic normal of the same surface, in content px.
    vec3 dx = vec3(1.0, 0.0, uWave * cos(a) * cos(b) * 6.2 * uOn);
    vec3 dy = vec3(0.0, 1.0, uWave * -sin(a) * sin(b) * 4.1 * uOn);
    vNormal = normalize(cross(dx, dy));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
  }
`

export const PRISM_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uTexel;
  uniform float uOn;
  uniform float uScan;
  uniform float uScanWidth;
  uniform float uDisperse;
  uniform float uPrism;
  uniform float uGlow;
  uniform float uEdgeGain;
  uniform vec3 uCool;
  uniform vec3 uWarm;
  uniform vec3 uBacklight;
  uniform float uBackGain;
  uniform vec3 uLightDir;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;
  varying vec3 vNormal;

  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 n = normalize(vNormal);
    vec2 disp = n.xy * uDisperse * uOn;

    vec4 c = texture2D(tMap, vUv);
    float r = texture2D(tMap, vUv + disp).r;
    float b = texture2D(tMap, vUv - disp).b;
    c.r = mix(c.r, r, uOn);
    c.b = mix(c.b, b, uOn);

    // Where the glyphs are, in gradient terms. The block's background is
    // opaque, so alpha says nothing here and luminance has to.
    float gx = lum(texture2D(tMap, vUv + vec2(uTexel.x, 0.0)).rgb)
             - lum(texture2D(tMap, vUv - vec2(uTexel.x, 0.0)).rgb);
    float gy = lum(texture2D(tMap, vUv + vec2(0.0, uTexel.y)).rgb)
             - lum(texture2D(tMap, vUv - vec2(0.0, uTexel.y)).rgb);
    float edge = clamp(length(vec2(gx, gy)) * uEdgeGain, 0.0, 1.0);

    // The read head: a band that walks the block top to bottom.
    float band = (vUv.y - uScan) / uScanWidth;
    float scan = exp(-band * band);

    // Which way the sheet is leaning decides which of the two colours the
    // glyph edge picks up. Multiplied by the scan so the colour is only
    // ever where the reader is.
    vec3 duo = mix(uCool, uWarm, clamp(0.5 + n.x * 26.0, 0.0, 1.0));
    c.rgb += edge * duo * uPrism * uOn * scan * c.a;

    // The backlight: warm, broad, and behind the read head rather than on
    // it. The 0.55 power is what spreads it past the band's own width —
    // a glow the same width as the scan looks like a scanner, and a glow
    // wider than it looks like something behind the page is lit.
    c.rgb += (uBacklight * pow(max(scan, 1e-4), 0.55) * uBackGain + scan * uGlow) * uOn * c.a;

    vec3 L = normalize(uLightDir);
    float spec = pow(max(dot(n, L), 1e-4), 30.0);
    c.rgb += spec * 0.22 * uOn * c.a;

    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`

// ── 6. the copy, drawn into the cursor ───────────────────────────────────
//
// The page keeps its code block: this is a Twin, and the thing that flies
// is a second presentation of the same content. That is the whole reason
// the gesture reads as COPY rather than as move — the original never left,
// and there was no moment when it was not there to be seen.

export const SUCK_VERT = /* glsl */ `
  uniform vec2 uCursor;
  uniform float uT;
  uniform float uSpan;
  uniform float uTwist;
  uniform float uArc;
  uniform float uLag;
  varying vec2 vUv;
  varying vec3 vNormal;

  const float PI = 3.141592653589793;

  void main() {
    vUv = uv;
    vec2 rel = position.xy - uCursor;
    float dist = length(rel);
    // The near corner goes first and the far corner trails. Without the
    // lag the block scales toward a point, which is a transform anyone can
    // write; with it the sheet is drawn in like cloth through a ring.
    float t = clamp((uT - uLag * (dist / max(uSpan, 1e-4))) / (1.0 - uLag), 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);

    float ang = e * uTwist * (1.0 - clamp(dist / max(uSpan, 1e-4), 0.0, 1.0));
    float ca = cos(ang);
    float sa = sin(ang);
    rel = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);

    // The arc's slope along the radial direction, for the normal: the
    // sheet tips as it is drawn through the ring, and the light sliding
    // across that tip is the material's character — colour stays put.
    float slope = PI * cos(PI * e) * uArc * (1.6 / max(uSpan, 1.0));
    vec2 dir = dist > 1e-3 ? rel / dist : vec2(0.0);
    vNormal = normalize(vec3(-slope * dir.x, slope * dir.y, 1.0));

    vec3 p = vec3(uCursor + rel * (1.0 - e), sin(PI * e) * uArc);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const SUCK_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform float uT;
  uniform vec3 uLightDir;
  uniform float uDiffuse;
  uniform float uSpecPow;
  uniform float uSpecGain;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 c = texture2D(tMap, vUv);
    // Specular relative to flat, so an untipped pixel is untouched: the
    // sheet glints as it turns without ever changing its own colour. The
    // first version added a flat "heat" term instead, and the whole block
    // washed out on its way in.
    vec3 n = normalize(vNormal);
    vec3 L = normalize(uLightDir);
    // Two bounds, not one. The diffuse tip shading is capped at ±uDiffuse
    // (default 0.1), because the block is near-black and any broad
    // addition is a large relative shift — one shared 0.45 cap turned the
    // whole flying sheet mid-grey (2026-08-20). The glint is tight
    // (uSpecPow, default 48) and strong: a narrow highlight can be bright
    // without changing the sheet's colour.
    float lit = clamp((dot(n, L) - L.z) * 0.5, -uDiffuse, uDiffuse);
    float spec = pow(max(dot(n, L), 1e-4), uSpecPow) - pow(max(L.z, 1e-4), uSpecPow);
    c.rgb += (lit + clamp(spec, 0.0, 1.0) * uSpecGain) * c.a;
    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
    // The exit fade scales AFTER the sRGB conversion — pushing
    // premultiplied rgb through the transfer curve at fractional alpha
    // lifts it, and the whole block visibly whitened on its way into the
    // cursor (2026-08-20).
    gl_FragColor *= 1.0 - smoothstep(0.72, 1.0, uT);
  }
`

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

export const MELT_VERT = /* glsl */ `
  uniform float uT;
  uniform vec2 uSize;
  uniform float uExit;
  uniform float uWaver;
  uniform float uStreams;
  uniform float uGather;
  ${HASH}
  varying vec2 vUv;
  varying float vRun;
  varying float vNeck;
  varying float vGap;

  void main() {
    vUv = uv;
    // uv.y = 1 is the content's top edge; the bottom leads the fall.
    float depth = 1.0 - uv.y;

    // The melting front is SMOOTH in x — value noise, ~90px wavelength.
    // The first pass staggered discrete 24px lanes, and adjacent lanes
    // letting go at different times cut the row into stepped plates
    // (2026-08-20, "looks really rough").
    float lx = uv.x * uSize.x / 90.0;
    float lane = mix(
      hash11(floor(lx) * 12.9898),
      hash11((floor(lx) + 1.0) * 12.9898),
      smoothstep(0.0, 1.0, fract(lx))
    );

    // First-stage stream, and the pair it merges into further down. The
    // index is clamped: the geometry's right-edge column has uv.x exactly
    // 1.0, and floor handed it a stream past the last one, whose centre
    // sat off the row's right edge — the whole edge cell smeared out over
    // the card's margin as it fell (2026-08-20). The pair divisor is
    // (n+1)/2, not n/2, for the same reason at the pair stage.
    float si = min(floor(uv.x * uStreams), uStreams - 1.0);
    float sh = hash11(si * 37.13 + 4.7);
    float streamX = ((si + 0.25 + 0.5 * sh) / uStreams) * uSize.x;
    float pairX = ((floor(si / 2.0) + 0.5) / ((uStreams + 1.0) * 0.5)) * uSize.x;

    // The head leads the tail by 0.07 of the timeline and the front's
    // waves add 0.22 more; both are folded into the normalization so the
    // LAST vertex still completes by uT = 1 and the row is off screen.
    // The wave share is the larger term on purpose — at 0.1 the whole
    // row let go inside a tenth of the clock and fell as one sheet.
    float t = clamp((uT - 0.22 * lane - 0.07 * (1.0 - depth)) / 0.71, 0.0, 1.0);
    // The square is gravity: slow enough to read at the top of the fall,
    // fast enough at the bottom to feel like the row let go.
    float fall = t * t * (uExit + uSize.y);

    // Necking follows how far the material has RUN, not the clock: liquid
    // still in the list keeps the row's own x, and only the running
    // streams gather and merge. Gathering by time slid the whole row
    // sideways into plates while it was still on the page. One row height
    // of run is full necking — by the second row down, streams, not sheet.
    float neck = smoothstep(0.0, uSize.y * 1.2, fall);
    float run = neck * uGather;
    float merge = smoothstep(0.5, 0.95, t);
    float x = mix(uv.x * uSize.x, mix(streamX, pairX, merge), run);
    x += sin(fall * 0.028 + si * 7.0) * uWaver * run;

    // The material that sits across a stream boundary. Gathering alone
    // never separates the streams — the boundary quads just stretch and
    // smear across the gap, and the fall reads as one curtain. These
    // fragments thin away as the liquid necks, which is what opens the
    // daylight between rivulets.
    float f = fract(uv.x * uStreams);
    vGap = 1.0 - smoothstep(0.0, 0.3, min(f, 1.0 - f) * 2.0);
    vNeck = neck;

    vRun = t;

    vec3 moved = position;
    moved.x = x - uSize.x * 0.5;
    moved.y -= fall;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
  }
`

export const MELT_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;
  varying float vRun;
  varying float vNeck;
  varying float vGap;

  void main() {
    vec4 c = texture2D(tMap, vUv);
    // Only the last tenth of the material — the very top of the row —
    // tapers, so each stream ends in a rounded drip rather than a cut
    // edge. Everything below it keeps its full body all the way down.
    float tip = smoothstep(1.0, 0.9, vUv.y);
    // Liquid darkens as it draws out — enough that cream ooze still
    // reads against the cream card it is crossing.
    c.rgb *= mix(1.0, 0.82, clamp(vRun * 1.4, 0.0, 1.0));
    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
    // Both tapers scale AFTER the sRGB conversion — premultiplied rgb
    // pushed through the transfer curve at fractional alpha comes out
    // lifted, and the drip tips whitened as they tapered (2026-08-20).
    gl_FragColor *= mix(1.0, tip, smoothstep(0.15, 0.6, vRun));
    gl_FragColor *= 1.0 - vGap * vNeck;
  }
`

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

export const SHATTER_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aSeed;
  uniform float uT;
  uniform vec2 uOrigin;
  uniform float uSpan;
  uniform float uSpread;
  uniform float uPop;
  uniform float uSpin;
  uniform float uGravity;
  uniform float uKick;
  varying vec2 vUv;
  varying float vT;
  varying float vFlash;

  void main() {
    vUv = uv;
    float near = clamp(distance(aCenter.xy, uOrigin) / max(uSpan, 1e-4), 0.0, 1.0);
    // The crack runs outward from the press at about six row-widths per
    // second; 0.16 of the effect is how long it takes to reach the far end.
    float t = clamp((uT - 0.16 * near) / 0.84, 0.0, 1.0);
    vT = t;
    vFlash = (1.0 - smoothstep(0.0, 0.22, t)) * step(0.0001, t);

    vec3 rel = position - aCenter;
    // Tumble about an axis of its own, not about z: a shard that only
    // spins in the page plane reads as a sticker being shuffled.
    float ang = (aSeed.x - 0.5) * uSpin * t;
    float ca = cos(ang);
    float sa = sin(ang);
    vec3 spun = vec3(
      rel.x * ca - rel.y * sa,
      rel.x * sa + rel.y * ca,
      rel.z
    );
    float tilt = (aSeed.z - 0.5) * uSpin * 0.7 * t;
    spun = vec3(spun.x, spun.y * cos(tilt), spun.y * sin(tilt));

    // The kick is radial from the press, so the break has a direction and
    // is not an even puff. The random spread is what stops it being a ring.
    vec2 away = normalize(aCenter.xy - uOrigin + vec2(1e-3));
    vec3 vel = vec3(
      away.x * uKick + (aSeed.y - 0.5) * uSpread,
      away.y * uKick * 0.5 + (aSeed.z - 0.5) * uSpread * 0.5 + uKick * 0.35,
      aSeed.w * uPop
    );

    vec3 p = aCenter + spun + vel * t;
    p.y -= uGravity * t * t;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const SHATTER_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  varying vec2 vUv;
  varying float vT;
  varying float vFlash;

  void main() {
    vec4 c = texture2D(tMap, vUv);
    // A shard that has tumbled past edge-on shows its back. Unlit rather
    // than mirrored, for the same reason the roll's underside is.
    if (!gl_FrontFacing) c.rgb *= 0.42;
    // The break itself. Premultiplied add, so it lights the shard and not
    // the transparent gap between shards.
    c.rgb += vFlash * 0.5 * c.a;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`
