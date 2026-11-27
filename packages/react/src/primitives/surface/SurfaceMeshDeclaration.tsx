// <Surface.Mesh> — where one scene presentation of an HTML source renders.
//
// Declared in a scene tree it renders the presenter where it stands. Declared
// in a page tree it renders nothing there and registers with the canvas host
// instead, because a mesh cannot exist in the DOM reconciler.
//
// This module imports no three code, so a page that declares a Surface loads
// none before a canvas mounts. The presenter that draws lives in
// SurfaceMesh.tsx and is reached through surfaceSceneLookup.tsx.
//
// Ownership: this component owns where its presenter renders and the
// Surface's declaration that it presents in a canvas. The presenter owns the
// mesh, its material, pointer relay, and presentation evidence.

import { use, useEffect, useMemo } from 'react'
import {
  DEFAULT_PART,
  SurfaceHandleContext,
  SurfacePartContext,
  SurfaceRootContext,
  SurfaceTunnelContext,
} from './surfaceContext'
import { SurfaceFinishContext } from './surfaceFinish'
import { surfaceStoreOf } from './surfaceHandle'
import { useCanvasPresence } from './SurfaceScene'
import { ScenePresenter } from './surfaceSceneLookup'
import type { SurfaceMeshProps } from './SurfaceMesh'

let declarationSeq = 0

/**
 * One presentation of a Surface.
 *
 * Declared in a scene tree it renders where it stands. Declared in a page
 * tree it renders NOTHING there and registers inward instead, because a
 * mesh cannot exist in the DOM reconciler — the host renders it inside the
 * Canvas, with the store and part passed as props rather than through a
 * context the two trees do not share.
 *
 * Outside a SurfaceCanvas its first render suspends until Munari's scene
 * module loads, so the caller's Canvas needs a Suspense boundary above it.
 */
export function SurfaceMesh({ surface, part, ...props }: SurfaceMeshProps) {
  const root = use(SurfaceRootContext)
  const inheritedPart = use(SurfacePartContext)
  const tunneled = use(SurfaceTunnelContext)
  // Carried through the tunnel, which passes on only what wraps the element.
  const finish = use(SurfaceFinishContext)
  const store = surface ? surfaceStoreOf(surface) : (root?.store ?? null)
  if (!store) {
    throw new Error(
      'munari: <Surface.Mesh> found no Surface. Put it inside a <Surface>, or ' +
        'pass the handle it presents as `surface={…}` for separated wiring.',
    )
  }
  const controllerActive = root?.store === store ? root.controllerActive : true
  const partId = part ?? inheritedPart?.id ?? DEFAULT_PART
  const registerKey = useMemo(() => `inward-${declarationSeq++}`, [])
  const host = root?.host ?? null
  const mounted = useCanvasPresence(store)
  const handleValue = useMemo(() => ({ handle: store.handle, store }), [store])
  useEffect(() => {
    if (controllerActive) return store.declarePresentation('canvas')
  }, [store, controllerActive])

  // A page-declared presentation is registered, not rendered. The element
  // is rebuilt on every render so prop changes reach the scene, and the
  // registry keys it stably so the host reconciles rather than remounts —
  // a remount here would drop the presenter's readiness proof and hang the
  // handoff it was in the middle of.
  const inward = root !== null && root.wiring === 'page' && !tunneled
  const element = (
    <SurfaceHandleContext value={handleValue}>
      <SurfaceFinishContext value={finish}>
        <SurfaceTunnelContext value>
          <ScenePresenter {...props} store={store} partId={partId} tunneled />
        </SurfaceTunnelContext>
      </SurfaceFinishContext>
    </SurfaceHandleContext>
  )
  useEffect(() => {
    if (!inward || !host || !mounted || !controllerActive) return
    return host.registerPresenter({ key: registerKey, element })
  })

  if (inward || !mounted || !controllerActive) return null
  return (
    <SurfaceHandleContext value={handleValue}>
      <ScenePresenter {...props} store={store} partId={partId} tunneled={tunneled} />
    </SurfaceHandleContext>
  )
}
