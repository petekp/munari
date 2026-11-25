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
// suspends until it arrives, so a presenter in a caller's own Canvas renders
// one module load later. A load that fails goes to the nearest error boundary.

import { createContext, use } from 'react'
import type { SurfaceSceneComponents } from './surfaceSceneComponents'
import type { PresenterProps } from './SurfaceMesh'
import type { SurfaceLitMaterialProps } from './surfaceMaterials'
import type { SurfacePrewarmProps } from './SurfacePrewarm'
import type { SurfaceAnchorGroupProps } from './SurfaceAnchorGroup'

export const SurfaceSceneComponentsContext = createContext<SurfaceSceneComponents | null>(null)

interface SceneModuleLoad {
  components: Promise<SurfaceSceneComponents>
  failed: boolean
}

export type SceneModuleLoader = () => Promise<SurfaceSceneComponents>

// React renders a component that threw once more, synchronously, before it
// hands the error to a boundary. A failed load cleared during the first of
// those renders started a new import in the second, so the fallback stayed up
// and an import that failed at once never let the main thread go
// (surfaceSceneLookup.test.tsx, 2026-11-25). Cleared after the task, the
// failure reaches the boundary and a later mount loads again.
export function createSceneModuleCache(loadModule: SceneModuleLoader) {
  let pendingLoad: SceneModuleLoad | null = null
  function startLoad(): SceneModuleLoad {
    const load: SceneModuleLoad = { components: loadModule(), failed: false }
    load.components.catch(() => {
      load.failed = true
    })
    return load
  }
  return function sceneComponentsLoad(): Promise<SurfaceSceneComponents> {
    pendingLoad ??= startLoad()
    const load = pendingLoad
    if (load.failed) {
      setTimeout(() => {
        if (pendingLoad === load) pendingLoad = null
      }, 0)
    }
    return load.components
  }
}

const loadedSceneComponents = createSceneModuleCache(() =>
  import('./surfaceSceneComponents').then(module => module.surfaceSceneComponents),
)

function useSurfaceSceneComponents(): SurfaceSceneComponents {
  return use(SurfaceSceneComponentsContext) ?? use(loadedSceneComponents())
}

export function ScenePresenter(props: PresenterProps) {
  const { Presenter } = useSurfaceSceneComponents()
  return <Presenter {...props} />
}

/**
 * A lit slab wearing the Surface's capture.
 *
 * Mounted in `<Surface.Mesh material={…}>`, where a configured texture is
 * guaranteed to already exist. The emissive term always carries the capture
 * so sliding `emissiveIntensity` is a uniform write rather than a rebuild —
 * at the default `0` it contributes nothing.
 */
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
