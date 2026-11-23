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

The default does not block the pointer yet. In either pointer mode, a press on
a scene mesh in front of a Surface reaches the Surface's HTML behind it. A mesh
blocks only when its own handlers stop propagation:

```tsx
import type { ThreeEvent } from '@react-three/fiber'

const stop = (event: ThreeEvent<PointerEvent | MouseEvent>) => event.stopPropagation()
const blocksSurfaces = { onPointerDown: stop, onPointerUp: stop, onPointerMove: stop, onClick: stop }

<mesh {...blocksSurfaces} geometry={spout} material={porcelain} />
```

This works only on the relay route, which is the default. With
`pointerRoute="auto"`, the native route sends the pointer to a DOM layer above
the canvas, and R3F's propagation never runs. Keep a Surface on relay when a
mesh can cover it.
[Review notes](https://github.com/petekp/munari/blob/main/apps/lab/src/scenes/review-notes/ReviewNotesTeapot.tsx)
puts these handlers on the teapot in front of its notes.
