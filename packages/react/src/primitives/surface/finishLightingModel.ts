// Finish lighting model — three's physical lighting with the direct lights
// scaled by one uniform, a finish's `lightGain`.
//
// The law: a finish can ask for more or less of the key and rim than the
// studio gives every finish, without a rig of its own. Velvet put most of
// its light in the key, at 3.2 times the studio key, and lights are shared
// by every finish on a canvas, because three's WebGPU renderer reads a
// light's uniforms once per frame: on one shared set every card drew under
// the studio that placed the lights last (measured 2026-11-26, one bench
// card switched from velvet to lacquer changed 85% of the pixels of two
// other cards). The gain multiplies each light's color where three's
// PhysicalLightingModel reads it, in `direct` and `directRectArea`, so it
// is a uniform write and reaches every lobe a light feeds. A gain of 1
// multiplies by exactly 1.
//
// Prototype on the softbox-size branch: with `areaKey` set, the point key
// lights as a rectangle without LTC tables. Diffuse is three's exact form
// factor (LTC_Evaluate with the identity matrix, as directRectArea does).
// Specular is GGX toward the point of the rectangle nearest the mirror ray,
// with the lobe widened by the rectangle's equal-area radius over twice its
// distance and scaled back by (α/α′)² (Karis, Real Shading in Unreal Engine
// 4, 2013). That widening makes a mirror facing the box return its
// luminance, the box's area over 4πd²·α′², with α′ = r/2d.
//
// Ownership: this module owns the subclass and its uniform. finishNodes
// scales the key's own sheen and scatter by the same uniform.

import * as THREE from 'three'
import { MeshPhysicalNodeMaterial, PhysicalLightingModel, type Node, type NodeBuilder, type UniformNode } from 'three/webgpu'
import {
  abs,
  BRDF_GGX,
  clamp,
  clearcoatNormalView,
  clearcoatRoughness,
  cross,
  diffuseContribution,
  dot,
  float,
  length,
  LTC_Evaluate,
  mat3,
  max,
  normalize,
  normalView,
  positionView,
  positionViewDirection,
  reflect,
  roughness,
  select,
  specularColorBlended,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl'
import type { KeySheenUniforms } from './finishKeyLight'

type DirectInput = Parameters<PhysicalLightingModel['direct']>[0]
type DirectRectAreaInput = Parameters<PhysicalLightingModel['directRectArea']>[0]

function gained(lightColor: Node, gain: Node<'float'>): Node<'vec3'> {
  // SAFETY: three's light nodes pass lightColor as a vec3 (the light's color
  // times its intensity); its published types leave the node untyped.
  return (lightColor as Node<'vec3'>).mul(gain)
}

interface AreaLobe {
  readonly normal: Node<'vec3'>
  readonly roughness: Node<'float'>
  readonly f0: Node<'vec3'>
  readonly f90: Node<'float'>
}

/** GGX from a rectangle, toward its point nearest the mirror ray. View space. */
function representativeSpecular(key: KeySheenUniforms, luminance: Node<'vec3'>, lit: Node<'float'>, lobe: AreaLobe): Node<'vec3'> {
  const P = positionView
  const center = key.position
  const lightNormal = normalize(cross(key.halfWidth, key.halfHeight))
  const mirror = reflect(positionViewDirection.negate(), lobe.normal)
  const facing = dot(mirror, lightNormal)
  const toCenter = center.sub(P)
  const t = dot(toCenter, lightNormal).div(select(abs(facing).lessThan(1e-6), float(1e-6), facing))
  // A mirror ray that never meets the plane leans toward the edge it points at.
  const along = mirror.sub(lightNormal.mul(facing))
  const target = select(t.greaterThan(0), P.add(mirror.mul(t)), center.add(along.mul(1e4)))
  const offset = target.sub(center)
  const u = clamp(dot(offset, key.halfWidth).div(dot(key.halfWidth, key.halfWidth)), -1, 1)
  const v = clamp(dot(offset, key.halfHeight).div(dot(key.halfHeight, key.halfHeight)), -1, 1)
  const nearest = center.add(key.halfWidth.mul(u)).add(key.halfHeight.mul(v))
  const toNearest = nearest.sub(P)
  const distanceSquared = max(dot(toNearest, toNearest), float(1e-8))
  const lightDirection = toNearest.div(sqrt(distanceSquared))
  const area = length(key.halfWidth).mul(length(key.halfHeight)).mul(4)
  const radius = sqrt(area.div(Math.PI))
  const alpha = lobe.roughness.mul(lobe.roughness)
  const widened = clamp(alpha.add(radius.div(length(toCenter).mul(2))), 0, 1)
  const ratio = alpha.div(widened)
  const dotNL = clamp(dot(lobe.normal, lightDirection), 0, 1)
  const emitterCosine = clamp(abs(dot(lightNormal, lightDirection)), 0, 1)
  const irradiance = luminance.mul(area.mul(emitterCosine).mul(dotNL).div(distanceSquared))
  const brdf = BRDF_GGX({ lightDirection, f0: lobe.f0, f90: lobe.f90, roughness: lobe.roughness, normalView: lobe.normal })
  return irradiance.mul(brdf).mul(ratio.mul(ratio)).mul(lit)
}

class GainedLightingModel extends PhysicalLightingModel {
  readonly #gain: Node<'float'>
  readonly #areaKey: KeySheenUniforms | null

  constructor(gain: Node<'float'>, material: FinishPhysicalMaterial) {
    super(
      material.useClearcoat,
      material.useSheen,
      material.useIridescence,
      material.useAnisotropy,
      material.useTransmission,
      material.useDispersion,
      material.useRetroreflection,
    )
    this.#gain = gain
    this.#areaKey = material.areaKey
  }

  override direct(input: DirectInput, builder: NodeBuilder): void {
    // SAFETY: LightsNode passes the light node that called; an analytic light
    // node carries its light. Only the rig's point key is a PointLight.
    const light = (input.lightNode as { light?: THREE.Light | null }).light
    if (this.#areaKey && light instanceof THREE.PointLight) return this.#directArea(this.#areaKey, input)
    super.direct({ ...input, lightColor: gained(input.lightColor, this.#gain) }, builder)
  }

  override directRectArea(input: DirectRectAreaInput, builder: NodeBuilder): void {
    super.directRectArea({ ...input, lightColor: gained(input.lightColor, this.#gain) }, builder)
  }

  #directArea(key: KeySheenUniforms, { reflectedLight }: DirectInput): void {
    const luminance = gained(key.luminance, this.#gain)
    const p0 = key.position.add(key.halfWidth).sub(key.halfHeight)
    const p1 = key.position.sub(key.halfWidth).sub(key.halfHeight)
    const p2 = key.position.sub(key.halfWidth).add(key.halfHeight)
    const p3 = key.position.add(key.halfWidth).add(key.halfHeight)
    const P = positionView.toVar()
    // LTC_Evaluate's own test: the light shines from one face only.
    const lit = select(cross(p1.sub(p0), p3.sub(p0)).dot(P.sub(p0)).greaterThanEqual(0), float(1), float(0))
    const identity = mat3(1, 0, 0, 0, 1, 0, 0, 0, 1)
    const formFactor = LTC_Evaluate({ N: normalView, V: positionViewDirection, P, mInv: identity, p0, p1, p2, p3 })
    reflectedLight.directDiffuse.addAssign(luminance.mul(diffuseContribution).mul(formFactor))
    reflectedLight.directSpecular.addAssign(
      representativeSpecular(key, luminance, lit, { normal: normalView, roughness, f0: specularColorBlended, f90: float(1) }),
    )
    if (this.clearcoat) {
      this.clearcoatSpecularDirect.addAssign(
        representativeSpecular(key, luminance, lit, { normal: clearcoatNormalView, roughness: clearcoatRoughness, f0: vec3(0.04), f90: float(1) }),
      )
    }
  }
}

/** A MeshPhysicalNodeMaterial whose direct lights are scaled by `lightGain`. */
export class FinishPhysicalMaterial extends MeshPhysicalNodeMaterial {
  readonly lightGain: UniformNode<'float', number> = uniform(1)
  /** Set before the first build: the key uniforms the point key lights as a rectangle with. */
  areaKey: KeySheenUniforms | null = null

  override setupLightingModel(): PhysicalLightingModel {
    return new GainedLightingModel(this.lightGain, this)
  }
}
