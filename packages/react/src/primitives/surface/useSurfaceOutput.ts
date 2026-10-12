// Compositor output — an explicit association between target pixels and their screen draw.
// A shader owns target inclusion; the binding checks the final draw boundary.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Mesh, type Material, type Object3D, type RenderTarget } from 'three'
import { useLatest } from '../useLatest'
import { useSurfaceHostContext } from './surfaceHostContext'
import { beginSurfaceOutputDraw, drawnByOverride, surfaceOutputDrawCompleted, type SurfaceOutputDraw } from './surfacePass'

export interface SurfaceOutputHandlers {
  readonly onBeforeRender: Object3D['onBeforeRender']
  readonly onAfterRender: Object3D['onAfterRender']
}

/**
 * Attach both handlers to the final compositor mesh inside SurfaceCanvas.
 * Its single authored material must include each target's captured draw in the output.
 * Preserve those pixels through intermediate passes. Shader overwrite, discard,
 * occlusion, and writes outside the renderer's observed draws remain caller-owned.
 */
export function useSurfaceOutput(targets: readonly RenderTarget[]): SurfaceOutputHandlers {
  const host = useSurfaceHostContext()
  if (!host) throw new Error('useSurfaceOutput belongs inside SurfaceCanvas.')
  const targetsRef = useLatest(targets)
  const pending = useRef<{ draw: SurfaceOutputDraw; mesh: Mesh; material: Material; targets: readonly RenderTarget[] } | null>(null)
  useLayoutEffect(() => () => { pending.current = null }, [host])
  const onBeforeRender = useCallback<Object3D['onBeforeRender']>(function (this: Object3D, renderer, scene, _camera, geometry, material) {
    pending.current = null
    if (!(this instanceof Mesh) || Array.isArray(this.material) || this.material !== material || drawnByOverride(scene, material) || !material.colorWrite || renderer.getRenderTarget() !== null) return
    pending.current = { draw: beginSurfaceOutputDraw(renderer, this, geometry), mesh: this, material, targets: [...targetsRef.current] }
  }, [targetsRef])
  const onAfterRender = useCallback<Object3D['onAfterRender']>(function (renderer, scene, _camera, _geometry, material) {
    const pass = pending.current
    pending.current = null
    if (!pass || pass.material !== material || pass.mesh.material !== material || drawnByOverride(scene, material) || !material.colorWrite || renderer.getRenderTarget() !== null || !surfaceOutputDrawCompleted(renderer, pass.draw)) return
    host.closeFrameTail(pass.targets)
  }, [host])
  return useMemo(() => ({ onBeforeRender, onAfterRender }), [onBeforeRender, onAfterRender])
}
