// The selection bead's node material — one strip of glass per selected line.
//
// The material samples a DOM capture, so it obeys three rules and states
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
//   THE CANVAS VALUE IS encode(c.rgb) · fade. The Surface texture is
//   SRGBColorSpace, so samples are LINEAR and the bead is computed in
//   linear premultiplied colour; the WebGL version encoded that
//   premultiplied colour directly, and every knob was tuned against the
//   result. The interior builds that encoded value and returns it through
//   `encodedOutput`.
//
//   THE GLEAM IS ITS OWN DRAW. Outside the glass the WebGL bead wrote the
//   shadow's coverage as alpha and the caustic's warm residue as colour,
//   and the residue was brightest where the caustic carved the coverage to
//   0. Three's conversion drops the colour of a fragment with alpha 0
//   (decisions.md #72), so the bead now draws only the shadow, and a second
//   mesh adds the residue with alpha 1 and blend factors that leave the
//   canvas alpha alone. On the canvas that is dst·(1 − a) + encode(gleam),
//   which is what the single WebGL draw blended.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformArrayNode, type UniformNode } from 'three/webgpu'
import {
  Break,
  Discard,
  Fn,
  If,
  Loop,
  abs,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  log,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  refract,
  sRGBTransferOETF,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'

/** Light direction the bench's other scenes share, so one hand lit them all. */
export const LIGHT: readonly [number, number, number] = [-0.34, 0.52, 0.78]

/** The bead's live values, written by the frame loop. */
export interface BubbleValues {
  readonly size: UniformNode<'vec2', THREE.Vector2>
  readonly t: UniformNode<'float', number>
  /** (left, top, width, height) per strip, content px. */
  readonly rects: UniformArrayNode<'vec4'>
  readonly rectCount: UniformNode<'int', number>
  readonly corner: UniformNode<'float', number>
  readonly edge: UniformNode<'float', number>
  readonly height: UniformNode<'float', number>
  readonly weld: UniformNode<'float', number>
  readonly caustic: UniformNode<'float', number>
  readonly magnify: UniformNode<'float', number>
  readonly refract: UniformNode<'float', number>
  readonly ior: UniformNode<'float', number>
  readonly disperse: UniformNode<'float', number>
  readonly frost: UniformNode<'float', number>
  readonly shadowOffset: UniformNode<'vec2', THREE.Vector2>
  readonly shadowSoft: UniformNode<'float', number>
  readonly shadowAlpha: UniformNode<'float', number>
  readonly lightDir: UniformNode<'vec3', THREE.Vector3>
  readonly lightPos: UniformNode<'vec3', THREE.Vector3>
  readonly follow: UniformNode<'float', number>
  readonly tint: UniformNode<'color', THREE.Color>
  readonly tintGain: UniformNode<'float', number>
  readonly reflect: UniformNode<'float', number>
  readonly depth: UniformNode<'float', number>
  readonly spec: UniformNode<'float', number>
  readonly specPow: UniformNode<'float', number>
  readonly specOp: UniformNode<'float', number>
  readonly sheen: UniformNode<'float', number>
  readonly sheenPow: UniformNode<'float', number>
  readonly sheenOp: UniformNode<'float', number>
  readonly rim: UniformNode<'float', number>
  readonly rimPow: UniformNode<'float', number>
}

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

// ── the bubble field ────────────────────────────────────────────────────

interface SoftBox {
  readonly d: Node<'float'>
  readonly grad: Node<'vec2'>
}

interface Light {
  /** Unit vector toward the light. */
  readonly L: Node<'vec3'>
  /** Its in-page direction, normalized. */
  readonly Lc: Node<'vec2'>
}

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
// ~0.414r, so k = 0.42r keeps corner's px meaning. Both axis planes
// breathe at the crest, so the interior floor is b.y - k*ln2, not b.y
// — bubbleNear reports THAT as halfH, keeping t = 1 exactly there.
//
// The softmax weights are the field's own partial derivatives: the TRUE
// gradient, magnitude included. It shrinks to zero at the crest, and
// must not be normalized back — unit-scaling a vanishing gradient
// re-amplifies the crossing into a full direction flip (the mid-strip
// slice this file already paid for once).
function sdSoftBox(p: Node<'vec2'>, b: Node<'vec2'>, r: Node<'float'>): SoftBox {
  const k = max(r.mul(0.42), 1e-3).toVar()
  const q = vec4(p, p.negate()).sub(vec4(b, b)).toVar()
  const m = max(max(q.x, q.y), max(q.z, q.w)).toVar()
  const w = exp(q.sub(vec4(m)).div(k)).toVar()
  const sum = w.x.add(w.y).add(w.z).add(w.w)
  return {
    d: m.add(k.mul(log(sum))),
    grad: vec2(w.x.sub(w.z), w.y.sub(w.w)).div(sum),
  }
}

interface BubbleNear {
  readonly d: Node<'float'>
  readonly grad: Node<'vec2'>
  readonly center: Node<'vec2'>
  readonly halfH: Node<'float'>
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
//
// Builds a loop, so it runs inside an Fn.
function bubbleNear(v: BubbleValues, p: Node<'vec2'>): BubbleNear {
  const center = vec2(0).toVar()
  const halfH = float(1).toVar()
  // 0.36 ≈ 1/(4·ln2): calibrates k so weld deepens a seam midpoint by
  // the same weld/4 px the old polynomial blend did.
  const k = max(v.weld.mul(0.36), 1e-3).toVar()
  const m = float(1e5).toVar()
  const s = float(0).toVar()
  const g = vec2(0).toVar()
  Loop(v.rects.array.length, ({ i }) => {
    If(i.greaterThanEqual(v.rectCount), () => {
      Break()
    })
    const r = v.rects.element(i).toVar()
    const bi = r.zw.mul(0.5).toVar()
    const rr = min(v.corner, min(bi.x, bi.y)).toVar()
    const ci = r.xy.add(bi).toVar()
    const box = sdSoftBox(p.sub(ci), bi, rr)
    const di = box.d.toVar()
    const gi = box.grad.toVar()
    // s and g are kept relative to the running min m, so every exponent
    // is <= 0 and exp can only underflow to zero, never overflow.
    If(di.lessThan(m), () => {
      const re = exp(di.sub(m).div(k)).toVar()
      s.assign(s.mul(re).add(1))
      g.assign(g.mul(re).add(gi))
      m.assign(di)
      center.assign(ci)
      // The field's actual floor, not the rect's: see sdSoftBox.
      halfH.assign(bi.y.sub(max(rr.mul(0.42), 1e-3).mul(0.6931)))
    }).Else(() => {
      const w = exp(di.sub(m).negate().div(k)).toVar()
      s.addAssign(w)
      g.addAssign(w.mul(gi))
    })
  })
  return {
    d: m.sub(k.mul(log(max(s, 1)))),
    grad: g.div(max(s, 1)),
    center,
    halfH,
  }
}

// A drop, not a bevel: h = H·sqrt(1 - exp(d/edge)). At the rim this is
// the same square-root contact a spherical cap has — vertical tangent,
// the bright thin border — and inward the curvature decays
// exponentially without ever reaching flat, so there is no ring where
// dome meets plateau. The bevel-extrude it replaces (arc rim, capped
// top, normalized per strip) drew that ring as a squarish inner bezel
// once the specular could find it (2026-08-21). Depth is the only
// input: a thin strip never gets deep enough to reach full height, so a
// single line is a shallow film and a paragraph a full drop with no
// separate area law. edge is the rolloff scale — smaller is a steeper
// rim and a fuller, flatter middle.
function bubbleHeight(v: BubbleValues, d: Node<'float'>): Node<'float'> {
  const u = exp(min(d, 0).div(max(v.edge, 1e-3)))
  return v.height.mul(sqrt(max(float(1).sub(u), 1e-4)))
}

// Light direction in content coordinates (y runs down): the fixed world
// bearing flipped once, blended toward the point light riding the cursor
// lightPos.z px above the page.
function lightAt(v: BubbleValues, p: Node<'vec2'>): Light {
  const Lfix = normalize(vec3(v.lightDir.x, v.lightDir.y.negate(), v.lightDir.z))
  const Lpt = normalize(vec3(v.lightPos.xy.sub(p), v.lightPos.z))
  const L = normalize(mix(Lfix, Lpt, v.follow)).toVar()
  const Lc = normalize(L.xy.add(vec2(1e-5))).toVar()
  return { L, Lc }
}

/** Outside the glass: the shadow's coverage, and the warm light added over it. */
interface Exterior {
  readonly a: Node<'float'>
  readonly gleam: Node<'float'>
}

// Builds loops, so it runs inside an Fn.
function exteriorShade(v: BubbleValues, p: Node<'vec2'>, d: Node<'float'>, grad: Node<'vec2'>): Exterior {
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
  //   The residue is squared before the sRGB encode: the encode
  //   lifts small linear values ~5x, which is what made the additive
  //   version blow out at the lowest knob settings on light paper.
  //
  // Contact and shade compose as independent occluders — 1-(1-a)(1-b),
  // not a max. The max left a visible crease where the two crossed,
  // because the winner switches term mid-gradient.
  const { Lc } = lightAt(v, p)
  const down = clamp(float(0.5).sub(dot(grad, Lc).mul(0.5)), 0, 1).toVar()

  const sd = bubbleNear(v, p.sub(v.shadowOffset)).d.toVar()
  const shade = float(1).sub(smoothstep(v.shadowSoft.negate(), v.shadowSoft, sd))
  const inner = smoothstep(0, v.shadowSoft.mul(2.5), sd.negate())
  const contact = exp(d.negate().div(max(v.shadowSoft.mul(0.35), 0.5))).mul(
    float(0.12).add(down.mul(down).mul(0.88)),
  )
  const occ = float(1).sub(float(1).sub(contact.mul(0.7)).mul(float(1).sub(shade.mul(0.9))))
  const shadow = occ.mul(float(1).sub(v.caustic.mul(inner).mul(0.6)))
  const q = sd.add(v.shadowSoft.mul(1.2)).div(max(v.shadowSoft, 1))
  const band = exp(q.mul(q).negate()).mul(down).mul(down).toVar()
  const carve = clamp(float(1).sub(v.caustic.mul(band).mul(1.5)), 0, 1)
  const a = v.shadowAlpha.mul(v.t).mul(shadow).mul(carve)
  const residue = v.caustic.mul(band).mul(0.25)
  const gleam = residue.mul(residue).mul(v.t)
  return { a, gleam }
}

// ── the materials ───────────────────────────────────────────────────────

// Content px of the bead's own uv, y running down.
function contentPoint(v: BubbleValues): Node<'vec2'> {
  const at = uv()
  return vec2(at.x.mul(v.size.x), float(1).sub(at.y).mul(v.size.y))
}

// The mesh stays flat; the bump exists only in the fragment's optics.
// 2026-08-21: displacing vertices by bubbleHeight made the screen→content
// mapping piecewise-projective — kinked at every quad seam — so the
// silhouette and its fwidth feather stepped visibly at any tessellation
// (~2px stairs even at 3px quads under the perspective camera). Flat also
// keeps the pointer's flat-pose hit test honest (decisions.md #35).
export function createBubbleMaterial(map: TextureNode, v: BubbleValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    toneMapped: false,
  })

  const toUv = (p: Node<'vec2'>): Node<'vec2'> =>
    clamp(vec2(p.x.div(v.size.x), float(1).sub(p.y.div(v.size.y))), vec2(0), vec2(1))

  material.outputNode = Fn(() => {
    const p = contentPoint(v).toVar()
    const near = bubbleNear(v, p)
    const d = near.d.toVar()
    const grad = near.grad.toVar()
    const center = near.center
    const halfH = max(near.halfH, 1).toVar()
    const result = vec4(0).toVar()

    If(d.greaterThan(0), () => {
      result.assign(vec4(vec3(0), exteriorShade(v, p, d, grad).a))
    }).Else(() => {
      const h = bubbleHeight(v, d)
      const fill = h.div(max(v.height, 1e-4)).toVar()

      // The normal, analytically: the SDF's gradient (true magnitude) times
      // the profile's derivative dh/dd = -H·u / (2e·sqrt(1-u)) — exact at
      // the rim, where finite differences blur the vertical tangent. The
      // root is floored so the tangent is a large finite slope rather than
      // a divide-by-zero normal.
      const eEff = max(v.edge, 1e-3)
      const uu = exp(min(d, 0).div(eEff)).toVar()
      const root = max(sqrt(max(float(1).sub(uu), 0)), 0.01)
      const dhdd = v.height.negate().mul(uu).div(eEff.mul(2).mul(root))
      const n = normalize(vec3(grad.mul(dhdd.negate()), 1)).toVar()

      // The top is a lens: it pulls the page in toward THIS strip's centre.
      // The rim is Snell: the eye ray refracts through the rim normal at a
      // real index. The middle is never exactly flat now, but its slope
      // decays exponentially — the residual bend mid-drop is sub-pixel, so
      // the words stay the page's own to the eye — and the bend grows
      // toward the border with the profile real glass has, words
      // compressing into the rim.
      const lensed = mix(p, center, v.magnify.mul(fill).mul(v.t)).toVar()
      const bend = refract(vec3(0, 0, -1), n, float(1).div(max(v.ior, 1)))
        .xy.mul(v.refract)
        .mul(v.t)
        .toVar()

      // One loop does dispersion AND frost (the glass lab's move): each of
      // twelve taps carries a wavelength — red bends least, blue most — and
      // a golden-angle disk offset that grows with frost, so spectral
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
      const ign = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)).toVar()
      const acc = vec3(0).toVar()
      const wsum = vec3(1e-4).toVar()
      const accA = float(0).toVar()
      Loop(12, ({ i }) => {
        const fi = float(i).add(ign).div(12).toVar()
        const sw = vec3(
          // smoothstep(0.75, 0.0, fi), written with ordered edges: WGSL and
          // Metal leave smoothstep undefined when the low edge is the higher.
          float(1).sub(smoothstep(0, 0.75, fi)),
          float(1).sub(abs(fi.sub(0.5)).mul(2)),
          smoothstep(0.25, 1, fi),
        ).toVar()
        const ang = float(i).add(0.5).mul(2.39996).add(ign.mul(6.2832))
        const scatter = vec2(cos(ang), sin(ang)).mul(sqrt(fi)).mul(v.frost).mul(v.t)
        const tap = lensed.add(bend.mul(mix(float(1).sub(v.disperse), float(1).add(v.disperse), fi))).add(scatter)
        // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
        const s = (map.sample(toUv(tap)) as Node<'vec4'>).toVar()
        acc.addAssign(s.rgb.mul(sw))
        wsum.addAssign(sw)
        accA.addAssign(s.a)
      })
      const rgb = acc.div(wsum).toVar()
      const alpha = accA.div(12).toVar()

      // A body of glass is lit from above: brighter along a strip's top
      // edge, shaded along its bottom. Measured against the strip's own
      // centre, which is why this term does not move when a line is added.
      const up = clamp(center.y.sub(p.y).div(halfH), -1, 1)
      rgb.mulAssign(mix(1, float(1).add(v.depth.mul(up)), v.t.mul(fill)))

      // Tint by Beer–Lambert absorption, per channel: transmission falls
      // exponentially with path length, so the colour deepens with
      // thickness and the hue shifts as it deepens — a flat mix does
      // neither. The coefficient is the tint's complement: what the glass
      // is not coloured, it absorbs. Ink stays dark; only light that
      // passes is filtered.
      rgb.mulAssign(exp(v.tint.sub(1).mul(v.tintGain.mul(2).mul(fill).mul(v.t))))

      // The lighting is computed RELATIVE TO FLAT (the ripple lesson): the
      // flat top's own response is subtracted from the specular and the
      // sheen, so the interior of a strip adds no constant wash over the
      // words. The light lives where
      // the normal actually tips, brightening the rim the light faces and
      // shading the rim it leaves. The rim glow is Fresnel — grazing
      // incidence is what actually brightens a droplet's border — not a
      // profile ramp.
      //
      // The normal n lives in content coordinates (y runs down); lightDir
      // is the shared world vector (y runs up). One flip here — without it
      // every azimuth is vertically mirrored and a light placed above the
      // page lights the glass from below. follow blends toward a point
      // light riding the cursor, per-pixel, so highlights sweep across the
      // body as the pointer moves.
      const { L, Lc } = lightAt(v, p)
      const lambert = max(dot(n, L), 1e-4)
      const flatL = max(L.z, 1e-4)
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
      const Hv = normalize(L.add(vec3(0, 0, 1)))
      const specN = v.specPow.add(2).div(6.2832)
      const sheenN = v.sheenPow.add(2).div(6.2832)
      const specLobe = pow(max(dot(n, Hv), 1e-4), v.specPow).mul(specN)
      // The sheen keeps the flat null: at its low power the flat response is
      // a constant wash over the words (the ripple lesson), and its cut at
      // the crest is a soft band, not a razor.
      const sheenLobe = max(pow(lambert, v.sheenPow).sub(pow(flatL, v.sheenPow)), 0).mul(sheenN)
      const rimGlow = pow(clamp(float(1).sub(n.z), 1e-4, 1), v.rimPow)

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
      // shadowAlpha rather than a knob of its own: one light budget with
      // the shadow, which is the only reason this coupling means anything.
      //
      // The CAST shadow deliberately does not continue inward — that is
      // light blocked from paper the bead is not covering. So a step the
      // size of the shade term's rim value survives at the silhouette. It
      // sits under the specular and the Fresnel rim glow, which is what
      // keeps it from reading as an edge.
      const downIn = clamp(float(0.5).sub(dot(grad, Lc).mul(0.5)), 0, 1).toVar()
      const thin = float(1).sub(fill)
      const foot = thin.mul(thin).mul(float(0.12).add(downIn.mul(downIn).mul(0.88)))
      rgb.mulAssign(float(1).sub(v.shadowAlpha.mul(0.7).mul(foot).mul(v.t)))

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
      const F0 = 0.05
      const fres = float(F0).add(pow(clamp(float(1).sub(n.z), 1e-4, 1), 5).mul(1 - F0))
      const fresR = fres.sub(F0).div(1 - F0)
      const R = reflect(vec3(0, 0, -1), n).toVar()
      const qb = R.y.negate().sub(0.5).div(0.3)
      const wband = exp(qb.mul(qb).negate())
      const room = mix(mix(0.35, 3, wband), 0.08, smoothstep(0.05, 0.7, R.y))
      const wR = fresR.mul(v.reflect).mul(v.t).toVar()
      rgb.assign(rgb.mul(float(1).sub(wR)).add(vec3(room).mul(wR)))
      alpha.assign(alpha.mul(float(1).sub(wR)).add(wR))

      // The internal caustic: light entering the up-light rim concentrates
      // along the opposite interior wall — the glowing lower lip a real
      // droplet shows. Lives at mid-fill, down-light side only.
      const ql = fill.sub(0.35).div(0.25)
      const lip = exp(ql.mul(ql).negate()).mul(downIn).mul(downIn)

      rgb.addAssign(rimGlow.mul(v.rim).add(v.caustic.mul(lip).mul(0.12)).mul(v.t).mul(alpha))

      // The spec and sheen are PAINT, not added light. Additive spec ran
      // ~1.9 at the lobe core over 0.85 paper — deep in clip, so the gain
      // slider had a dead zone the size of the core, and an opacity knob
      // crossfading additive→paint DIMMED as it rose (2026-08-21). As a
      // premultiplied white layer (the reflection's pattern) the glint is
      // bounded at paper-white, shows over blank paper and ink alike, and
      // hides what it covers. Gain shapes the lobe's footprint — how much
      // of it saturates; opacity is the layer's alpha.
      const wH = min(
        clamp(specLobe.mul(v.spec), 0, 1).mul(v.specOp).add(clamp(sheenLobe.mul(v.sheen), 0, 1).mul(v.sheenOp)),
        1,
      )
        .mul(v.t)
        .toVar()
      rgb.assign(rgb.mul(float(1).sub(wH)).add(vec3(wH)))
      alpha.assign(alpha.mul(float(1).sub(wH)).add(wH))

      // The strip rides the ease — but the fade multiplies AFTER the sRGB
      // encode, never before. The encode is nonlinear: for the paper texel,
      // encode(0.45 · 0.85) = 0.65 where the correct contribution is
      // 0.45 · encode(0.85) = 0.42, and the blender still adds the page at
      // (1 − 0.45) underneath — 1.16, clipped. Measured 2026-08-21: every
      // mid-fade frame drew the bead as a flat white pill over the words
      // (255 pure at t 0.07–0.14 against 237 paper), at any knob setting,
      // with the geometry flattened, with every effect term zeroed — the
      // white was the compositing tail itself. Fading the encoded output
      // scales the premultiplied pair consistently, so a bead over
      // unchanged paper fades without ever being visible.
      const aa = d.fwidth().add(1e-4)
      const fade = float(1).sub(smoothstep(aa.negate(), aa, d)).mul(min(v.t.mul(3), 1))
      // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
      // published types leave the result untyped.
      const encoded = sRGBTransferOETF(rgb) as Node<'vec3'>
      result.assign(encodedOutput(vec4(encoded, alpha).mul(fade)))
    })
    return result
  })()
  return material
}

/**
 * The caustic's warm residue outside the glass, drawn after the bead as added
 * light. It adds to the canvas colour and leaves its alpha alone, as Knobs'
 * corona does.
 */
export function createGleamMaterial(v: BubbleValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
  material.outputNode = Fn(() => {
    const p = contentPoint(v).toVar()
    const near = bubbleNear(v, p)
    const d = near.d.toVar()
    Discard(d.lessThanEqual(0))
    // Alpha 1, so Three's conversion keeps the colour; the blend ignores it.
    return vec4(vec3(1, 0.97, 0.88).mul(exteriorShade(v, p, d, near.grad.toVar()).gleam), 1)
  })()
  return material
}
