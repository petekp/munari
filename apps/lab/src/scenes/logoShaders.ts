// The matter palette: what a lifted letter is MADE of. Logo.tsx owns the
// springs and the crossing; logoLaw deals the substances; logoFields owns
// the blur pyramid; this file owns the GLSL (the flightShaders convention
// — a shader is data, and inlining it buries both files).
//
// The idea in one line: on the page every letter is INK; lifted, each
// letter becomes a different substance — balloon, foil, gummy, neon —
// and the conductor re-deals substances the way it re-deals faces and
// colors, so in matter mode a beat TRANSMUTES a letter.
//
//   · the surface — the glyph's own alpha is a height field, read from
//     TWO PRE-BLURRED COPIES of the letter's texture (logoFields: a
//     fine field at 1/4 resolution, a coarse field at 1/16). The fine
//     gradient is the edge shoulder; the coarse gradient is the pillow
//     — the inflation that makes a balloon a balloon. The fields are
//     genuinely band-limited, so their gradients are smooth by
//     construction. The first version instead point-sampled the RAW
//     mask on 8-tap rings at wide radii, and 8 taps do not blur — they
//     COPY: the neon "glow" was eight displaced letters (the
//     ghost-trail screenshot, 2026-08-14), the balloon's shading broke
//     along circular arcs (one arc per tap crossing the glyph edge),
//     and on low LOD tiers the tap gradients amplified the texel
//     lattice into flat-shaded rectangles. Field resolution is tied to
//     the CSS box, not the texture, so the look also survives every
//     tier swap.
//   · the light — Cook–Torrance GGX with Schlick Fresnel for the key,
//     plus an analytic STUDIO standing in for an HDRI: a graded room
//     and three softboxes behind the viewer, widened by roughness. A
//     curved surface sweeps its reflection across the boxes' soft
//     edges, which is the cue that reads as chrome instead of stripes.
//     The normal is rotated into WORLD space per letter (uQuat), so
//     the studio stands still while the letters wobble under it.
//   · the exposure — lit color runs through an ACES fit before
//     compositing, so highlights roll off like film instead of
//     clipping into flat white bands.
//   · gel waves — the plane is subdivided and low-frequency waves
//     travel through it, scaled per matter. The wave slope joins the
//     normal, recomputed EXACTLY in the fragment: the earlier
//     per-vertex slope interpolated across a 28×14 grid and banded
//     every glint into terraces.
//   · prism fringe — the three channels sample at offsets along the
//     letter's velocity: dispersion belongs to motion.
//   · neon — the ink becomes the tube: emissive core, plus a halo of
//     its own light OUTSIDE the glyph — the coarse field's excess
//     coverage over the sharp alpha, now a true smooth glow — with
//     alpha grown to carry it.
//
// Identity is guarded at the SWAP EDGES: the final color is
// mix(page texel, shaded, uFx), and uFx rides the cooling gate below —
// zero through the last stretch of every crossing — so at both
// handoffs the letter is exactly its own pixels. Mid-flight the
// interiors relight fully; that is the transmutation, and the
// ink-band clause's wide tails absorb it.
//
// Premultiplied rules (decisions.md #5): the texture arrives
// premultiplied, the blur pyramid keeps it premultiplied, and the
// shaded result multiplies by alpha before the mix. Albedo comes from
// the FINE FIELD un-premultiplied (blurred rgb over blurred alpha — a
// weighted neighborhood, so no divide-by-tiny-alpha at lone edge
// texels). And the raw-ShaderMaterial encode rule: the sampler hands
// back linear, the canvas is sRGB, so the fragment ends with
// <colorspace_fragment> or every AA midtone sinks (the texel-vs-screen
// bisect, 2026-08-02).

/** The cooling law: the LIGHT rides its own choreography window on the
 *  lift's progress — `lift.range(from, distance)`, zero before `from`,
 *  full past `from + distance` — while depth, jelly, and prism ride
 *  plain progress. Substances bloom after liftoff and freeze back to
 *  ink before touchdown, so the last stretch on either side of a swap
 *  is literally the page's own pixels. That is first a perceptual
 *  choice (matter cooling as it lands) and second what keeps the
 *  crossing-flash carry clause honest: its ink-mask centroid is only a
 *  position while the mask is ink — substance light near a swap drags
 *  the mask without moving a letter (measured 2026-08-14: a ~7px mask
 *  arc on the landing tail against shots steady to 0.1px). */
export const MATTER_LIGHT_GATE = { from: 0.25, distance: 0.35 }

/** Per-matter tuning, indexed by LOGO_MATTERS (logoLaw). `shoulder`
 *  weights the fine field's gradient (the edge bevel) and `pillow` the
 *  coarse field's (the interior inflation) — the pair that most decides
 *  what a substance IS: a balloon is nearly all pillow, an enamel gummy
 *  nearly all shoulder. The field SCALES are fixed by the blur pyramid
 *  (logoFields); these are unitless weights. `dome` scales the whole
 *  height gradient into the normal; `jelly`/`prism` scale the shared
 *  knobs per matter (a neon tube is rigid; only gummy disperses fully). */
export const MATTER_PARAMS = [
  { shoulder: 0, pillow: 0, dome: 0, jelly: 0, prism: 0 }, // ink — the page's own look
  { shoulder: 0.45, pillow: 1.0, dome: 1.5, jelly: 0.4, prism: 0 }, // balloon
  { shoulder: 1.0, pillow: 0.5, dome: 1.1, jelly: 0.25, prism: 0.35 }, // foil
  { shoulder: 1.1, pillow: 0.45, dome: 1.0, jelly: 1, prism: 1 }, // gummy
  { shoulder: 0.7, pillow: 0.3, dome: 0.55, jelly: 0.1, prism: 0 }, // neon
]

// ── the blur pyramid's blit pass (logoFields runs it) ───────────────────

/** Fullscreen pass-through: the blit quad ignores every matrix. */
export const BLIT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** One 3×3 tent-filtered downsample hop. Two hops (texture → 1/4 →
 *  1/16) give the two height fields; `uSpread` widens the taps so a 4×
 *  stride leaves no source texel uncovered. Values stay premultiplied
 *  and linear — no colorspace include here: render targets are storage,
 *  not screen. */
export const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSrcTexel;
  uniform float uSpread;
  varying vec2 vUv;
  void main() {
    vec2 o = uSrcTexel * uSpread;
    vec4 s = texture2D(tSrc, vUv) * 0.25;
    s += (texture2D(tSrc, vUv + vec2(o.x, 0.0)) + texture2D(tSrc, vUv - vec2(o.x, 0.0)) +
          texture2D(tSrc, vUv + vec2(0.0, o.y)) + texture2D(tSrc, vUv - vec2(0.0, o.y))) * 0.125;
    s += (texture2D(tSrc, vUv + o) + texture2D(tSrc, vUv - o) +
          texture2D(tSrc, vUv + vec2(o.x, -o.y)) + texture2D(tSrc, vUv + vec2(-o.x, o.y))) * 0.0625;
    gl_FragColor = s;
  }
`

// ── the letter ──────────────────────────────────────────────────────────

export const LETTER_VERT = /* glsl */ `
  // uJelly is px of displacement, already the product of knob ×
  // amplitude × excitation × the matter's own factor — zero pins the
  // geometry to the flat plane the registration snap was computed for.
  // uWaveK are the two wave numbers (rad/px, wavelengths set from the
  // font size so every letter ripples at the same physical scale);
  // uPhase staggers the six letters so the word never pumps in unison.
  // The lighting slope of this same field is recomputed EXACTLY in the
  // fragment (a per-vertex varying banded the glints across the grid).
  uniform float uTime;
  uniform float uJelly;
  uniform vec2 uWaveK;
  uniform float uPhase;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 p = position;
    float ax = p.x * uWaveK.x + uTime * 4.6 + uPhase;
    float ay = p.y * uWaveK.y - uTime * 3.7 + uPhase * 1.7;
    // Two crossed traveling waves in z, plus a small transverse jiggle —
    // zero-mean sines, so the letter's centroid stays put (the carry
    // clause fits that centroid; a drifting field would fail honestly).
    p.z += uJelly * (0.6 * sin(ax) + 0.4 * sin(ay));
    p.xy += uJelly * 0.3 * vec2(sin(ay), sin(ax));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const LETTER_FRAG = /* glsl */ `
  // The letter's live pixels, premultiplied…
  uniform sampler2D tMap;
  // …and the same pixels pre-blurred by logoFields: the fine field
  // (shoulder scale, 1/4 res) and the coarse field (pillow scale, 1/16).
  uniform sampler2D tFine;
  uniform sampler2D tCoarse;
  // 1/texture px for each sampler: tMap's feeds the prism offsets, the
  // field texels set the gradient step so slopes are per-field-texel —
  // field resolution rides the CSS box, so the look survives LOD tiers.
  uniform vec2 uTexel;
  uniform vec2 uTexelF;
  uniform vec2 uTexelC;
  // Plane size in CSS px — rebuilds the vertex-local position for the
  // exact wave slope; uFont scales the crinkle to physical size.
  uniform vec2 uPlane;
  uniform float uFont;
  // Per-matter field weights (MATTER_PARAMS): fine gradient, coarse
  // gradient, and the overall height-to-normal gain.
  uniform float uShoulder;
  uniform float uPillowW;
  uniform float uDome;
  // gloss knob × cooling-gated amplitude (zero for ink): the mix weight
  // between the page's exact pixels and the shaded substance.
  uniform float uFx;
  // prism offset in texels (knob × amplitude × speed × matter factor)
  // and the direction of travel it disperses along.
  uniform float uPrism;
  // Index into the matter deck: 0 ink, 1 balloon, 2 foil, 3 gummy,
  // 4 neon. Uniform branching — one program, six letters, no recompiles
  // when the conductor re-deals.
  uniform float uMatter;
  uniform vec2 uVelDir;
  // The letter's world rotation: normals are lifted into world space so
  // the studio stands still while the letter wobbles under it.
  uniform vec4 uQuat;
  // The key light, in WORLD space.
  uniform vec3 uLight;
  uniform float uTime;
  uniform float uPhase;
  uniform float uJelly;
  uniform vec2 uWaveK;
  varying vec2 vUv;

  const float PI = 3.14159265;

  vec3 qrot(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }

  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
      mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // One softbox: a Gaussian lobe around a direction, widened by
  // roughness — the cheap stand-in for prefiltered-mip convolution.
  vec3 softbox(vec3 d, vec3 c, float sz, vec3 tint, float rg) {
    float s = sz + rg * 0.5;
    return tint * exp((dot(d, c) - 1.0) / max(s * s, 1e-4));
  }
  // The studio standing in for an HDRI: a graded room (dark floor,
  // bright ceiling) plus a big warm key box up-left, a cool fill right,
  // and a dim floor bounce. Everything lives in the +z hemisphere —
  // flat front-facing surfaces reflect straight back past the viewer,
  // so the boxes must stand behind the camera to be seen.
  vec3 studio(vec3 d, float rg) {
    vec3 col = mix(vec3(0.035, 0.04, 0.05), vec3(0.15, 0.16, 0.18), smoothstep(-0.8, 0.5, d.y));
    col += vec3(0.3, 0.28, 0.25) * smoothstep(0.1, 1.0, d.y);
    col += softbox(d, normalize(vec3(-0.45, 0.6, 0.55)), 0.09, vec3(2.4, 2.3, 2.15), rg);
    col += softbox(d, normalize(vec3(0.7, 0.1, 0.5)), 0.18, vec3(0.5, 0.55, 0.65), rg);
    col += softbox(d, normalize(vec3(0.05, -0.75, 0.45)), 0.2, vec3(0.22, 0.2, 0.18), rg);
    return col;
  }

  // ACES fit (Narkowicz): film-like rolloff instead of clipped bands.
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    // ── prism: per-channel dispersion along the motion vector ──
    // At uPrism 0 all three taps coincide and c is the plain texel —
    // identity by construction, not by branch.
    vec2 o = uVelDir * uPrism * uTexel;
    vec4 cr = texture2D(tMap, vUv + o);
    vec4 cg = texture2D(tMap, vUv);
    vec4 cb = texture2D(tMap, vUv - o);
    vec4 c = vec4(cr.r, cg.g, cb.b, (cr.a + cg.a + cb.a) / 3.0);
    vec4 outC = c;

    if (uMatter > 0.5 && uFx > 0.001) {
      // ── the surface: gradients of two smooth height fields ──
      // Central differences at one field texel, on hardware bilinear —
      // band-limited data, so the slopes are smooth by construction.
      vec4 hF = texture2D(tFine, vUv);
      vec4 hC = texture2D(tCoarse, vUv);
      vec2 gF = vec2(
        texture2D(tFine, vUv + vec2(uTexelF.x, 0.0)).a -
          texture2D(tFine, vUv - vec2(uTexelF.x, 0.0)).a,
        texture2D(tFine, vUv + vec2(0.0, uTexelF.y)).a -
          texture2D(tFine, vUv - vec2(0.0, uTexelF.y)).a
      ) * 0.5;
      vec2 gC = vec2(
        texture2D(tCoarse, vUv + vec2(uTexelC.x, 0.0)).a -
          texture2D(tCoarse, vUv - vec2(uTexelC.x, 0.0)).a,
        texture2D(tCoarse, vUv + vec2(0.0, uTexelC.y)).a -
          texture2D(tCoarse, vUv - vec2(0.0, uTexelC.y)).a
      ) * 0.5;
      // The coarse field doubles as local coverage: the thickness proxy
      // for transmission, and the halo source for neon.
      float thick = hC.a;

      // Albedo: the fine field un-premultiplied covers the edges (a
      // blurred neighborhood — no lone-texel alpha to divide by), the
      // sharp texel takes over inside.
      vec3 albF = clamp(hF.rgb / max(hF.a, 1e-3), 0.0, 1.0);
      vec3 alb = mix(albF, c.rgb / max(c.a, 0.25), smoothstep(0.2, 0.7, c.a));

      // ── per-matter PBR constants ──
      float rough; float metal; float sss; float crinkle;
      if (uMatter < 1.5) { rough = 0.34; metal = 0.0; sss = 0.3; crinkle = 0.0; } // balloon
      else if (uMatter < 2.5) { rough = 0.16; metal = 1.0; sss = 0.0; crinkle = 0.4; } // foil
      else if (uMatter < 3.5) { rough = 0.14; metal = 0.0; sss = 0.85; crinkle = 0.0; } // gummy
      else { rough = 0.4; metal = 0.0; sss = 0.0; crinkle = 0.0; } // neon

      // The gel slope, exact at this fragment (same field the vertex
      // stage displaces).
      vec2 p = (vUv - 0.5) * uPlane;
      float ax = p.x * uWaveK.x + uTime * 4.6 + uPhase;
      float ay = p.y * uWaveK.y - uTime * 3.7 + uPhase * 1.7;
      vec2 wslope = uJelly * vec2(0.6 * uWaveK.x * cos(ax), 0.4 * uWaveK.y * cos(ay));

      // The normal: shoulder + pillow slopes scaled by dome, the gel
      // slope folded in, foil's crinkle on top — then lifted to world.
      vec2 slope = (gF * uShoulder * 2.4 + gC * uPillowW * 3.2) * uDome;
      vec3 n = normalize(vec3(-slope - wslope * 0.6, 1.0));
      if (crinkle > 0.0) {
        vec2 np = p * (22.0 / uFont);
        vec2 wob =
          vec2(vnoise(np) - 0.5, vnoise(np + 19.7) - 0.5) +
          0.5 * vec2(vnoise(np * 2.7) - 0.5, vnoise(np * 2.7 + 7.3) - 0.5);
        n = normalize(vec3(n.xy + crinkle * wob, n.z));
      }
      n = qrot(uQuat, n);

      // ── Cook–Torrance key + studio IBL ──
      vec3 V = vec3(0.0, 0.0, 1.0);
      vec3 L = normalize(uLight);
      vec3 H = normalize(L + V);
      float NdV = max(dot(n, V), 1e-3);
      float NdL = max(dot(n, L), 0.0);
      float NdH = max(dot(n, H), 0.0);
      float VdH = max(dot(V, H), 0.0);
      vec3 F0 = mix(vec3(0.04), mix(alb, vec3(1.0), 0.25), metal);
      float a2 = rough * rough;
      a2 *= a2;
      float D = a2 / (PI * pow(NdH * NdH * (a2 - 1.0) + 1.0, 2.0));
      float k = rough * rough * 0.5;
      float Vis = 0.25 / ((NdL * (1.0 - k) + k) * (NdV * (1.0 - k) + k) + 1e-4);
      vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
      vec3 KEY = vec3(2.6, 2.5, 2.3);
      // Wrap lighting stands in for subsurface scattering on the
      // diffuse term: light bleeds past the terminator on soft matter.
      float wrap = sss * 0.5;
      float NdLw = clamp((dot(n, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
      vec3 lit = (1.0 - metal) * (1.0 - F) * alb / PI * KEY * NdLw;
      lit += D * Vis * F * KEY * NdL;
      vec3 R = reflect(-V, n);
      lit += (1.0 - metal) * alb * studio(n, 1.0) * 0.55;
      vec3 Fibl = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
      lit += studio(R, rough) * Fibl;
      // Transmission: thin spans glow in their own color — the candy
      // edge light that makes gummy read as gel rather than plastic.
      lit += sss * alb * (1.0 - thick) * (0.5 + 0.5 * studio(-n, 1.0)) * 1.2;

      float pulse = 0.9 + 0.1 * sin(uTime * 9.0 + uPhase * 3.0);
      if (uMatter > 3.5) {
        // Neon: the stroke IS the light. Emissive core toward white,
        // the PBR pass held back to a glaze over the tube.
        lit = mix(alb, vec3(1.0), 0.6) * 2.6 * pulse + lit * 0.2;
      }

      // Exposure, premultiply, and the identity mix: uFx is the cooled
      // gate — zero at every swap edge, so the mix lands on the page's
      // exact pixels there.
      outC.rgb = mix(c.rgb, aces(lit) * c.a, uFx);

      if (uMatter > 3.5) {
        // The halo: the coarse field's excess coverage over the sharp
        // alpha is light OUTSIDE the glyph — a true smooth glow now,
        // squared for a soft knee, tinted by the field's own blurred
        // color, added premultiplied with alpha grown to carry it.
        float halo = clamp((thick - c.a) * 1.9, 0.0, 1.0);
        float haloA = uFx * halo * halo * 0.8 * pulse;
        vec3 glow = clamp(hC.rgb / max(hC.a, 1e-3), 0.0, 1.0);
        outC.rgb += mix(glow, vec3(1.0), 0.3) * haloA;
        outC.a += haloA * (1.0 - outC.a);
      }
    }

    if (outC.a < 0.004) discard;
    gl_FragColor = outC;
    // Linear in from the sampler, sRGB out to the canvas (flightShaders'
    // hard rule for any material sampling useSurfaceTexture).
    #include <colorspace_fragment>
  }
`
