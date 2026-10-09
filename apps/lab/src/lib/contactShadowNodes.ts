// Contact shadow nodes — the three materials behind the lab's floor shadow:
// a depth fill seen from below the floor, a nine-tap blur, and the floor
// plane that shows the result.
//
// The law: these reproduce drei's ContactShadows, which cannot draw on a
// WebGPURenderer. Its depth material patches MeshDepthMaterial's GLSL and its
// blur is a GLSL ShaderMaterial, and the node builder rejects both. Measured
// 2026-10-09, Chrome 155, Three 0.186.1: the Workspace route logged
// 'Material "MeshDepthMaterial" is not compatible' three times and
// '"ShaderMaterial" is not compatible' twice.
//
// The depth fill and the blur keep their alpha by blending with NoBlending:
// an opaque NormalBlending node material writes alpha 1.
//
// Ownership: this module owns the graphs. ContactShadows owns the targets,
// the camera, and the frame loop.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { depth, float, texture, uniform, uv, vec2, vec4 } from 'three/tsl'
import { passMaterial } from '@petepetrash/munari/advanced'

/**
 * Colour darkens toward the floor and alpha fades with height, as drei's
 * depth material does. `depth` is 0 at the floor and 1 at the camera's far
 * plane.
 */
export function shadowDepthMaterial(color: THREE.ColorRepresentation): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: THREE.NoBlending })
  material.colorNode = vec4(uniform(new THREE.Color(color)).mul(depth).mul(2), float(1).sub(depth))
  return material
}

// three-stdlib's HorizontalBlurShader weights, which drei samples with.
const BLUR_WEIGHTS = [0.051, 0.0918, 0.12245, 0.1531, 0.1633, 0.1531, 0.12245, 0.0918, 0.051]

export interface ShadowBlur {
  readonly material: MeshBasicNodeMaterial
  /** The distance between taps, in uv units. */
  readonly step: { value: number }
}

/** One axis of the blur, reading `source` and drawn into another target. */
export function shadowBlurMaterial(source: THREE.Texture, axis: 'x' | 'y'): ShadowBlur {
  const step = uniform(0)
  const direction = axis === 'x' ? vec2(step, 0) : vec2(0, step)
  const taps = BLUR_WEIGHTS.map((weight, i) => texture(source, uv().add(direction.mul(i - 4))).mul(weight))
  const material = passMaterial({ blending: THREE.NoBlending })
  material.colorNode = taps.reduce((sum, tap) => sum.add(tap))
  return { material, step }
}

/**
 * The floor plane. drei mirrors its plane on y so a GL sample, which puts
 * v = 0 at the bottom of the image, lands right side up. A TSL sample puts
 * v = 0 at the top (passMaterial), so the plane samples at 1 - v.
 */
export function shadowPlaneMaterial(source: THREE.Texture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, opacity, depthWrite: false })
  material.colorNode = texture(source, uv().flipY())
  return material
}
