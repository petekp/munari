// <Surface.Scene> — a retained R3F contribution for one Surface.
//
// The scene boundary owns the lifetime of a caller's subtree. Its children
// stay mounted through a return and reclaim linger, then leave only after a
// frame can clear their last pixels.

import { use, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  SurfaceHandleContext,
  SurfaceRootContext,
  nextSurfaceInstanceId,
  type SurfaceRootValue,
} from './surfaceContext'
import { surfaceStoreOf, type SurfaceHandle, type SurfaceStore } from './surfaceHandle'
import { useSurfaceHostContext } from './surfaceHostContext'

export interface SurfaceSceneProps {
  /** The Surface whose canvas-side subtree this retains. */
  surface?: SurfaceHandle
  children?: React.ReactNode
}

export function SurfaceScene({ surface, children }: SurfaceSceneProps) {
  const parent = use(SurfaceRootContext)
  const host = useSurfaceHostContext()
  const store = surface ? surfaceStoreOf(surface) : parent?.store
  if (!store) {
    throw new Error('munari: <Surface.Scene> needs `surface={…}` or an enclosing <Surface>.')
  }
  if (!host) {
    throw new Error('munari: <Surface.Scene> must be rendered inside a <SurfaceCanvas>.')
  }
  const mounted = useCanvasPresence(store)
  useEffect(() => store.declarePresentation('canvas'), [store])
  const [instanceId] = useState(nextSurfaceInstanceId)
  const handleValue = useMemo(() => ({ handle: store.handle, store }), [store])
  const root = useMemo<SurfaceRootValue>(
    () => ({
      store,
      handle: store.handle,
      host,
      canvas: host.id,
      name: store.name,
      instanceId,
      wiring: 'canvas',
      exclusive: store.exclusive(),
      reportMeasuredSize: () => {},
      measuredSize: () => null,
      partRuntime: (id) => store.part(id)?.runtime ?? null,
    }),
    [store, host, instanceId],
  )
  return (
    <SurfaceHandleContext value={handleValue}>
      <SurfaceRootContext value={root}>{mounted ? children : null}</SurfaceRootContext>
    </SurfaceHandleContext>
  )
}

function useCanvasPresence(store: SurfaceStore): boolean {
  return useSyncExternalStore(
    useMemo(() => store.subscribePresence.bind(store), [store]),
    useMemo(() => store.canvasMounted.bind(store), [store]),
    useMemo(() => store.canvasMounted.bind(store), [store]),
  )
}
