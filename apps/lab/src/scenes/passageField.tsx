import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { clampScale, createDomTextureSource, type DomTextureSource } from 'munari'
import { CROSS_DIP, CROSS_LIFT, FADE, HANDOVER, type FlightPart } from './passageParts'
import type { Endpoint, Panel } from './passageMeasure'

// The field: a whole card's worth of type, in one draw call.
//
// Every part of the card is an instance of the same unit quad. Its two boxes
// (source layout, destination layout) and its two texture windows are
// per-instance attributes, and the only thing that changes per frame is a
// single float — `uT`. So a hundred words rearranging themselves costs the
// same as one, and costs nothing on the CPU at all.
//
// That is not incidental to how it looks. Because every part reads the same
// progress, they move in formation: the card reads as one object being
// rearranged rather than as a hundred things that happen to be animating.
// And because the whole flight is a pure function of `uT`, a spring that
// turns around mid-air plays it backwards exactly, with no state to unwind.

/**
 * How densely an endpoint's capture is cut: one texel per device pixel of the
 * layout it was measured at. Nothing else goes into it.
 *
 * A shared-element flight has a supply problem the relayout version never had:
 * the source card is captured at 308 px and then shown at up to 940, and a
 * texture cannot invent the texels it was not given. So this used to take the
 * OTHER endpoint's width and cut the smaller of the two denser, buying texels
 * for the magnification ahead.
 *
 * The bug in that is not the arithmetic, it is the noun. **EVERY ENDPOINT IS A
 * DESTINATION.** The small card is where an open BEGINS and where a close comes
 * to REST, and a plate cut 2.5× denser than the box it is shown in is a 2.5×
 * minification there — over a mip level of blur, through a trilinear sampler,
 * on a frame the reader is looking straight at. Measured live: supply 1.000 at
 * the large endpoint against 2.526 at the small one, and the tell was that the
 * type snapped clear at the instant the mesh handed back to the DOM. A landing
 * is the only moment the same words are shown at the same size by both, one
 * after the other, so a defect at one endpoint shows up there and nowhere else.
 *
 * Mid-flight softness is real and is now somebody else's budget. The hand-over
 * retires each capture where it stops being the sharper of the two, so the
 * worst magnification either plate ever suffers is at the geometric mean of the
 * two widths — 1.75× here — and that is also, exactly, where the flight is
 * moving fastest and the shutter is smearing it 24 px (decisions #19). Spend
 * the sharpness where a reader can stop; spend the exposure where they cannot.
 *
 * (decisions #52's lesson arriving a third time: supply is a target, not a
 * maximum. Twice now the fix has been to stop asking for more than one.)
 *
 * `dpr` is not a shortcut for the density law — it IS the law here. Both
 * endpoints rest ON the plane, and `texelDemand` at z = 0 degenerates to
 * exactly the display's ratio, with no arithmetic left to blur it. What is
 * borrowed is the guard: `clampScale` is the same call `Surface` makes before
 * deciding whether to warn, on the LONG edge rather than the width alone (a
 * tall narrow endpoint used to walk straight past a width-only ceiling).
 */
export function captureScale(width: number, height: number, dpr: number): number {
  return Math.max(0.5, clampScale(dpr, width, height))
}

/**
 * How long the shutter is open for, IN SECONDS.
 *
 * A twenty-fourth of a second at a 180° shutter angle — the cinema standard,
 * and the exposure behind essentially every moving image anyone has an
 * intuition about.
 *
 * It is a time and not a shutter *angle*, which is the whole correction. An
 * angle is a fraction of a frame, and a frame is not a quantity this scene
 * controls: 180° is 1/48 s at cinema's 24 Hz and 1/240 s at the 120 Hz this
 * machine actually runs at, so the same build would render five times less blur
 * on the better display, and the effect would get weaker the faster the flight
 * was drawn. Measured live at 120 Hz before this changed: peak smear 4.4 px,
 * median 0.76 px, not one frame above 6 px — present in the drawing buffer,
 * absent to the eye, and I judged it acceptable off a 2× crop, which is exactly
 * how a 4 px streak passes for motion blur.
 *
 * Stated as a time, the span it produces is identical on every display, and it
 * is allowed to reach back further than the frame that reported it: at 120 Hz
 * this covers about two and a half frames of travel, which no single camera
 * could do. That is deliberate. The look being reproduced is a 24 Hz one, and
 * what is being simulated is a photograph of the flight, not a sample of it.
 */
export const EXPOSURE = 1 / 48

/**
 * The most of the flight a single exposure may cover.
 *
 * Velocity is frame-rate invariant, so a long frame is no longer a fast one and
 * this has stopped being load-bearing for dropped frames. It stays for the
 * degenerate frame time — a first frame, a restored tab, a clock that hands over
 * zero — where the division itself is the hazard rather than the result.
 */
const SPAN_CAP = 0.08

/** The narrowest frame time to believe, so a degenerate clock cannot divide. */
const MIN_DT = 1 / 480

/**
 * The signed stretch of flight-time one exposure covers: velocity × time.
 *
 * This is the ENTIRE per-frame cost of the motion blur on the CPU. Everything
 * else — which word blurs, how far, in what direction, and how the blur varies
 * across a single word that is also being stretched — falls out of the fact
 * that the flight is a pure function of `uT`, so the vertex shader can simply
 * ask the trajectory where it was a moment ago.
 *
 * It is signed because a close is an open played backwards (`departureTarget`),
 * and so is its blur; an unsigned span would trail a returning word forwards,
 * which reads as the word arriving before it has moved.
 */
export function shutterSpan(prev: number, now: number, dt: number, exposure: number): number {
  const travelled = clamp01(now) - clamp01(prev)
  const velocity = travelled / Math.max(dt, MIN_DT)
  const open = velocity * Math.max(0, exposure)
  return Math.max(-SPAN_CAP, Math.min(SPAN_CAP, open))
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** One cut of one endpoint, and how many times it has painted. */
export interface Cut {
  gen: number
  paints: number
}

/**
 * Which cut a slot shows, given what is on screen and what is being prepared.
 *
 * One rule, and it is the whole fix for the flash at the start of every open:
 * **a slot never vacates for a replacement that has no pixels yet.** A re-cut
 * is a brand new canvas, and by the time one happens the page copy has already
 * been told to hide — so a slot that goes dark while its replacement warms up
 * leaves a hole in a card the reader is looking at. Measured before this
 * existed: the whole field, 200 triangles, gone for two frames, on every open
 * and never on a close — because back then `captureScale` re-cut the smaller
 * endpoint the moment the larger one was measured.
 *
 * IT NO LONGER DOES. Each endpoint's density is now its own business (#20), so
 * nothing about the destination's arrival can change the source's cut, and the
 * flash this was written for cannot happen on that path. Kept, and kept tested,
 * because the rule is not about that one caller: a slot is handed a new cut
 * whenever the endpoints are re-measured — a resize is the live one — and the
 * correct thing to do with a blank replacement is never to show it.
 *
 * The same shape as decisions #14: reconcile by comparing what is actually
 * there, not by scheduling a swap and trusting it to arrive.
 */
export function publishedCut<T extends Cut>(live: T | null, next: T | null): T | null {
  if (!next) return null
  return next.paints > 0 ? next : live
}

interface Slot extends Cut {
  source: DomTextureSource
  texture: THREE.CanvasTexture
}

/**
 * A capture, as a texture the flight shader can sample.
 *
 * Four settings, and the fourth is the one that was missing. `premultiplyAlpha`
 * is the upload flag, and it is a SEPARATE claim from the material's
 * `premultipliedAlpha`, which is only the blend equation. A 2D canvas holds
 * premultiplied pixels; with this false, `texImage2D` politely un-premultiplies
 * on the way in, and the shader then hands straight-alpha colour to a
 * premultiplied blend — `ONE, ONE_MINUS_SRC_ALPHA` against a fragment whose rgb
 * was never scaled by its own alpha. Every partially covered texel is drawn at
 * up to twice its weight.
 *
 * Which is not a stripe or a flicker; it is the whole card looking subtly
 * wrong. Antialiased glyph edges are exactly the pixels this doubles, so the
 * mesh's text renders visibly HEAVIER than the same text on the page, and the
 * eye reads that as blur. Measured 2026-08-04, one row through the title:
 * mean level 138 from the GPU against 115 in the DOM and 109 from compositing
 * the same plate row on the CPU — 111 the moment this flag went true. Sibling
 * scenes (`Glass`, `glassSdf`) had it all along; this one was written without
 * it and nothing anywhere reports the mismatch.
 */
export function plateTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  // The measured boxes are top-down, the way layout reports them, so the
  // texture is read top-down too. Flipping here rather than subtracting in
  // three places in the shader.
  t.flipY = false
  t.premultiplyAlpha = true
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function retire(s: Slot) {
  s.texture.dispose()
  s.source.dispose()
}

/**
 * A capture, uploaded once — and re-cut without ever going dark.
 *
 * `createDomTextureSource` is the same primitive a Surface is built on, used
 * here for the one thing a Surface cannot do: hand over its texture without
 * also being a mesh. These captures are static by construction — the plate is
 * unparented, nothing animates in it, and its `paintCount` stops advancing
 * after the first paint or two — so this is an upload, not a feed.
 *
 * It used to be cut TWICE per open — `captureScale` needed the other endpoint's
 * width to choose a density, and the destination does not exist yet when the
 * source is first cut. It does not any more (#20): each endpoint is cut once, at
 * its own resting density, and the destination's arrival changes nothing about
 * the source. The overlap machinery below is what made that second cut
 * invisible, and it is still what makes any future one invisible.
 *
 * Superseded plates are held, not freed, until the flight unmounts. Disposing
 * one at the instant of promotion would pull a texture out from under a
 * material that is still pointing at it for the rest of that frame, and the
 * alternative — waiting N frames — is the frame-count race this project keeps
 * paying for. A flight is a second long and holds two plates.
 *
 * Mipmaps because a plate is routinely sampled far below its own size: at t = 0
 * the DESTINATION's plate is already being drawn, 940 px of texture across a
 * 308 px card, and a glyph minified threefold without them crawls. Neither plate
 * is minified at its own endpoint — that is what #20 bought — so this is the
 * flight's cost and not the landing's.
 */
export function useCapture(
  node: HTMLElement | null,
  width: number,
  height: number,
  scale: number,
): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const live = useRef<Slot | null>(null)
  const next = useRef<Slot | null>(null)
  const spent = useRef<Slot[]>([])
  const gen = useRef(0)

  useEffect(() => {
    if (!node || width <= 0 || height <= 0) return
    let made: DomTextureSource
    try {
      // A CLONE, per cut. `createDomTextureSource` adopts, and adoption MOVES
      // the node and refuses anything with a parent — so the second cut of an
      // endpoint was handing over a node the first cut already owned, and
      // being refused. The refusal was correct and the `catch` below ate it:
      // `captureScale`'s whole magnification branch had never once run in the
      // browser, and every source plate flew at its resting density stretched
      // to three times its size. Found by reading the live texture back
      // (385 px wide for a card cut at 308 — 1.25×, the pre-destination
      // answer) rather than from any symptom, 2026-08-04.
      const own = node.cloneNode(true) as HTMLElement
      made = createDomTextureSource(own, width, height, { label: 'passage-capture', scale })
    } catch (err) {
      // Loud, because the last thing this swallowed cost a rewrite to find.
      console.error('passage: capture refused', err)
      return
    }
    const t = plateTexture(made.canvas)
    // A cut that was still warming up when a third one arrived was never on
    // screen, so it can go straight into the pile.
    if (next.current) spent.current.push(next.current)
    next.current = { gen: gen.current++, paints: 0, source: made, texture: t }
    // NO cleanup here on purpose: this effect re-runs when the density changes
    // mid-flight, and tearing down the live plate is precisely the hole.
  }, [node, width, height, scale])

  useEffect(
    () => () => {
      for (const s of spent.current) retire(s)
      if (next.current) retire(next.current)
      if (live.current) retire(live.current)
      spent.current = []
      next.current = null
      live.current = null
    },
    [],
  )

  useFrame(() => {
    const pending = next.current
    const on = live.current
    if (pending) {
      const n = pending.source.paintCount()
      if (n !== pending.paints) {
        pending.paints = n
        pending.texture.needsUpdate = true
      }
      if (publishedCut(on, pending) !== pending) return
      if (on) spent.current.push(on)
      live.current = pending
      next.current = null
      setTex(pending.texture)
      return
    }
    // While a re-cut is in flight the live plate must NOT be refreshed:
    // `createDomTextureSource` MOVES the node it is given, so the old parking
    // canvas has nothing left to paint and re-uploading it would replace a
    // good plate with an empty one. Hence this runs only once nothing is
    // pending — the texels already on the GPU are what carry the card across.
    if (!on) return
    const n = on.source.paintCount()
    if (n !== on.paints) {
      on.paints = n
      on.texture.needsUpdate = true
    }
  })

  return tex
}

export const FIELD_VERT = /* glsl */ `
attribute vec4 aBoxA;
attribute vec4 aBoxB;
attribute vec4 aUvA;
attribute vec4 aUvB;
attribute vec4 aMeta;

uniform float uT;
uniform float uSpan;
uniform float uFade;
uniform float uHandover;
uniform float uCrossLift;
uniform float uCrossDip;
uniform vec2 uCardA;
uniform vec2 uCardB;

varying vec2 vLocal;
varying vec2 vSmear;
varying vec4 vRectA;
varying vec4 vRectB;
varying float vPresence;
varying float vHandover;

void main() {
  // The unit quad's uv, read as a coordinate inside this part's own box, in
  // the layout's orientation — x right, y DOWN from the box's top-left.
  vec2 lc = vec2(uv.x, 1.0 - uv.y);

  vec4 b = mix(aBoxA, aBoxB, uT);
  vec2 card = mix(uCardA, uCardB, uT);
  vec2 px = b.xy + b.zw * lc;
  // Into the card's centred, y-up world.
  vec2 p1 = vec2(px.x - card.x * 0.5, card.y * 0.5 - px.y);

  // THE SHUTTER. The flight is a pure function of uT, so "where was this exact
  // corner of this exact word when the shutter opened" is not a history to keep
  // — it is the same three lines evaluated at an earlier time. No velocity
  // buffer, no previous-frame matrix, no post pass, and the answer is per
  // VERTEX, so a word that is also stretching gets a smear that varies across
  // its own width.
  float t0 = clamp(uT - uSpan, 0.0, 1.0);
  vec4 b0 = mix(aBoxA, aBoxB, t0);
  vec2 card0 = mix(uCardA, uCardB, t0);
  vec2 px0 = b0.xy + b0.zw * lc;
  vec2 p0 = vec2(px0.x - card0.x * 0.5, card0.y * 0.5 - px0.y);
  vec2 d = p1 - p0;

  // Sweep the quad over the exposure: corners on the LEADING side of the travel
  // stay where they are, trailing corners pull back to where they started. For
  // a convex quad that is exactly the union of the two poses — the Minkowski
  // sum with the segment — so the smear has room to land instead of being
  // clipped at the box it came from.
  vec2 outward = vec2((lc.x - 0.5) * max(b.z, 1e-4), (0.5 - lc.y) * max(b.w, 1e-4));
  float lead = step(0.0, dot(outward, d));
  vec2 swept = p1 - d * (1.0 - lead);

  // Everything the fragment shader needs, in the box's OWN units: where this
  // fragment sits in the box as it is now, and how far the box moved under it
  // during the exposure. Sampling in local units is what lets a tap that falls
  // outside the box be dropped — the neighbouring glyph on the plate is not
  // this word's history, it is somebody else's present.
  vec2 dLocal = vec2(d.x, -d.y) / max(b.zw, vec2(1e-4));
  vLocal = lc - dLocal * (1.0 - lead);
  vSmear = dLocal;
  vRectA = aUvA;
  vRectB = aUvB;

  // A part that is CROSSING the card — a word changing line — leaves the
  // surface. Real z in the card's own frame, so the bank parallaxes it against
  // the paragraph it is passing over: it reads as above the text rather than
  // mixed into it. Zero at both endpoints, so the card is flat whenever it is
  // being compared with the DOM.
  float bc = clamp(uT, 0.0, 1.0);
  float bx = 4.0 * bc * (1.0 - bc);
  float bump = bx * bx * (3.0 - 2.0 * bx);
  float cross = aMeta.w * bump;
  vec3 pos = vec3(swept, uCrossLift * cross);

  float hasFrom = aMeta.x;
  float hasTo = aMeta.y;
  float matched = hasFrom * hasTo;

  // Swap between the two captures — briefly, and at the moment the quad is
  // equally badly served by both, measured in LOG size. Each capture is on
  // screen while it is the sharper one, and the two are never both visible
  // for long: the same word rasterized at two sizes does not register glyph
  // for glyph (measured: advances grow 2.315-2.37x under type that grows
  // 2.47x), and a long blend renders that disagreement as an embossed double.
  float g = aBoxB.w / max(aBoxA.w, 0.001);
  float lg = log(max(g, 0.001));
  float phase = abs(g - 1.0) < 0.002 ? uT : clamp(log(1.0 + (g - 1.0) * uT) / lg, 0.0, 1.0);
  float hx = clamp((phase - (0.5 - uHandover * 0.5)) / uHandover, 0.0, 1.0);
  float sharp = hx * hx * (3.0 - 2.0 * hx);
  vHandover = mix(hasTo, sharp, matched);

  // Unmatched parts fade over their own window; matched parts never fade at
  // all. That last clause is the one that decides whether this reads as
  // objects moving or as a dissolve.
  float a0 = aMeta.z;
  float a1 = min(1.0, a0 + uFade);
  float x = clamp((uT - a0) / max(a1 - a0, 1e-4), 0.0, 1.0);
  float s = x * x * (3.0 - 2.0 * x);
  // And it gives up some of its opacity for being up there, which is what
  // makes both it and the line it is flying over readable during the pass.
  vPresence = mix(mix(1.0 - s, s, hasTo), 1.0 - uCrossDip * cross, matched);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

export const FIELD_FRAG = /* glsl */ `
// Enough that the widest smear this can produce still steps by well under a
// texel per tap. Twelve was sized for a 4 px streak; a 22 px one at a magnified
// capture is forty-odd texels, and a sparse walk across that reads as a row of
// ghosts rather than a trail — the same picket the 360° test produced, arriving
// from the sampling side instead of the exposure side.
#define TAPS 24

uniform sampler2D uTexA;
uniform sampler2D uTexB;

varying vec2 vLocal;
varying vec2 vSmear;
varying vec4 vRectA;
varying vec4 vRectB;
varying float vPresence;
varying float vHandover;

/** One instant of the exposure, at local coordinate l inside the part's box. */
vec4 sampleAt(vec2 l) {
  // A tap outside the box contributes NOTHING, rather than being clamped to the
  // edge. The two rects are windows onto a whole card's plate, so the texels
  // just past a word's box are the next word along — clamping would smear a
  // neighbour into this one's trail, and the edge column into everything.
  vec2 m = step(vec2(0.0), l) * step(l, vec2(1.0));
  vec2 lq = clamp(l, 0.0, 1.0);
  vec4 a = texture2D(uTexA, vRectA.xy + vRectA.zw * lq);
  vec4 b = texture2D(uTexB, vRectB.xy + vRectB.zw * lq);
  // Premultiplied throughout (decisions #5), so a straight mix of two captures
  // is a correct composite and scaling is a correct fade — no
  // unpremultiply/repremultiply anywhere in the path, and multiplying by a
  // coverage mask is just less light.
  return mix(a, b, vHandover) * (m.x * m.y);
}

void main() {
  vec4 acc;
  if (dot(vSmear, vSmear) < 1e-10) {
    // Standing still. Not merely an optimisation — the endpoints of this flight
    // are compared against real DOM at the same pixels, so a resting part has
    // to be the single-tap image exactly, not an average of twelve copies of
    // it that agrees to within rounding.
    acc = sampleAt(vLocal);
  } else {
    // The exposure, integrated. Taps run FORWARD in local units from where the
    // fragment sits now, because the box moved forward under it: one box-width
    // of smear means the fragment was at vLocal + vSmear when the shutter
    // opened. Averaging over all TAPS rather than over the ones that landed
    // inside is deliberate — a fragment the word only covered for part of the
    // exposure really did receive less light, and that partial coverage is what
    // makes the leading and trailing edges fall off instead of ending on a cut.
    acc = vec4(0.0);
    for (int i = 0; i < TAPS; i++) {
      float f = (float(i) + 0.5) / float(TAPS);
      acc += sampleAt(vLocal + vSmear * f);
    }
    acc /= float(TAPS);
  }
  gl_FragColor = acc * vPresence;
  #include <colorspace_fragment>
}
`

export const PANEL_VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vP;
void main() {
  vP = position.xy * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uSize, 0.0, 1.0);
}
`

export const PANEL_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uRadius;
uniform float uBorder;
uniform vec3 uFill;
uniform vec3 uEdge;
varying vec2 vP;

float roundedBox(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - hs + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // Named hs, not half: half is a RESERVED WORD in GLSL ES, and a shader
  // using it fails to compile with a parse error while the mesh silently
  // never draws.
  vec2 hs = uSize * 0.5;
  float r = min(uRadius, min(hs.x, hs.y));
  float d = roundedBox(vP, hs, r);
  // One pixel of coverage either side, in whatever the current projection
  // makes a pixel — so the edge is exactly as sharp at 308 px wide as at 940,
  // which a stretched capture of the same border could never be.
  float aa = max(fwidth(d), 0.0001);
  float outer = 1.0 - smoothstep(-aa, aa, d);
  float inner = 1.0 - smoothstep(-aa, aa, d + uBorder);
  // Discard rather than write a transparent fragment: the depth this pass
  // leaves behind is what carves the shadow out of the card's silhouette, and
  // the rounded corners are exactly where CSS lets the shadow show through.
  if (outer < 0.004) discard;
  vec3 col = mix(uEdge, uFill, inner);
  gl_FragColor = vec4(col * outer, outer);
  #include <colorspace_fragment>
}
`

const UNIT = new THREE.PlaneGeometry(1, 1)

/**
 * A private unit quad, built fresh every time.
 *
 * The obvious version shares one `PlaneGeometry`'s position/uv/index across
 * every field geometry, and it is a trap: `BufferGeometry.dispose()` fires an
 * event that deletes the GL buffer for each of its attributes, and an
 * attribute shared with another geometry is deleted for that one too. So the
 * first plan rebuild — which happens on EVERY flight, the moment the
 * destination is measured — tore the buffers out from under the panel and the
 * next field alike. The symptom was a wall of `drawElementsInstanced: no
 * buffer is bound to enabled attribute` and a card that drew nothing, with no
 * exception anywhere.
 *
 * Four vertices per geometry is not a cost worth sharing to avoid.
 */
function unitQuad(): {
  index: THREE.BufferAttribute
  position: THREE.BufferAttribute
  uv: THREE.BufferAttribute
} {
  return {
    index: new THREE.BufferAttribute(new Uint16Array([0, 2, 1, 2, 3, 1]), 1),
    position: new THREE.BufferAttribute(
      new Float32Array([-0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0]),
      3,
    ),
    uv: new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
  }
}

/**
 * The instance buffers for one population of parts.
 *
 * Built once per flight and never touched again — the flight is a uniform,
 * not a buffer update. Rebuilt only when the plan itself changes, which is
 * when a different card is flown, not when this one turns around.
 */
function useFieldGeometry(parts: FlightPart[]): THREE.InstancedBufferGeometry | null {
  return useMemo(() => {
    if (!parts.length) return null
    const n = parts.length
    const geo = new THREE.InstancedBufferGeometry()
    const quad = unitQuad()
    geo.setIndex(quad.index)
    geo.setAttribute('position', quad.position)
    geo.setAttribute('uv', quad.uv)
    geo.instanceCount = n

    const boxA = new Float32Array(n * 4)
    const boxB = new Float32Array(n * 4)
    const uvA = new Float32Array(n * 4)
    const uvB = new Float32Array(n * 4)
    const meta = new Float32Array(n * 4)
    parts.forEach((p, i) => {
      boxA.set([p.from.x, p.from.y, p.from.w, p.from.h], i * 4)
      boxB.set([p.to.x, p.to.y, p.to.w, p.to.h], i * 4)
      uvA.set([p.uvFrom.x, p.uvFrom.y, p.uvFrom.w, p.uvFrom.h], i * 4)
      uvB.set([p.uvTo.x, p.uvTo.y, p.uvTo.w, p.uvTo.h], i * 4)
      meta.set([p.hasFrom, p.hasTo, p.delay, p.crossing], i * 4)
    })
    geo.setAttribute('aBoxA', new THREE.InstancedBufferAttribute(boxA, 4))
    geo.setAttribute('aBoxB', new THREE.InstancedBufferAttribute(boxB, 4))
    geo.setAttribute('aUvA', new THREE.InstancedBufferAttribute(uvA, 4))
    geo.setAttribute('aUvB', new THREE.InstancedBufferAttribute(uvB, 4))
    geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 4))
    // The parts are placed by the vertex shader in card-local px, so the
    // geometry's own bounds say nothing about where it ends up. Culling it on
    // them would blink the whole card out at the worst possible moment.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    return geo
  }, [parts])
}

function useFieldMaterial(
  texA: THREE.Texture | null,
  texB: THREE.Texture | null,
  cardA: [number, number],
  cardB: [number, number],
) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FIELD_VERT,
        fragmentShader: FIELD_FRAG,
        uniforms: {
          uT: { value: 0 },
          uSpan: { value: 0 },
          uFade: { value: FADE },
          uHandover: { value: HANDOVER },
          uCrossLift: { value: CROSS_LIFT },
          uCrossDip: { value: CROSS_DIP },
          uCardA: { value: new THREE.Vector2() },
          uCardB: { value: new THREE.Vector2() },
          uTexA: { value: null },
          uTexB: { value: null },
        },
        transparent: true,
        // THE FIELD IS A PAINTER'S-ORDER COMPOSITE, NOT A 3D SCENE.
        //
        // Every part sits on the card's plane at z = 0, and so does the panel
        // underneath them — which writes depth, because the shadow behind the
        // card is clipped by that depth (#58: blend order cannot express a
        // clip). Coplanar quads depth-TESTED against it are a coin flip per
        // fragment: `LessEqualDepth` passes on equality, but the panel's big
        // quad and a word's small one interpolate the same plane to values
        // that differ in the last bits, so some fragments lose. Measured, it
        // reads as a staircase of rectangular patches across the card — and
        // it survived every single-layer isolation, because a layer can only
        // fight a layer.
        //
        // The parts are inside the card by construction, so they have nothing
        // to be occluded BY. Turning the test off is the statement of that,
        // and renderOrder alone decides who is in front.
        depthTest: false,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  mat.uniforms.uTexA.value = texA
  mat.uniforms.uTexB.value = texB
  mat.uniforms.uCardA.value.set(cardA[0], cardA[1])
  mat.uniforms.uCardB.value.set(cardB[0], cardB[1])
  return mat
}

/**
 * The card's size at SIZE progress `t` — a straight lerp between two real
 * layouts, and nothing else.
 *
 * The staircase is gone at this line. The first design asked the layout engine
 * how tall the card wanted to be at every intermediate width and got a step
 * function back; this asks two real layouts and draws a line between their
 * answers. Both endpoints are exactly what the page will hand back, and
 * nothing in between is a shape the component has an opinion about — because
 * in between, the component is not being laid out at all.
 *
 * `t` is `sizeProgress`, the same number the parts interpolate their own boxes
 * on, so the type can never slide against the panel it is printed on.
 */
export function cardSizeAt(a: Endpoint, b: Endpoint, t: number): [number, number] {
  const c = Math.min(1, Math.max(0, t))
  return [a.width + (b.width - a.width) * c, a.height + (b.height - a.height) * c]
}

function PanelMesh({
  a,
  b,
  panel,
  progress,
}: {
  a: Endpoint
  b: Endpoint
  panel: Panel
  progress: React.MutableRefObject<number>
}) {
  const mat = useMemo(() => {
    const fill = new THREE.Color().setStyle(panel.fill, THREE.SRGBColorSpace)
    const edge = new THREE.Color().setStyle(panel.edge, THREE.SRGBColorSpace)
    return new THREE.ShaderMaterial({
      vertexShader: PANEL_VERT,
      fragmentShader: PANEL_FRAG,
      uniforms: {
        uSize: { value: new THREE.Vector2(a.width, a.height) },
        uRadius: { value: panel.radius },
        uBorder: { value: panel.border },
        uFill: { value: fill },
        uEdge: { value: edge },
      },
      transparent: true,
      premultipliedAlpha: true,
      // The one surface in the flight that DOES write depth — it is the
      // card's silhouette, and the shadow behind it is clipped by exactly
      // this.
      depthWrite: true,
    })
  }, [panel, a.width, a.height])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame(() => {
    const [w, h] = cardSizeAt(a, b, progress.current)
    mat.uniforms.uSize.value.set(w, h)
  })

  return <mesh geometry={UNIT} material={mat} renderOrder={0} frustumCulled={false} />
}

function PartMesh({
  parts,
  texA,
  texB,
  a,
  b,
  progress,
  renderOrder,
}: {
  parts: FlightPart[]
  texA: THREE.Texture | null
  texB: THREE.Texture | null
  a: Endpoint
  b: Endpoint
  progress: React.MutableRefObject<number>
  renderOrder: number
}) {
  const geo = useFieldGeometry(parts)
  const mat = useFieldMaterial(texA, texB, [a.width, a.height], [b.width, b.height])
  const was = useRef(progress.current)
  useFrame((_, dt) => {
    const t = Math.min(1, Math.max(0, progress.current))
    mat.uniforms.uT.value = t
    mat.uniforms.uSpan.value = shutterSpan(was.current, t, dt, EXPOSURE)
    was.current = t
  })
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo || !texA || !texB) return null
  return <mesh geometry={geo} material={mat} renderOrder={renderOrder} frustumCulled={false} />
}

/**
 * A card in flight, assembled from two measured layouts.
 *
 * Four things are drawn, back to front, and the split is the design:
 *
 *   - the PANEL, analytically — a rounded rectangle with a one-pixel border,
 *     exact at every size, never stretched from a capture
 *   - the painted BLOCKS, from the chrome captures — a stats strip stretches
 *     correctly because its cells divide it evenly at both ends
 *   - anything the caller keeps LIVE, as real DOM (the ticking counter)
 *   - the WORDS, from the ink captures, on top of all of it
 *
 * Three draw calls plus whatever `live` costs, for any card of any length.
 */
export function PassageField({
  a,
  b,
  plan,
  progress,
  live,
  onSourceReady,
  onFlightReady,
}: {
  a: Endpoint
  /**
   * Null until the destination exists to be measured, which is a real window
   * and not a loading state.
   *
   * The order is forced by the page: the arriving route is absolutely
   * positioned and invisible until it takes over, so its box cannot be
   * measured before the swap — and the swap cannot happen before something is
   * standing in for the card that is about to disappear. So there is a beat
   * where only the source is known, and in that beat this draws the source
   * card at rest, exactly. It is the identity flight: every part matched to
   * itself, `uT` at 0, one texture in both samplers.
   */
  b: Endpoint | null
  plan: FlightPart[]
  progress: React.MutableRefObject<number>
  live?: React.ReactNode
  /** The source card can be seen here — the page copy may hide now. */
  onSourceReady?: () => void
  /** Both ends have pixels — the card may start moving. */
  onFlightReady?: () => void
}) {
  const dpr = useThree((s) => s.viewport.dpr)
  // Each endpoint's density is its own business, so neither of these moves when
  // the other endpoint shows up several frames later.
  const scaleA = captureScale(a.width, a.height, dpr)
  const scaleB = captureScale(b?.width ?? 0, b?.height ?? 0, dpr)
  const inkA = useCapture(a.ink, a.width, a.height, scaleA)
  const chromeA = useCapture(a.chrome, a.width, a.height, scaleA)
  // Nulls until `b` arrives, so nothing ever adopts a node twice — and note
  // that `createDomTextureSource` MOVES the node it is given, so handing the
  // same endpoint in as both ends would tear the first source's plate out
  // from under it.
  const inkB = useCapture(b?.ink ?? null, b?.width ?? 0, b?.height ?? 0, scaleB)
  const chromeB = useCapture(b?.chrome ?? null, b?.width ?? 0, b?.height ?? 0, scaleB)

  const words = useMemo(() => plan.filter((p) => p.kind === 'word'), [plan])
  const blocks = useMemo(() => plan.filter((p) => p.kind === 'block'), [plan])

  // Two readiness signals, because the handoff and the flight are different
  // moments. The page copy may hide as soon as the SOURCE can be seen — the
  // same contract `Surface.onFirstUpload` offers, and for the same reason —
  // but nothing may move until the destination has pixels too, or the first
  // frames of the flight are a card cross-fading against a blank.
  const sourceReady = !!(inkA && chromeA)
  const flightReady = sourceReady && !!(inkB && chromeB)
  useEffect(() => {
    if (sourceReady) onSourceReady?.()
  }, [sourceReady, onSourceReady])
  useEffect(() => {
    if (flightReady) onFlightReady?.()
  }, [flightReady, onFlightReady])

  const end = b ?? a
  return (
    <>
      {/* Gated for the same reason, and it is the sharper case: the panel is
          opaque and it is drawn exactly over the page card it is standing in
          for, which is still visible at this point (the copy hides on
          `onSourceReady`, which is this). One frame of an empty dark slab over
          live DOM reads as the card blinking out at the instant it is
          grabbed. */}
      {sourceReady && <PanelMesh a={a} b={end} panel={end.panel} progress={progress} />}
      <PartMesh
        parts={blocks}
        texA={chromeA}
        texB={chromeB ?? chromeA}
        a={a}
        b={end}
        progress={progress}
        renderOrder={1}
      />
      {/* Nothing that belongs to the flying card may be on screen before the
          card is. The band's Surface warms up on its own schedule, and left
          ungated it draws first — measured, frame 1 of every open was the
          band alone on the page with no card behind it. #54, again: content
          first, then everything that rides on it. */}
      {sourceReady && live}
      <PartMesh
        parts={words}
        texA={inkA}
        texB={inkB ?? inkA}
        a={a}
        b={end}
        progress={progress}
        renderOrder={3}
      />
    </>
  )
}

