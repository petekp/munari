// Scene contribution — a Surface's scene children, handed to the canvas host.
//
// A mesh cannot exist in the DOM reconciler, so scene children declared under
// a Surface in a page tree register with the SurfaceCanvas host once its
// canvas has mounted. The host renders them inside the Canvas, wrapped in the
// Surface's contexts, which the two trees do not share.
//
// Ownership: the host owns where the children render; this component owns
// their registration and the Surface's declaration that it presents in a canvas.

import { use, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { SurfaceHandleContext, SurfacePartContext, SurfaceRootContext, SurfaceTunnelContext } from './surfaceContext'
import { SurfaceFinishContext } from './surfaceFinish'

export function SceneContribution({ scene }: { scene: ReactNode }) {
  const root = use(SurfaceRootContext)!
  const part = use(SurfacePartContext)
  const finish = use(SurfaceFinishContext)
  const mounted = useSyncExternalStore(root.store.subscribePresence, root.store.canvasMounted, () => false)
  const [key] = useState(() => `surface-content-${Math.random()}`)
  useLayoutEffect(() => root.store.declarePresentation('canvas'), [root.store])
  const identity = useMemo(() => ({ handle: root.handle, store: root.store }), [root.handle, root.store])
  const element = <SurfaceHandleContext value={identity}><SurfaceRootContext value={root}><SurfacePartContext value={part}><SurfaceFinishContext value={finish}><SurfaceTunnelContext value>{scene}</SurfaceTunnelContext></SurfaceFinishContext></SurfacePartContext></SurfaceRootContext></SurfaceHandleContext>
  useEffect(() => {
    if (!root.host || !mounted) return
    return root.host.registerPresenter({ key, element })
  })
  return null
}
