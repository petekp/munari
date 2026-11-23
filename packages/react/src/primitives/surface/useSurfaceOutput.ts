// Compositor output — an explicit association between target pixels and their screen draw.
// A shader owns target inclusion; the binding checks the final draw boundary.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Mesh, type Material, type Object3D, type RenderTarget } from 'three'
import { useLatest } from '../useLatest'
import { useSurfaceHostContext } from './surfaceHostContext'
import { beginSurfacePass, drawnByOverride, geometryHasTriangle, type SurfaceObservedPass, type SurfaceOutputRenderer } from './surfacePass'

export interface SurfaceOutputHandlers {
  readonly onBeforeRender: Object3D['onBeforeRender']
  readonly onAfterRender: Object3D['onAfterRender']
}

/**
 * Attach both handlers to the final compositor mesh inside SurfaceCanvas, outside BundleGroup.
 * Its single authored material must include each target's captured draw in the output.
 * Preserve those pixels through intermediate passes. Shader overwrite, discard,
 * occlusion, and writes outside the renderer's observed draws remain caller-owned.
 */
export function useSurfaceOutput(targets: readonly RenderTarget[]): SurfaceOutputHandlers {
  const host = useSurfaceHostContext()
  if (!host) throw new Error('useSurfaceOutput belongs inside SurfaceCanvas.')
  const targetsRef = useLatest(targets)
  const reportedBundle = useRef(false)
  const pending = useRef<PendingOutput | null>(null)
  const settlePending = useCallback((): PendingOutput | null => {
    const pass = pending.current
    pending.current = null
    return pass
  }, [])
  useLayoutEffect(() => () => {
    const pass = settlePending()
    pass?.observed.finish(pass.renderer)
  }, [host, settlePending])
  const onBeforeRender = useCallback<Object3D['onBeforeRender']>(function (this: Object3D, renderer, scene, _camera, geometry, material) {
    const stale = settlePending()
    stale?.observed.finish(stale.renderer)
    if (!(this instanceof Mesh)) return
    // Cached BundleGroup executions omit mesh callbacks, so their recording draw
    // cannot establish a supported output boundary.
    for (let parent: Object3D | null = this.parent; parent; parent = parent.parent) {
      if ('isBundleGroup' in parent && parent.isBundleGroup === true) {
        if (!reportedBundle.current) {
          reportedBundle.current = true
          console.error('[munari] useSurfaceOutput cannot confirm a mesh inside BundleGroup. Move the final output mesh outside BundleGroup.')
        }
        return
      }
    }
    if (Array.isArray(this.material) || this.material !== material || drawnByOverride(scene, material) || !material.colorWrite || renderer.getRenderTarget() !== null) return
    pending.current = {
      observed: beginSurfacePass(renderer, scene, this, geometry, material),
      renderer,
      hasTriangle: geometryHasTriangle(geometry),
      mesh: this,
      material,
      targets: [...targetsRef.current],
    }
  }, [targetsRef, settlePending])
  const onAfterRender = useCallback<Object3D['onAfterRender']>(function (renderer, scene, _camera, _geometry, material) {
    const pass = settlePending()
    if (!pass) return
    const drew = pass.observed.finish(renderer).drawable
    const stillOutput = pass.material === material && pass.mesh.material === material && !drawnByOverride(scene, material) && material.colorWrite && renderer.getRenderTarget() === null
    if (stillOutput && pass.hasTriangle && drew) host.closeFrameTail(pass.targets)
  }, [host, settlePending])
  return useMemo(() => ({ onBeforeRender, onAfterRender }), [onBeforeRender, onAfterRender])
}

interface PendingOutput {
  readonly observed: SurfaceObservedPass
  readonly renderer: SurfaceOutputRenderer
  readonly hasTriangle: boolean
  readonly mesh: Mesh
  readonly material: Material
  readonly targets: readonly RenderTarget[]
}
