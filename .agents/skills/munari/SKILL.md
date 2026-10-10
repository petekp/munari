---
name: munari
description: Build and review React interactions that combine retained HTML, Three.js scenes, and shaders with Munari.
---

# Munari

Use the smallest public API that owns the requested renderer relationship.
Munari's tagline is "HTML, 3D, and Shaders, Unified."

## Establish the source revision

Read the consumer's installed README/types or this checkout's README and
`docs/agent-workflow.md`. Superseded proposals remain in Git history; the
README and exports define current usage. The development checkout may be newer than a released
package. Read `docs/authoring.md` before writing captured markup.

Import only `@petepetrash/munari`, `@petepetrash/munari/advanced`,
`@petepetrash/munari/snapdom` and `@petepetrash/munari/style.css`. A missing
export is a package concern, not a reason to reach into private source files.
Peers are `react` and `react-dom` 19, `three` ~0.186.1 and
`@react-three/fiber` ^9.8.1. A TypeScript project needs `@types/three`
~0.186.0; without it `tsc` fails inside Munari's own types. `@zumer/snapdom` is
optional. npm saves `three@~0.186.1` as `^0.186.1`, so restore the tilde in
`package.json`.

## Starter

```tsx
import { useState } from 'react'
import { Surface, SurfaceCanvas } from '@petepetrash/munari'
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'
import '@petepetrash/munari/style.css'

enableSnapdomCapture() // snapDOM where Chrome's flag is off; needs @zumer/snapdom

function Card() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ width: 320, height: 200, background: '#fff', color: '#111' }}>
      <button onClick={() => setCount(count + 1)}>Count {count}</button>
      <input placeholder="type here" />
    </div>
  )
}

export function App() {
  const [inScene, setInScene] = useState(false)
  return (
    <>
      <button style={{ position: 'fixed', top: 8, right: 8, zIndex: 30 }} onClick={() => setInScene(v => !v)}>
        {inScene ? 'Return to page' : 'Show in scene'}
      </button>
      <Surface inScene={inScene}><Card /></Surface>
      <SurfaceCanvas pointerMode="surfaces" style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
    </>
  )
}
```

The card keeps its count and input value across the toggle. Give the content
root a fixed size. Without `enableSnapdomCapture()`, run Chrome with
`--enable-features=CanvasDrawElement` or serve an HTML-in-canvas origin trial
token.

With no usable engine, `useSurfaceStatus()` returns `supported: false`,
`engine: null` and a `reason` that names the flag, the trial and
`enableSnapdomCapture()`. In development a `Surface` that is asked for the scene
logs the same sentence once with a `[munari] ` prefix. The content stays native.
`engine` is `'html-in-canvas'` or `'snapdom'` when one can run.

`style.css` ships one rule: children of `.ui-layer`, the portal container of a
floating Surface, take pointer events. The rest is a contract for your CSS. A
captured tree lives in a `.ui-root` container instead of `<body>`, so put
body-level background, color and font rules on `.ui-root` as well. A hit test
never reaches the captured tree, so every `:hover` and `:active` rule must also
match `[data-hover]` and `[data-active]`. Exclude `[data-pointer-focus]` from
`:focus-visible` rules.

## Renderer and materials

`SurfaceCanvas` renders with Three's `WebGPURenderer`. It falls back to WebGL 2
where the browser has no WebGPU adapter. Neither accepts GLSL, so do not write
`ShaderMaterial` or `onBeforeCompile`. Write custom materials as TSL node
materials.

- A translucent material sets `premultipliedAlpha: true`.
- A custom `outputNode` returns its color through `premultipliedOutput`
  (premultiplied linear color) or `encodedOutput` (premultiplied sRGB color),
  both from `@petepetrash/munari`.
- `gl` takes `WebGPURendererParameters` without `canvas`. Set
  `gl={{ antialias: false, depth: false }}` when the canvas needs neither.

## Capture engines

HTML-in-canvas is the default. For other browsers, install `@zumer/snapdom` and
call `enableSnapdomCapture()` from `@petepetrash/munari/snapdom` once, before
the first `Surface` mounts. Pass `{ always: true }` to force snapDOM.

Pass `live` to `Surface` or `CaptureContent` when the content changes on its
own: an animation, a clock, a video, data that arrives after mount. On snapDOM,
a Surface re-captures after the user's input by default, and after changes
nobody made only when it is `live`.

## Choose the relationship

- `<Surface inScene={boolean}>` contains one existing HTML/React component.
  Its local state, uncontrolled values, focus, and selection stay on that instance.
  The supplied flat mesh matches the page; motion and visual effects remain
  application code. Inside a Surface, `Surface.Mesh` defaults to
  `placement="match-dom"`: a unit plane one world unit in front of the camera,
  sized to the page rect. A transformed parent `<group>` moves it relative to that
  camera, not the page, and can put it behind the camera, where it vanishes with
  no warning while status reports `presentation: 'scene'`. To pose the mesh
  yourself, pass `placement="manual"`. The default geometry is a 1 by 1 plane, so
  pass `geometry={<planeGeometry args={[width, height]} />}` for CSS-pixel
  units, and use `cameraDistance(viewportHeight, fov)` from `/advanced` for a
  camera where one world unit is one CSS pixel at z = 0. Written inside a scene
  (`Surface.Scene`, `SceneSurface`), a mesh defaults to `manual`.
- For custom scenes, use `Surface.Root`, `Surface.HTML`, `Surface.Scene`, and
  `Surface.Mesh`. HTML parts have distinct names. Meshes select a part and can
  use named `Surface.Anchor` boxes from its painted generation.
- `SceneSurface` draws HTML that belongs in the scene. Its explicit `size` is
  CSS pixels; the convenience mesh is one world unit high with the same aspect
  ratio. Use its `.Root`, `.HTML`, and `.Mesh` form for custom scene geometry.
- `useElementCapture()` returns a callback ref and frame identity for native HTML
  that stays in place. It can capture an element, body, or html with appropriate
  exclusions. Its copy follows the user's input, layout, fonts and `refresh()`;
  pass `live` to follow every mutation and running animation. `CaptureContent` supplies separate React children or a detached
  element to a capture handle. It requires explicit dimensions.
- `SurfaceCanvas` owns the renderer, camera, lights and surrounding R3F scene.
  Keep it mounted while needed. `pointerMode` defaults to `"scene"`, which
  takes pointer input over the whole canvas, so a full-viewport canvas blocks the
  page. Use `"surfaces"` for an overlay: the canvas is transparent to the pointer
  except over Surface meshes, which also cover page controls beneath them. Use
  demand rendering when the application has no ongoing animation. Flight must
  keep frames through its own physics even after the handoff settles.

One unnamed canvas is the default. Use `canvasId` on `Surface`, `Surface.Root`, or
`SceneSurface.Root` to select a named `SurfaceCanvas`; the host keeps its `id` prop.
Several hosts need distinct IDs and explicit page associations. Reusable client
components can use `useId`; independent SSR
roots require distinct matching `identifierPrefix` values or document-unique IDs.
A scene-side Surface belongs to its enclosing canvas and rejects conflicting IDs.

Use `usePageTarget` or `createPageTarget` when a retained component returns to
changing React layout parents. Keep its Root at a stable React position; attach
the target ref to the current page slot. A normal fixed-slot handoff needs none.

## Read intent, hold and motion separately

`useSurfaceStatus(handle?)` reports author `requestedInScene`, accepted
`presentation` (`page`, `scene`, or null), `sceneReady`, `isTransitioning`, and
`supported`/`reason`. Callbacks use the same presentation vocabulary; motion
completion and string driver targets use page or scene.

`useSurfaceProgress().get()` and driver inputs are raw 0..1 motion. `.eased()`
is explicitly curved. `useSurfaceDriver(step, handle?)` returns the wanted raw
progress; `useSurfaceMotion(step, handle?)` uses position and a numeric 0/1 target.
The protocol still owns preparation, the actual presentation draw, and release.
Hooks without a handle read the nearest Surface identity across the renderer trees.

`useSurfaceBeforeRender` belongs inside a Mesh. After frame pose writers and
world-matrix updates, it reports the actual draw camera and render target. It
can run several times in one animation frame. Advance physics in the frame step;
update companions in this callback. `canvasMayDraw` is permission for that pass,
not an accepted presentation receipt. Put shared cameras/lights at canvas scope.

An always-declared `Surface.Scene` retains its children through preparation,
reversal, return and cleanup. It does not retain a caller-owned host. A missing
host or preparation input waits without perpetual renderer claims; development
warns once after ten seconds without changing state or calling onError. A
scene declared before its first request is valid and stays quiet.

## Input and paint contracts

- Ordinary handoff HTML stays native when capture is unavailable. Branch inside
  scene-dependent actions with `supportsSurfaces()` so their native outcomes
  still finish. A SceneSurface needs its own native fallback when necessary.
- Page-owned preparation leaves the live instance on the page and captures a copy.
  It borrows the instance through a native rig only when focus is inside the
  content or a selection intersects it. An inert clone then reserves layout.
- The default `pointerRoute="relay"` forwards synthetic events: clicks, typing
  and hover reach the DOM, and the `Surface.Mesh` `onPointer*` props fire.
  `Surface.Mesh` has no `onClick` because the browser click after a press on a
  Surface is swallowed; use `onPointerUp`. `onDoubleClick` and `onContextMenu`
  fire. `pointerRoute="auto"` lets the browser hit-test the drawn element for
  trusted events and real caret and selection, but the mesh `onPointer*` props do
  not fire. snapDOM always relays. Multiple interactive poses of one source all
  use relay. Unknown/replaced/deformed geometry and authored raycasts use relay.
  Disabled or inert scene sources take no input.
- While a Surface is in the scene, the page can still hold an `inert`,
  `aria-hidden` copy of its content that reserves layout and keeps the state it
  had at the lift. The live instance is parked in the canvas host. In tests and
  queries, use the copy that is not inside `[inert]`.
- Keep the content root sized by its layout; animate inner wrappers, not root
  opacity/transform. Do not use CSS mask-image inside captured content. Provide
  hover/active attribute twins. Read the full authoring constraints.
- Frame dimensions, texture and anchors belong to the same paint generation.
  Captured textures are borrowed; their owner disposes them after all usage ends.
- Canvas and capture resolution follow native display density by default, including
  display and zoom changes. Explicit resolution limits trade quality for cost.
  Stationary flat meshes use the pixel-grid correction at draw time; read their
  rendered matrix in companion callbacks and leave physics transforms continuous.
- A manual mesh supplies a proxy. `/advanced` manual presentation must register
  required parts and report actual eligible draws. `sampledParts` belongs on
  the mesh that samples and draws those sources, never on an invisible proxy.

## Verify the behavior

In a source checkout, follow `AGENTS.md` for test layout and retention rules.
Run the relevant behavioral tests, four typechecks, lint and package build.
Browser checks are serial. Select the gate that measures the affected behavior;
require actual enhanced capability and test a separate no-flag profile.
A zero-exit skip is not a pass. Inspect real pixels and input alongside status.
Use native display density in visible Chrome checks. Run explicit lower/higher DPR
comparisons headlessly, and use `probe:sharpness` for a measured native-HTML reference.

`instruments/api-all-demos/README.md` lists the hardening probes and their bounded
cost/pixel budgets. Measurements belong in runnable instruments and decisions;
changing a law changes its contract in the same commit. Preserve unrelated work
and the repository's explicit CI/deployment/scope approval rules.
