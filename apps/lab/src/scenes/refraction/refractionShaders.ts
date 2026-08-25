// The refraction material — one sheet, two live captures.
//
// The law: the outgoing view is sampled UNDISPLACED and the incoming view
// is sampled THROUGH A DROP OF GLASS. Nothing here is a screen grab: the
// incoming capture is a Surface the page presents nowhere, reached by
// handle (`useSurfaceTextureOf`), which is why its pixels exist at all
// inside this sheet and nowhere else on the canvas.
//
// The drop is the front. The aperture field says how far past the front a
// pixel sits, that distance drives a droplet profile, and the profile's
// slope is the surface — so the thing that reveals the arriving page and
// the thing that bends it are one object. Everything optical hangs off
// that one normal: the refraction, the room it mirrors, its rim.
//
// The ink decides WHERE the drop grows and no longer decides what it looks
// like. That split is the fix for the fault Pete reported on 2026-08-22:
// with the surface cut from the leaving page's ink field, the glass was a
// relief of its letterforms and the front was only a mask over it, so the
// effect read as embossed text rather than as liquid emerging.
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
// The GLASS is what the drop mirrors, not what a light does to it. There
// is no light position and no pointer: a procedural room reflects off the
// drop's own normal. The highlight therefore moves because the meniscus
// sweeps across the page, not because a hand moved. The scene carried a
// raking point light until 2026-08-22 and it read as a hot spot chasing
// the cursor.
//
// PREMULTIPLIED (decisions.md #5): light is added as `k * c.a`, fades and
// masks multiply the whole vec4. The reflection and the rim are the same:
// scaled by alpha so the transparent margin outside the panel stays empty,
// and composited by REPLACING colour rather than adding it, which is what
// keeps a bright streak bounded at paper-white instead of clipping.

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
  uniform vec2 uTexel;           // 1 / stage size, so px constants are px
  uniform float uRelief;         // 0..1, the pulse
  uniform float uTransmission;   // 0..1, how far the aperture front has swept
  uniform float uZoom;           // the incoming view's own scale
  uniform sampler2D tField;      // the leaving page's ink mass, box-filtered
  uniform sampler2D tSpread;     // that same mass, grown outward into blobs
  uniform sampler2D tHollow;     // and the paper grown inward, for their insides
  uniform vec2 uSpreadTexel;     // 1 / spread size, the step the normal measures over
  uniform float uRounding;       // 0 straight bilinear, 1 eased at texel boundaries
  uniform float uDispersion;     // fraction of the bend red and blue differ by
  uniform float uApertureFloor;  // measured ink density of bare paper
  uniform float uApertureCeil;   // measured ink density of a dense text block
  uniform float uApertureInk;    // how far the ink steers the front
  uniform float uApertureGamma;  // spreads the front's travel over the page
  uniform float uApertureOvershoot; // how far the front sweeps past both ends
  uniform float uApertureEdge;   // seam width, in screen pixels
  uniform float uBendTaper;      // CSS px over which the bend dies at the rim
  uniform float uRimPx;          // how wide the drop's meniscus is
  uniform float uHeightPx;       // how tall the drop stands
  uniform float uIor;            // refractive index of the glass
  uniform float uRefractPx;      // CSS px the arriving page moves per unit deviation
  uniform float uReflect;        // how much of the room the glass mirrors
  uniform float uRoomBand;       // where the window streak sits, in reflected y
  uniform float uRoomWidth;      // how broad that streak is
  uniform float uRim;            // weight of the grazing-incidence rim
  uniform float uRimPow;         // how tightly the rim hugs the steepest slope
  uniform float uFresPow;        // how fast the mirror falls off away from grazing
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;

  // The aperture field: where the front is, at every point of the page.
  //
  // Two scales of the same ink and no geometry at all.
  //
  // The ink term is the box-filtered field, so the front opens at the
  // densest mark on the page. Cut from a sharper density it would pick out
  // individual words and run through the middle of a title mid-crossing,
  // half the leaving headline beside half the arriving one.
  //
  // The spread term is a signed distance field, and it is signed because a
  // one-sided one has nothing to say about the inside of a solid mark.
  // tSpread grows the ink outward, so bare paper carries the height of the
  // nearest mark less how far away it is. tHollow grows the PAPER inward,
  // so the middle of a solid mark carries how deep it is. The difference
  // orders both, and every mark opens from its own centre.
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
  // Hermite reconstruction of a coarse field, at the cost of no extra taps.
  //
  // Bilinear is C0. Its iso-lines are straight inside a texel and kink at
  // every boundary, so the contact line drawn from a 25x19 spread is a
  // polygon with roughly one edge per texel it crosses — the stark facets
  // Pete photographed on 2026-08-23. Easing the fractional coordinate before
  // the hardware lerp makes the interpolant C1 across the boundary, which is
  // what rounds the corners out.
  //
  // The easing zeroes the interpolant's slope AT the boundary. Nothing here
  // reads that slope: the normal is a central difference two spread texels
  // wide (below), so it never straddles a single boundary and cannot pick up
  // the flat spot.
  vec2 roundedUv(vec2 uv, vec2 texel) {
    vec2 t = uv / texel - 0.5;
    vec2 i = floor(t);
    vec2 f = t - i;
    return (i + 0.5 + mix(f, f * f * (3.0 - 2.0 * f), uRounding)) * texel;
  }

  float apertureAt(vec2 uv) {
    float ink = clamp(
      (texture2D(tField, uv).r - uApertureFloor) / (uApertureCeil - uApertureFloor),
      0.0, 1.0);
    vec2 su = roundedUv(uv, uSpreadTexel);
    float spread = 0.5 + 0.5 * (texture2D(tSpread, su).r - texture2D(tHollow, su).r);
    return pow(mix(spread, ink, uApertureInk), uApertureGamma);
  }

  void main() {
    vec4 outgoing = texture2D(tMap, vUv);

    // ── the front ──────────────────────────────────────────────────────
    float field = apertureAt(vUv);

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

    // ── the body of glass ──────────────────────────────────────────────
    //
    // The front is not a mask over the page — it is the contact line of a
    // drop, and everything the drop's surface does is derived from how far
    // inside that line a pixel sits. The scene shaped the surface out of the
    // LEAVING page's ink until 2026-08-22, which made the glass a relief of
    // its letterforms; the ink still decides where the drop grows, because
    // the spread grew out of it, but it no longer decides what the drop
    // looks like.
    //
    // The field is not a distance, so it is turned into one: an implicit
    // surface's signed distance is its value over the magnitude of its
    // gradient, which is exact wherever the field is locally linear and is
    // near enough everywhere else.
    //
    // Measured over one SPREAD texel either side rather than by dFdx. The
    // spread is a coarse bilinear texture, so its screen derivative is
    // discontinuous at every texel boundary — a magnitude jump that a seam
    // width never showed, and a DIRECTION jump that a specular normal shows
    // as facets on a 22px grid. The wider difference reads across the
    // boundary instead of straddling it.
    vec2 stepPx = uSpreadTexel / uTexel;
    float gx = apertureAt(vUv + vec2(uSpreadTexel.x, 0.0))
             - apertureAt(vUv - vec2(uSpreadTexel.x, 0.0));
    float gy = apertureAt(vUv + vec2(0.0, uSpreadTexel.y))
             - apertureAt(vUv - vec2(0.0, uSpreadTexel.y));
    vec2 gPx = vec2(gx / (2.0 * stepPx.x), gy / (2.0 * stepPx.y));
    float gm = max(length(gPx), 1e-6);
    vec2 gdir = gPx / gm;
    float d = (field - edge) / gm;

    // The profile is a drop: zero at the contact line, a vertical tangent
    // there, a flat top about three rim widths in. The flat top is what
    // keeps the arriving page readable through the middle of a blob — every
    // optical term below lives in the meniscus and dies inside it.
    //
    // The root is floored because a vertical tangent has no normal. That
    // floor, and not the profile, is what sets the steepest surface the
    // glass can present, so it is what bounds the widest bend it can ask
    // for — refractionLaw.ts pins the bend against it.
    float e = max(uRimPx, 0.5);
    float uu = exp(-max(d, 0.0) / e);
    float fill = sqrt(max(1.0 - uu, 0.0));
    float dhdd = uHeightPx * uRelief * uu / (2.0 * e * max(fill, 0.06));

    // Outside the line there is no surface at all, so the normal is flat and
    // every term below falls out on its own rather than being faded out.
    // 1.5px of ramp is the contact line's own antialiasing — narrower than
    // the content seam on purpose, so the drop arrives a moment before what
    // is inside it does.
    float lip = smoothstep(0.0, 1.5, d);

    // The sheet's own rim. base + bend is clamped to the texture, so a bend
    // that points outward within a bend's distance of the edge repeats the
    // arriving page's border row and draws a hard straight streak. Dying to
    // zero makes that unreachable rather than unlikely, and the law's test
    // walks every distance against the largest bend the profile can ask for.
    vec2 toEdgePx = min(vUv, 1.0 - vUv) / uTexel;
    float taper = smoothstep(0.0, uBendTaper, min(toEdgePx.x, toEdgePx.y));

    vec3 n = normalize(vec3(-dhdd * gdir * lip * taper, 1.0));

    // ── the arriving page, seen through it ─────────────────────────────
    //
    // Snell, not a gradient push: the eye ray refracts at the surface and
    // lands somewhere else on the page behind it. Past the critical angle
    // refract returns zero, which is total internal reflection and is the
    // right answer rather than a case to guard.
    vec2 base = (vUv - 0.5) / uZoom + 0.5;
    vec2 bend = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / max(uIor, 1.0)).xy
      * uRefractPx * uTexel;

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

    vec4 c = mix(outgoing, incoming, reveal);

    // ── what the glass mirrors ─────────────────────────────────────────
    //
    // Glass is defined by what it reflects, and a mirror REPLACES what is
    // behind it rather than adding to it: the words under a streak dim as
    // the reflection takes over. Added instead, the same term reads as gloss
    // paint over the page, and it clips — the fault Selection measured at a
    // lobe core of ~1.9 over 0.85 paper (2026-08-21).
    //
    // The room is three facts and no texture: dim walls, one window band
    // brighter than paper, a floor darker than anything on the page. F0 is
    // renormalised out of the mix weight so a flat sheet stays EXACTLY
    // untouched rather than veiled by the 5% every dielectric reflects
    // head-on — which is also what keeps the page outside the drop a page.
    //
    // The exponent is a knob, not Schlick's 5. lip above zeroes the normal at
    // the contact line, which is the profile's steepest point, so this
    // surface never tilts past about 59 degrees — and a fifth power there
    // leaves 2.4% once F0 is renormalised out. mirrorFalloff in
    // refractionTuning.ts carries the measurement. Any positive exponent
    // keeps the flat page exactly untouched, because 1 - n.z is 0 there.
    float F0 = 0.05;
    float fres = F0 + (1.0 - F0) * pow(clamp(1.0 - n.z, 1e-4, 1.0), uFresPow);
    float fresR = (fres - F0) / (1.0 - F0);
    vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
    float qb = (R.y - uRoomBand) / max(uRoomWidth, 1e-3);
    float room = mix(mix(0.35, 3.0, exp(-qb * qb)), 0.08,
                     smoothstep(0.05, 0.7, -R.y));
    float wR = clamp(fresR * uReflect, 0.0, 1.0);
    c.rgb = mix(c.rgb, vec3(room) * c.a, wR);

    // Grazing incidence brightens a border — the tell of a raised edge of
    // glass, and the reason a droplet's rim reads before its body does.
    // Paint, not light: a white layer at its own coverage, so it is bounded
    // at paper-white and the knob stays linear all the way up.
    float wRim = clamp(pow(clamp(1.0 - n.z, 1e-4, 1.0), uRimPow) * uRim, 0.0, 1.0);
    c.rgb = mix(c.rgb, vec3(c.a), wRim);

    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`

// ── the ink field ───────────────────────────────────────────────────────

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
// at every bend tried, worse than the sharp gradient it replaced.
export const FIELD_FRAG = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uStep;            // an eighth of a field texel, in uv
  uniform float uDetail;         // 0 how dark the patch is, 1 how busy it is
  varying vec2 vUv;

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    float sum = 0.0;
    float vs = 0.0;
    float vss = 0.0;
    for (int y = 0; y < 8; y++) {
      for (int x = 0; x < 8; x++) {
        vec2 o = (vec2(float(x), float(y)) - 3.5) * 2.0 * uStep;
        vec4 c = texture2D(tSource, vUv + o);
        sum += (1.0 - lum(c.rgb)) * c.a;
        // Composited over white, which is what an eye integrates. The source
        // is premultiplied, so its colour is already scaled by alpha and the
        // paper is whatever alpha did not cover (decisions.md #5).
        float v = lum(c.rgb) + (1.0 - c.a);
        vs += v;
        vss += v * v;
      }
    }
    // Standard deviation across the 64 taps: how much the patch varies rather
    // than how dark it is. Doubled because the busiest a patch can be is half
    // black and half white, which deviates by 0.5.
    float mean = vs / 64.0;
    float busy = clamp(2.0 * sqrt(max(vss / 64.0 - mean * mean, 0.0)), 0.0, 1.0);
    gl_FragColor = vec4(mix(sum / 64.0, busy, uDetail), 0.0, 0.0, 1.0);
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
