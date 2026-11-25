// Surface host scope — the contexts a SurfaceCanvas gives the page and scene trees.
//
// The host reaches both trees because R3F bridges parent context into its
// root. The scene components ride along: page-declared Surfaces name them
// through surfaceSceneLookup.tsx, and this is the module that imports them, so
// they load with the canvas rather than with the page.

import type { ReactNode } from 'react'
import { SurfaceHostContext } from './surfaceHostContext'
import type { SurfaceHost } from './surfaceHostRegistry'
import { SurfaceSceneComponentsContext } from './surfaceSceneLookup'
import { surfaceSceneComponents } from './surfaceSceneComponents'

export function SurfaceHostScope({ host, children }: { host: SurfaceHost; children: ReactNode }) {
  return (
    <SurfaceHostContext value={host}>
      <SurfaceSceneComponentsContext value={surfaceSceneComponents}>{children}</SurfaceSceneComponentsContext>
    </SurfaceHostContext>
  )
}
