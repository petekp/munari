// GLSL materials — the ones WebGPURenderer cannot run.
//
// Three draws a ShaderMaterial black and ignores onBeforeCompile, and logs
// only the material type, far from the object that caused it. Both
// SurfaceCanvas and the Surface.Mesh slot report one, and this set keeps a
// material from being reported twice.

import * as THREE from 'three'

export function usesGlsl(material: THREE.Material): boolean {
  return (
    material instanceof THREE.ShaderMaterial ||
    material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
  )
}

export const reportedGlslMaterials = new WeakSet<THREE.Material>()
