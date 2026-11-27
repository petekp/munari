// Finish material — a physical body wearing a Surface capture, with the
// capture either lit as the body's albedo, composited over the lit body
// unlit, or, when the finish has no color, lit as the whole body.
//
// The law: the capture is premultiplied in its sRGB encoding (decisions.md
// #5, #48), so it composites over an opaque body in that encoding, as the
// page does, and only then decodes. Over an opaque body that composite is
// the alpha divide's whole job: the result has alpha 1, and no decoded
// premultiplied sample is ever divided. Output goes through
// premultipliedOutput or encodedOutput, because SurfaceCanvas's pipeline
// re-encodes fragments and a bare output lands too dark where it is
// translucent (decisions.md #72). A finish with no color lights the
// capture itself, as Surface.LitMaterial did: the straight color is the
// albedo and three premultiplies the result, which re-encodes to the
// page's value at every coverage.
//
// SurfaceCanvas draws without tone mapping, so the page's colors land
// exact. Lit bodies then clip: measured 2026-11-24 on m2 (Chrome for Testing
// 156, 1440×900 at 2x), satin polymer clipped over 53% of the form card from
// the room environment alone and 88% with the studio light at power 2.4,
// which flattens the finish to white. A colored body's lit result goes
// through Khronos PBR Neutral, which leaves colors under 0.76 as they are and
// rolls off the highlights above them. Unlit text is laid over the
// tone-mapped body untouched.
//
// Lit text is printed ink, a dielectric: as the albedo of a metal body it
// became a dark mirror, and the dark "Add to bag" pill on anodized aluminum
// lost its label (2026-11-24 review). Where the capture covers the body,
// metalness falls to 0 and the ink takes its own roughness and full
// dielectric reflection.
//
// The normal is shading only. The edge and relief bend no vertex, so the
// pointer still maps through the mesh UV. The normal is built in the card's
// own frame (x right, y up, z toward the viewer). A match-dom mesh shares
// the camera's rotation, so that frame is view space and is used as it is.
// Any other mesh turns it onto its geometry's normal and its model-view x
// axis, so a mesh turned or bent in a 3D scene shades as it stands.
//
// A layer the finish holds compiles, and its amount is a uniform, so an
// amount crossing zero rebuilds nothing. three compiles clear coat, sheen
// and anisotropy when their node is set, so a present layer sets the node
// to the property node three would read anyway.
//
// Ownership: this module builds the node graph from the base and the layer
// code that has loaded (finishLayerCode.ts). SurfaceFinishMaterial owns the
// capture view and the writes before each draw; finishRig places the lights.

import { type Node, type TextureNode } from 'three/webgpu'
import {
  abs,
  clamp,
  cross,
  dFdx,
  dFdy,
  Discard,
  dot,
  float,
  Fn,
  length,
  materialAnisotropy,
  materialClearcoat,
  materialClearcoatRoughness,
  materialMetalness,
  materialRoughness,
  materialSheen,
  materialSpecularIntensity,
  max,
  min,
  mix,
  modelViewMatrix,
  neutralToneMapping,
  normalView,
  normalize,
  output,
  positionViewDirection,
  Schlick_to_F0,
  select,
  sign,
  sqrt,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { encodedOutput, premultipliedOutput } from '../../lib/surfaceOutput'
import { chunkCode, type FinishLayerCode } from './finishLayerCode'
import { FinishPhysicalMaterial } from './finishLightingModel'
import type { FinishLayers, FinishUniforms } from './finishUniforms'
import type { SurfaceDetailKind } from './surfaceFinish'

// Below this coverage a fragment writes nothing visible.
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
// How far the fibers and formation tint the body, per unit of relief
// slope: kraft's 0.04 slope moves its body color by about ±10%. By eye,
// unmeasured.
const FIBER_TINT_PER_SLOPE = 2.5


// SAFETY: three declares neutralToneMapping's layout as vec3 to vec3; its
// published types leave the result untyped.
const rollOff = (color: Node<'vec3'>) => neutralToneMapping(color, float(1)) as Node<'vec3'>

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

/** Perceptual roughness widened by the normal's change across the pixel. */
function filteredRoughness(roughness: Node<'float'>, normal: Node<'vec3'>): Node<'float'> {
  const dx = dFdx(normal)
  const dy = dFdy(normal)
  const variance = dot(dx, dx).add(dot(dy, dy)).mul(FILTER_SIGMA2)
  const alpha = roughness.mul(roughness)
  const alpha2 = clamp(alpha.mul(alpha).add(min(variance.mul(2), float(FILTER_KAPPA))), float(0), float(1))
  return sqrt(sqrt(alpha2))
}

/** Whether a finish's relief sits in its clear coat rather than its base. */
function reliefIsInCoat(detail: SurfaceDetailKind | null): boolean {
  return detail === 'orange-peel' || detail === 'glaze'
}

// ── material ───────────────────────────────────────────────────────────

/** Changes a finish's shading in its own frame, for a scene that bends or turns the card. */
export interface FinishShadingInputs {
  /** Maps each normal the finish builds (base, coat and the flat face), in view space; three normalizes the result. */
  readonly normal?: (normal: Node<'vec3'>) => Node<'vec3'>
  /** Maps the body color, in linear light, after the rim, crackle and fiber tint and before the film. */
  readonly bodyColor?: (color: Node<'vec3'>) => Node<'vec3'>
}

export interface FinishMaterialInputs extends FinishShadingInputs {
  /** A raw (NoColorSpace) view of the capture: encoded, premultiplied. */
  readonly capture: TextureNode
  readonly size: Node<'vec2'>
  readonly radii: Node<'vec4'>
  /** Corner coverage, 1 inside and 0 outside. */
  readonly cornerMask: Node<'float'>
  readonly uniforms: FinishUniforms
}

/**
 * The card's axes in view space for a mesh that does not face the camera.
 * Out is the geometry's interpolated normal, so a bent mesh shades along its
 * bend. Right is the mesh's x axis, normalized because the plane's scale
 * sizes it, and up completes the frame.
 */
interface MeshAxes {
  readonly right: Node<'vec3'>
  readonly up: Node<'vec3'>
  readonly out: Node<'vec3'>
}

function meshFrame(): MeshAxes {
  const out = normalize(normalView)
  const right = normalize(modelViewMatrix.mul(vec4(1, 0, 0, 0)).xyz)
  return { right, up: normalize(cross(out, right)), out }
}

/** A material wearing `layers`, whose chunks `code` holds. */
export function createFinishMaterial(inputs: FinishMaterialInputs, layers: FinishLayers, code: FinishLayerCode): FinishPhysicalMaterial {
  const { capture, cornerMask, size, radii, uniforms } = inputs
  const { detail } = layers
  const mapNormal = inputs.normal ?? ((normal: Node<'vec3'>) => normal)
  const material = new FinishPhysicalMaterial({ transparent: true, depthWrite: false, premultipliedAlpha: true })
  const gain = material.lightGain
  const texCoord = uv()
  // SAFETY: a texture sample is a vec4; three's types return a bare Node.
  const page = capture.sample(texCoord) as Node<'vec4'>
  const uncovered = float(1).sub(page.a)
  const ownsBody = layers.body !== 'capture'

  const content = vec2(texCoord.x.sub(0.5), float(0.5).sub(texCoord.y)).mul(size)
  const { slope: edge, towardRim } = edgeProfile(content, size.mul(0.5), radii, uniforms.edgeWidth)
  const toView = layers.frame === 'camera' ? null : meshFrame()
  const cardNormal = (slope: Node<'vec2'>) => {
    // Content y runs down; the card's frame runs up.
    const inCard = normalize(vec3(slope.x, slope.y.negate(), float(1)))
    const inView = toView ? toView.right.mul(inCard.x).add(toView.up.mul(inCard.y)).add(toView.out.mul(inCard.z)) : inCard
    return normalize(mapNormal(normalize(inView)))
  }
  let withRelief = cardNormal(edge)
  if (detail !== null) {
    const relief = chunkCode(code[detail], detail).reliefSlope(content, uniforms.detailScale, uniforms.detailDepth)
    // The relief is defined on the flat face. Fading it as the edge turns
    // keeps it from shifting the rim's fast-changing normal pixel to pixel.
    withRelief = cardNormal(edge.add(relief.div(float(1).add(dot(edge, edge)))))
  }
  const edgeOnly = cardNormal(edge)
  const inCoat = reliefIsInCoat(detail)
  const baseNormal = inCoat ? edgeOnly : withRelief
  material.normalNode = baseNormal
  material.roughnessNode = filteredRoughness(materialRoughness, baseNormal)
  if (layers.coat) {
    const coatNormal = inCoat ? withRelief : edgeOnly
    material.clearcoatNode = materialClearcoat
    material.clearcoatNormalNode = coatNormal
    material.clearcoatRoughnessNode = filteredRoughness(materialClearcoatRoughness, coatNormal)
  }
  if (layers.sheen) material.sheenNode = materialSheen
  if (layers.anisotropy) material.anisotropyNode = materialAnisotropy

  // SAFETY: three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const captureStraight = sRGBTransferEOTF(page.a.greaterThan(0).select(page.rgb.div(page.a), vec3(0))) as Node<'vec3'>
  // A glaze thins fastest near the rim, so its color shifts there most.
  const towardRimColor = towardRim.mul(towardRim).mul(uniforms.rimShift)
  let bodyColor: Node<'vec3'> = ownsBody
    ? mix(uniforms.body, uniforms.rimColor, towardRimColor)
    : mix(captureStraight, uniforms.rimColor, towardRimColor)
  if (layers.crackle) {
    const lines = chunkCode(code.crackle, 'crackle').crackleLines(content, uniforms.crackleScale)
    bodyColor = bodyColor.mul(float(1).sub(lines.mul(uniforms.crackle)))
  }
  if (detail === 'fiber') {
    const density = chunkCode(code.fiber, detail).fiberRelief(content, uniforms.detailScale).x
    bodyColor = bodyColor.mul(float(1).add(density.mul(uniforms.detailDepth).mul(FIBER_TINT_PER_SLOPE)))
  }
  if (inputs.bodyColor) bodyColor = inputs.bodyColor(bodyColor)
  if (layers.film) {
    // A metal's body color is its reflectance, so the film over it is too.
    const cosTheta = clamp(dot(baseNormal, positionViewDirection), float(0), float(1))
    const film = chunkCode(code.film, 'film')
    const thickness = film.filmThickness(content, uniforms.filmThickness, uniforms.filmVariation, uniforms.filmScale)
    // SAFETY: Schlick_to_F0 is vec3 in and out; three's types return a bare Node.
    const filmF0 = Schlick_to_F0(film.filmReflectance(cosTheta, thickness, uniforms.filmIor, bodyColor), float(1), cosTheta) as Node<'vec3'>
    bodyColor = mix(bodyColor, clamp(filmF0, vec3(0), vec3(1)), uniforms.film)
  }

  // three's softbox key gives no sheen and no scatter, so the key's share of
  // both is emitted here, scaled by the same gain as three's lights.
  let keyLight: Node<'vec3'> = vec3(0)
  if (layers.sheen) keyLight = chunkCode(code.sheen, 'sheen').keySheen(baseNormal, uniforms.key)
  if (layers.scatter) {
    const scatter = chunkCode(code.scatter, 'scatter').keyScatter(baseNormal, cardNormal(vec2(0, 0)), towardRim, bodyColor, uniforms.scatter, uniforms.key)
    keyLight = keyLight.add(layers.body === 'lit-text' ? scatter.mul(uncovered) : scatter)
  }
  const keyEmission = keyLight.mul(gain)

  if (layers.body === 'capture') {
    material.colorNode = vec4(bodyColor, page.a)
    material.emissiveNode = keyEmission.add(bodyColor.mul(uniforms.emission))
    // three's premultiplication already applied the capture's coverage; this
    // adds only the corner coverage.
    material.outputNode = Fn(() => {
      const covered = output.mul(cornerMask)
      Discard(covered.a.lessThan(DISCARD_ALPHA))
      return covered
    })()
    return material
  }

  if (layers.body === 'lit-text') {
    material.metalnessNode = materialMetalness.mul(uncovered)
    material.roughnessNode = filteredRoughness(mix(materialRoughness, float(INK_ROUGHNESS), page.a), baseNormal)
    material.specularIntensityNode = mix(materialSpecularIntensity, float(1), page.a)
    // SAFETY: as above, vec3 to vec3.
    const bodyEncoded = sRGBTransferOETF(bodyColor) as Node<'vec3'>
    // SAFETY: as above, vec3 to vec3.
    const albedo = sRGBTransferEOTF(page.rgb.add(bodyEncoded.mul(uncovered))) as Node<'vec3'>
    material.colorNode = vec4(albedo, 1)
    material.emissiveNode = keyEmission.add(albedo.mul(uniforms.emission))
    material.outputNode = Fn(() => {
      const covered = vec4(rollOff(output.rgb), output.a).mul(cornerMask)
      Discard(covered.a.lessThan(DISCARD_ALPHA))
      return premultipliedOutput(covered)
    })()
    return material
  }

  material.colorNode = vec4(bodyColor, 1)
  material.emissiveNode = keyEmission.add(bodyColor.mul(uniforms.emission))
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
