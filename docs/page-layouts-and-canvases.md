# Changing page layouts and renderer availability

Use `usePageTarget()` when the same content must return to different React layout
parents. Render `ref={target.ref}` on the current slot and pass `target` to
`Surface.HTML`; the content itself stays at one stable React position.
[Flight](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/flight/Flight.tsx) uses one target and Root per card.
Ordinary handoffs in a fixed slot need no target.
Keyed target lists can be prepended, reordered and removed without moving React's
own list anchors. Server-rendered targeted HTML hydrates the original node.

One unnamed canvas is the default. Multiple hosts use unique IDs and an explicit
`canvasId` association. Reusable client components can use React `useId`; independent
SSR roots need distinct matching `identifierPrefix` values during server render
and hydration, or document-unique authored IDs. A scene-side Surface belongs to
its enclosing canvas and rejects a conflicting association.

A missing/lost renderer keeps handoff HTML usable. Preparation waits stop claiming
renderer work when only missing input can unblock them. Development warns once
after ten seconds of an unresolved host or preparation episode, without changing
state or invoking `onError`. Declared but unrequested scenes remain quiet.
Unsupported media, custom elements, and external form associations remain native
with a reason until their retained-content behavior is supported.

Native pointer routing is opt-in on `Surface.Mesh` with `pointerRoute="auto"`.
It requires a known planar geometry and an interactive source. Multiple scene
poses sharing one source all use relay. `pointerEvents="none"` disables scene input
while page-owned preparation remains interactive.

`Surface.Mesh` has no `onClick`, because the gate swallows the browser click after
any press on a Surface. Use `onPointerUp`. `onDoubleClick` and `onContextMenu`
fire under the relay route.

## Meshes in front of a Surface

A visible scene mesh that is nearer the camera than a Surface takes the
pointer wherever it covers the Surface. The HTML behind it hears nothing at
those points. This holds in both pointer modes and on the native route
(`pointerRoute="auto"`), where the lifted canvas parks so the press goes to the
scene. The test is three's raycast against each
mesh's geometry, so a mesh covers exactly where a ray would hit it.

Some meshes never block:

- A mesh hidden by `visible={false}` on itself or on an ancestor.
- A mesh whose material has `visible: false`.
- A descendant of the Surface's own mesh, such as an overlay drawn as its child.
- A mesh at the Surface's own depth, such as a decal or a backing card.
- A mesh whose `raycast` does nothing.

Give a prop a no-op `raycast` to let the pointer through it. Shadows and glows
that lie in front of a Surface usually want this:

```tsx
import type * as THREE from 'three'

const NO_HIT: THREE.Object3D['raycast'] = () => {}

<mesh raycast={NO_HIT} geometry={shadowPlane} material={shadowMaterial} />
```

The test raycasts every visible mesh in the scene for each pointer event that
hits a Surface. In `surfaces` mode it also runs once a frame while the pointer
is over a Surface. Its cost grows with triangle count. In review notes, the
36,864-triangle teapot body accounts for most of the 3.8 to 4.2 ms per ray,
with no change in frame rate at 60 Hz.
[Review notes](https://github.com/petekp/munari/blob/main/apps/lab/src/scenes/review-notes/ReviewNotesTeapot.tsx)
wraps its notes around that teapot, and
[Flight](https://github.com/petekp/munari/blob/main/apps/lab/src/scenes/flight/FlightCardShadow.tsx)
gives its card shadow a no-op `raycast`.
