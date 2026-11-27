// Finish key light — the key evaluated as a point light at its center, for
// the lobes three leaves out of a RectAreaLight.
//
// three r186's directRectArea gives a softbox key no sheen and no subsurface
// term, so velvet's glow and wax's scatter would not move when the key
// moves. Both are added as emission (finishSheen.ts, finishScatter.ts). On m2
// (2026-11-26) dragging the key changed velvet's card pixels by a mean of
// sRGB 16 to 19, against 1.4 with the environment-lit sheen alone.
//
// Ownership: this module owns the key's uniforms, which every finish holds.
// The rig writes the key's position and intensity before each draw
// (finishRig.tsx).

import * as THREE from 'three'
import { type UniformNode } from 'three/webgpu'
import { uniform } from 'three/tsl'

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
