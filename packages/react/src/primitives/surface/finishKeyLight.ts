// Finish key light — the key evaluated as a point light at its center, for
// the lobes three leaves out of a RectAreaLight.
//
// three r186's directRectArea gives a softbox key no sheen and no subsurface
// term, so velvet's glow and wax's scatter would not move when the key
// moves. Both are added here as emission. On m2 (2026-11-26) dragging the
// key changed velvet's card pixels by a mean of sRGB 16 to 19, against 1.4
// with the environment-lit sheen alone.
//
// Ownership: this module builds the emission nodes and their uniforms. The
// rig writes the key's position and intensity before each draw
// (finishRig.ts).

import * as THREE from 'three'
import { type Node, type UniformNode } from 'three/webgpu'
import {
  clamp,
  dot,
  float,
  materialSheen,
  materialSheenRoughness,
  max,
  normalize,
  positionView,
  positionViewDirection,
  pow,
  uniform,
} from 'three/tsl'

// Scatter under a wax surface: the wrap reaches this far past the shading's
// terminator (0 is plain Lambert), and light that enters the face leaks out
// through the thin rounded edge at this share. By eye, unmeasured.
const SCATTER_WRAP = 0.6
const SCATTER_EDGE_LEAK = 1.2

// ── scatter ────────────────────────────────────────────────────────────

/**
 * Key light that scatters under a translucent surface: the part a wrapped
 * diffuse reaches past Lambert, plus what enters through the face and leaks
 * out through the thin rounded edge. Wax is colored by how far light
 * travels in it, so the scattered light carries the body color squared,
 * scaled back to the body's brightest channel.
 */
export function keyScatter(
  normal: Node<'vec3'>,
  face: Node<'vec3'>,
  towardRim: Node<'float'>,
  body: Node<'vec3'>,
  weight: Node<'float'>,
  key: KeySheenUniforms,
): Node<'vec3'> {
  const toKey = key.position.sub(positionView)
  const toLight = normalize(toKey)
  const irradiance = key.intensity.div(dot(toKey, toKey))
  const dotNL = dot(normal, toLight)
  const wrapped = clamp(dotNL.add(SCATTER_WRAP).div(1 + SCATTER_WRAP), float(0), float(1))
  const beyondLambert = wrapped.sub(clamp(dotNL, float(0), float(1)))
  const leak = clamp(dot(face, toLight), float(0), float(1)).mul(towardRim.mul(towardRim)).mul(SCATTER_EDGE_LEAK)
  const deep = body.mul(body).div(max(max(max(body.x, body.y), body.z), float(1e-3)))
  return deep.mul(irradiance).mul(beyondLambert.add(leak)).mul(weight.div(Math.PI))
}

// ── key sheen ──────────────────────────────────────────────────────────

/**
 * The key as a point light at its center, for the sheen three leaves out of
 * a RectAreaLight (PhysicalLightingModel.directRectArea at r186) and the
 * scatter three has no term for. View space. `intensity` is the light's
 * color times the point key's intensity, so the irradiance under it is
 * `studio.lightPower` in every rig. `radiantIntensity` is the same, but
 * black when the key is not the softbox, whose lights three already gives
 * sheen.
 */
export interface KeySheenUniforms {
  readonly position: UniformNode<'vec3', THREE.Vector3>
  readonly radiantIntensity: UniformNode<'color', THREE.Color>
  readonly intensity: UniformNode<'color', THREE.Color>
}

export function createKeySheenUniforms(): KeySheenUniforms {
  return { position: uniform(new THREE.Vector3()), radiantIntensity: uniform(new THREE.Color(0, 0, 0)), intensity: uniform(new THREE.Color(0, 0, 0)) }
}

/**
 * Charlie sheen from the key, as three's BRDF_Sheen evaluates it for a
 * point light: D after Estevez and Kulla 2017, visibility after Neubelt
 * and Pettineo 2013, with the same floor on sin²θh.
 */
export function keySheen(normal: Node<'vec3'>, key: KeySheenUniforms): Node<'vec3'> {
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
