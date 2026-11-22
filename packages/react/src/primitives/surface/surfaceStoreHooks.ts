// Surface store hooks — the React readers of one Surface's store: refresh,
// status, freeze, driver and motion. Each takes a handle or the enclosing
// Surface, and throws when it has neither.
import { useMemo, useSyncExternalStore } from 'react'
import { type SurfaceHandle } from './surfaceHandle'
import { type SurfaceStatus, type SurfaceViewDestination } from './surfaceStatus'
import { useSurfaceDriver as useSurfaceDriverBinding, useSurfaceStoreOf } from './useSurfaceDriver'
import { useSurfaceSupport } from './surfaceSupport'

function useRequiredSurfaceStore(hook: string, surface?: SurfaceHandle) {
  const store = useSurfaceStoreOf(surface)
  if (!store) throw new Error(`${hook} needs a Surface handle or an enclosing Surface.`)
  return store
}

/** Request fresh captures from the enclosing Surface, or from the given handle. */
export function useSurfaceRefresh(surface?: SurfaceHandle): () => void {
  return useRequiredSurfaceStore('useSurfaceRefresh', surface).refresh
}

export function useSurfaceStatus(surface?: SurfaceHandle): SurfaceStatus {
  const store = useRequiredSurfaceStore('useSurfaceStatus', surface)
  const browserSupported = useSurfaceSupport()
  const snapshot = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus)
  return useMemo(() => ({ ...snapshot, supported: browserSupported && snapshot.supported }), [snapshot, browserSupported])
}

/** Is the Surface's content frozen for the scene? The `onFreezeChange` signal, as React state. */
export function useFreezeSurface(surface?: SurfaceHandle): boolean {
  const store = useRequiredSurfaceStore('useFreezeSurface', surface)
  return useSyncExternalStore(store.subscribeFreeze, store.isFrozen, store.isFrozen)
}

export interface SurfaceDriverFrame { readonly dtMs: number; readonly progress: number; readonly target: SurfaceViewDestination }
export type SurfaceDriverStep = (frame: SurfaceDriverFrame) => number
export interface SurfaceMotionFrame { readonly dtMs:number; readonly position:number; readonly target:0|1; readonly scenePresented:boolean }

export function useSurfaceDriver(step: SurfaceDriverStep | null, surface?: SurfaceHandle) {
  useSurfaceDriverBinding(step === null ? null : frame => step({ ...frame, target: frame.target === 'canvas' ? 'scene' : 'page' }), surface)
}

export function useSurfaceMotion(step: (frame: SurfaceMotionFrame) => number, surface?: SurfaceHandle) {
  const store = useRequiredSurfaceStore('useSurfaceMotion', surface)
  useSurfaceDriver(frame => step({ dtMs:frame.dtMs, position:frame.progress, target:frame.target === 'scene' ? 1 : 0, scenePresented:store.getStatus().presentation === 'scene' }), surface)
  return useMemo(()=>({get:()=>store.motionProgress()}),[store])
}
