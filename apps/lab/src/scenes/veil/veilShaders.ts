// The veil's materials. The blur is a two-pass separable gaussian whose
// radius is the law (veilLaw.ts) evaluated per row — GLSL twins of
// `veilRadius`, `veilSeamAlpha`, and `veilLod`, fed the same constants
// through uniforms so the JS tests and the shaders cannot drift apart
// on shape, only on constants the scene passes to both.
//
// Everything runs in the band's OWN coordinates: row 0 is the seam,
// rows grow downward, and the article y of row 0 arrives as a uniform
// (uWindow). The scene positions the canvas in the scrolling layer at
// exactly uWindow, so position and content are computed from the same
// number and cannot disagree — the hold fix that replaced trying to
// outguess the compositor's scroll (see Veil.tsx).
//
// Three passes, all 13 taps:
//
//   copy   article texture -> window RT   (mipmapped on write)
//   pass   horizontal blur -> strip RT    (mipmapped on write)
//   band   vertical blur, fade, encode -> the quad on screen
//
// Why the copy pass exists: a 13-tap kernel spaced radius/6 apart is a
// comb, not a gaussian, unless each tap integrates the span between
// taps. The DOM texture carries no mip chain (Surface's filter
// policy), so at high dpr the taps point-sample between texels and the
// deep blur turns into a woven lattice of ghost impulses (observed on
// a retina display, 2026-08-08 — a dpr 1 probe cannot see it, the
// coarser texels plug the gaps). Copying the window into an RT WE mip
// gives every tap `veilLod`'s integrated footprint, and the seam still
// samples the pristine base level — spacing 0 maps to level 0.
//
// The seam needs no special case beyond that. At radius 0 all thirteen
// taps land on the same texel of level 0 and the normalized sum is
// that texel — the band's near edge is the content, exactly, which is
// what veilLaw.test.ts pins on the JS side.
//
// Everything before the band's encode stays linear premultiplied: the
// sampler decodes sRGB on read (texture.colorSpace), both RTs are
// HalfFloat linear (mips average premultiplied linear color, the one
// space where averaging is honest), and the single #include
// <colorspace_fragment> in VEIL_BAND_FRAG is the one place the light
// leaves linear. The fade multiplies AFTER that encode: the browser
// composites this canvas premultiplied in DEVICE space, so identity
// blending over identical pixels needs sRGB(c) × a — fading before the
// encode hands it sRGB(c × a), which is too bright at every partial
// alpha (observed as a glowing stripe, 2026-08-08).

// The GLSL twin of veilRadius(d, p): d is a band row, uBand is
// (seam row, band height), uMaxR/uCurve are VEIL_DEFAULTS unless tuned.
const VEIL_PROFILE_GLSL = /* glsl */ `
  uniform vec2 uBand;
  uniform float uMaxR;
  uniform float uCurve;
  float veilRadius(float y) {
    float s = clamp((y - uBand.x) / uBand.y, 0.0, 1.0);
    s = s * s * (3.0 - 2.0 * s);
    return uMaxR * pow(s, uCurve);
  }
`

// Gaussian taps at i in [-6, 6], spaced radius/6 apart: the spacing
// scales with the radius while t_i/sigma stays fixed at i/3, so the
// weights are compile-time constants and only the footprint moves.
// veilBias is veilLod's twin: the mip level that makes one tap's
// footprint cover the spacing to the next (uDpr texels per CSS px).
const TAPS_GLSL = /* glsl */ `
  uniform float uDpr;
  float veilWeight(int i) {
    return exp(-float(i * i) / 18.0);
  }
  float veilBias(float spacing) {
    return max(0.0, log2(max(spacing * uDpr, 1.0)));
  }
`

// Clip-space quad for the offscreen passes — PlaneGeometry(2,2) is
// already the viewport in NDC, no camera involved.
export const VEIL_QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// The copy: article paint in, the window's rows out, nothing else —
// this pass exists to be mipmapped. uStrip is (strip top in band rows,
// strip height), uWindow the article y of band row 0, uSize the canvas
// CSS size, uContent the article's CSS size.
export const VEIL_COPY_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uContent;
  uniform vec2 uStrip;
  uniform vec2 uSize;
  uniform float uWindow;
  varying vec2 vUv;
  void main() {
    float bandY = uStrip.x + (1.0 - vUv.y) * uStrip.y;
    float cy = bandY + uWindow;
    float cx = vUv.x * uSize.x;
    gl_FragColor = texture2D(tMap, vec2(cx / uContent.x, 1.0 - cy / uContent.y));
  }
`

// Horizontal half of the gaussian: window RT in, half-blurred strip
// out. Row for row — both RTs have identical geometry, so v passes
// through untouched.
export const VEIL_PASS_FRAG = /* glsl */ `
  ${VEIL_PROFILE_GLSL}
  ${TAPS_GLSL}
  uniform sampler2D tWin;
  uniform vec2 uStrip;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    float bandY = uStrip.x + (1.0 - vUv.y) * uStrip.y;
    float r = veilRadius(bandY);
    float spacing = r / 6.0;
    float bias = veilBias(spacing);
    float cx = vUv.x * uSize.x;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float w = veilWeight(i);
      vec2 uv = vec2((cx + float(i) * spacing) / uSize.x, vUv.y);
      acc += w * texture2D(tWin, uv, bias);
      wsum += w;
    }
    gl_FragColor = acc / wsum;
  }
`

export const VEIL_BAND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Vertical half, drawn as the window quad itself: strip in, finished
// veil out. Same profile, same taps, same bias law, other axis — then
// the encode, then the seam fade (order is the load-bearing part, see
// the header).
export const VEIL_BAND_FRAG = /* glsl */ `
  ${VEIL_PROFILE_GLSL}
  ${TAPS_GLSL}
  uniform sampler2D tBlur;
  uniform vec2 uStrip;
  uniform vec2 uSize;
  uniform float uFade;
  uniform float uGate;
  varying vec2 vUv;
  void main() {
    float bandY = (1.0 - vUv.y) * uSize.y;
    float r = veilRadius(bandY);
    float spacing = r / 6.0;
    float bias = veilBias(spacing);
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float w = veilWeight(i);
      float y = bandY + float(i) * spacing;
      vec2 uv = vec2(vUv.x, 1.0 - (y - uStrip.x) / uStrip.y);
      acc += w * texture2D(tBlur, uv, bias);
      wsum += w;
    }
    gl_FragColor = acc / wsum;
    #include <colorspace_fragment>
    float a = clamp((bandY - uBand.x) / uFade, 0.0, 1.0);
    a = a * a * (3.0 - 2.0 * a);
    // The generation gate: veilReturn is evaluated JS-side per FRAME (it
    // varies per frame, not per fragment — every fragment this frame gets
    // the same value) and arrives here as a plain uniform. Multiplying
    // AFTER the encode keeps the premultiplied story identical to the
    // fade's just above: both are alpha applied to an already-sRGB color,
    // so a still-closing gate composites exactly like a not-yet-faded row.
    gl_FragColor *= a * uGate;
  }
`
