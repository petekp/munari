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
// fully one document or fully the other outside a band `apertureEdge`
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
//
// Both captures are SRGBColorSpace, so samples return linear values and the
// sheet hands its premultiplied linear composite to `premultipliedOutput`,
// which encodes it as the canvas expects. The passes that fill the ink fields
// draw into targets with no color space, so they write raw values.
//
// Ownership: this module owns the pixels. refractionField.tsx owns the
// targets the field passes draw into, refractionMaterial.tsx owns the
// per-frame uniform writes, and refractionLaw.ts owns the shape.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import {
  Fn,
  Loop,
  clamp,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  refract,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'

type Float = UniformNode<'float', number>
type Vec2 = UniformNode<'vec2', THREE.Vector2>

/**
 * Everything the sheet reads that is not the Surface's own: the second
 * capture, the field targets, and every tuned number. The frame loop writes
 * `.value` on these; the built material keeps sampling the same nodes.
 */
export interface RefractionValues {
  /** The resident Surface, presented nowhere. */
  readonly incoming: TextureNode
  /** The leaving page's ink mass, box-filtered. */
  readonly ink: TextureNode
  /** That same mass, grown outward into blobs. */
  readonly spread: TextureNode
  /** And the paper grown inward, for their insides. */
  readonly hollow: TextureNode
  /** 0 until its source has published. */
  readonly hasIncoming: Float
  /** One CSS pixel in uv, so px constants are px. */
  readonly texel: Vec2
  /** 1 / spread size, the step the normal measures over. */
  readonly spreadTexel: Vec2
  /** 0..1, the pulse. */
  readonly relief: Float
  /** 0..1, how far the aperture front has swept. */
  readonly transmission: Float
  /** The incoming view's own scale. */
  readonly zoom: Float
  /** 0 straight bilinear, 1 eased at texel boundaries. */
  readonly rounding: Float
  /** Fraction of the bend red and blue differ by. */
  readonly dispersion: Float
  /** Measured ink density of bare paper. */
  readonly apertureFloor: Float
  /** Measured ink density of a dense text block. */
  readonly apertureCeil: Float
  /** How far the ink steers the front. */
  readonly apertureInk: Float
  /** Spreads the front's travel over the page. */
  readonly apertureGamma: Float
  /** How far the front sweeps past both ends. */
  readonly apertureOvershoot: Float
  /** Seam width, in screen pixels. */
  readonly apertureEdge: Float
  /** CSS px over which the bend dies at the rim. */
  readonly bendTaper: Float
  /** How wide the drop's meniscus is. */
  readonly rimPx: Float
  /** How tall the drop stands. */
  readonly heightPx: Float
  /** Refractive index of the glass. */
  readonly ior: Float
  /** CSS px the arriving page moves per unit deviation. */
  readonly refractPx: Float
  /** How much of the room the glass mirrors. */
  readonly reflect: Float
  /** Where the window streak sits, in reflected y. */
  readonly roomBand: Float
  /** How broad that streak is. */
  readonly roomWidth: Float
  /** Weight of the grazing-incidence rim. */
  readonly rim: Float
  /** How tightly the rim hugs the steepest slope. */
  readonly rimPow: Float
  /** How fast the mirror falls off away from grazing. */
  readonly fresPow: Float
}

/**
 * The uniform and texture nodes for one sheet. Every number is rewritten by
 * the frame loop before the sheet draws, so the zeros are placeholders —
 * `zoom` starts at 1 only because it is a divisor.
 */
export function createRefractionValues(
  textures: {
    incoming: THREE.Texture
    ink: THREE.Texture
    spread: THREE.Texture
    hollow: THREE.Texture
  },
  texel: THREE.Vector2,
  spreadTexel: THREE.Vector2,
): RefractionValues {
  return {
    incoming: texture(textures.incoming),
    ink: texture(textures.ink),
    spread: texture(textures.spread),
    hollow: texture(textures.hollow),
    hasIncoming: uniform(0),
    texel: uniform(texel),
    spreadTexel: uniform(spreadTexel),
    relief: uniform(0),
    transmission: uniform(0),
    zoom: uniform(1),
    rounding: uniform(0),
    dispersion: uniform(0),
    apertureFloor: uniform(0),
    apertureCeil: uniform(1),
    apertureInk: uniform(0),
    apertureGamma: uniform(1),
    apertureOvershoot: uniform(0),
    apertureEdge: uniform(0),
    bendTaper: uniform(1),
    rimPx: uniform(0),
    heightPx: uniform(0),
    ior: uniform(1),
    refractPx: uniform(0),
    reflect: uniform(0),
    roomBand: uniform(0),
    roomWidth: uniform(1),
    rim: uniform(0),
    rimPow: uniform(1),
    fresPow: uniform(1),
  }
}

// SAFETY: a texture sample is a vec4; Three's types return a bare Node.
const sample = (map: TextureNode, at: Node<'vec2'>) => map.sample(at) as Node<'vec4'>

/** The sheet: the leaving capture, the arriving one through the drop, and the room the drop mirrors. */
export function createRefractionMaterial(surface: SurfaceNodes, v: RefractionValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })

  // Hermite reconstruction of a coarse field, at the cost of no extra taps.
  //
  // Bilinear is C0. Its iso-lines are straight inside a texel and kink at
  // every boundary, so the contact line drawn from the coarse spread is a
  // polygon with roughly one edge per texel it crosses — the stark facets
  // Pete photographed on 2026-08-23. Easing the fractional coordinate before
  // the hardware lerp makes the interpolant C1 across the boundary, which is
  // what rounds the corners out.
  //
  // The easing zeroes the interpolant's slope AT the boundary. Nothing here
  // reads that slope: the normal is a central difference two spread texels
  // wide (below), so it never straddles a single boundary and cannot pick up
  // the flat spot.
  const roundedUv = (at: Node<'vec2'>, texel: Node<'vec2'>): Node<'vec2'> => {
    const t = at.div(texel).sub(0.5)
    const i = t.floor()
    const f = t.sub(i)
    return i.add(0.5).add(mix(f, f.mul(f).mul(float(3).sub(f.mul(2))), v.rounding)).mul(texel)
  }

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
  // The spread map grows the ink outward, so bare paper carries the height
  // of the nearest mark less how far away it is. The hollow map grows the
  // PAPER inward, so the middle of a solid mark carries how deep it is. The
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
  // was normalised in its own first pass rather than here — the spread pass
  // says why one decay cannot serve marks of different heights otherwise.
  const apertureAt = (at: Node<'vec2'>): Node<'float'> => {
    const ink = sample(v.ink, at).r.sub(v.apertureFloor).div(v.apertureCeil.sub(v.apertureFloor)).clamp(0, 1)
    const su = roundedUv(at, v.spreadTexel)
    const spread = float(0.5).add(float(0.5).mul(sample(v.spread, su).r.sub(sample(v.hollow, su).r)))
    return pow(mix(spread, ink, v.apertureInk), v.apertureGamma)
  }

  material.outputNode = Fn(() => {
    const vUv = uv()
    const outgoing = sample(surface.map, vUv).toVar()

    // ── the front ──────────────────────────────────────────────────────
    const field = apertureAt(vUv).toVar()

    // Swept past both ends, so t=0 reveals nothing anywhere and t=1 reveals
    // everything — a front that stopped short would leave the outgoing page
    // ghosted into the margins for good.
    const edge = mix(float(1).add(v.apertureOvershoot), v.apertureOvershoot.negate(), v.transmission).toVar()

    // The seam is a fixed number of SCREEN pixels wide, not a fixed slice of
    // the field. The field is smooth over most of a page, so a seam stated in
    // field units spreads over half the panel and every pixel under it shows
    // both documents at once — which is the crossfade, back by another route.
    // fwidth is the field's change per pixel, so this holds the seam at
    // apertureEdge pixels wherever the front happens to be.
    //
    // Capped at half the overshoot: near the figure's border the field steps
    // hard, and an uncapped seam there would reach back past 1.0 and reveal
    // a sliver at transmission 0. Half rather than all, so the ends clear the
    // field's range with margin instead of landing exactly on it.
    const w = clamp(field.fwidth().mul(v.apertureEdge), 1e-5, v.apertureOvershoot.mul(0.5))
    const reveal = smoothstep(edge.sub(w), edge.add(w), field)

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
    // as facets. The wider difference reads across the
    // boundary instead of straddling it.
    const stepPx = v.spreadTexel.div(v.texel)
    const gx = apertureAt(vUv.add(vec2(v.spreadTexel.x, 0))).sub(apertureAt(vUv.sub(vec2(v.spreadTexel.x, 0))))
    const gy = apertureAt(vUv.add(vec2(0, v.spreadTexel.y))).sub(apertureAt(vUv.sub(vec2(0, v.spreadTexel.y))))
    const gPx = vec2(gx.div(stepPx.x.mul(2)), gy.div(stepPx.y.mul(2)))
    const gm = max(length(gPx), 1e-6)
    const gdir = gPx.div(gm)
    const d = field.sub(edge).div(gm)

    // The profile is a drop: zero at the contact line, a vertical tangent
    // there, a flat top about three rim widths in. The flat top is what
    // keeps the arriving page readable through the middle of a blob — every
    // optical term below lives in the meniscus and dies inside it.
    //
    // The root is floored because a vertical tangent has no normal. That
    // floor, and not the profile, is what sets the steepest surface the
    // glass can present, so it is what bounds the widest bend it can ask
    // for — refractionLaw.ts pins the bend against it.
    const e = max(v.rimPx, 0.5)
    const uu = exp(max(d, 0).negate().div(e))
    const fill = sqrt(max(float(1).sub(uu), 0))
    const dhdd = v.heightPx.mul(v.relief).mul(uu).div(e.mul(2).mul(max(fill, 0.06)))

    // Outside the line there is no surface at all, so the normal is flat and
    // every term below falls out on its own rather than being faded out.
    // 1.5px of ramp is the contact line's own antialiasing — narrower than
    // the content seam on purpose, so the drop arrives a moment before what
    // is inside it does.
    const lip = smoothstep(0, 1.5, d)

    // The sheet's own rim. base + bend is clamped to the texture, so a bend
    // that points outward within a bend's distance of the edge repeats the
    // arriving page's border row and draws a hard straight streak. Dying to
    // zero makes that unreachable rather than unlikely, and the law's test
    // walks every distance against the largest bend the profile can ask for.
    const toEdgePx = min(vUv, float(1).sub(vUv)).div(v.texel)
    const taper = smoothstep(0, v.bendTaper, min(toEdgePx.x, toEdgePx.y))

    const n = normalize(vec3(gdir.mul(dhdd.negate()).mul(lip).mul(taper), 1)).toVar()

    // ── the arriving page, seen through it ─────────────────────────────
    //
    // Snell, not a gradient push: the eye ray refracts at the surface and
    // lands somewhere else on the page behind it. Past the critical angle
    // refract returns zero, which is total internal reflection and is the
    // right answer rather than a case to guard.
    const base = vUv.sub(0.5).div(v.zoom).add(0.5)
    const bend = refract(vec3(0, 0, -1), n, float(1).div(max(v.ior, 1))).xy.mul(v.refractPx).mul(v.texel)

    // Glass splits the spectrum. Red takes the long way round the bend and
    // blue the short one; alpha comes from the middle tap, so the outer two
    // channels fringe against the rounded corner by a fraction of a pixel.
    const mid = sample(v.incoming, clamp(base.add(bend), 0, 1))
    const red = sample(v.incoming, clamp(base.add(bend.mul(float(1).add(v.dispersion))), 0, 1)).r
    const blue = sample(v.incoming, clamp(base.add(bend.mul(float(1).sub(v.dispersion))), 0, 1)).b
    const arriving = vec4(red, mid.g, blue, mid.a)

    // Before the resident source has published there is nothing to transmit;
    // falling back to the outgoing view keeps the sheet from going blank on
    // whichever commit loses the race between two independent trees.
    const incoming = mix(outgoing, arriving, v.hasIncoming)

    const c = mix(outgoing, incoming, reveal).toVar()

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
    const F0 = 0.05
    const fres = float(F0).add(float(1 - F0).mul(pow(clamp(float(1).sub(n.z), 1e-4, 1), v.fresPow)))
    const fresR = fres.sub(F0).div(1 - F0)
    const R = reflect(vec3(0, 0, -1), n)
    const qb = R.y.sub(v.roomBand).div(max(v.roomWidth, 1e-3))
    const room = mix(mix(0.35, 3.0, exp(qb.mul(qb).negate())), 0.08, smoothstep(0.05, 0.7, R.y.negate()))
    const wR = clamp(fresR.mul(v.reflect), 0, 1)
    const mirrored = mix(c.rgb, vec3(room).mul(c.a), wR)

    // Grazing incidence brightens a border — the tell of a raised edge of
    // glass, and the reason a droplet's rim reads before its body does.
    // Paint, not light: a white layer at its own coverage, so it is bounded
    // at paper-white and the knob stays linear all the way up.
    const wRim = clamp(pow(clamp(float(1).sub(n.z), 1e-4, 1), v.rimPow).mul(v.rim), 0, 1)
    const rimmed = mix(mirrored, vec3(c.a), wRim)

    return premultipliedOutput(vec4(rimmed, c.a).mul(surface.radiusMask(vUv)))
  })()

  // Browser probes read the live uniform values and the leaving capture here.
  material.userData.refractionValues = v
  material.userData.refractionLeaving = surface.map

  return material
}

// ── the ink field ───────────────────────────────────────────────────────


/** A field pass: the material, and the values the field hook writes into it. */
export interface FieldPass {
  readonly material: MeshBasicNodeMaterial
  readonly source: TextureNode
  /** An eighth of a field texel, in uv. */
  readonly step: Vec2
  /** 0 how dark the patch is, 1 how busy it is. */
  readonly detail: Float
}

// One box filter, run into a target a sixteenth of the page's size. Sixty-
// four bilinear taps span two field texels, so every source texel under the
// box contributes and the result carries no trace of the line pitch.
//
// A ring or a cross of taps cannot do this job however wide it is spread.
// Measured 2026-08-22: five taps at 16px spacing over 13px lines is point
// sampling a periodic signal, and the "smooth" gradient it returned jumped
// between neighbouring pixels — the arriving page came out as colour noise
// at every bend tried, worse than the sharp gradient it replaced.
export function createFieldPass(placeholder: THREE.Texture): FieldPass {
  const material = passMaterial()
  const source = texture(placeholder)
  const step = uniform(new THREE.Vector2(1, 1))
  const detail = uniform(0)

  const lum = (c: Node<'vec3'>) => dot(c, vec3(0.2126, 0.7152, 0.0722))

  material.outputNode = Fn(() => {
    const at = uv()
    const sum = float(0).toVar()
    const vs = float(0).toVar()
    const vss = float(0).toVar()
    Loop({ type: 'int', start: 0, end: 8 }, { type: 'int', start: 0, end: 8 }, ({ i, j }) => {
      const o = vec2(float(j), float(i)).sub(3.5).mul(2).mul(step)
      const c = sample(source, at.add(o))
      const l = lum(c.rgb).toVar()
      sum.addAssign(float(1).sub(l).mul(c.a))
      // Composited over white, which is what an eye integrates. The source
      // is premultiplied, so its colour is already scaled by alpha and the
      // paper is whatever alpha did not cover (decisions.md #5).
      const v = l.add(float(1).sub(c.a)).toVar()
      vs.addAssign(v)
      vss.addAssign(v.mul(v))
    })
    // Standard deviation across the 64 taps: how much the patch varies rather
    // than how dark it is. Doubled because the busiest a patch can be is half
    // black and half white, which deviates by 0.5.
    const mean = vs.div(64)
    const busy = clamp(sqrt(max(vss.div(64).sub(mean.mul(mean)), 0)).mul(2), 0, 1)
    return vec4(mix(sum.div(64), busy, detail), 0, 0, 1)
  })()

  return { material, source, step, detail }
}

/** A spread pass: the material, and the values the field hook writes into it. */
export interface SpreadPass {
  readonly material: MeshBasicNodeMaterial
  readonly source: TextureNode
  /** Half a texel of THIS pass, in uv. */
  readonly step: Vec2
  /** Subtracted before scaling; 0 after pass 0. */
  readonly floor: Float
  /** 1 / (ceil - floor); 1 after pass 0. */
  readonly scale: Float
  /** Height lost per texel travelled, 1 / passes. */
  readonly decay: Float
  /** 1 on pass 0 of the hollow chain, else 0. */
  readonly invert: Float
}

// One step of the aperture's spread — the ink field, normalised, grown
// outward by one texel and charged for the distance.
//
// A grassfire. Each tap pays `decay` times how far it reaches, and the pass
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
// Pass 0 does the normalising and the rest run idempotent, with floor 0 and
// scale 1 — one pair of uniform writes rather than a second program. The
// same switch runs the chain twice: once on the ink and once on its inverse,
// which is what gives a solid mark an inside. `invert` is pass 0's only,
// because after it the field is already whichever of the two it is.
//
// Twenty-five taps at half a texel, so the box is contiguous over the source
// rather than sampling it at intervals — the mistake refractionField.tsx's
// preamble records paying a day for.
export function createSpreadPass(placeholder: THREE.Texture): SpreadPass {
  const material = passMaterial()
  const source = texture(placeholder)
  const step = uniform(new THREE.Vector2(1, 1))
  const floor = uniform(0)
  const scale = uniform(1)
  const decay = uniform(0)
  const invert = uniform(0)

  material.outputNode = Fn(() => {
    const at = uv()
    const best = float(0).toVar()
    Loop({ type: 'int', start: 0, end: 5 }, { type: 'int', start: 0, end: 5 }, ({ i, j }) => {
      const tap = vec2(float(j), float(i)).sub(2).mul(0.5)
      const raw = sample(source, at.add(tap.mul(step).mul(2)).clamp(0, 1)).r
      const height = raw.sub(floor).mul(scale).clamp(0, 1).toVar()
      const v = mix(height, float(1).sub(height), invert)
      best.assign(max(best, v.sub(decay.mul(length(tap)))))
    })
    return vec4(best, 0, 0, 1)
  })()

  return { material, source, step, floor, scale, decay, invert }
}
