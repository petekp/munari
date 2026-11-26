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
  dFdx,
  dFdy,
  Discard,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  materialClearcoatRoughness,
  materialMetalness,
  materialRoughness,
  materialSheen,
  materialSheenRoughness,
  materialSpecularIntensity,
  max,
  min,
  mix,
  neutralToneMapping,
  normalize,
  output,
  positionView,
  positionViewDirection,
  pow,
  select,
  sign,
  sin,
  smoothstep,
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
// Specular anti-aliasing after Kaplanyan et al., "Stable Specular
// Highlights" (HPG 2016): the normal's change across a pixel, as variance
// at their SIGMA2 0.25, widens alpha² by twice that, capped at their KAPPA
// 0.18. A rounded edge turns its normal about 10° per CSS px, so a coat at
// roughness 0.02 reflected the softbox there as a band under one device
// pixel wide, which flickered pixel to pixel along glazed ceramic's lower
// rim (m2 probe, 2026-11-25: luminance jumped 13 per pixel there, under 0.2
// on every other rim).
const FILTER_SIGMA2 = 0.25
const FILTER_KAPPA = 0.18
// Crackle lines are this many CSS px wide where the cell borders meet.
// By eye, unmeasured.
const CRACKLE_LINE_PX = 0.9

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

interface EdgeProfile {
  readonly slope: Node<'vec2'>
  readonly towardRim: Node<'float'>
}

/**
 * A rounded edge `width` px wide, falling outward from a rounded-rect
 * card of half size `half` and corner radii `radii` (tl, tr, br, bl):
 * its slope, and how far across the edge `p` is, 0 where the flat face
 * ends and 1 at the rim. `p` is CSS px from the card's center, y down.
 */
function edgeProfile(
  p: Node<'vec2'>,
  half: Node<'vec2'>,
  radii: Node<'vec4'>,
  width: Node<'float'>,
): EdgeProfile {
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
  const hasEdge = width.greaterThan(0.5)
  const slope = towardRim.div(sqrt(max(float(1).sub(towardRim.mul(towardRim)), float(RIM_SLOPE_FLOOR))))
  return { slope: outward.mul(select(hasEdge, slope, float(0))), towardRim: select(hasEdge, towardRim, float(0)) }
}

// ── body pattern ───────────────────────────────────────────────────────

/**
 * Coverage of a crackle network at content point `p`, 0 to 1: the borders
 * of a Voronoi tiling with cells `scale` px across. The border is where the
 * nearest and second-nearest cell points are equally far.
 */
function crackleLines(p: Node<'vec2'>, scale: Node<'float'>): Node<'float'> {
  const q = p.div(scale)
  const cell = floor(q)
  let nearest: Node<'float'> = float(8)
  let second: Node<'float'> = float(8)
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const neighbor = cell.add(vec2(x, y))
      const point = neighbor.add(vec2(latticeHash(neighbor), latticeHash(neighbor.add(19.19))))
      const distance = length(point.sub(q))
      second = min(max(nearest, distance), second)
      nearest = min(nearest, distance)
    }
  }
  const gap = second.sub(nearest)
  const line = float(CRACKLE_LINE_PX).div(scale)
  // The gap grows at about two per cell unit across a border.
  return float(1).sub(smoothstep(line, line.mul(2.5), gap))
}

/** Perceptual roughness widened by the normal's change across the pixel. */
function filteredRoughness(roughness: Node<'float'>, normal: Node<'vec3'>): Node<'float'> {
  const dx = dFdx(normal)
  const dy = dFdy(normal)
  const variance = dot(dx, dx).add(dot(dy, dy)).mul(FILTER_SIGMA2)
  const alpha = roughness.mul(roughness)
  const alpha2 = clamp(alpha.mul(alpha).add(min(variance.mul(2), float(FILTER_KAPPA))), float(0), float(1))
  return sqrt(sqrt(alpha2))
}

// ── key sheen ──────────────────────────────────────────────────────────

/**
 * The softbox key as a point light at its center, for the sheen three
 * leaves out of a RectAreaLight (PhysicalLightingModel.directRectArea at
 * r186). View space. `radiantIntensity` is the light's color times the
 * point key's intensity, so the irradiance under it is `studio.lightPower`,
 * as for the softbox; black when the key is not the softbox, whose lights
 * three already gives sheen.
 */
export interface KeySheenUniforms {
  readonly position: UniformNode<'vec3', THREE.Vector3>
  readonly radiantIntensity: UniformNode<'color', THREE.Color>
}

export function createKeySheenUniforms(): KeySheenUniforms {
  return { position: uniform(new THREE.Vector3()), radiantIntensity: uniform(new THREE.Color(0, 0, 0)) }
}

/**
 * Charlie sheen from the key, as three's BRDF_Sheen evaluates it for a
 * point light: D after Estevez and Kulla 2017, visibility after Neubelt
 * and Pettineo 2013, with the same floor on sin²θh.
 */
function keySheen(normal: Node<'vec3'>, key: KeySheenUniforms): Node<'vec3'> {
  const toKey = key.position.sub(positionView)
  const distanceSquared = dot(toKey, toKey)
  const toLight = normalize(toKey)
  const half = normalize(toLight.add(positionViewDirection))
  const dotNL = clamp(dot(normal, toLight), float(0), float(1))
  const dotNV = clamp(dot(normal, positionViewDirection), float(0), float(1))
  const dotNH = clamp(dot(normal, half), float(0), float(1))
  const inverseAlpha = float(1).div(materialSheenRoughness.mul(materialSheenRoughness))
  const sin2h = max(float(1).sub(dotNH.mul(dotNH)), float(0.0078125))
  const distribution = float(2).add(inverseAlpha).mul(pow(sin2h, inverseAlpha.mul(0.5))).div(2 * Math.PI)
  const visibility = clamp(float(1).div(float(4).mul(dotNL.add(dotNV).sub(dotNL.mul(dotNV)))), float(0), float(1))
  return materialSheen.mul(distribution.mul(visibility).mul(dotNL)).mul(key.radiantIntensity.div(distanceSquared))
}

// ── material ───────────────────────────────────────────────────────────

/** The uniforms that shape a finish's normal and pattern its body, written before each draw. */
export interface FinishShapeUniforms {
  readonly edgeWidth: UniformNode<'float', number>
  readonly detailScale: UniformNode<'float', number>
  readonly detailDepth: UniformNode<'float', number>
  /** Body color at the rim, linear light. */
  readonly rimColor: UniformNode<'color', THREE.Color>
  readonly crackle: UniformNode<'float', number>
  readonly crackleScale: UniformNode<'float', number>
  /** The card's tilt as a rotation in its own frame; identity when flat. */
  readonly tilt: UniformNode<'mat3', THREE.Matrix3>
}

export function createFinishShapeUniforms(): FinishShapeUniforms {
  return {
    edgeWidth: uniform(0),
    detailScale: uniform(1),
    detailDepth: uniform(0),
    rimColor: uniform(new THREE.Color()),
    crackle: uniform(0),
    crackleScale: uniform(40),
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
  readonly key: KeySheenUniforms
}

/** `hasCrackle` compiles the crackle network, which costs nine cell lookups a fragment. */
export function createFinishMaterial(
  inputs: FinishMaterialInputs,
  text: TextLighting,
  detail: SurfaceDetail,
  hasCrackle: boolean,
): MeshPhysicalNodeMaterial {
  const { capture, cornerMask, size, radii, body, shape, key } = inputs
  const material = new MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false, premultipliedAlpha: true })
  const texCoord = uv()
  // SAFETY: a texture sample is a vec4; three's types return a bare Node.
  const page = capture.sample(texCoord) as Node<'vec4'>
  const uncovered = float(1).sub(page.a)

  const content = vec2(texCoord.x.sub(0.5), float(0.5).sub(texCoord.y)).mul(size)
  const { slope: edge, towardRim } = edgeProfile(content, size.mul(0.5), radii, shape.edgeWidth)
  const relief = reliefSlope(detail, content, shape.detailScale, shape.detailDepth)
  const viewNormal = (slope: Node<'vec2'>) => {
    // Content y runs down; the card's frame runs up.
    const inCard = normalize(vec3(slope.x, slope.y.negate(), float(1)))
    // SAFETY: a mat3 times a vec3 is a vec3; three's types return a bare Node.
    return normalize(shape.tilt.mul(inCard) as Node<'vec3'>)
  }
  // The relief is defined on the flat face. Fading it as the edge turns
  // keeps it from shifting the rim's fast-changing normal pixel to pixel.
  const reliefOnEdge = relief.div(float(1).add(dot(edge, edge)))
  const withRelief = viewNormal(edge.add(reliefOnEdge))
  const edgeOnly = viewNormal(edge)
  const inCoat = reliefIsInCoat(detail)
  const baseNormal = inCoat ? edgeOnly : withRelief
  const coatNormal = inCoat ? withRelief : edgeOnly
  material.normalNode = baseNormal
  material.clearcoatNormalNode = coatNormal
  material.roughnessNode = filteredRoughness(materialRoughness, baseNormal)
  material.clearcoatRoughnessNode = filteredRoughness(materialClearcoatRoughness, coatNormal)
  material.emissiveNode = keySheen(baseNormal, key)

  // A glaze thins fastest near the rim, so its color shifts there most.
  const rimBody = mix(body, shape.rimColor, towardRim.mul(towardRim))
  const bodyColor = hasCrackle ? rimBody.mul(float(1).sub(crackleLines(content, shape.crackleScale).mul(shape.crackle))) : rimBody

  if (text === 'lit') {
    material.metalnessNode = materialMetalness.mul(uncovered)
    material.roughnessNode = filteredRoughness(mix(materialRoughness, float(INK_ROUGHNESS), page.a), baseNormal)
    material.specularIntensityNode = mix(materialSpecularIntensity, float(1), page.a)
    // SAFETY: three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const bodyEncoded = sRGBTransferOETF(bodyColor) as Node<'vec3'>
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

  material.colorNode = vec4(bodyColor, 1)
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
  shape.rimColor.value.set(finish.rimColor ?? finish.color)
  shape.crackle.value = finish.crackle
  shape.crackleScale.value = Math.max(finish.crackleScale, 4)
}
