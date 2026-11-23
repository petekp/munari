# Capture an element that stays native

```tsx
const capture = useElementCapture()
return (
  <>
    <article ref={capture.ref}>Native selectable content</article>
    <SurfaceCanvas><GlassEffect capture={capture} /></SurfaceCanvas>
  </>
)
```

Import `useElementCapture` from the package. `GlassEffect` is application scene
code: inside it, `useCaptureFrame(capture).get()` reads the latest painted texture,
dimensions, and anchors, or `null` while unavailable. A frame's `anchors` is
`null` when its anchors could not be matched to the captured snapshot. Paints
wake the renderer without causing a React render per frame. The texture is borrowed; consumers do
not dispose it.

The native element remains in place. Attach the ref to an element, `document.body`,
or `document.documentElement`; exclude unsupported content and the capture's own
preview when capturing a document. The copy is rebuilt when the user acts on the
element, when its layout, stylesheets, fonts or images change, and when a
transition ends. A change nobody made on it (data arriving, a store update, a
control elsewhere on the page) is not followed: call `capture.refresh()` from
whatever makes it, or pass `useElementCapture({ live: true })` to follow every
mutation and every running animation. `CaptureContent` instead supplies separately
authored React children or a detached element to a `useCaptureHandle()` identity.
`CaptureContent` requires explicit dimensions for either input. [Selection](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/selection/Selection.tsx)
and [Veil](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/veil/Veil.tsx) are complete element-capture callers.

`CaptureContent` children are HTML, so `CaptureContent` with children belongs
in the page tree. Inside `SurfaceCanvas` it throws. There, pass a built element
with `element` instead. For children, create the handle in a page component,
render `CaptureContent` there, and pass the handle to the scene component:

```tsx
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh, MeshBasicMaterial } from 'three'
import { CaptureContent, SurfaceCanvas, useCaptureFrame, useCaptureHandle, type CaptureHandle } from '@petepetrash/munari'

function CapturedPlane({ capture }: { capture: CaptureHandle }) {
  const frame = useCaptureFrame(capture)
  const mesh = useRef<Mesh>(null)
  const material = useRef<MeshBasicMaterial>(null)
  useFrame(() => {
    const current = frame.get()
    if (!current || !mesh.current || !material.current) return
    if (material.current.map !== current.texture) {
      material.current.map = current.texture
      material.current.needsUpdate = true
    }
    mesh.current.scale.x = current.width / current.height
    mesh.current.visible = true
  })
  return (
    <mesh ref={mesh} visible={false}>
      <planeGeometry />
      <meshBasicMaterial ref={material} />
    </mesh>
  )
}

export function Page() {
  const capture = useCaptureHandle()
  return (
    <>
      <CaptureContent capture={capture} size={[240, 80]}><p>Authored in React</p></CaptureContent>
      <div style={{ position: 'relative', height: 400 }}>
        <SurfaceCanvas><CapturedPlane capture={capture} /></SurfaceCanvas>
      </div>
    </>
  )
}
```

The plane is one unit high, and `width / height` gives its aspect. The texture
is premultiplied, so this stock material draws opaque content correctly and
translucent pixels too dark. See [Materials on a SurfaceCanvas](scene-content.md#materials-on-a-surfacecanvas).

## Run an update behind a capture

`useCaptureTransition` runs an app update behind a shader effect. The page keeps
the live content. The canvas draws a capture of the outgoing state over the target,
the update runs once that capture is on screen, and the live page shows when the
effect ends.

```tsx
const stamps = useCaptureTransition()

<SurfaceCanvas>
  <StampEffect transition={stamps} />
</SurfaceCanvas>
<button onClick={() => stamps.start(card, () => setCount(n => n + 1))}>Stamp</button>
```

`start(target, update)` runs each update once, in request order. With no effect
connected, under reduced motion, or for a target outside the document, the update
runs at once, so a browser without a capture engine needs no extra code. `finish()`
applies every waiting update and ends running effects. Call it before a state change
that must not wait, such as typing into the target. The update must be synchronous.
A capture of a translucent target shows the live update through it, so give the
target an opaque background. Every wait is bounded at 1 s (decision #77).

The effect component calls `useCaptureTransitionEffect` from
`@petepetrash/munari/advanced` inside a `SurfaceCanvas`. It is provisional and may
change in any release. It returns the `cover` props that the effect's mesh spreads. Pass it the same
transition handle on every render, because it binds the first handle it receives.
[Capture transitions](transition-api.md) describes the effect side, and
[Postcard](../apps/lab/src/scenes/postcard/PostcardStamp.tsx) and
[Distortion Wave](../apps/lab/src/scenes/distortion-wave/distortionWaveEffect.tsx)
are working effects.
