// The flight card's two shader pairs. The scene next door owns the physics
// and the React; this file owns the GLSL, the same way glassSdfShader.ts
// sits beside glassSdf.tsx — a shader is data, and 300 lines of it wedged
// between components is 300 lines you scroll past to read either one.
//
// Both pairs are welded to laws that live elsewhere: the card's bend is
// driven by `aeroAmplitude`/`aeroFollowStep` in the kernel, and the
// shadow's layers are the card's own measured `box-shadow`, parsed by
// `onChrome`. What is authored here is only how they RASTERIZE.

import { SURFACE_RADIUS_GLSL } from 'anamorph'

// ── the airborne copy's material ─────────────────────────────────────────
//
// `material="none"` hands the material slot to us so the card
// can be UNLIT — a lit standard material would shade the texture and the
// handoff would stop being invisible the moment a light moved. What it does
// add is a gloss band keyed to the plate's own normal: the only cue that the
// thing is tilted, since an unlit quad has no other way to say so.

export const CARD_VERT = /* glsl */ `
  // The aero bend: the one thing on this card CSS could never draw. The
  // plate is rigid in the physics; what bends is the SHEET, around the
  // point the fingers pin, by an amount the driver derives from the plate's
  // own velocity (aeroAmplitude — hard zero at rest, so both handoff swaps
  // are geometrically flat by theorem). uAero packs (dir.x, dir.y,
  // amplitude px, reach px); uAeroGrab is the held point in card-local px.
  // The leading half catches more air than the trailing half — a swished
  // card is not a symmetric parabola — and the normal is the ANALYTIC
  // derivative of the same field, so the gloss band sweeps the flex
  // instead of staying painted on.
  uniform vec4 uAero;
  uniform vec2 uAeroGrab;
  uniform vec3 uWad;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vNl;
  varying vec3 vWp;

  // Per-vertex chaos for the crumple. Deterministic in uv (+ the flight's
  // seed), so the wad holds one shape across frames instead of boiling.
  float l14hash(vec2 p2) {
    return fract(sin(dot(p2, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vUv = uv;
    vec3 p = position;
    float crush = uWad.x;
    vec2 dir = uAero.xy;
    // The bend cedes the sheet to the crush: a held, crushing ball is still
    // being waved around at bend-worthy speeds, and a wad has no sheet left
    // to catch the air with.
    float amt = uAero.z * (1.0 - crush);
    float L = max(uAero.w, 1.0);
    float s = dot(p.xy - uAeroGrab, dir);
    float t = clamp(s / L, -1.0, 1.0);
    float lead = max(t, 0.0);
    float bow = t * t + 0.45 * lead * lead;
    // TOWARD the camera (+z). The sign is load-bearing, not aesthetic:
    // bowing away pushed the bent edges BEHIND the shadow plane at
    // z = −0.5 during a fast throw home, and where two surfaces cross, the
    // depth test flips per-pixel — a grainy seam marching along whichever
    // edge led the throw. Bowing toward the viewer keeps every bent
    // fragment strictly in front of the shadow at every altitude (a +z bow
    // in the plate's frame can only RAISE a vertex's world z for any bank
    // < 90°), so the carve (#58) can never fight its own card.
    p.z += amt * bow;
    // n = normalize(−∂z/∂x, −∂z/∂y, 1); ∂z/∂s = amt·(2t + 0.9·lead)/L.
    float dzds = amt * (2.0 * t + 0.9 * lead) / L;
    vec3 nl = normalize(vec3(-dzds * dir, 1.0));

    // ── the crumple: the sheet converges on a wad ──
    //
    // uWad = (crush 0→1, seed, wad radius px). Each vertex has its own
    // noise target — the sheet's footprint contracted to 13% AROUND THE
    // GRAB POINT plus a random radial offset inside the wad's ball — and
    // its own PHASE: the hash staggers when each vertex commits, because a
    // real crush is chaotic, not a uniform lerp. Contracting toward
    // uAeroGrab rather than the centre is what "crushed in the hand" means:
    // the ball forms under the fingers that pressed the ✕ (the driver pins
    // that same point to the pointer), not half a card away from them. For
    // a keyboard delete the grab is the centre and this is the old formula.
    // The sin(π·lt) term overshoots mid-travel (the sheet bulges and
    // wrinkles before it packs), and dies at both ends so the endpoints are
    // exact: crush 0 is the untouched card (the handoff theorem again),
    // crush 1 is the settled wad. Analytic normals are hopeless on this
    // field — the fragment shader switches to screen-space derivative
    // facets as the crush takes over.
    if (crush > 0.0) {
      float seed = uWad.y;
      float wadR = uWad.z;
      float j = l14hash(uv + seed);
      float lt = smoothstep(0.42 * j, 1.0, crush);
      // Fold coherence: the target field samples the hash on a COARSE uv
      // grid, so neighbouring vertices travel together as chunks — paper
      // folds, it does not shred. (All-per-vertex targets were measured as
      // exactly that: a confetti burst mid-crush, every triangle torn from
      // its neighbours.) A 35% per-vertex remainder puts crease chaos back
      // on top of the folds, and the phase stays per-vertex, so a chunk's
      // vertices crumple INTO their shared destination rather than arriving
      // in lockstep.
      vec2 cell = floor(uv * vec2(6.0, 3.0)) / vec2(6.0, 3.0);
      vec3 cellDir = vec3(
        l14hash(cell + seed + 1.3) - 0.5,
        l14hash(cell + seed + 2.7) - 0.5,
        l14hash(cell + seed + 4.1) - 0.5);
      vec3 vertDir = vec3(
        l14hash(uv + seed + 8.2) - 0.5,
        l14hash(uv + seed + 9.6) - 0.5,
        l14hash(uv + seed + 11.4) - 0.5);
      vec3 dirn = normalize(mix(cellDir, vertDir, 0.35) + vec3(1e-4));
      float rr = (0.35 + 0.65 * l14hash(cell + seed + 6.9)) * wadR;
      vec3 wadP = vec3(uAeroGrab + (p.xy - uAeroGrab) * 0.13, 0.0) + dirn * rr;
      wadP += dirn * (sin(lt * 3.14159265) * 0.35 * wadR);
      p = mix(p, wadP, lt);
    }

    vNl = nl;
    vN = normalize(mat3(modelMatrix) * nl);
    vWp = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const CARD_FRAG = /* glsl */ `
  ${SURFACE_RADIUS_GLSL}
  uniform sampler2D tMap;
  uniform float uGloss;
  uniform float uFlex;
  uniform vec3 uWad;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vNl;
  varying vec3 vWp;
  void main() {
    vec4 c = texture2D(tMap, vUv);
    // A broad highlight from up and to the left, riding the surface normal.
    // At rest the normal is +z, so the term is constant — and it has to be
    // constant ZERO, because a card lying in its slot must be exactly its own
    // pixels, not a shade of them. The bias is therefore the value the band
    // takes at rest, which is L.z raised to the same power: hand-writing it
    // as a literal is how this shipped 4.5% dark, a flat neutral tint that
    // reads as "the texture is slightly transparent" and sends you looking at
    // the blend mode.
    vec3 L = normalize(vec3(-0.45, 0.62, 0.65));
    float s = max(dot(vN, L), 0.0);
    float band = pow(s, 6.0) - pow(L.z, 6.0);
    c.rgb += uGloss * band;
    // The band above rides the WORLD normal — it is the tilt cue, and it is
    // ADDITIVE, which on a white card clips at white: the bend never read
    // through it. This one rides the LOCAL bend normal (vNl — exactly
    // (0,0,1) whenever the sheet is flat, at any plate tilt, so it is a
    // curvature-only signal), and it can only DARKEN: the curled region
    // turning away from the page light shades itself, and darkening is the
    // only direction a white card can show. Multiplicative with a factor
    // ≤ 1, so premultiplied alpha stays valid where the additive term
    // hasn't already spent it.
    vec3 nl = normalize(vNl);
    float sl = max(dot(nl, L), 0.0);
    float flexBand = pow(sl, 6.0) - pow(L.z, 6.0);
    c.rgb *= min(1.0 + uFlex * flexBand, 1.0);
    // ── crumple shading: facets, not fields ──
    //
    // The analytic normals above describe the BEND's smooth field; a wad is
    // the opposite object, all creases and planes. Screen-space derivatives
    // of the world position give the true facet normal of whatever triangle
    // is under the fragment — free, and automatically faceted because the
    // interpolated position is piecewise planar. The band is a broad pow-2
    // (a wad shades everywhere, not just at grazing), multiplicative and
    // floored so the deepest folds go dark grey, never black. And no fade,
    // anywhere: the wad stays fully opaque for its whole life, because it
    // is not allowed to be gone while it can still be seen — the exit is a
    // place, not a time (the driver's wadOffscreen verdict), and a wad that
    // has left the viewport needs no dimming to disappear.
    float crush = uWad.x;
    if (crush > 0.003) {
      vec3 fn = normalize(cross(dFdx(vWp), dFdy(vWp)));
      fn *= sign(fn.z + 1e-6);
      float sf = max(dot(fn, L), 0.0);
      float facetBand = pow(sf, 2.0) - pow(L.z, 2.0);
      float k = clamp(crush * 1.6, 0.0, 1.0);
      c.rgb *= clamp(1.0 + 1.1 * k * facetBand, 0.35, 1.0);
    }
    // The element's corners, not the quad's. The texture can't say where the
    // card ends — the .ui-root background paints its corners opaque white —
    // so the measured border-radius is enforced analytically (crisp at any
    // LOD tier), and the gloss band dies with the alpha it rides on.
    c.a *= anamorphRadiusMask(vUv);
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    // The texture is SRGBColorSpace, so the sampler above hands this shader
    // LINEAR values — and the renderer presents an sRGB canvas. Built-in
    // materials get this encode appended automatically; a raw ShaderMaterial
    // does not, and shipping without it wrote linear values into an sRGB
    // framebuffer: every AA midtone sank, and the card's text rendered
    // visibly darker and heavier than the same pixels at rest (measured in
    // the texel-vs-screen bisect, 2026-08-02). At rest band is exactly zero,
    // so with the encode the mesh is exactly its own pixels — in color, not
    // just in geometry.
    #include <colorspace_fragment>
  }
`

// ── the shadow the card throws back onto the page ────────────────────────
//
// Not a decal and not a blob: the plate's four corners projected onto z = 0
// along the light direction, so a tilted card throws a genuinely sheared
// quadrilateral. The softness and the weight are functions of how far off the
// page it is, which is the only reason a shadow reads as height at all.
//
// It darkens the PAGE, not the scene — the canvas composites over the
// document with alpha, so a translucent black quad drawn over the prose is
// a shadow falling on real text.
//
// WHAT it renders is not authored here, though: the layers are the card's own
// measured `box-shadow`, parsed by the library (`onChrome`). At height zero
// the shader draws exactly what the browser draws — same offsets, same
// Gaussian (σ = blur/2, via erf, which IS the analytic form of a Gaussian
// blurred edge), same colors compositing first-layer-on-top — so the liftoff
// swap is invisible: the page hides a DOM shadow and this draws its twin.
// Height then EVOLVES those layers (Driver); it no longer invents a look.
//
// No <colorspace_fragment> here, deliberately: this shader samples no
// texture. Its colors are CSS values, already sRGB — written raw into the
// sRGB canvas and alpha-blended there, which is the same space the page
// composites box-shadows in. The encode would double-apply. (The hard rule
// scopes to materials sampling `useSurfaceTexture`, which hand back linear.)

export const SHADOW_MAX_LAYERS = 4

export const SHADOW_FRAG = /* glsl */ `
  uniform vec2 uQuadHalf;
  uniform vec2 uCardHalf;
  uniform vec4 uRadii;
  uniform int uCount;
  uniform vec2 uOff[${SHADOW_MAX_LAYERS}];
  uniform float uSigma[${SHADOW_MAX_LAYERS}];
  uniform float uSpread[${SHADOW_MAX_LAYERS}];
  uniform vec4 uColor[${SHADOW_MAX_LAYERS}];
  varying vec2 vUv;

  // Abramowitz–Stegun 7.1.26 — plenty for an alpha ramp.
  float erfA(float x) {
    float s = sign(x);
    float a = abs(x);
    float t = 1.0 / (1.0 + 0.3275911 * a);
    float y = 1.0 -
      (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
        0.254829592) * t * exp(-a * a);
    return s * y;
  }

  float layerCoverage(vec2 p, int i) {
    vec2 half_ = uCardHalf + uSpread[i];
    if (half_.x <= 0.0 || half_.y <= 0.0) return 0.0;
    vec2 q = p - uOff[i];
    float r = q.x < 0.0 ? (q.y > 0.0 ? uRadii.x : uRadii.w)
                        : (q.y > 0.0 ? uRadii.y : uRadii.z);
    r = clamp(r + uSpread[i], 0.0, min(half_.x, half_.y));
    vec2 d = abs(q) - half_ + vec2(r);
    float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
    // Gaussian-blurred edge: coverage is the CDF of the blur at the signed
    // distance. σ near zero degenerates to a step — the '0px 1px 0px' hairline
    // layer renders as the same hairline the DOM paints.
    return 0.5 - 0.5 * erfA(sd / (uSigma[i] * 1.4142135 + 1e-4));
  }

  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uQuadHalf;
    vec4 acc = vec4(0.0);
    // CSS paints the FIRST layer on top: composite back-to-front.
    for (int i = ${SHADOW_MAX_LAYERS - 1}; i >= 0; i--) {
      if (i >= uCount) continue;
      float a = layerCoverage(p, i) * uColor[i].a;
      acc.rgb = uColor[i].rgb * a + acc.rgb * (1.0 - a);
      acc.a = a + acc.a * (1.0 - a);
    }
    if (acc.a <= 0.002) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
  }
`

export const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
