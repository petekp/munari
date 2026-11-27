// Finish sheen — the key's Charlie sheen, which three leaves out of a
// RectAreaLight (finishKeyLight.ts), emitted by the finish itself.
//
// Its own chunk, loaded when a finish first uses sheen (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
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
} from 'three/tsl'

import type { KeySheenUniforms } from './finishKeyLight'

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
