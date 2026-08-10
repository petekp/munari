// The genie sheet's material. The warp itself is NOT here — the law lives
// in genieLaw.ts and the driver applies it to the geometry's position
// attribute on the CPU, so the raycast hits the same funnel the eye sees
// and a mid-drain click lands on the content it appears to land on. (The
// flight card keeps its bend on the GPU and raycasts the flat plane; that
// trade is right for a mild bow and wrong for a warp that moves the sheet
// half a viewport from its rect. genieLaw.test.ts proves the funnel never
// folds over, which is the case that would make CPU picking ambiguous.)
//
// So this pair only rasterizes: pass the deformed position through, mask
// the element's corners, fade the shadow where the funnel has squeezed
// it past legibility, keep the colorspace honest.
//
// ── why the shadow needs a shader at all ────────────────────────────────
//
// The shade is ink INSIDE the capture (genie.css explains why it cannot
// be a box-shadow), which is right at rest and right under a
// translation, and wrong under a minification — because ink scales with
// the paper and a shadow does not. A shadow's offset is set by the light
// and by how far the thing floats above the ground, not by how big the
// thing is; shrink a window to a ninth and its shadow should not become
// a ninth of a shadow. Poured into the mouth, 5px of drop at the
// funnel's 0.11 scale is 0.55px, and half a pixel of translucent grey is
// not a shadow — it is a dark fringe crawling down one edge of the neck,
// and (because the bottom band is shade too) the first thing that enters
// the bay is a smear rather than the window.
//
// So the shade fades out. What it fades ON is the whole design. Fading
// on `t` is the obvious move and it is wrong: during a minimize the top
// of the sheet is still near full size while the bottom is already at
// the mouth, so a fade driven by the clock strips a perfectly legible
// 5px band off the part of the sheet that still reads correctly. The
// fade is driven instead by how hard the funnel is squeezing THIS ROW —
// carried per-vertex from the law, which computes it anyway. The shadow
// then survives exactly where it still resolves and leaves where it
// cannot, which is also what makes it need no special case for a
// manual scrub, a catch mid-flight, or a restore: none of those know
// what time it is either.

import { SURFACE_RADIUS_GLSL } from '@petepetrash/munari'

export const GENIE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vSqueeze;
  // The row's width as a fraction of the sheet's resting width, written
  // by the same loop that writes position — genieWarp returns it as k.
  attribute float squeeze;
  void main() {
    vUv = uv;
    vSqueeze = squeeze;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const GENIE_FRAG = /* glsl */ `
  ${SURFACE_RADIUS_GLSL}
  uniform sampler2D tMap;
  /** Where the window stops and the shade begins, as a fraction of the
   *  capture root, in the DOM's own coordinates: (windowW / rootW,
   *  windowH / rootH). (1, 1) means this sheet has no shade band and
   *  nothing below can fade anything. */
  uniform vec2 uShadeEdge;
  /** The band of row-compression the shade fades across: fully present
   *  at or above .y, gone at or below .x. */
  uniform vec2 uShadeFade;
  varying vec2 vUv;
  varying float vSqueeze;
  void main() {
    vec4 c = texture2D(tMap, vUv);

    // The shade occupies an L along the root's right and bottom edges,
    // and the window in front of it is opaque, so a texel is shade if
    // and only if it is outside the window's box. The two empty corners
    // fall in the same region and are already alpha 0, so they neither
    // need nor notice this.
    //
    // vUv.y runs bottom → top and the DOM's runs top → bottom, the same
    // flip the driver applies when it feeds the law.
    float shade = min(1.0, step(uShadeEdge.x, vUv.x) + step(uShadeEdge.y, 1.0 - vUv.y));
    // Premultiplied (decisions.md #5), so scaling the whole texel —
    // colour and alpha together — is exactly a fade, and leaves it
    // premultiplied on the way out.
    c *= mix(1.0, smoothstep(uShadeFade.x, uShadeFade.y, vSqueeze), shade);
    // The element's corners, enforced analytically. The flight card needs
    // this because its .ui-root paints them opaque and the texture cannot
    // say where the card ends; the genie sheet turns that background off
    // (genie.css) so its shadow can carry real alpha, which leaves the
    // mask doing nothing at this scene's zero radius — kept because the
    // radius is the window's to choose, not this shader's to assume.
    c.a *= munariRadiusMask(vUv);
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    // The DOM texture is SRGBColorSpace: the sampler hands back linear,
    // and a raw ShaderMaterial gets no automatic encode. Without this the
    // sheet's text renders darker than the page it must be identical to
    // at the swap (measured on the flight card, 2026-08-02).
    #include <colorspace_fragment>
  }
`
