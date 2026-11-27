// useSurfaceFinishMaterial — the finish material, for a custom material that
// bends or turns the finish's normal or changes its body color.
//
// The hook imports the finish code statically, so it ships with /advanced;
// a page that only sets `finish` on a Surface loads that code on demand
// (finishLoader.tsx). The canvas's rig still arrives with the deferred
// chunk, and the material holds its compile until it has.
//
// Ownership: this module gathers the hook's inputs; SurfaceFinishMaterial.tsx
// builds and writes the material.

import { useFinishSources } from './finishLoader'
import type { FinishPhysicalMaterial } from './finishLightingModel'
import { useFinishMaterial, type SurfaceFinishMaterialInputs } from './SurfaceFinishMaterial'

/**
 * The finish material for the Surface.Mesh this runs in, for a material
 * that bends or turns the finish's normal or changes its body color. Null
 * when neither `inputs.finish` nor the Surface names a finish.
 *
 * `normal` and `bodyColor` build the shader, so a new function builds a new
 * material: pass functions that keep their identity, defined at module scope
 * or memoized.
 */
export function useSurfaceFinishMaterial(inputs: SurfaceFinishMaterialInputs = {}): FinishPhysicalMaterial | null {
  return useFinishMaterial(useFinishSources('useSurfaceFinishMaterial()'), inputs)
}
