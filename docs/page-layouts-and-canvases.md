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

Only meshes block, and only where three draws them. These never block:

- A mesh hidden by `visible={false}` on itself or on an ancestor.
- A hit on a material, or a material group, with `visible: false`.
- A descendant of the Surface's own mesh, such as an overlay drawn as its child.
- A mesh within 0.01% of the Surface's distance along the ray, such as an
  exactly coplanar decal or backing card. A decal raised off the Surface blocks.
- A mesh on a layer that the canvas's R3F raycaster does not test.
- A mesh whose `raycast` does nothing. A group's no-op `raycast` does not
  cover its children, which still block; give each mesh its own.
- `Points`, `Line` and `Sprite` objects, so a sprite label in front of a
  Surface lets the pointer through.
- The back of a single-sided mesh, which three's raycast skips.

Opacity and `colorWrite` do not count. A fully transparent mesh blocks, which
makes it a hit proxy.

Give a prop a no-op `raycast` to let the pointer through it. Shadows and glows
that lie in front of a Surface usually want this:

```tsx
import type * as THREE from 'three'

const NO_HIT: THREE.Object3D['raycast'] = () => {}

<mesh raycast={NO_HIT} geometry={shadowPlane} material={shadowMaterial} />
```

The test raycasts every mesh that could block, out to the Surface's distance.
A mesh whose bounds lie beyond the Surface costs one bounding-sphere test. A
mesh whose bounds the ray crosses costs its triangle loop. One walk serves all
the pointer routes that ask along the same ray in the same R3F frame. While
the pointer is over a Surface, the test walks once per pointer event. It also
walks once per R3F frame in `surfaces` mode, on the native route, and for a
Surface that deforms. Under `frameloop="demand"`, a pointer at rest costs nothing
until the next frame. In review notes, the 36,864-triangle teapot body's bounds
enclose both notes. Each walk spends 4.3 to 5.3 ms on it. A pointer that
moves once a frame would cost about two walks, an estimate of 9 to 11 ms of
each 16.7 ms frame. Frame rate held
at 60 Hz in headless Chrome. By that estimate a 120 Hz budget of 8.3 ms would
be exceeded, which is unmeasured. Give a heavy mesh a no-op `raycast` and add a low-poly proxy that
blocks in its place.
[Review notes](https://github.com/petekp/munari/blob/main/apps/lab/src/scenes/review-notes/ReviewNotesTeapot.tsx)
wraps its notes around that teapot, and
[Flight](https://github.com/petekp/munari/blob/main/apps/lab/src/scenes/flight/FlightCardShadow.tsx)
gives its card shadow a no-op `raycast`.
