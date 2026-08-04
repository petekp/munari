// The height field behind the wake scene: an explicit finite-difference wave
// equation, stepped in a ping-pong render target, and the two shaders that
// run it.
//
// The arithmetic is here rather than only in GLSL because the interesting
// failures are numeric, and numeric failures in a fragment shader are
// invisible: an unstable scheme does not throw, it fills the field with NaN
// and the page it refracts goes black or transparent with a clean frame
// buffer and no error anywhere. So the stability bound is a function with a
// test, and the shader is written to use it.

/**
 * One step of the 2D wave equation, discretized explicitly:
 *
 *   h⁺ = 2h − h⁻ + c² ∇²h,  then damped
 *
 * `lap` is the 5-point Laplacian of `h` in TEXEL units (the four neighbours
 * minus four times the centre), which is why `c2` is dimensionless here: the
 * grid spacing is one texel by construction.
 */
export function waveStep(
  h: number,
  hPrev: number,
  lap: number,
  c2: number,
  damping: number,
): number {
  return (2 * h - hPrev + c2 * lap) * damping
}

/**
 * The stability ceiling for the scheme above — a supremum, not a setting.
 *
 * The explicit leapfrog is conditionally stable, and the Courant condition in
 * 2D with unit spacing puts c² at ½. The roughest mode the grid can hold is
 * the checkerboard (every neighbour of a peak is a trough, so ∇²h = −8h),
 * which reduces the scheme to hₙ₊₁ = (2 − 8c²)hₙ − hₙ₋₁ — a linear recurrence
 * whose roots sit on the unit circle exactly while |2 − 8c²| ≤ 2.
 *
 * The edge case is the interesting one, and the test found it before the
 * screen did: AT c² = ½ the two roots collide at −1, and a repeated root
 * contributes a term in n·λⁿ. The field does not ring at the bound, it grows
 * LINEARLY — 8000× after 4000 steps, measured. So the bound is unattainable
 * rather than merely uncomfortable, and above it the growth turns geometric
 * and saturates to NaN within a few hundred steps.
 *
 * None of that raises anything in JS. It arrives as a page that renders black
 * with a clean frame buffer and no error anywhere.
 */
export const CFL_C2 = 0.5

/** What the scene runs at. Half the ceiling — audibly fast, unambiguously stable. */
export const WAVE_C2 = 0.25

/** Per-step amplitude retention. */
export const WAVE_DAMPING = 0.994

/**
 * How many steps until a disturbance of `initial` has decayed below `floor`,
 * under `damping` alone.
 *
 * The scene uses this to know when the water is *done*: below one part in
 * 255 the field cannot move a single 8-bit pixel of the page it refracts, so
 * continuing to step it is work with no observable result. Deriving the
 * number from the damping constant rather than picking a plausible-looking
 * timeout means the two can never drift apart — retune the damping and the
 * settle window follows.
 */
export function settleSteps(damping: number, initial = 1, floor = 1 / 255): number {
  if (damping >= 1) return Infinity
  if (initial <= floor) return 0
  return Math.ceil(Math.log(floor / initial) / Math.log(damping))
}

/**
 * The highlight on a wave's face, from the surface slope alone.
 *
 * A textbook specular — `pow(dot(n, light), k)` against the surface normal —
 * cannot be used here, and the reason is the whole discipline of this
 * project. Flat water has the normal (0, 0, 1), so a head-on term evaluates
 * to some CONSTANT at rest: every pixel of a settled page would carry a
 * uniform veil, forever, and the page would no longer match the DOM it is
 * standing in for. Tilting the light until that constant is negligible only
 * moves the problem, because the same exponent that kills the resting term
 * kills the moving one — at exponent 48 a fully-lit wave face measured 4e-13.
 *
 * So the sheen is driven by the SLOPE, which is zero at rest by construction
 * and cannot be nearly-zero-but-not: the page comes back to being exactly
 * itself when the water stills. Crispness is a rest state.
 */
export function sheen(nx: number, ny: number, lx: number, ly: number, gain: number): number {
  const lit = Math.max(nx * lx + ny * ly, 0)
  return gain * lit * lit
}

// ── the shaders ──────────────────────────────────────────────────────────

/** A fullscreen triangle. No attributes beyond position; uv is derived. */
export const FIELD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * The simulation pass. State is packed (h, h⁻) into R and G of a half-float
 * target; B and A are unused and held at 0/1 so the target reads sanely in a
 * debugger.
 *
 * The drop is added AFTER the step rather than before, so a disturbance
 * enters the field as a displacement with no velocity — a surface pushed
 * down and released, which is what a finger entering water does. Adding it to
 * both h and h⁻ instead would inject it as a standing offset that never
 * propagates.
 */
export const FIELD_SIM_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform float uC2;
  uniform float uDamping;
  /** xy = centre in uv, z = radius in TEXELS, w = depth (0 disables). */
  uniform vec4 uDrop;

  void main() {
    vec2 s = texture2D(uState, vUv).rg;
    float h = s.r;
    float hPrev = s.g;

    // Neighbours, clamped at the edge: sampling the boundary texel back into
    // itself makes the wall reflect. (A wrapping fetch would make the field a
    // torus and send every ripple out one side and back in the other.)
    float l = texture2D(uState, vec2(max(vUv.x - uTexel.x, 0.0), vUv.y)).r;
    float r = texture2D(uState, vec2(min(vUv.x + uTexel.x, 1.0), vUv.y)).r;
    float d = texture2D(uState, vec2(vUv.x, max(vUv.y - uTexel.y, 0.0))).r;
    float u = texture2D(uState, vec2(vUv.x, min(vUv.y + uTexel.y, 1.0))).r;

    float lap = (l + r + d + u) - 4.0 * h;
    float next = (2.0 * h - hPrev + uC2 * lap) * uDamping;

    if (uDrop.w != 0.0) {
      // Measured in TEXELS, not in uv. The field's texels are square in
      // screen pixels by construction, so a texel-space radius is round on
      // any window; a uv-space one would be an ellipse stretched along
      // whichever axis the window is longer in.
      float dist = length((vUv - uDrop.xy) / uTexel) / max(uDrop.z, 1e-5);
      // A smooth well rather than a disc: a hard-edged impulse is a step
      // function, and a step function on a grid is every wavelength at once
      // — it reads as a square of noise expanding, not as a ripple.
      next -= uDrop.w * (cos(min(dist, 1.0) * 3.14159265) * 0.5 + 0.5);
    }

    gl_FragColor = vec4(next, h, 0.0, 1.0);
  }
`

/**
 * The page pass: live DOM, seen through the field.
 *
 * Nothing here warps a picture of the page — `uPage` is the Surface's own
 * texture, uploaded on the compositor's paint signal like any other Surface,
 * so a caret blinking or a character typed under the water arrives inside the
 * refraction on the frame it happens.
 *
 * Three separate reads for R/G/B at slightly different offsets is dispersion,
 * and it is the detail that makes the medium read as water rather than as a
 * wobble: real refraction is wavelength-dependent, and an eye that has never
 * thought about it still knows.
 *
 * Ends with `colorspace_fragment` — mandatory for any raw shader sampling a
 * Surface texture. The texture is sRGB, so the sampler hands the shader
 * LINEAR values; built-in materials re-encode on output and a raw shader does
 * not. Skipping it writes linear into an sRGB canvas and every antialiased
 * midtone sinks — text renders visibly darker and heavier than the same
 * pixels at rest, with no error to find.
 */
export const PAGE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPage;
  uniform sampler2D uState;
  /** One field texel, in uv. */
  uniform vec2 uTexel;
  /** One viewport pixel, in uv — everything below is authored in px. */
  uniform vec2 uPxToUv;
  /** Peak displacement, px. */
  uniform float uRefract;
  /** Spread between the red and blue sample offsets. */
  uniform float uDispersion;
  uniform float uSpecular;
  /** The light, as a direction across the page. Normalized on the CPU. */
  uniform vec2 uLight;
  /** xy = the front's centre in uv, z = its radius in px. */
  uniform vec3 uFront;
  /** 0 while the page is at rest — every branch below is skipped. */
  uniform float uFrontOn;
  /** 1 on the ARRIVING page (kept inside the front), 0 on the one it covers. */
  uniform float uCut;
  /** x = how far the field warps the front, y = the crest's width. Both px. */
  uniform vec2 uEdge;

  void main() {
    float h = texture2D(uState, vUv).r;
    float hl = texture2D(uState, vec2(vUv.x - uTexel.x, vUv.y)).r;
    float hr = texture2D(uState, vec2(vUv.x + uTexel.x, vUv.y)).r;
    float hd = texture2D(uState, vec2(vUv.x, vUv.y - uTexel.y)).r;
    float hu = texture2D(uState, vec2(vUv.x, vUv.y + uTexel.y)).r;

    // The surface normal of the height field. The z term is what keeps a
    // steep wave from folding the page back on itself: normalize() bounds the
    // displacement no matter how sharp the gradient gets.
    vec3 n = normalize(vec3((hl - hr), (hd - hu), 0.25));
    // Authored in pixels and converted here, so the displacement is the same
    // distance horizontally and vertically. In raw uv it would be a wider
    // wobble across than down on every screen that is not square.
    vec2 off = n.xy * uRefract * uPxToUv;

    vec4 g = texture2D(uPage, vUv + off);
    float rr = texture2D(uPage, vUv + off * (1.0 + uDispersion)).r;
    float bb = texture2D(uPage, vUv + off * (1.0 - uDispersion)).b;
    vec4 page = vec4(rr, g.g, bb, g.a);

    // The sheen — twin of sheen() above, and slope-driven for the reason
    // written there: it must be EXACTLY zero on flat water, or a settled page
    // wears a veil and stops matching the DOM it stands for. Additive on a
    // premultiplied colour and scaled by alpha, so it can never light a pixel
    // the page left empty.
    float lit = max(dot(n.xy, uLight), 0.0);
    float spec = uSpecular * lit * lit;
    page.rgb += spec * page.a;

    if (uFrontOn > 0.5) {
      vec2 dpx = (vUv - uFront.xy) / uPxToUv;
      // The front is a circle only in the sense that a coastline is: its
      // radius is displaced by the height of the water it is crossing, so it
      // arrives ahead of itself on a crest and lags in a trough. This one term
      // is why the boundary reads as part of the same event as the ripples
      // rather than as a mask that happens to be playing over them.
      float edge = length(dpx) - uFront.z - h * uEdge.x;

      if (uCut > 0.5) {
        // The arriving page exists only inside the front, feathered over a
        // few pixels inward. A discard rather than a zero alpha because this
        // quad stands in FRONT of the page it is replacing: a fragment that
        // writes nothing lets the other one through, and a transparent
        // fragment that still writes depth would not.
        float inside = 1.0 - smoothstep(-9.0, 1.5, edge);
        if (inside <= 0.002) discard;
        page *= inside;
      } else {
        // The page being left darkens AHEAD of the front, not behind it —
        // which is the only place it can be seen, since everywhere behind is
        // covered by the page arriving. The first version shaded the covered
        // side and was a branch that could never render a pixel: correct
        // arithmetic, invisible by construction.
        float ahead = 1.0 - smoothstep(0.0, 95.0, edge);
        page.rgb *= mix(1.0, 0.72, ahead);
      }

      // The crest: the line of light where the surface is folding over. Drawn
      // by BOTH pages from the same edge distance, so it is continuous across
      // a seam whose two sides are different textures. Cool rather than white
      // — a white line at any real width stops reading as water and starts
      // reading as a wipe.
      float band = exp(-(edge * edge) / (2.0 * uEdge.y * uEdge.y));
      page.rgb += band * 0.07 * vec3(0.72, 0.9, 1.0) * page.a;
    }

    gl_FragColor = page;

    #include <colorspace_fragment>
  }
`
