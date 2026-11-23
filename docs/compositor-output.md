# Custom compositor output

Direct draws confirm presentation automatically. When a compositor first draws
Surfaces into render targets, attach `useSurfaceOutput` from `/advanced` to its
final output mesh inside `SurfaceCanvas`:

```tsx
import { useSurfaceOutput } from '@petepetrash/munari/advanced'

const output = useSurfaceOutput([sceneTarget])
return <mesh {...output} material={compositeMaterial}>
  <planeGeometry args={[2, 2]} />
</mesh>
```

`sceneTarget` is the target containing the Surface draws. `compositeMaterial`
is your single TSL material that includes those draws in the final output.
Name every contributing source target for a multi-pass composition. Keep both
handlers attached to the final mesh. An unrelated screen render cannot confirm
their presentation. Keep source targets intact until output and use separate
intermediate targets for effects.

Keep the final output mesh outside `BundleGroup` on both backends. Three omits
mesh callbacks when it executes a cached bundle, so those draws cannot confirm
presentation. Other scene content may use bundles. On the first observed draw
inside a bundle, the hook rejects proof and logs the required placement once.
It cannot diagnose handlers attached after a bundle was already cached.

Color clears, including partial clears, invalidate earlier draws into a target.
Render intermediate passes before the final mesh; nested rendering inside its
material cannot provide attributable draw evidence. Your compositor still owns
shader inclusion, overwrite, discard, depth, and occlusion. The hook checks the
output draw and its declared sources; it does not inspect shader text or pixels.
