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
//
//   PRESSES ADD. Each press is its own wave with its own clock, and the
//   field is their sum — a second click mid-flight raises a second ring
//   through the first instead of restarting it. Every wave ends through
//   the settle window: past uSettle its envelope tapers to zero height
//   AND zero velocity, so the sheet is flat and still before the DOM
//   takes the pixels back. The first version landed at sin's full exit
//   slope, and the swap read as a stop rather than a settle.

/** Concurrent press waves a ripple field carries; excess presses recycle
 *  the oldest slot. */
export const RIPPLE_MAX_WAVES = 6

// The wave field, shared verbatim by the control's vertex stage and the
// shadow's — the shadow is believable exactly as long as the two agree on
// where the surface is.
const RIPPLE_FIELD = /* glsl */ `
  uniform vec2 uSize;
  uniform vec2 uWaveOrigin[${RIPPLE_MAX_WAVES}];
  uniform float uWaveT[${RIPPLE_MAX_WAVES}];
  uniform int uWaveCount;
  uniform float uLift;
  uniform float uBend;
  uniform float uWaveLen;
  uniform float uFlap;
  uniform float uSettle;
  uniform float uTail;

  const float PI = 3.141592653589793;

  // Height and in-plane slope gradient of the summed field at content
  // point p (content y runs down).
  void rippleField(vec2 p, out float z, out vec2 grad) {
    z = 0.0;
    grad = vec2(0.0);
    float span = max(0.5 * length(uSize), 1.0);
    for (int i = 0; i < ${RIPPLE_MAX_WAVES}; i++) {
      if (i >= uWaveCount) break;
      float t = clamp(uWaveT[i], 1e-4, 1.0);
      float d = distance(p, uWaveOrigin[i]);
      float far = clamp(d / span, 0.0, 1.0);

      // Up fast — the 0.7 power puts the peak around a third of the run,
      // where a finger's own press peaks — then out through the settle
      // window, value and velocity both zero at t = 1.
      float env = sin(PI * pow(t, 0.7)) * (1.0 - smoothstep(uSettle, 1.0, t));

      // Pinned at the finger: both terms carry the far-field weight, so
      // the pressed point never moves and the free corners do the flapping.
      float rise = uLift * pow(max(far, 1e-4), 1.4);

      // The wave travels. xi is the retarded phase in cycles — how many
      // wavelengths have swept past this point; negative means the front
      // has not arrived and the sheet is still flat there. Without the
      // front the sinusoid is a standing pattern the whole sheet wears
      // from the first frame (seen 2026-08-20: rings spanning the surface
      // within two frames of the click). The lead-in keeps the front C1
      // so the light shows no crease at the leading ring; the decay calms
      // the train so one ring leads and a couple follow.
      float xi = uFlap * t / (2.0 * PI) - d / uWaveLen;
      float lead = smoothstep(0.0, 0.35, xi);
      float decay = exp(-max(xi, 0.0) / uTail);
      float S = xi <= 0.0 ? 0.0 : sin(2.0 * PI * xi) * decay * lead;
      z += env * (rise + uBend * S * far);

      // dz/dd, analytically (dxi/dd = -1/uWaveLen). The far-field ramp of
      // the wave term contributes an order less than the wave itself and
      // is dropped.
      float dSdxi = 0.0;
      if (xi > 0.0) {
        float ls = clamp(xi / 0.35, 0.0, 1.0);
        float dLead = 6.0 * ls * (1.0 - ls) / 0.35;
        dSdxi = (2.0 * PI * cos(2.0 * PI * xi) * lead
                 + sin(2.0 * PI * xi) * (dLead - lead / uTail)) * decay;
      }
      float slope = env * (
        uLift * 1.4 * pow(max(far, 1e-3), 0.4) / span
        - uBend * dSdxi * far / uWaveLen
      );
      vec2 dir = d > 1e-3 ? (p - uWaveOrigin[i]) / d : vec2(0.0);
      grad += slope * dir;
    }
  }
`

export const RIPPLE_VERT = /* glsl */ `
  ${RIPPLE_FIELD}
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    // uv.y runs bottom → top; the click arrives in content coordinates,
    // which run top → bottom.
    vec2 p = vec2(uv.x * uSize.x, (1.0 - uv.y) * uSize.y);
    float z;
    vec2 grad;
    rippleField(p, z, grad);
    // Content y runs down; the world's runs up. Flip so the shared light
    // means the same thing here as everywhere else.
    vNormal = normalize(vec3(-grad.x, grad.y, 1.0));

    vec3 moved = position;
    moved.z += z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
  }
`

// The shadow is the same grid, relit as its own projection: each vertex
// slides along the light onto the page plane, so the dark shape IS the
// deformed sheet's outline — it spreads where the sheet lifts, keeps the
// pinned point dark and tight, and vanishes with the settle window because
// its height does. No blur pass: the penumbra is the edge feather widening
// with the caster's height.
export const RIPPLE_SHADOW_VERT = /* glsl */ `
  ${RIPPLE_FIELD}
  uniform vec3 uLightDir;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vUv = uv;
    vec2 p = vec2(uv.x * uSize.x, (1.0 - uv.y) * uSize.y);
    float z;
    vec2 grad;
    rippleField(p, z, grad);
    vHeight = z;

    vec3 L = normalize(uLightDir);
    vec3 moved = position;
    // Project the lifted point along the light onto the page. The grid
    // stretches past the quad where the sheet rises, which is the whole
    // reason this is a mesh and not a repainted rectangle.
    moved.xy -= (L.xy / L.z) * z;
    moved.z = 0.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
  }
`

export const RIPPLE_SHADOW_FRAG = /* glsl */ `
  uniform vec2 uSize;
  uniform float uLift;
  uniform float uShadowAlpha;
  uniform float uShadowSoft;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    float h = max(vHeight, 0.0);
    float k = clamp(h / max(uLift, 1.0), 0.0, 1.0);
    // Distance to the caster's own edge, in content px. Feather widens
    // with height: contact-tight where the sheet is pinned, penumbral
    // where it flies.
    float edge = min(
      min(vUv.x, 1.0 - vUv.x) * uSize.x,
      min(vUv.y, 1.0 - vUv.y) * uSize.y
    );
    float feather = mix(1.0, max(uShadowSoft, 1.0), k);
    float body = smoothstep(0.0, feather, edge);
    // Zero at contact — a landed sticker is page again, and pages do not
    // shadow themselves — rising fast, then thinning as the gap grows.
    float occ = clamp(k * 3.0, 0.0, 1.0) * (1.0 - 0.45 * k);
    gl_FragColor = vec4(0.0, 0.0, 0.0, uShadowAlpha * body * occ);
    #include <colorspace_fragment>
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
// So the LENS anchors on the nearest rect alone — a strip's magnify
// centre and half-height never refer to a neighbour, and a line added
// below cannot move the words above it. The HEIGHT FIELD, though, is a
// soft-min union: strips fuse where they meet, so a multi-line
// selection reads as one liquid body rather than a stack of beveled
// bars, and the only pixels that move when a line joins are the ones
// within a weld-width of the new seam.
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
  uniform float uWeld;

  // A box as four soft half-planes under one log-sum-exp. Two earlier
  // forms each carried a hidden crease: the exact rounded-box SDF is
  // non-differentiable along its interior medial ridges (the mitred
  // picture-frame look, 2026-08-21), and the folded two-axis softmax
  // that replaced it kept a kink across each center axis from abs(p) —
  // underflowed to nothing mid-strip, but live within ~2k of an end cap,
  // where it cut the specular in half along the centreline (2026-08-21,
  // grad_y jump 0.37 at 5px from the cap). Four planes with no fold make
  // the field C-infinity: opposing weights cancel smoothly. Edges stay
  // sub-px exact (the end midpoint pulls in ~1.2px at full corner); the
  // corner cut on the diagonal is ~0.98k and a radius-r fillet cuts
  // ~0.414r, so k = 0.42r keeps uCorner's px meaning. Both axis planes
  // breathe at the crest, so the interior floor is b.y - k*ln2, not b.y
  // — bubbleNear reports THAT as halfH, keeping t = 1 exactly there.
  float sdSoftBox(vec2 p, vec2 b, float r) {
    float k = max(r * 0.42, 1e-3);
    vec4 q = vec4(p, -p) - vec4(b, b);
    float m = max(max(q.x, q.y), max(q.z, q.w));
    vec4 w = exp((q - vec4(m)) / k);
    return m + k * log(w.x + w.y + w.z + w.w);
  }

  // The softmax weights are the field's own partial derivatives: the TRUE
  // gradient, magnitude included. It shrinks to zero at the crest, and
  // must not be normalized back — unit-scaling a vanishing gradient
  // re-amplifies the crossing into a full direction flip (the mid-strip
  // slice this file already paid for once).
  vec2 sdSoftBoxGrad(vec2 p, vec2 b, float r) {
    float k = max(r * 0.42, 1e-3);
    vec4 q = vec4(p, -p) - vec4(b, b);
    float m = max(max(q.x, q.y), max(q.z, q.w));
    vec4 w = exp((q - vec4(m)) / k);
    return vec2(w.x - w.z, w.y - w.w) / (w.x + w.y + w.z + w.w);
  }

  // Content px, top-left origin. The returned distance and gradient are
  // the union of the strips — the shape is one liquid body — while center
  // and halfH are the plain-min nearest strip's, so the lens stays
  // per-line.
  //
  // The weld is a log-sum-exp soft-min: each strip's distance becomes a
  // density exp(-d/k), the densities ADD — which is what a fluid's do —
  // and -k*log of the sum is a distance again. One law for any number of
  // strips: order-independent (the pairwise fold it replaced was not, and
  // notched where a short line met a long one), a three-line junction
  // rounds as one curve, and the field deepens where bodies meet, so the
  // height swells at a seam like a meniscus. The softmax weights are the
  // field's exact partial derivatives, so the weight-averaged gradient is
  // the true one — magnitude included, never normalized: it vanishes
  // smoothly at crests and seam midlines, which is exactly what keeps the
  // lighting continuous across them.
  float bubbleNear(vec2 p, out vec2 grad, out vec2 center, out float halfH) {
    grad = vec2(0.0, 1.0);
    center = vec2(0.0);
    halfH = 1.0;
    // 0.36 ≈ 1/(4·ln2): calibrates k so uWeld deepens a seam midpoint by
    // the same uWeld/4 px the old polynomial blend did.
    float k = max(uWeld * 0.36, 1e-3);
    float m = 1e5;
    float s = 0.0;
    vec2 g = vec2(0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= uRectCount) break;
      vec4 r = uRects[i];
      vec2 bi = r.zw * 0.5;
      float rr = min(uCorner, min(bi.x, bi.y));
      vec2 ci = r.xy + bi;
      float di = sdSoftBox(p - ci, bi, rr);
      vec2 gi = sdSoftBoxGrad(p - ci, bi, rr);
      // s and g are kept relative to the running min m, so every exponent
      // is <= 0 and exp can only underflow to zero, never overflow.
      if (di < m) {
        float re = exp((di - m) / k);
        s = s * re + 1.0;
        g = g * re + gi;
        m = di;
        center = ci;
        // The field's actual floor, not the rect's: see sdSoftBox.
        halfH = bi.y - max(rr * 0.42, 1e-3) * 0.6931;
      } else {
        float w = exp(-(di - m) / k);
        s += w;
        g += w * gi;
      }
    }
    grad = g / max(s, 1.0);
    return m - k * log(max(s, 1.0));
  }

  float bubbleSd(vec2 p) {
    vec2 g;
    vec2 c;
    float hh;
    return bubbleNear(p, g, c, hh);
  }

  // A drop, not a bevel: h = H·sqrt(1 - exp(d/uEdge)). At the rim this is
  // the same square-root contact a spherical cap has — vertical tangent,
  // the bright thin border — and inward the curvature decays
  // exponentially without ever reaching flat, so there is no ring where
  // dome meets plateau. The bevel-extrude it replaces (arc rim, capped
  // top, normalized per strip) drew that ring as a squarish inner bezel
  // once the specular could find it (2026-08-21). Depth is the only
  // input: a thin strip never gets deep enough to reach full height, so a
  // single line is a shallow film and a paragraph a full drop with no
  // separate area law. uEdge is the rolloff scale — smaller is a steeper
  // rim and a fuller, flatter middle.
  float bubbleHeight(float d) {
    float u = exp(min(d, 0.0) / max(uEdge, 1e-3));
    return uHeight * sqrt(max(1.0 - u, 1e-4));
  }
`

// The mesh stays flat; the bump exists only in the fragment's optics.
// 2026-08-21: displacing vertices by bubbleHeight made the screen→content
// mapping piecewise-projective — kinked at every quad seam — so the
// silhouette and its fwidth feather stepped visibly at any tessellation
// (~2px stairs even at 3px quads under the perspective camera). Flat also
// keeps the pointer's flat-pose hit test honest (decisions.md #35).
export const BUBBLE_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const BUBBLE_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uSize;
  uniform float uT;
  uniform float uMagnify;
  uniform float uRefract;
  uniform float uIor;
  uniform float uDisperse;
  uniform vec2 uShadowOffset;
  uniform float uShadowSoft;
  uniform float uShadowAlpha;
  uniform float uCaustic;
  uniform vec3 uLightDir;
  uniform vec3 uTint;
  uniform float uTintGain;
  uniform float uDepth;
  uniform float uSpec;
  uniform float uSpecPow;
  uniform float uSpecOp;
  uniform float uSheen;
  uniform float uSheenPow;
  uniform float uSheenOp;
  uniform float uRim;
  uniform float uRimPow;
  uniform float uReflect;
  uniform float uFrost;
  uniform vec3 uLightPos;
  uniform float uFollow;
  ${BUBBLE_FIELD}
  varying vec2 vUv;

  vec2 toUv(vec2 p) {
    return clamp(vec2(p.x / uSize.x, 1.0 - p.y / uSize.y), vec2(0.0), vec2(1.0));
  }

  void main() {
    vec2 p = vec2(vUv.x * uSize.x, (1.0 - vUv.y) * uSize.y);
    vec2 grad;
    vec2 center;
    float halfH;
    float d = bubbleNear(p, grad, center, halfH);
    halfH = max(halfH, 1.0);

    if (d > 0.0) {
      // Outside the glass, three coupled terms, all bounded by the paper.
      // Every one of them is DIRECTIONAL. The version this replaced had an
      // isotropic contact line at full weight while the cast shadow ran at
      // half, so the darkest thing on the page was a flat ring hugging the
      // silhouette — a CSS box-shadow with a spread, reported 2026-08-21
      // (~0.12 alpha over the whole 4.5px band, dark on the lit side of the
      // bead as much as the shaded one). Nothing round lit from one side
      // does that. Light leaks under the up-light rim of a droplet, so the
      // darkness has to thin out toward the light.
      //
      //   CONTACT. Occlusion at the foot of the rim: an exponential that
      //   is gone within a couple of px, weighted to the shaded side and
      //   floored low so the lit rim keeps a trace of ground.
      //
      //   SHADE. The directional cast shadow, its interior lightened where
      //   transmission puts light straight through.
      //
      //   CAUSTIC. Mostly CARVED out of the shade — unshadowed paper
      //   showing through, which cannot clip — plus a small warm residue.
      //   The residue is squared before the sRGB encode below: the encode
      //   lifts small linear values ~5x, which is what made the additive
      //   version blow out at the lowest knob settings on light paper.
      //
      // Contact and shade compose as independent occluders — 1-(1-a)(1-b),
      // not a max. The max left a visible crease where the two crossed,
      // because the winner switches term mid-gradient.
      //
      // Light direction in content coordinates (y runs down): the fixed
      // world bearing flipped once, blended toward the point light riding
      // the cursor uLightPos.z px above the page.
      vec3 Lfix = normalize(vec3(uLightDir.x, -uLightDir.y, uLightDir.z));
      vec3 Lpt = normalize(vec3(uLightPos.xy - p, uLightPos.z));
      vec3 L = normalize(mix(Lfix, Lpt, uFollow));
      vec2 Lc = normalize(L.xy + vec2(1e-5));
      float down = clamp(0.5 - 0.5 * dot(grad, Lc), 0.0, 1.0);

      float sd = bubbleSd(p - uShadowOffset);
      float shade = 1.0 - smoothstep(-uShadowSoft, uShadowSoft, sd);
      float inner = smoothstep(0.0, uShadowSoft * 2.5, -sd);
      float contact = exp(-d / max(uShadowSoft * 0.35, 0.5))
                    * (0.12 + 0.88 * down * down);
      float occ = 1.0 - (1.0 - contact * 0.7) * (1.0 - shade * 0.9);
      float shadow = occ * (1.0 - 0.6 * uCaustic * inner);
      float q = (sd + uShadowSoft * 1.2) / max(uShadowSoft, 1.0);
      float band = exp(-q * q) * down * down;
      float carve = clamp(1.0 - 1.5 * uCaustic * band, 0.0, 1.0);
      float a = uShadowAlpha * uT * shadow * carve;
      float residue = 0.25 * uCaustic * band;
      float gleam = residue * residue * uT;
      gl_FragColor = vec4(vec3(1.0, 0.97, 0.88) * gleam, a);
      #include <colorspace_fragment>
      return;
    }

    float h = bubbleHeight(d);
    float fill = h / max(uHeight, 1e-4);

    // The normal, analytically: the SDF's gradient (true magnitude) times
    // the profile's derivative dh/dd = -H·u / (2e·sqrt(1-u)) — exact at
    // the rim, where finite differences blur the vertical tangent. The
    // root is floored so the tangent is a large finite slope rather than
    // a divide-by-zero normal.
    float eEff = max(uEdge, 1e-3);
    float uu = exp(min(d, 0.0) / eEff);
    float root = max(sqrt(max(1.0 - uu, 0.0)), 0.01);
    float dhdd = -uHeight * uu / (2.0 * eEff * root);
    vec3 n = normalize(vec3(-dhdd * grad, 1.0));

    // The top is a lens: it pulls the page in toward THIS strip's centre.
    // The rim is Snell: the eye ray refracts through the rim normal at a
    // real index. The middle is never exactly flat now, but its slope
    // decays exponentially — the residual bend mid-drop is sub-pixel, so
    // the words stay the page's own to the eye — and the bend grows
    // toward the border with the profile real glass has, words
    // compressing into the rim.
    vec2 lensed = mix(p, center, uMagnify * fill * uT);
    vec2 bend = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / max(uIor, 1.0)).xy * uRefract * uT;

    // One loop does dispersion AND frost (the glass lab's move): each of
    // twelve taps carries a wavelength — red bends least, blue most — and
    // a golden-angle disk offset that grows with uFrost, so spectral
    // fringing and scatter share the same samples. The weights are
    // per-channel tents over the spectral coordinate, normalized so a
    // zero-frost, zero-disperse loop returns the plain sample exactly.
    //
    // The disk is rotated and the spectral coordinate jittered PER PIXEL
    // (interleaved gradient noise). Fixed taps drew every glyph edge as a
    // stack of legible echoes, and because each colour channel weights a
    // different subset of the fixed directions, the echoes came out
    // colour-fringed — doubled blue/amber text at frost 2.5 over a 26px
    // heading (2026-08-21). Jittered, the same taps read as frost grain.
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 acc = vec3(0.0);
    vec3 wsum = vec3(1e-4);
    float accA = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = (float(i) + ign) / 12.0;
      vec3 sw = vec3(
        smoothstep(0.75, 0.0, fi),
        1.0 - abs(fi - 0.5) * 2.0,
        smoothstep(0.25, 1.0, fi)
      );
      float ang = (float(i) + 0.5) * 2.39996 + ign * 6.2832;
      vec2 scatter = vec2(cos(ang), sin(ang)) * sqrt(fi) * uFrost * uT;
      vec2 tap = lensed + bend * mix(1.0 - uDisperse, 1.0 + uDisperse, fi) + scatter;
      vec4 s = texture2D(tMap, toUv(tap));
      acc += s.rgb * sw;
      wsum += sw;
      accA += s.a;
    }
    vec4 c = vec4(acc / wsum, accA / 12.0);

    // A body of glass is lit from above: brighter along a strip's top
    // edge, shaded along its bottom. Measured against the strip's own
    // centre, which is why this term does not move when a line is added.
    float up = clamp((center.y - p.y) / halfH, -1.0, 1.0);
    c.rgb *= mix(1.0, 1.0 + uDepth * up, uT * fill);

    // Tint by Beer–Lambert absorption, per channel: transmission falls
    // exponentially with path length, so the colour deepens with
    // thickness and the hue shifts as it deepens — a flat mix does
    // neither. The coefficient is the tint's complement: what the glass
    // is not coloured, it absorbs. Ink stays dark; only light that
    // passes is filtered.
    c.rgb *= exp(-(vec3(1.0) - uTint) * (uTintGain * 2.0 * fill * uT));

    // The lighting is computed RELATIVE TO FLAT (the ripple lesson): the
    // flat top's own response is subtracted from the specular and the
    // sheen, so the interior of a strip adds no constant wash over the
    // words. The light lives where
    // the normal actually tips, brightening the rim the light faces and
    // shading the rim it leaves. The rim glow is Fresnel — grazing
    // incidence is what actually brightens a droplet's border — not a
    // profile ramp.
    //
    // The normal n lives in content coordinates (y runs down); uLightDir
    // is the shared world vector (y runs up). One flip here — without it
    // every azimuth is vertically mirrored and a light placed above the
    // page lights the glass from below. uFollow blends toward a point
    // light riding the cursor, per-pixel, so highlights sweep across the
    // body as the pointer moves.
    vec3 Lfix = normalize(vec3(uLightDir.x, -uLightDir.y, uLightDir.z));
    vec3 Lpt = normalize(vec3(uLightPos.xy - p, uLightPos.z));
    vec3 L = normalize(mix(Lfix, Lpt, uFollow));
    vec2 Lc = normalize(L.xy + vec2(1e-5));
    float lambert = max(dot(n, L), 1e-4);
    float flatL = max(L.z, 1e-4);
    // The specular is the light's mirror image — Blinn half-vector, not a
    // flat-nulled Lambert power. The null (subtract the flat top's own
    // response, clamp at zero) is antisymmetric across a ridge: positive on
    // the up-light slope, zero on the down-light one, zero ON the crest —
    // so a highlight straddling a strip's centreline was cut flat at it no
    // matter how smooth the surface (2026-08-21, at both light bearings).
    // The half-vector form needs no null at specular powers: the flat
    // response is self-negligible off-axis (0.966^256 ≈ 1e-4), and where
    // it isn't — surface square to the half-vector — a real highlight
    // belongs, riding the cursor. The (n+2)/2π factor is Blinn–Phong
    // energy normalization: the power knobs tune lobe tightness without
    // also tuning brightness.
    vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));
    float specN = (uSpecPow + 2.0) / 6.2832;
    float sheenN = (uSheenPow + 2.0) / 6.2832;
    float spec = pow(max(dot(n, Hv), 1e-4), uSpecPow) * specN;
    // The sheen keeps the flat null: at its low power the flat response is
    // a constant wash over the words (the ripple lesson), and its cut at
    // the crest is a soft band, not a razor.
    float sheen = max(pow(lambert, uSheenPow) - pow(flatL, uSheenPow), 0.0) * sheenN;
    float rim = pow(clamp(1.0 - n.z, 1e-4, 1.0), uRimPow);

    // THE FOOTPRINT — the shadow pass's contact occlusion, continued under
    // the bead. Light that cannot reach the paper at the foot of the rim
    // does not start reaching it again because the paper is now behind
    // glass: the field was truncated at d = 0 for implementation reasons,
    // not physical ones. Without it the bead reads as a glass object
    // resting on the page rather than a drop wetting it, because surface
    // shading alone tracks the specular and this does not.
    //
    // Inward the decay is the glass thickening, not a penumbra width, so
    // it rides (1 - fill) — matching the exterior's rim value at the edge,
    // zero at the crest — where outside it rides exp(-d). Same 0.12 floor
    // and down-light weighting as the exterior term, and it spends
    // uShadowAlpha rather than a knob of its own: one light budget with
    // the shadow, which is the only reason this coupling means anything.
    //
    // The CAST shadow deliberately does not continue inward — that is
    // light blocked from paper the bead is not covering. So a step the
    // size of the shade term's rim value survives at the silhouette. It
    // sits under the specular and the Fresnel rim glow, which is what
    // keeps it from reading as an edge.
    float downIn = clamp(0.5 - 0.5 * dot(grad, Lc), 0.0, 1.0);
    float foot = (1.0 - fill) * (1.0 - fill) * (0.12 + 0.88 * downIn * downIn);
    c.rgb *= 1.0 - uShadowAlpha * 0.7 * foot * uT;

    // The environment: glass is defined by what it mirrors, and a mirror
    // REPLACES transmission rather than adding to it — the text under a
    // strong streak dims as the reflection takes over, where the old
    // additive term kept it at full strength and read as gloss paint.
    // Composited as its own premultiplied layer (both rgb and alpha), so
    // the streak also shows over blank paper, where the capture is
    // transparent. F0 is renormalized out of the mix weight so the flat
    // top stays exactly untouched. The room is high-contrast by
    // construction: dim walls, a window streak brighter than the paper
    // up-page, a floor darker than anything on the page below.
    float F0 = 0.05;
    float fres = F0 + (1.0 - F0) * pow(clamp(1.0 - n.z, 1e-4, 1.0), 5.0);
    float fresR = (fres - F0) / (1.0 - F0);
    vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
    float qb = (-R.y - 0.5) / 0.3;
    float wband = exp(-qb * qb);
    float room = mix(mix(0.35, 3.0, wband), 0.08, smoothstep(0.05, 0.7, R.y));
    float wR = fresR * uReflect * uT;
    c.rgb = c.rgb * (1.0 - wR) + vec3(room) * wR;
    c.a = c.a * (1.0 - wR) + wR;

    // The internal caustic: light entering the up-light rim concentrates
    // along the opposite interior wall — the glowing lower lip a real
    // droplet shows. Lives at mid-fill, down-light side only.
    float ql = (fill - 0.35) / 0.25;
    float lip = exp(-ql * ql) * downIn * downIn;

    c.rgb += (rim * uRim + 0.12 * uCaustic * lip) * uT * c.a;

    // The spec and sheen are PAINT, not added light. Additive spec ran
    // ~1.9 at the lobe core over 0.85 paper — deep in clip, so the gain
    // slider had a dead zone the size of the core, and an opacity knob
    // crossfading additive→paint DIMMED as it rose (2026-08-21). As a
    // premultiplied white layer (the reflection's pattern) the glint is
    // bounded at paper-white, shows over blank paper and ink alike, and
    // hides what it covers. Gain shapes the lobe's footprint — how much
    // of it saturates; opacity is the layer's alpha.
    float wH = min(clamp(spec * uSpec, 0.0, 1.0) * uSpecOp
                 + clamp(sheen * uSheen, 0.0, 1.0) * uSheenOp, 1.0) * uT;
    c.rgb = c.rgb * (1.0 - wH) + vec3(wH);
    c.a = c.a * (1.0 - wH) + wH;

    // The strip rides the ease — but the fade multiplies AFTER the sRGB
    // encode, never before. The encode is nonlinear: for the paper texel,
    // encode(0.45 · 0.85) = 0.65 where the correct contribution is
    // 0.45 · encode(0.85) = 0.42, and the blender still adds the page at
    // (1 − 0.45) underneath — 1.16, clipped. Measured 2026-08-21: every
    // mid-fade frame drew the bead as a flat white pill over the words
    // (255 pure at uT 0.07–0.14 against 237 paper), at any knob setting,
    // with the geometry flattened, with every effect term zeroed — the
    // white was the compositing tail itself. Fading the encoded output
    // scales the premultiplied pair consistently, so a bead over
    // unchanged paper fades without ever being visible.
    float aa = fwidth(d) + 1e-4;
    float fade = (1.0 - smoothstep(-aa, aa, d)) * min(uT * 3.0, 1.0);
    gl_FragColor = c;
    #include <colorspace_fragment>
    gl_FragColor *= fade;
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
  uniform vec2 uSway;
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
    // Height varies across the sheet only because neighbours start at
    // different times (the lag), so the slope is dz/de times de/ddist. At
    // either end of the flight t sits on its clamp, 6t(1-t) is zero, and
    // the still-flat sheet shades exactly like the HTML it replaces.
    float slope = PI * cos(PI * e) * uArc * 6.0 * t * (1.0 - t)
                * uLag / (max(uSpan, 1e-4) * max(1.0 - uLag, 1e-3));
    vec2 dir = dist > 1e-3 ? rel / dist : vec2(0.0);
    vNormal = normalize(vec3(-slope * dir.x, slope * dir.y, 1.0));

    // The bow: a per-run sideways drift, zero at both ends of the flight,
    // so the sheet still leaves the block and lands in the cursor — only
    // the road between them changes run to run.
    vec3 p = vec3(uCursor + rel * (1.0 - e) + uSway * sin(PI * e), sin(PI * e) * uArc);
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
