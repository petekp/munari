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

// Development only. A traversal per frame would cost a large scene every
// frame; a material added later is still named within a second.
export const GLSL_SCAN_INTERVAL_MS = 1000

// A GLSL material anywhere on the canvas, including drei's Text and
// MeshDistortMaterial, draws black or unpatched, and Three's log names only
// the material type.
export function reportGlslInScene(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    if (!('material' in object)) return
    const materials: unknown[] = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (!(material instanceof THREE.Material) || reportedGlslMaterials.has(material) || !usesGlsl(material)) continue
      reportedGlslMaterials.add(material)
      const label = object.name ? `"${object.name}"` : `a ${object.type}`
      console.error(
        `[munari] ${label} on a <SurfaceCanvas> uses a GLSL material (${material.type}), which ` +
          'WebGPURenderer cannot run, so it draws black or unpatched. Rebuild it as a TSL node material.',
      )
    }
  })
}
