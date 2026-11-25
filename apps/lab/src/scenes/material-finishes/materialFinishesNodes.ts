// Finish material — a MeshPhysicalNodeMaterial body wearing a Surface
// capture, with the capture either lit as the body's albedo or composited
// over the lit body unlit, and a body normal that carries the card's
// rounded edge, the finish's surface relief and the card's tilt.
//
// The law: the capture is premultiplied in its sRGB encoding (decisions.md
// #5, #48), so it composites over the opaque body in that encoding, as the
// page does, and only then decodes. Over an opaque body that composite is
// the alpha divide's whole job: the result has alpha 1, and no decoded
// premultiplied sample is ever divided. Output goes through
// premultipliedOutput or encodedOutput, because SurfaceCanvas's pipeline
// re-encodes fragments and a bare output lands too dark where it is
// translucent (decisions.md #72).
//
// SurfaceCanvas draws without tone mapping, so the page's colors land
// exact. Lit bodies then clip: measured 2026-11-24 on m2 (Chrome for Testing
// 156, 1440×900 at 2x), satin polymer clipped over 53% of the form card from
// the room environment alone and 88% with the studio light at power 2.4,
// which flattens the finish to white. The lit result goes through Khronos
// PBR Neutral, which leaves colors under 0.76 as they are and rolls off the
// highlights above them. Unlit text is laid over the tone-mapped body
// untouched.
//
// Lit text is the albedo, so coat highlights, sheen and film land on the
// text too. Unlit text keeps its page color under any light
// (docs/materials-research.md §3). Lit text is printed ink, a dielectric:
// as the albedo of a metal body it became a dark mirror, and the dark
// "Add to bag" pill on anodized aluminum lost its label (2026-11-24
// review). Where the capture covers the body, metalness falls to 0 and
// the ink takes its own roughness and full dielectric reflection.
//
// The normal is shading only. The edge and relief bend no vertex, so the
// pointer still maps through the mesh UV (docs/materials-research.md §3);
// the tilt moves vertices through deformSurfaceGeometry, which keeps hit
// testing on the drawn pose. A match-dom mesh shares the camera's rotation,
// so a normal in the card's own frame (x right, y up, z toward the viewer)
// is already a view-space normal.
//
// Ownership: this module builds the node graph. MaterialFinishesSurface
// owns the raw capture view, the tilt, and the writes before each draw.

import * as THREE from 'three'
import { MeshPhysicalNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import {
  abs,
  clamp,
  Discard,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  materialMetalness,
  materialRoughness,
  materialSpecularIntensity,
  max,
  min,
  mix,
  neutralToneMapping,
  normalize,
  output,
  select,
  sign,
  sin,
  sqrt,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput, premultipliedOutput } from '@petepetrash/munari'
import type { Finish, SurfaceDetail, TextLighting } from './materialFinishesTuning'

// Below this coverage a fragment writes nothing visible; Surface.LitMaterial
// discards at the same value.
const DISCARD_ALPHA = 0.004
// Screen-print ink dries semi-matte. By eye, unmeasured.
const INK_ROUGHNESS = 0.5
// A quarter-round edge is vertical at the rim. Capping 1 − u² here holds
// the steepest slope at 1/√0.08, about 74°, so the rim pixel keeps a
// finite normal.
const RIM_SLOPE_FLOOR = 0.08

// SAFETY: three declares neutralToneMapping's layout as vec3 to vec3; its
// published types leave the result untyped.
const rollOff = (color: Node<'vec3'>) => neutralToneMapping(color, float(1)) as Node<'vec3'>

// ── relief ─────────────────────────────────────────────────────────────

const latticeHash = (cell: Node<'vec2'>) => fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453))

/** Value noise in −1..1 with its gradient per lattice cell: (value, ∂/∂x, ∂/∂y). */
function valueNoise(p: Node<'vec2'>): Node<'vec3'> {
  const cell = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const du = f.mul(float(1).sub(f)).mul(6)
  const a = latticeHash(cell)
  const b = latticeHash(cell.add(vec2(1, 0)))
  const c = latticeHash(cell.add(vec2(0, 1)))
  const d = latticeHash(cell.add(vec2(1, 1)))
  const k = a.sub(b).sub(c).add(d)
  const value = a.add(b.sub(a).mul(u.x)).add(c.sub(a).mul(u.y)).add(k.mul(u.x).mul(u.y))
  const dx = du.x.mul(b.sub(a).add(k.mul(u.y)))
  const dy = du.y.mul(c.sub(a).add(k.mul(u.x)))
  return vec3(value.mul(2).sub(1), dx.mul(2), dy.mul(2))
}

/**
 * The relief's slope (−∂h/∂x, −∂h/∂y) at content point `p` (CSS px, y
 * down). Each octave's slope is its cell gradient times `depth`, so a
 * feature's height grows with its size.
 */
function reliefSlope(detail: SurfaceDetail, p: Node<'vec2'>, scale: Node<'float'>, depth: Node<'float'>): Node<'vec2'> {
  switch (detail) {
    case 'orange-peel': {
      const coarse = valueNoise(p.div(scale))
      // A second octave on a rotated lattice breaks up the grid.
      const turned = vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8)))
      const fine = valueNoise(turned.div(scale.mul(0.43)).add(17.3))
      return coarse.yz.add(fine.yz.mul(0.6)).mul(depth)
    }
    case 'brushed': {
      // Grooves along x: long in x, narrow in y, so the slope is across them.
      const groove = valueNoise(vec2(p.x.div(scale.mul(180)), p.y.div(scale)))
      const hairline = valueNoise(vec2(p.x.div(scale.mul(50)).add(31.7), p.y.div(scale.mul(0.55))))
      return vec2(0, groove.z.add(hairline.z.mul(0.5)).mul(depth))
    }
    case 'pile': {
      // Patches where the pile lies a different way, and fiber grain.
      const patch = valueNoise(p.div(scale))
      const fiber = valueNoise(p.div(1.4).add(9.1))
      return patch.yz.add(fiber.yz.mul(0.25)).mul(depth)
    }
    case 'glaze':
      return valueNoise(p.div(scale)).yz.mul(depth)
    case 'none':
      return vec2(0, 0)
  }
}

/** Whether a finish's relief sits in its clear coat rather than its base. */
function reliefIsInCoat(detail: SurfaceDetail): boolean {
  return detail === 'orange-peel' || detail === 'glaze'
}

/**
 * The slope of a rounded edge `width` px wide, falling outward from a
 * rounded-rect card of half size `half` and corner radii `radii`
 * (tl, tr, br, bl). `p` is CSS px from the card's center, y down.
 */
function edgeSlope(p: Node<'vec2'>, half: Node<'vec2'>, radii: Node<'vec4'>, width: Node<'float'>): Node<'vec2'> {
  const left = p.x.lessThan(0)
  const top = p.y.lessThan(0)
  // An edge wider than its corner radius has contours that meet the
  // corner's diagonal in a crease, which read as a mitred bevel on velvet's
  // 64 px edge (2026-11-25 shots). Rounding the field at the edge's width
  // keeps every contour round.
  const r = max(select(left, select(top, radii.x, radii.w), select(top, radii.y, radii.z)), width)
  const q = abs(p).sub(half).add(r)
  const outside = max(q, vec2(0, 0))
  const outsideLength = length(outside)
  const distance = outsideLength.add(min(max(q.x, q.y), float(0))).sub(r)
  const inCorner = q.x.greaterThan(0).and(q.y.greaterThan(0))
  const awayFromCenter = select(inCorner, outside.div(max(outsideLength, float(1e-4))), select(q.x.greaterThan(q.y), vec2(1, 0), vec2(0, 1)))
  const outward = awayFromCenter.mul(sign(p))
  const towardRim = float(1).sub(clamp(distance.negate().div(max(width, float(1e-3))), float(0), float(1)))
  const slope = towardRim.div(sqrt(max(float(1).sub(towardRim.mul(towardRim)), float(RIM_SLOPE_FLOOR))))
  return outward.mul(select(width.greaterThan(0.5), slope, float(0)))
}

// ── material ───────────────────────────────────────────────────────────

/** The uniforms that shape a finish's normal, written before each draw. */
export interface FinishShapeUniforms {
  readonly edgeWidth: UniformNode<'float', number>
  readonly detailScale: UniformNode<'float', number>
  readonly detailDepth: UniformNode<'float', number>
  /** The card's tilt as a rotation in its own frame; identity when flat. */
  readonly tilt: UniformNode<'mat3', THREE.Matrix3>
}

export function createFinishShapeUniforms(): FinishShapeUniforms {
  return {
    edgeWidth: uniform(0),
    detailScale: uniform(1),
    detailDepth: uniform(0),
    tilt: uniform(new THREE.Matrix3()),
  }
}

export interface FinishMaterialInputs {
  /** A raw (NoColorSpace) view of the capture: encoded, premultiplied. */
  readonly capture: TextureNode
  /** Corner coverage from useSurfaceNodes().radiusMask(). */
  readonly cornerMask: Node<'float'>
  /** The source's CSS size and corner radii, from useSurfaceNodes(). */
  readonly size: Node<'vec2'>
  readonly radii: Node<'vec4'>
  /** Body color in linear light; THREE.Color decodes the hex on write. */
  readonly body: UniformNode<'color', THREE.Color>
  readonly shape: FinishShapeUniforms
}

export function createFinishMaterial(inputs: FinishMaterialInputs, text: TextLighting, detail: SurfaceDetail): MeshPhysicalNodeMaterial {
  const { capture, cornerMask, size, radii, body, shape } = inputs
  const material = new MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false, premultipliedAlpha: true })
  const texCoord = uv()
  // SAFETY: a texture sample is a vec4; three's types return a bare Node.
  const page = capture.sample(texCoord) as Node<'vec4'>
  const uncovered = float(1).sub(page.a)

  const content = vec2(texCoord.x.sub(0.5), float(0.5).sub(texCoord.y)).mul(size)
  const edge = edgeSlope(content, size.mul(0.5), radii, shape.edgeWidth)
  const relief = reliefSlope(detail, content, shape.detailScale, shape.detailDepth)
  const viewNormal = (slope: Node<'vec2'>) => {
    // Content y runs down; the card's frame runs up.
    const inCard = normalize(vec3(slope.x, slope.y.negate(), float(1)))
    // SAFETY: a mat3 times a vec3 is a vec3; three's types return a bare Node.
    return normalize(shape.tilt.mul(inCard) as Node<'vec3'>)
  }
  const withRelief = viewNormal(edge.add(relief))
  const edgeOnly = viewNormal(edge)
  const inCoat = reliefIsInCoat(detail)
  material.normalNode = inCoat ? edgeOnly : withRelief
  material.clearcoatNormalNode = inCoat ? withRelief : edgeOnly

  if (text === 'lit') {
    material.metalnessNode = materialMetalness.mul(uncovered)
    material.roughnessNode = mix(materialRoughness, float(INK_ROUGHNESS), page.a)
    material.specularIntensityNode = mix(materialSpecularIntensity, float(1), page.a)
    // SAFETY: three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const bodyEncoded = sRGBTransferOETF(body) as Node<'vec3'>
    // SAFETY: as above, vec3 to vec3.
    const albedo = sRGBTransferEOTF(page.rgb.add(bodyEncoded.mul(uncovered))) as Node<'vec3'>
    material.colorNode = vec4(albedo, 1)
    material.outputNode = Fn(() => {
      const covered = vec4(rollOff(output.rgb), output.a).mul(cornerMask)
      Discard(covered.a.lessThan(DISCARD_ALPHA))
      return premultipliedOutput(covered)
    })()
    return material
  }

  material.colorNode = vec4(body, 1)
  material.outputNode = Fn(() => {
    // The canvas stores 0..1, so what the roll-off leaves above 1 clips
    // before the composite rather than bleeding into the text's antialiased
    // edge.
    // SAFETY: as above, vec3 to vec3.
    const litBody = sRGBTransferOETF(rollOff(output.rgb).saturate()) as Node<'vec3'>
    const covered = vec4(page.rgb.add(litBody.mul(uncovered)), 1).mul(cornerMask)
    Discard(covered.a.lessThan(DISCARD_ALPHA))
    return encodedOutput(covered)
  })()
  return material
}

/** Write a finish's values. Crossing zero on a lobe recompiles; other writes are uniform updates. */
export function writeFinish(material: MeshPhysicalNodeMaterial, body: UniformNode<'color', THREE.Color>, shape: FinishShapeUniforms, finish: Finish): void {
  body.value.set(finish.color)
  material.roughness = finish.roughness
  material.metalness = finish.metalness
  material.ior = finish.ior
  material.specularIntensity = finish.specularIntensity
  material.clearcoat = finish.clearcoat
  material.clearcoatRoughness = finish.clearcoatRoughness
  material.sheen = finish.sheen
  material.sheenColor.set(finish.sheenColor)
  material.sheenRoughness = finish.sheenRoughness
  material.anisotropy = finish.anisotropy
  material.anisotropyRotation = finish.anisotropyRotation
  material.iridescence = finish.iridescence
  material.iridescenceIOR = finish.iridescenceIOR
  // Without a thickness map, three reads the range's upper bound as the film thickness.
  material.iridescenceThicknessRange[1] = finish.iridescenceThickness
  shape.edgeWidth.value = finish.edgeWidth
  shape.detailScale.value = Math.max(finish.detailScale, 0.25)
  shape.detailDepth.value = finish.detailDepth
}
