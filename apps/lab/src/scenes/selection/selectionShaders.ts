// The selection bead's shaders — one strip of glass per selected line.
//
// The shader samples a DOM capture, so it obeys three rules and states
// them once:
//
//   PREMULTIPLIED (decisions.md #5). The texture arrives with rgb already
//   scaled by alpha. Adding light is therefore `c.rgb += k * c.a` — an
//   unscaled add lights the transparent margin around a corner and draws
//   a square halo where the radius mask just cut one. Fading is `c *= f`
//   on the whole vec4, not on alpha alone, and it happens AFTER the sRGB
//   encode: scaling premultiplied colour before a nonlinear encode
//   overstates it, and the blender adds the page underneath at the
//   complement, so the pair clips. Measured 2026-08-21: every mid-fade
//   frame drew the bead as a flat white pill over the words.
//
//   NO pow() BASE TOUCHES 0.0. The GLSL spec defines pow(0, y>0) as 0,
//   but ANGLE compiles pow to exp2(y * log2(x)) and log2(0) delivers NaN,
//   which a premultiplied fragment writes to the framebuffer as solid
//   black. 2026-08-20: every strip drew an opaque black bar across its
//   interior — the plateau is where `1.0 - fill` is exactly 0.0, and its
//   rim stayed clean because only there was the base nonzero. Every pow
//   base here is clamped to at least 1e-4.
//
//   THE FRAGMENT SHADER ENDS WITH `#include <colorspace_fragment>`. The
//   Surface texture is SRGBColorSpace, so the sampler hands this shader
//   LINEAR values, and a raw ShaderMaterial writes straight to the
//   framebuffer with none of the encoding three injects into its own
//   materials. Without the chunk the whole capture goes through one extra
//   sRGB->linear decode and lands dark: the #f2f0e4 panel measured
//   226,222,198 in Chrome on 2026-08-20, a 30-count drop in blue.

/** Light direction the bench's other scenes share, so one hand lit them all. */
export const LIGHT: readonly [number, number, number] = [-0.34, 0.52, 0.78]

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
