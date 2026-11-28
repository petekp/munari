// Lazy WebGPU engine bundle — groups pipeline compilation, geometry buffers,
// material manifest drivers, pointer raycasting, and hover bridging behind a
// single `import('./gpuEngine')` split in `SurfaceCanvas`.
//
// The law: fallback/SSR and initial page-only renders never parse or execute
// WebGPU shader/raycast/pointer-forwarder code until `navigator.gpu` exists
// and a canvas initializes.
//
// Ownership: `@petepetrash/munari/gpu`.

import type { SurfaceFinish } from '../primitives/surface/surfaceFinish'
import { createManifestMaterial, unlitSurfaceManifest } from './manifest'
import { isFinishMaterial, isManifestMaterial, type FinishModule } from './surfaceDom'
import type { GpuMaterial, GpuMaterialFactory, GpuRenderer } from './webgpu'

export { createManifestDriver } from './manifest'
export { bridgeHoverAtLastPointer, installPointerGate } from './gpuPointerGate'
export {
  createGpuRenderer,
  createGpuSurfaceTexture,
  createPlaneGeometry,
  deformGpuGeometry,
  resolveFrameContext,
  resolveKeyPos,
} from './webgpu'

export interface ActiveMaterialSlot {
  readonly isFinish: boolean
  readonly factory: GpuMaterialFactory | undefined
}

export interface SyncedMaterialSlot {
  readonly mat: GpuMaterial | null
  readonly active: ActiveMaterialSlot | null
}

/** Builds a finish, custom factory, or default unlit WebGPU material for one Surface. */
export function buildSurfaceMaterial(
  renderer: GpuRenderer,
  finish: SurfaceFinish | undefined,
  finishMod: FinishModule | null,
  factory: GpuMaterialFactory | undefined,
  invalidate: () => void,
): GpuMaterial | null {
  if (finish) {
    return finishMod ? finishMod.createGpuFinishMaterial(renderer, finish, invalidate) : null
  }
  if (factory) return factory.create(renderer)
  return createManifestMaterial(renderer, unlitSurfaceManifest)
}

/** Reconciles a Surface's material slot on prop/finish/uniform changes without leaking pipelines. */
export function syncSurfaceMaterialSlot<TUniforms>(params: {
  readonly renderer: GpuRenderer
  readonly curMat: GpuMaterial | null
  readonly active: ActiveMaterialSlot | null
  readonly finish: SurfaceFinish | undefined
  readonly finishMod: FinishModule | null
  readonly effectiveFactory: GpuMaterialFactory | undefined
  readonly uniforms: TUniforms | undefined
  readonly invalidate: () => void
}): SyncedMaterialSlot {
  const { renderer, curMat, active, finish, finishMod, effectiveFactory, uniforms, invalidate } = params
  const isFin = Boolean(finish)
  const kindChanged =
    !curMat || !active || active.isFinish !== isFin || (!isFin && active.factory !== effectiveFactory)
  if (!kindChanged && curMat) {
    if (finish && isFinishMaterial(curMat)) {
      curMat.updateFinish(finish)
    } else if (!isFin && uniforms !== undefined && isManifestMaterial<TUniforms>(curMat)) {
      curMat.setUniforms(uniforms)
    }
    invalidate()
    return { mat: curMat, active }
  }
  curMat?.dispose()
  const nextMat = buildSurfaceMaterial(renderer, finish, finishMod, effectiveFactory, invalidate)
  const nextActive: ActiveMaterialSlot | null = nextMat
    ? { isFinish: isFin, factory: effectiveFactory }
    : null
  if (nextMat) {
    if (uniforms !== undefined && isManifestMaterial<TUniforms>(nextMat)) nextMat.setUniforms(uniforms)
    void nextMat.ready.then(invalidate, () => {})
  }
  invalidate()
  return { mat: nextMat, active: nextActive }
}

export type GpuEngine = typeof import('./gpuEngine')
