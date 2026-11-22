// Polymer prototype node materials — analytical SDF soft-polymer bevel & shadow.
//
// Why single-pass SDF instead of Three shadow maps: a 2048x2048 PCF/VSM shadow
// pass renders the scene twice and blurs a depth target on every frame. A UI
// container's planform is an exact rounded rectangle, so 5 ALU ops compute both
// the G1/G2 cushion normal on the polymer body and the ray-projected area-light
// penumbra on the shadow skirt in a single pass with zero extra render targets.
//
// Ownership: this module builds TSL `MeshBasicNodeMaterial` instances and their
// uniform bags. `PolymerPrototypeSurface` writes per-frame pose/light uniforms.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type UniformNode } from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

export const SHADOW_PAD_PX = 96

export interface PolymerBodyUniforms {
  readonly baseColor: UniformNode<'color', THREE.Color>
  readonly warmTint: UniformNode<'color', THREE.Color>
  readonly lightPosCss: UniformNode<'vec3', THREE.Vector3>
  readonly cardCenterCss: UniformNode<'vec2', THREE.Vector2>
  readonly elevation: UniformNode<'float', number>
  readonly bevelWidth: UniformNode<'float', number>
  readonly cornerRadius: UniformNode<'float', number>
  readonly pillow: UniformNode<'float', number>
  readonly bodyOpacity: UniformNode<'float', number>
  readonly subsurfaceWrap: UniformNode<'float', number>
  readonly warmth: UniformNode<'float', number>
  readonly sheen: UniformNode<'float', number>
  readonly shininess: UniformNode<'float', number>
  readonly grain: UniformNode<'float', number>
  readonly seamInk: UniformNode<'float', number>
  readonly recessed: UniformNode<'float', number>
}

export function createPolymerBodyUniforms(tintHex = '#fbfbfa', isRecessed = false): PolymerBodyUniforms {
  return {
    baseColor: uniform(new THREE.Color(tintHex)),
    warmTint: uniform(new THREE.Color('#fff1dc')),
    lightPosCss: uniform(new THREE.Vector3(300, 120, 520)),
    cardCenterCss: uniform(new THREE.Vector2(640, 400)),
    elevation: uniform(10),
    bevelWidth: uniform(7.5),
    cornerRadius: uniform(18),
    pillow: uniform(0.16),
    bodyOpacity: uniform(1),
    subsurfaceWrap: uniform(0.48),
    warmth: uniform(0.22),
    sheen: uniform(0.24),
    shininess: uniform(22),
    grain: uniform(0.012),
    seamInk: uniform(0.14),
    recessed: uniform(isRecessed ? 1 : 0),
  }
}

export function createPolymerBodyMaterial(
  surface: SurfaceNodes,
  u: PolymerBodyUniforms,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  material.premultipliedAlpha = true

  const texCoord = uv()
  const size = surface.size
  // CSS pixel coordinates centered on card: +x right, +y down.
  const pCss = vec2(texCoord.x.sub(0.5), float(1).sub(texCoord.y).sub(0.5)).mul(size)
  const halfSize = size.mul(0.5)
  const maxR = min(halfSize.x, halfSize.y).sub(1)
  const r = clamp(u.cornerRadius, float(2), maxR)

  // Signed distance to rounded box: negative inside, 0 at silhouette edge.
  const q = abs(pCss).sub(halfSize.sub(r))
  const outsideLen = length(max(q, vec2(0, 0)))
  const insideMax = min(max(q.x, q.y), float(0))
  const sdf = outsideLen.add(insideMax).sub(r)

  // Anti-aliased silhouette mask (~1 CSS px feather).
  const silhouette = float(1).sub(smoothstep(float(-0.75), float(0.5), sdf))

  // Outward 2D gradient of the rounded-box SDF in CSS pixel space.
  const eps = float(0.75)
  const qx1 = abs(pCss.add(vec2(eps, 0))).sub(halfSize.sub(r))
  const qx0 = abs(pCss.sub(vec2(eps, 0))).sub(halfSize.sub(r))
  const qy1 = abs(pCss.add(vec2(0, eps))).sub(halfSize.sub(r))
  const qy0 = abs(pCss.sub(vec2(0, eps))).sub(halfSize.sub(r))
  const sdfX1 = length(max(qx1, vec2(0, 0))).add(min(max(qx1.x, qx1.y), float(0))).sub(r)
  const sdfX0 = length(max(qx0, vec2(0, 0))).add(min(max(qx0.x, qx0.y), float(0))).sub(r)
  const sdfY1 = length(max(qy1, vec2(0, 0))).add(min(max(qy1.x, qy1.y), float(0))).sub(r)
  const sdfY0 = length(max(qy0, vec2(0, 0))).add(min(max(qy0.x, qy0.y), float(0))).sub(r)
  const grad = vec2(sdfX1.sub(sdfX0), sdfY1.sub(sdfY0)).div(eps.mul(2))

  // Quarter-round molded polymer cushion profile along inward distance (-sdf).
  const bevel = max(u.bevelWidth, float(1.5))
  const inward = clamp(sdf.negate().div(bevel), float(0), float(1))
  const rimFactor = float(1).sub(inward)
  // Smooth cushion slope: steepest near edge, smoothly zero on plateau, inverted if recessed well.
  const signDir = mix(float(1), float(-0.9), u.recessed)
  const slopeMag = rimFactor.mul(rimFactor).mul(1.75).mul(signDir)
  // Gentle overall pillow dome across the face so broad containers catch directional light gradient.
  const dome = pCss.div(max(halfSize, vec2(1, 1))).mul(u.pillow).mul(signDir)
  const normalXY = grad.mul(slopeMag).add(dome)
  const normal = normalize(vec3(normalXY.x, normalXY.y, float(1)))

  // 3D vector from this pixel on the elevated container to the global studio light.
  const worldXY = u.cardCenterCss.add(pCss)
  const toLight = vec3(
    u.lightPosCss.x.sub(worldXY.x),
    u.lightPosCss.y.sub(worldXY.y),
    max(u.lightPosCss.z.mul(0.62).sub(u.elevation), float(60)),
  )
  const lightDir = normalize(toLight)
  const viewDir = vec3(0, 0, 1)
  const halfVec = normalize(lightDir.add(viewDir))

  // Wrapped subsurface diffuse (soft matte polymer scatters past the 90° terminator).
  const nDotL = dot(normal, lightDir)
  const wrapped = clamp(nDotL.add(u.subsurfaceWrap).div(float(1).add(u.subsurfaceWrap)), float(0), float(1))

  // Satin micro-facet sheen along the light-catching bevel rim.
  const nDotH = max(dot(normal, halfVec), float(0))
  const spec = pow(nDotH, u.shininess).mul(u.sheen).mul(mix(float(0.25), float(1.35), rimFactor))

  // Subtle ambient-occlusion lip right at the outer 1.8 px edge + recessed cavity rim shading.
  const edgeLip = smoothstep(float(0), float(2.0), sdf.negate())
  const recessShadow = u.recessed.mul(rimFactor).mul(0.11)

  // Bead-blasted EDM mold micro-grain in CSS pixel coordinates.
  const hash = fract(sin(dot(pCss, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5)
  const grainOffset = hash.mul(u.grain)

  // Architectural hairline seam just inside the bevel shoulder (modernist graphic discipline).
  const seamBand = smoothstep(float(1.2), float(0), abs(sdf.negate().sub(bevel.mul(0.92))))
  const seamDarken = seamBand.mul(u.seamInk).mul(0.08)

  // THREE.Color converts CSS hex to linear RGB automatically on CPU.
  const baseLin = u.baseColor
  const warmLin = u.warmTint

  // Combine ambient paper bounce + wrapped directional light + subsurface warmth + satin sheen.
  const litShade = mix(float(0.79), float(1.055), wrapped)
    .sub(recessShadow)
    .sub(seamDarken)
    .mul(mix(float(0.88), float(1), edgeLip))
  const warmScatter = warmLin.mul(u.warmth).mul(rimFactor).mul(max(nDotL, float(0)).mul(0.14))
  const polymerRgb = clamp(
    baseLin.mul(litShade).add(warmScatter).add(vec3(spec, spec, spec)).add(vec3(grainOffset, grainOffset, grainOffset)),
    vec3(0, 0, 0),
    vec3(1, 1, 1),
  )

  // Composite premultiplied HTML capture ink (buttons, inputs, typography) onto lit polymer face.
  const domSample = surface.map.sample(texCoord)
  const polyA = u.bodyOpacity.mul(silhouette)
  const domA = domSample.a.mul(silhouette)
  const outA = domA.add(polyA.mul(float(1).sub(domA)))
  const outPremulRgb = domSample.rgb.mul(silhouette).add(polymerRgb.mul(polyA).mul(float(1).sub(domA)))

  material.outputNode = premultipliedOutput(vec4(outPremulRgb, outA))
  return material
}

export interface PolymerShadowUniforms {
  readonly cardSize: UniformNode<'vec2', THREE.Vector2>
  readonly padPx: UniformNode<'float', number>
  readonly lightPosCss: UniformNode<'vec3', THREE.Vector3>
  readonly cardCenterCss: UniformNode<'vec2', THREE.Vector2>
  readonly elevation: UniformNode<'float', number>
  readonly cornerRadius: UniformNode<'float', number>
  readonly lightRadius: UniformNode<'float', number>
  readonly shadowOpacity: UniformNode<'float', number>
  readonly contactOpacity: UniformNode<'float', number>
  readonly bodyOpacity: UniformNode<'float', number>
}

export function createPolymerShadowUniforms(): PolymerShadowUniforms {
  return {
    cardSize: uniform(new THREE.Vector2(320, 180)),
    padPx: uniform(SHADOW_PAD_PX),
    lightPosCss: uniform(new THREE.Vector3(300, 120, 520)),
    cardCenterCss: uniform(new THREE.Vector2(640, 400)),
    elevation: uniform(10),
    cornerRadius: uniform(18),
    lightRadius: uniform(42),
    shadowOpacity: uniform(0.14),
    contactOpacity: uniform(0.16),
    bodyOpacity: uniform(1),
  }
}

export function createPolymerShadowMaterial(u: PolymerShadowUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  material.premultipliedAlpha = true

  const texCoord = uv()
  const skirtSize = u.cardSize.add(u.padPx.mul(2))
  // Paper pixel coordinate relative to card center (+x right, +y down).
  const pPaper = vec2(texCoord.x.sub(0.5), float(1).sub(texCoord.y).sub(0.5)).mul(skirtSize)
  const halfCard = u.cardSize.mul(0.5)
  const r = clamp(u.cornerRadius, float(2), min(halfCard.x, halfCard.y).sub(1))

  // Ray-plane projection with softbox-bounded lateral tangent so edge cards never throw 100px runway shadows.
  const worldPaperXY = u.cardCenterCss.add(pPaper)
  const lightDeltaXY = vec2(u.lightPosCss.x.sub(worldPaperXY.x), u.lightPosCss.y.sub(worldPaperXY.y))
  const safeLz = max(u.lightPosCss.z, float(180))
  const rawRay = lightDeltaXY.div(safeLz)
  const rayLen = length(rawRay)
  const boundedRay = rawRay.div(max(rayLen, float(0.0001))).mul(min(rayLen, float(1.15)))
  const castShift = boundedRay.mul(u.elevation.mul(1.35))
  const pCast = pPaper.add(castShift)

  // Penumbra blur grows physically with elevation * (lightRadius / lightHeight), without bleeding onto sunlit side.
  const penumbraBlur = float(3.5).add(u.elevation.mul(float(0.95).add(u.lightRadius.div(safeLz).mul(6))))
  const qCast = abs(pCast).sub(halfCard.sub(r))
  const sdfCast = length(max(qCast, vec2(0, 0))).add(min(max(qCast.x, qCast.y), float(0))).sub(r)
  const penumbra = float(1).sub(smoothstep(float(-2.0), penumbraBlur, sdfCast))

  // Tight ambient contact occlusion right under the polymer base edge.
  const contactShift = lightDeltaXY.mul(min(u.elevation, float(4)).div(safeLz).mul(0.45))
  const pContact = pPaper.add(contactShift)
  const qContact = abs(pContact).sub(halfCard.sub(r))
  const sdfContact = length(max(qContact, vec2(0, 0))).add(min(max(qContact.x, qContact.y), float(0))).sub(r)
  const contactBlur = float(1.6).add(u.elevation.mul(0.18))
  const contact = float(1).sub(smoothstep(float(-1.2), contactBlur, sdfContact))

  // Under translucent silicone (bodyOpacity < 1), keep interior paper luminous while preserving outer cast shadow.
  const qFootprint = abs(pPaper).sub(halfCard.sub(r))
  const sdfFootprint = length(max(qFootprint, vec2(0, 0))).add(min(max(qFootprint.x, qFootprint.y), float(0))).sub(r)
  const underBody = float(1).sub(smoothstep(float(-1), float(1.5), sdfFootprint))
  const interiorAtten = mix(float(1), u.bodyOpacity.mul(0.35), underBody.mul(float(1).sub(u.bodyOpacity)))

  // Smooth fade at the outer skirt boundary so high standoffs never show a quad edge.
  const halfSkirt = skirtSize.mul(0.5)
  const skirtMargin = min(halfSkirt.x.sub(abs(pPaper.x)), halfSkirt.y.sub(abs(pPaper.y)))
  const skirtFade = smoothstep(float(0), float(18), skirtMargin)

  const rawAlpha = clamp(
    penumbra.mul(u.shadowOpacity).add(contact.mul(u.contactOpacity)).mul(interiorAtten).mul(skirtFade),
    float(0),
    float(0.65),
  )
  // Neutral cool-warm architectural shadow tint in linear RGB (~#17181f sRGB, never muddy black).
  const shadowColorLin = vec3(0.0086, 0.0094, 0.0135)
  material.outputNode = premultipliedOutput(vec4(shadowColorLin.mul(rawAlpha), rawAlpha))
  return material
}
