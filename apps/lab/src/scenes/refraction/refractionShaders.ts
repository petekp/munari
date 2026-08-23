// The refraction material — one sheet, two live captures.
//
// The law: the outgoing view is sampled UNDISPLACED and the incoming view
// is sampled THROUGH it. The lens is the outgoing page's own ink — its
// masses, not its letterforms, which is a distinction refractionField.tsx
// exists to enforce and paid for in a day of ghosting. Nothing here is a
// screen grab: the incoming capture is a Surface the page presents nowhere,
// reached by handle (`useSurfaceTextureOf`), which is why its pixels exist
// at all inside this sheet and nowhere else on the canvas.
//
// Two scales, two jobs, and mixing them up is the scene's whole failure
// mode. The BEND reads the filtered field, because a lens has to displace
// several glyphs the same way or it tears the words it is displacing. The
// LIGHT reads the page's raw luminance, because a highlight wants the edge
// of a single stroke.
//
// The fault the APERTURE exists to avoid: `mix(outgoing, incoming, t)`
// puts every pixel at half strength through the middle of the crossing.
// Measured 2026-08-22 over the 560×420 panel, that global blend made the
// midpoint the lowest-contrast frame of the whole transition — stddev
// 42.7, under both endpoints (54.8 leaving, 47.7 arriving) — and doubled
// every glyph, so the middle read as a blurred crossfade rather than as
// glass. The reveal below is a threshold instead: a front opens from the
// centre of the sheet, ink pushes it ahead of itself, and every pixel is
// fully one document or fully the other outside a band `uApertureEdge`
// wide, and that band is derived per pixel from fwidth so it stays a fixed
// number of SCREEN pixels. The ink term is what makes the claim visible
// rather than asserted — the arriving page breaks through the text blocks
// first.
//
// Why the geometry never leaves z = 0, unlike decisions.md #35: only the
// TRANSMITTED layer is displaced. The outgoing view's own pixels stay at
// their own uv, so its raycast is exact for as long as it is the view being
// pointed at — there is no gap between the hand and the eye to close. The
// same choice fisheye and slider make, for the same reason.
//
// PREMULTIPLIED (decisions.md #5): light is added as `k * c.a`, fades and
// masks multiply the whole vec4. The height field multiplies by alpha too —
// without that, the transparent margin outside the panel reads as maximum
// relief and the sheet grows a bright rim at its own border.

import { SURFACE_RADIUS_GLSL } from '@petepetrash/munari'

export const REFRACTION_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const REFRACTION_FRAG = /* glsl */ `
  uniform sampler2D tMap;        // the outgoing view, this Surface's own
  uniform sampler2D tIncoming;   // the resident Surface, presented nowhere
  uniform float uHasIncoming;    // 0 until its source has published
  uniform vec2 uTexel;           // 1 / capture size, for the finite difference
  uniform float uRelief;         // 0..1, the pulse
  uniform float uTransmission;   // 0..1, how far the aperture front has swept
  uniform float uZoom;           // the incoming view's own scale
  uniform float uAmplitude;      // CSS px of bend per unit ink-mass gradient
  uniform sampler2D tField;      // the leaving page's ink mass, box-filtered
  uniform sampler2D tSpread;     // that same mass, grown outward into blobs
  uniform sampler2D tHollow;     // and the paper grown inward, for their insides
  uniform vec2 uFieldTexel;      // 1 / field size
  uniform float uDispersion;     // fraction of the bend red and blue differ by
  uniform float uAspect;         // panel w/h, so distances are circular in px
  uniform float uApertureFloor;  // measured ink density of bare paper
  uniform float uApertureCeil;   // measured ink density of a dense text block
  uniform float uApertureInk;    // how far the ink steers the front
  uniform float uApertureGamma;  // spreads the front's travel over the page
  uniform float uApertureOvershoot; // how far the front sweeps past both ends
  uniform float uApertureEdge;   // seam width, in screen pixels
  uniform float uMaxBendPx;      // soft ceiling on the displacement, CSS px
  uniform float uBendTaper;      // CSS px over which the bend dies at the rim
  uniform vec2 uLight;           // the pointer, in this sheet's own uv
  uniform float uLightFalloff;   // distance at which the light is half strength
  uniform float uSpecPower;      // tightness of the raking highlight
  uniform float uSheenGain;
  uniform float uSheenAmount;
  uniform float uSheenTransmit; // how much light survives behind the front
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // Ink stands proud. Multiplied by alpha so the margin outside the panel
  // is flat rather than maximally raised.
  float heightAt(vec2 uv) {
    vec4 c = texture2D(tMap, uv);
    return (1.0 - lum(c.rgb)) * c.a;
  }

  void main() {
    vec4 outgoing = texture2D(tMap, vUv);

    // Two gradients, at two scales, and the difference between them is the
    // whole reason this scene works at all.
    //
    // The sharp one, one texel either side, is the edge of a single glyph.
    // It drives the LIGHT, where high frequency is what you want: letterforms
    // catching a highlight along their strokes.
    float hx = heightAt(vUv + vec2(uTexel.x, 0.0)) - heightAt(vUv - vec2(uTexel.x, 0.0));
    float hy = heightAt(vUv + vec2(0.0, uTexel.y)) - heightAt(vUv - vec2(0.0, uTexel.y));

    // The smooth one is the slope of the page's ink MASS, one texel of the
    // box-filtered field either side. It drives the BEND, and the reason it
    // has to come from a filtered field rather than from more taps on this
    // texture is written up in refractionField.tsx.
    float mx = texture2D(tField, vUv + vec2(uFieldTexel.x, 0.0)).r
             - texture2D(tField, vUv - vec2(uFieldTexel.x, 0.0)).r;
    float my = texture2D(tField, vUv + vec2(0.0, uFieldTexel.y)).r
             - texture2D(tField, vUv - vec2(0.0, uFieldTexel.y)).r;

    // Negative: ink pulls the transmitted view toward itself, so the letters
    // magnify what is behind them the way a raised bead of glass would.
    //
    // Two limits, and they answer different faults.
    //
    // The knee is about legibility: the field steps hardest at the figure's
    // border, and an unbounded bend there tears whatever is behind it.
    //
    // The taper is about the sheet's own rim. base + bend is clamped to
    // the texture, so a bend that points outward within a bend's distance of
    // the edge repeats the arriving page's border row and draws a hard
    // straight streak. Dying to zero at the rim makes that unreachable
    // rather than unlikely, and the law's test pins the width against the
    // largest bend the field can ask for.
    // Soft knee rather than min(): a hard cap leaves a plateau where
    // neighbouring pixels share a magnitude but not a direction, and heavy
    // strokes shear along it. This approaches uMaxBendPx and never reaches
    // it, so the magnitude stays as smooth as the field is.
    vec2 lens = vec2(mx, my);
    float lensMag = length(lens);
    float want = lensMag * uAmplitude * uRelief;
    vec2 toEdgePx = min(vUv, 1.0 - vUv) / uTexel;
    float taper = smoothstep(0.0, uBendTaper, min(toEdgePx.x, toEdgePx.y));
    vec2 bend = lensMag > 1e-5
      ? -(lens / lensMag) * (want / (1.0 + want / uMaxBendPx)) * taper * uTexel
      : vec2(0.0);
    vec2 base = (vUv - 0.5) / uZoom + 0.5;

    // Glass splits the spectrum. Red takes the long way round the bend and
    // blue the short one; alpha comes from the middle tap, so the outer two
    // channels fringe against the rounded corner by a fraction of a pixel.
    vec4 mid = texture2D(tIncoming, clamp(base + bend, 0.0, 1.0));
    float red = texture2D(tIncoming, clamp(base + bend * (1.0 + uDispersion), 0.0, 1.0)).r;
    float blue = texture2D(tIncoming, clamp(base + bend * (1.0 - uDispersion), 0.0, 1.0)).b;
    vec4 incoming = vec4(red, mid.g, blue, mid.a);

    // Before the resident source has published there is nothing to transmit;
    // falling back to the outgoing view keeps the sheet from going blank on
    // whichever commit loses the race between two independent trees.
    incoming = mix(outgoing, incoming, uHasIncoming);

    // The aperture, at two scales of the same ink and no geometry at all.
    //
    // The ink term is the filtered field the bend reads, so the front opens
    // at the densest mark on the page. Cut from a sharper density it would
    // pick out individual words and run through the middle of a title
    // mid-crossing, half the leaving headline beside half the arriving one.
    //
    // The spread term is a signed distance field, and it is signed because a
    // one-sided one has nothing to say about the inside of a solid mark.
    // tSpread grows the ink outward, so bare paper carries the height of
    // the nearest mark less how far away it is. tHollow grows the PAPER
    // inward, so the middle of a solid mark carries how deep it is. The
    // difference orders both, and every mark opens from its own centre.
    //
    // The fault that produced it, from Pete's screenshot on 2026-08-22: with
    // the outward spread alone, the black square figure was one flat plateau
    // — measured at 80% of the figure box above 0.995, against 6% over a text
    // column. A plateau has no interior order and fwidth across it is zero,
    // so the seam collapses to nothing and the whole square crosses the front
    // on a single frame with a hard rectangular edge. Text never showed this
    // because text is never flat.
    //
    // The term this replaced was a circle: one minus the distance from the
    // centre. It ordered the margins correctly and it was visible doing it —
    // at any ink share under 1 the front read as a circular wipe with blobs
    // riding on top of it, two shapes competing for the same edge (Pete,
    // 2026-08-22). A spread of the ink orders the same margins and has no
    // shape of its own, because the only thing on the page is the page.
    //
    // Both live in 0..1 against the same floor and ceiling, but the spread
    // was normalised in its own first pass rather than here — SPREAD_FRAG
    // says why one decay cannot serve marks of different heights otherwise.
    float ink = clamp(
      (texture2D(tField, vUv).r - uApertureFloor) / (uApertureCeil - uApertureFloor),
      0.0, 1.0);
    float spread = 0.5 + 0.5 * (texture2D(tSpread, vUv).r - texture2D(tHollow, vUv).r);
    float field = pow(mix(spread, ink, uApertureInk), uApertureGamma);

    // Swept past both ends, so t=0 reveals nothing anywhere and t=1 reveals
    // everything — a front that stopped short would leave the outgoing page
    // ghosted into the margins for good.
    float edge = mix(1.0 + uApertureOvershoot, -uApertureOvershoot, uTransmission);

    // The seam is a fixed number of SCREEN pixels wide, not a fixed slice of
    // the field. The field is smooth over most of a page, so a seam stated in
    // field units spreads over half the panel and every pixel under it shows
    // both documents at once — which is the crossfade, back by another route.
    // fwidth is the field's change per pixel, so this holds the seam at
    // uApertureEdge pixels wherever the front happens to be.
    //
    // Capped at half the overshoot: near the figure's border the field steps
    // hard, and an uncapped seam there would reach back past 1.0 and reveal
    // a sliver at transmission 0. Half rather than all, so the ends clear the
    // field's range with margin instead of landing exactly on it.
    float w = clamp(fwidth(field) * uApertureEdge, 1e-5, uApertureOvershoot * 0.5);
    float reveal = smoothstep(edge - w, edge + w, field);

    vec4 c = mix(outgoing, incoming, reveal);

    // Raking light from wherever the pointer is. An edge lights on the side
    // facing the light and stays dark on the other, which is what moves when
    // the hand moves; a normal-mapped point light would instead put its
    // brightest spot on flat paper, where the slope is zero.
    vec2 grad = vec2(hx, hy);
    float slopeMag = length(grad);
    vec2 gdir = slopeMag > 1e-5 ? grad / slopeMag : vec2(0.0);
    vec2 toLight = (uLight - vUv) * vec2(uAspect, 1.0);
    float dist = length(toLight);
    vec2 ldir = dist > 1e-5 ? toLight / dist : vec2(0.0, 1.0);
    float facing = max(dot(gdir, ldir), 0.0);
    float slope = clamp(slopeMag * uSheenGain, 0.0, 1.0);
    float falloff = (uLightFalloff * uLightFalloff)
      / (uLightFalloff * uLightFalloff + dist * dist);
    // Faded out behind the front. The relief IS the leaving page, so once a
    // pixel has been handed to the arriving one there is no letterform left
    // there to catch light. Untapered, the light redraws the leaving page's
    // headline in white over the arriving page's headline — which is the
    // "both documents at once" the aperture exists to prevent, arriving by
    // the one route the aperture does not control (seen 2026-08-22).
    float sheen = pow(facing, uSpecPower) * pow(slope, 1.5)
      * uSheenAmount * uRelief * falloff * mix(1.0, uSheenTransmit, reveal);
    c.rgb += sheen * c.a;

    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`

// ── the lens field ───────────────────────────────────────────────────────

export const FIELD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// One box filter, run into a target a sixteenth of the page's size. Sixty-
// four bilinear taps span two field texels, so every source texel under the
// box contributes and the result carries no trace of the line pitch.
//
// A ring or a cross of taps cannot do this job however wide it is spread.
// Measured 2026-08-22: five taps at 16px spacing over 13px lines is point
// sampling a periodic signal, and the "smooth" gradient it returned jumped
// between neighbouring pixels — the arriving page came out as colour noise
// at every amplitude tried, worse than the sharp gradient it replaced.
export const FIELD_FRAG = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uStep;            // an eighth of a field texel, in uv
  varying vec2 vUv;

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    float sum = 0.0;
    for (int y = 0; y < 8; y++) {
      for (int x = 0; x < 8; x++) {
        vec2 o = (vec2(float(x), float(y)) - 3.5) * 2.0 * uStep;
        vec4 c = texture2D(tSource, vUv + o);
        sum += (1.0 - lum(c.rgb)) * c.a;
      }
    }
    gl_FragColor = vec4(sum / 64.0, 0.0, 0.0, 1.0);
  }
`

// One step of the aperture's spread — the ink field, normalised, grown
// outward by one texel and charged for the distance.
//
// A grassfire. Each tap pays uDecay times how far it reaches, and the pass
// keeps the largest survivor, so a point N texels from the nearest ink
// carries that ink's height less N drops: a distance field wearing the ink's
// own values. Charging by the tap's actual length rather than a flat rate is
// what makes the blobs round — a flat rate spreads by the box's own shape
// and grows squares.
//
// The tap at the centre costs nothing, so a blob keeps the full height of
// the mark that made it. That is the property the first two versions of this
// pass both lost. A plain dilation had no distance in it at all and
// saturated the page. Mixing a blur back in to soften the square dragged the
// peaks down instead: measured 2026-08-22 at four passes, the spread topped
// out at 0.40 against a field that should have reached 1, so the aperture
// front spent its whole first half above every pixel on the sheet and then
// opened 42% of it in one step.
//
// The normalisation happens HERE and not in the material, which is what lets
// one decay work for every mark on the page. The figure's border is seven
// times the height of a paragraph; grown raw, a drop that killed a
// paragraph's blob in four passes left the figure's at 0.86 and it flooded
// the sheet. Normalised first, every blob starts at 1 and a decay of
// 1/passes lands every one of them on bare paper at exactly the tuned reach.
// It also buys back the resolution: an 8-bit target held 33 usable levels
// across a raw range of 0.129 and holds 255 across 0..1.
//
// Pass 0 does the normalising and the rest run idempotent, with uFloor 0 and
// uScale 1 — one pair of uniform writes rather than a second program. The
// same switch runs the chain twice: once on the ink and once on its inverse,
// which is what gives a solid mark an inside. uInvert is pass 0's only,
// because after it the field is already whichever of the two it is.
//
// Twenty-five taps at half a texel, so the box is contiguous over the source
// rather than sampling it at intervals — the mistake refractionField.tsx's
// preamble records paying a day for.
export const SPREAD_FRAG = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uStep;            // half a texel of THIS pass, in uv
  uniform float uFloor;          // subtracted before scaling; 0 after pass 0
  uniform float uScale;          // 1 / (ceil - floor); 1 after pass 0
  uniform float uDecay;          // height lost per texel travelled, 1 / passes
  uniform float uInvert;         // 1 on pass 0 of the hollow chain, else 0
  varying vec2 vUv;

  void main() {
    float best = 0.0;
    for (int y = 0; y < 5; y++) {
      for (int x = 0; x < 5; x++) {
        vec2 tap = (vec2(float(x), float(y)) - 2.0) * 0.5;
        float raw = texture2D(tSource, clamp(vUv + tap * uStep * 2.0, 0.0, 1.0)).r;
        float v = clamp((raw - uFloor) * uScale, 0.0, 1.0);
        v = mix(v, 1.0 - v, uInvert);
        best = max(best, v - uDecay * length(tap));
      }
    }
    gl_FragColor = vec4(best, 0.0, 0.0, 1.0);
  }
`
