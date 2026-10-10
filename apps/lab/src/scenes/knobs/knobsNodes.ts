// The backlight corona's node material — light from the artwork wrapping
// the slab's edge (Knobs.tsx explains the design and its falloffs).
//
// The bake is a plain 2D canvas with no color space, so samples are the
// page's sRGB values and the corona is computed in them, as it was tuned.
// The pipeline encodes each fragment to sRGB, so the opaque result is
// decoded first and lands on its tuned value; the additive blend then sums
// in the sRGB canvas, where the corona was tuned (decisions.md #72).
//
// Ownership: this module owns the shading. Knobs.tsx owns the bake, the
// uniform writes, and the mesh.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import {
  Fn,
  clamp,
  dot,
  exp,
  float,
  fract,
  max,
  positionGeometry,
  sRGBTransferEOTF,
  sin,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

/** The corona's live values, written by the frame loop. */
export interface CoronaValues {
  readonly half: UniformNode<'vec2', THREE.Vector2>
  readonly radius: UniformNode<'float', number>
  readonly view: UniformNode<'vec2', THREE.Vector2>
  readonly center: UniformNode<'vec2', THREE.Vector2>
  readonly lit: UniformNode<'float', number>
  // Where the corona lives, in px of signed distance: a small outward
  // skirt (the edge's own brightness, not painted light — it must die
  // inside the quad), and an inward veil onto the dark face. Uniforms, so
  // the tweak panel can slide them live.
  readonly outReach: UniformNode<'float', number>
  readonly veilReach: UniformNode<'float', number>
  readonly coreTauOut: UniformNode<'float', number>
  readonly coreTauIn: UniformNode<'float', number>
  readonly coreGain: UniformNode<'float', number>
  readonly veilGain: UniformNode<'float', number>
  readonly toneK: UniformNode<'float', number>
  readonly spill: UniformNode<'float', number>
  // The emitter gate. See litGate in knobsLaw — this is its mirror.
  readonly litFloor: UniformNode<'float', number>
  readonly litKnee: UniformNode<'float', number>
}

export function createCoronaValues(radius: number): CoronaValues {
  return {
    half: uniform(new THREE.Vector2(1, 1)),
    radius: uniform(radius),
    view: uniform(new THREE.Vector2(1, 1)),
    center: uniform(new THREE.Vector2(0, 0)),
    lit: uniform(1),
    outReach: uniform(0),
    veilReach: uniform(0),
    coreTauOut: uniform(1),
    coreTauIn: uniform(1),
    coreGain: uniform(0),
    veilGain: uniform(0),
    toneK: uniform(1),
    spill: uniform(0),
    litFloor: uniform(0),
    litKnee: uniform(1),
  }
}

export function createCoronaMaterial(art: THREE.Texture, v: CoronaValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    // Additive for COLOR only. The scene's canvas is transparent over the
    // DOM artwork, and the page composites it by alpha — stock
    // AdditiveBlending also sums alpha, which turns the whole plane's
    // footprint into an opaque black rectangle over the art. Add the
    // light, leave the coverage untouched.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
  const at = varying(positionGeometry.xy)

  // Signed distance to the slab's rounded rect — the same corner the DOM
  // authors and the rim extrudes.
  const slab = (p: Node<'vec2'>): Node<'float'> => {
    const q = p.abs().sub(v.half.sub(vec2(v.radius)))
    return q.max(vec2(0)).length().add(q.x.max(q.y).min(0)).sub(v.radius)
  }
  // The picture at a WORLD point (scene px, origin mid-viewport, y up):
  // the bake fills the viewport, flipY'd on upload.
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const picture = (world: Node<'vec2'>): Node<'vec3'> => (texture(art, vec2(0.5).add(world.div(v.view))) as Node<'vec4'>).rgb

  material.outputNode = Fn(() => {
    const d = slab(at)
    const e = vec2(2, 0)
    const n = vec2(slab(at.add(e.xy)).sub(slab(at.sub(e.xy))), slab(at.add(e.yx)).sub(slab(at.sub(e.yx)))).normalize()
    // The nearest point of the silhouette, then the VISIBLE art just
    // beyond it: the light actually wrapping this edge. The hidden art is
    // blocked by the slab and contributes nothing.
    const edge = at.sub(n.mul(d))
    const spill = picture(v.center.add(edge).add(n.mul(v.spill.mul(7))))
      .add(picture(v.center.add(edge).add(n.mul(v.spill.mul(20)))))
      .add(picture(v.center.add(edge).add(n.mul(v.spill.mul(40)))))
      .mul(1 / 3)
    const luminance = dot(spill, vec3(0.2126, 0.7152, 0.0722))

    // The hot line on the boundary. Outward it is compact-support and C1
    // at outReach ((1-t)^2 — an exponential alone never reaches zero, and
    // its leftover becomes an edge); inward it relaxes over coreTauIn px
    // onto the face.
    const t0 = clamp(d.div(v.outReach), 0, 1)
    const outward = float(1).sub(t0)
    const core = d
      .greaterThanEqual(0)
      .select(exp(d.negate().div(v.coreTauOut)).mul(outward).mul(outward), exp(d.div(v.coreTauIn)))
    // The bloom veil, over the dark face only: (1-t)^2 dies at veilReach
    // with zero slope — no endpoint to see. Scaled by luminance: bloom
    // belongs to bright surround, dim surround has none.
    const tv = float(1).sub(clamp(d.negate().div(v.veilReach), 0, 1))
    const veil = d.lessThan(0).select(tv.mul(tv).mul(luminance), float(0))

    // Is this edge standing in front of an emitter, or in front of the
    // backdrop? The backdrop is dark but SATURATED, so the spill comes
    // back a perfectly good teal either way and colour alone cannot tell.
    // The BRIGHTEST CHANNEL can, and luminance cannot: Rec.709 weights
    // blue at 0.07, so a saturated blue blade scores under a teal backdrop
    // and the two bands overlap. On max channel the backdrop tops out at
    // 0.155 and the dimmest drawn layer starts at 0.773. See litGate in
    // knobsLaw, which pins this and carries the measurements.
    const emitter = max(spill.r, max(spill.g, spill.b))
    // Written out rather than smoothstep() because the tweak panel can
    // drag the knee under the floor, which smoothstep leaves undefined.
    const lt = clamp(emitter.sub(v.litFloor).div(v.litKnee.sub(v.litFloor).max(1e-6)), 0, 1)
    const lit = lt.mul(lt).mul(float(3).sub(lt.mul(2)))

    const light = spill.mul(v.coreGain.mul(core).add(v.veilGain.mul(veil))).mul(v.lit).mul(lit)
    // Tone-map instead of clip: clipping is what rotated dusty pink into a
    // neon tube.
    const toned = vec3(1).sub(exp(light.negate().mul(v.toneK)))
    // Dither before quantization: a smooth falloff on a dark field bands
    // without it, and banding is what reads as a cheap gradient.
    const hash = fract(sin(dot(at, vec2(127.1, 311.7))).mul(43758.5453))
    const color = toned.add(hash.sub(0.5).div(255)).max(vec3(0))
    // All the light lives in a band hugging the silhouette.
    const inBand = d.lessThanEqual(v.outReach).and(d.greaterThanEqual(v.veilReach.add(4).negate()))
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    return inBand.select(vec4(sRGBTransferEOTF(color) as Node<'vec3'>, 1), vec4(0))
  })()
  return material
}
