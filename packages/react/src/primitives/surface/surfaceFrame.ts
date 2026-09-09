// Companion updates run after pose changes and before the renderer draws the scene.
// React status is for UI; frame readers consult the Surface's current controller.
import { createContext, use, useLayoutEffect } from 'react'
import type { Camera, Mesh, Object3D, WebGLRenderTarget } from 'three'
import type { SurfacePartId } from '@munari/core'
import { surfaceStoreOf, type SurfaceHandle } from './surfaceHandle'
import { surfaceViewPresentation, type SurfaceViewPresentation } from './surfaceStatus'
import { useLatest } from '../useLatest'

export interface SurfaceFrameState {
  readonly requestedInScene: boolean
  readonly targetInScene: boolean
  readonly presentation: SurfaceViewPresentation
  /** Permission for this draw, distinct from a previously accepted presentation. */
  readonly canvasMayDraw: boolean
  readonly progress: number
}

export function readSurfaceFrameState(surface: SurfaceHandle): SurfaceFrameState {
  const store = surfaceStoreOf(surface)
  const state = store.getState()
  return { requestedInScene: store.authorRequestedInScene(), targetInScene: store.canPrepareCanvas() && state.requested === 'canvas', presentation: surfaceViewPresentation(state.presented), canvasMayDraw: store.canvasPresents(), progress: store.motionProgress() }
}

export interface SurfaceRenderFrame extends SurfaceFrameState {
  readonly mesh: Mesh
  readonly camera: Camera
  readonly canvas: HTMLCanvasElement
  readonly renderTarget: WebGLRenderTarget | null
  readonly part: SurfacePartId
  readonly time: number
}

type Listener = (frame: SurfaceRenderFrame) => void
export function createSurfaceFrameChannel() {
  const listeners = new Set<Listener>()
  const presence = new Set<() => void>()
  const changed = () => { for (const listener of presence) listener() }
  return {
    hasListeners: () => listeners.size > 0,
    subscribePresence(listener: () => void) { presence.add(listener); return () => { presence.delete(listener) } },
    subscribe(listener: Listener) {
      const first = listeners.size === 0
      listeners.add(listener)
      if (first) changed()
      return () => { if (listeners.delete(listener) && listeners.size === 0) changed() }
    },
    publish(frame: SurfaceRenderFrame) { for (const listener of [...listeners]) listener(frame) },
  }
}
export const SurfaceFrameContext = createContext<ReturnType<typeof createSurfaceFrameChannel> | null>(null)

/** Update a mesh's companions synchronously before its scene is drawn. */
export function useSurfaceBeforeRender(callback: (frame: SurfaceRenderFrame) => void) {
  const channel = use(SurfaceFrameContext)
  if (!channel) throw new Error('useSurfaceBeforeRender belongs inside Surface.Mesh.')
  const callbackRef = useLatest(callback)
  useLayoutEffect(() => channel.subscribe(frame => callbackRef.current(frame)), [channel, callbackRef])
}

/** Render-pass membership follows the live Three tree, including explicit portals. */
export function surfaceBelongsToScene(mesh: Mesh, scene: Object3D): boolean {
  let node: Object3D | null = mesh
  while (node) {
    if (node === scene) return true
    node = node.parent
  }
  return false
}
