// Surface scene components — the canvas-side code a page-declared Surface draws with.
//
// SurfaceCanvas imports this module statically and provides it to every
// presenter it renders; page code reaches it only through
// surfaceSceneLookup.tsx, so it never ships with a page that has no canvas yet.

import { SurfacePresenter } from './SurfaceMesh'
import { SurfaceLitMaterial } from './surfaceMaterials'
import { SurfacePrewarm } from './SurfacePrewarm'
import { SurfaceAnchorGroup } from './SurfaceAnchorGroup'

export const surfaceSceneComponents = {
  Presenter: SurfacePresenter,
  LitMaterial: SurfaceLitMaterial,
  Prewarm: SurfacePrewarm,
  AnchorGroup: SurfaceAnchorGroup,
}

export type SurfaceSceneComponents = typeof surfaceSceneComponents
