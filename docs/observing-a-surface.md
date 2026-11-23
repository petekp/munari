# Observe and animate a Surface

| Read | Meaning |
|---|---|
| `useSurfaceStatus().requestedInScene` | The author's boolean intent, including fallback |
| `presentation` | Accepted `page` or `scene` hold; `null` if none exists |
| `sceneReady` | Required sources and preparation draws are ready |
| `isTransitioning` | The handoff is progressing or awaiting preparation |
| `supported`, `reason` | Capability/content support and an unavailable reason |
| `engine` | `'html-in-canvas'` or `'snapdom'`; `null` when no engine can run |
| `useFreezeSurface()` | Content is frozen for the scene (any part without `live`, and every part on snapDOM); stop your own clocks |
| `useSurfaceProgress().get()` | Raw 0..1 motion, identical to driver input |
| `useSurfaceProgress().eased()` | The explicitly eased version of that motion |

When no engine can run, `supported` is `false` and `reason` reports that capture
is unavailable. See [Requirements](../README.md#requirements) for browser support and
[Capture engines](capture-engines.md) to enable snapDOM. That reason takes
precedence over a content reason such as inline handlers, which appears only
when the engine works.

`useSurfaceStatus()` without a handle reads the nearest enclosing Surface, so it
throws in the component that renders the `Surface`. That component creates the
handle and passes it down:

```tsx
import { Surface, useSurfaceHandle, useSurfaceStatus, useSurfaceTextureOf } from '@petepetrash/munari'

function Card({ inScene }: { inScene: boolean }) {
  const surface = useSurfaceHandle('card')
  const status = useSurfaceStatus(surface)
  const texture = useSurfaceTextureOf(surface)
  return (
    <>
      <Surface surface={surface} inScene={inScene}><CardContent /></Surface>
      <p>{status.supported ? `${status.presentation}, texture ${texture ? 'ready' : 'pending'}` : status.reason}</p>
    </>
  )
}
```

`useSurfaceHandle()` creates a new identity. It does not return the enclosing
Surface's, so call it once in the owner and pass the handle to `Surface`.
Children of the `Surface` can call the same hooks with no handle.

`onPresentationChange` uses `page | scene | null`; `onMotionComplete` and a driver's
string target use `page | scene`. `useSurfaceDriver(step, handle?)` supplies a raw
progress value. `useSurfaceMotion(step, handle?)` supplies `position`, a numeric
0/1 target, and `scenePresented`. The protocol still decides when the page releases.
Without a handle, these hooks read the nearest Surface identity.

`useSurfaceBeforeRender` belongs inside `Surface.Mesh`. It runs after pose writers
and world-matrix updates, before each render pass, with the actual camera and render
target. It may run several times per animation frame. Advance physics in the frame
step; update shadows or other companions here. `canvasMayDraw` permits the upcoming
draw and is separate from an accepted presentation receipt.
[Postcard](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/postcard/PostcardMesh.tsx) demonstrates this boundary.
