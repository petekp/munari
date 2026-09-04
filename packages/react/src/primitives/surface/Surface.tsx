// The <Surface> compound — the root and the presentations that read it.
//
// Assembled here rather than in the barrel so the members are attached in
// one place and the type of `Surface` is the object callers actually see.
// A member is a plain component too: `Surface.Mesh` and `SurfaceMesh` are
// the same function, which is what makes them usable in a `React.lazy`, a
// `styled()` wrapper, or anywhere else a dotted name cannot go.

import { SurfaceRoot, type SurfaceProps } from './SurfaceRoot'
import { SurfaceAnchor } from './SurfaceAnchor'
import { SurfacePart } from './SurfacePart'
import { SurfaceDOM } from './SurfaceDOM'
import { SurfaceMesh } from './SurfaceMesh'
import { SurfaceScene } from './SurfaceScene'
import { SurfaceLitMaterial } from './surfaceMaterials'

export const Surface = Object.assign(
  (props: SurfaceProps) => <SurfaceRoot {...props} />,
  {
    Anchor: SurfaceAnchor,
    DOM: SurfaceDOM,
    Part: SurfacePart,
    Mesh: SurfaceMesh,
    Scene: SurfaceScene,
    LitMaterial: SurfaceLitMaterial,
  },
)
