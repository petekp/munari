// Surface scene lookup — how page code names the components that draw in a canvas.
//
// The law: page code that runs before any canvas mounts imports no three
// renderer code. A Surface declared in a page tree still names its presenter,
// its lit material, its prewarm group and its anchor groups, which render only
// inside a canvas. The page side names them through this context, and
// SurfaceCanvas, which imports the scene modules statically, provides them.
//
// The fault, measured 2026-11-25 with Vite 8.2.0: Surface.tsx imported
// SurfaceMesh, SurfacePrewarm and surfaceMaterials statically, and each
// reaches three/webgpu. A bundler keeps a module in one chunk, so an app that
// loaded SurfaceCanvas with React.lazy still shipped the renderer on its first
// page: 529.0 kB gzip, against 531.6 kB for the app that loads everything at
// once (instruments/payload, `lazyCanvas`).
//
// Ownership: SurfaceCanvas provides the components; this module owns only the
// lookup. Outside a SurfaceCanvas the lookup loads the scene module itself and
// suspends until it arrives, so a presenter in a caller's own Canvas still
// renders, one module load later.

import { createContext, use } from 'react'
import type { SurfaceSceneComponents } from './surfaceSceneComponents'
import type { PresenterProps } from './SurfaceMesh'
import type { SurfaceLitMaterialProps } from './surfaceMaterials'
import type { SurfacePrewarmProps } from './SurfacePrewarm'
import type { SurfaceAnchorGroupProps } from './SurfaceAnchorGroup'

export const SurfaceSceneComponentsContext = createContext<SurfaceSceneComponents | null>(null)

let loading: Promise<SurfaceSceneComponents> | null = null

function useSurfaceSceneComponents(): SurfaceSceneComponents {
  const provided = use(SurfaceSceneComponentsContext)
  if (provided) return provided
  loading ??= import('./surfaceSceneComponents').then(module => module.surfaceSceneComponents)
  return use(loading)
}

export function ScenePresenter(props: PresenterProps) {
  const { Presenter } = useSurfaceSceneComponents()
  return <Presenter {...props} />
}

export function SceneLitMaterial(props: SurfaceLitMaterialProps) {
  const { LitMaterial } = useSurfaceSceneComponents()
  return <LitMaterial {...props} />
}

export function ScenePrewarm(props: SurfacePrewarmProps) {
  const { Prewarm } = useSurfaceSceneComponents()
  return <Prewarm {...props} />
}

export function SceneAnchorGroup(props: SurfaceAnchorGroupProps) {
  const { AnchorGroup } = useSurfaceSceneComponents()
  return <AnchorGroup {...props} />
}
