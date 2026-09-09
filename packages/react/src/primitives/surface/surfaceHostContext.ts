// Which Canvas host a subtree belongs to, for the trees that can see it.
//
// This context reaches two places, and they are on opposite sides of the
// R3F reconciler: the page tree between `<SurfaceCanvas>` and the Canvas,
// and — because R3F bridges parent context into its own root — the scene
// tree inside it. A scene-side Surface reads its host here, so `canvasId`
// is optional when the enclosing SurfaceCanvas already determines its host.
// A page-side `<Surface>` is usually NOT under a Canvas at all and resolves
// by name instead (`resolveSurfaceHost`).

import { createContext, use } from 'react'
import type { SurfaceHost } from './surfaceHostRegistry'

export const SurfaceHostContext = createContext<SurfaceHost | null>(null)

/** The enclosing Canvas host, or null in an ordinary page tree. */
export function useSurfaceHostContext(): SurfaceHost | null {
  return use(SurfaceHostContext)
}
