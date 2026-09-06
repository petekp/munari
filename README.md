# munari

**HTML, 3D, and Shaders, Unified.**

Munari lets React content appear in a Three.js scene while keeping its original
DOM and state. It captures the HTML, keeps its texture current, routes input,
and coordinates the handoff between page and scene. The project is named for the
Italian designer and artist Bruno Munari.

This README describes the development checkout. Build this checkout to use the
API below; check the guide included with an installed release for its API.
No package release is implied by these local changes.

## Requirements

React, Three.js, and React Three Fiber are peer dependencies. Enhanced rendering
uses Chrome's experimental HTML-in-canvas capability. Without it, handoff content
stays native and usable. `useSurfaceSupport()` reports capability after hydration;
`supportsSurfaces()` is the imperative check for an event handler.

## Install

For a released version:

```sh
npm install @petepetrash/munari three @react-three/fiber
```

For this development API, run `npm run build` in the checkout and install the
resulting `packages/react/dist` directory in your consumer. Import the stylesheet
once. The package leaves React, Three.js and R3F external as peers.

## Your first Surface

Put your existing HTML component inside `Surface`. Its `inScene` boolean requests
where it should appear. The component stays mounted once, so its local state and
uncontrolled inputs survive the round trip.

```tsx
import { useId, useState } from 'react'
import { Surface, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button style={{ width: 240, height: 100 }} onClick={() => setCount(count + 1)}>
      Count {count}
    </button>
  )
}

export function Example() {
  const canvas = useId()
  const supported = useSurfaceSupport()
  const [inScene, setInScene] = useState(false)
  return (
    <main style={{ position: 'relative', minHeight: 400, padding: 32 }}>
      {supported && <SurfaceCanvas
        id={canvas}
        pointerMode="surfaces"
        frameloop="demand"
        style={{ position: 'absolute', inset: 0 }}
      />}
      <Surface canvas={canvas} inScene={inScene}><Counter /></Surface>
      <button disabled={!supported} onClick={() => setInScene(value => !value)}>
        {inScene ? 'Return to page' : 'Show in scene'}
      </button>
    </main>
  )
}
```

`SurfaceCanvas` owns the R3F renderer, camera, and scene. `Surface` supplies a flat
mesh matching the HTML's page position. Switching alone preserves its appearance;
flight, deformation, lighting, and shader effects come from your scene code.
The [running starter](apps/lab/src/scenes/home/HomeStarter.tsx) uses this pattern.

## Add custom scene content

Use the explicit composition form when the effect needs its own meshes or logic:

```tsx
<Surface.Root inScene={selected} canvas="controls">
  <Surface.HTML><ControlBoard /></Surface.HTML>
  <Surface.Scene>
    <Surface.Mesh alpha="source" pointerRoute="auto">
      <ControlsHardware />
    </Surface.Mesh>
  </Surface.Scene>
</Surface.Root>

<SurfaceCanvas id="controls"><ControlsLights /></SurfaceCanvas>
```

`ControlBoard`, `ControlsHardware`, and `ControlsLights` are application components
in this example. The first draws HTML; the second supplies the physical controls
and their motion; the third supplies ordinary R3F lights. Munari's `Surface.Mesh`
draws the captured HTML and provides its texture, named anchors, and input mapping.
See the complete [Controls caller](apps/lab/src/scenes/controls/Controls.tsx).

`Surface.Scene` retains custom children through preparation, reversal, and return.
It contributes to the shared canvas rather than creating another renderer. Declare
it before it is requested. Shared cameras and lights belong under `SurfaceCanvas`.
Use `placement="manual"` and normal R3F geometry/transforms for scene-owned placement.
`group`, `mesh`, and `planeGeometry` are R3F's Three.js elements.

For several pieces of HTML that must transfer together, give each `Surface.HTML`
a distinct `part` name and select that part on its mesh. `sampledParts` records
additional sources sampled by a material. A manual pointer proxy cannot claim
those draw receipts. [Knobs](apps/lab/src/scenes/knobs/Knobs.tsx) and
[Logo](apps/lab/src/scenes/logo/Logo.tsx) show coordinated parts and anchors.

## HTML that belongs in a scene

```tsx
<SurfaceCanvas camera={{ position: [0, 0, 5] }}>
  <group position={[0, 0.5, 0]}>
    <SceneSurface size={[240, 80]}>
      <div style={{ width: 240, height: 80, background: 'white' }}>Scene label</div>
    </SceneSurface>
  </group>
</SurfaceCanvas>
```

Import `SceneSurface` from the package. `size` is the HTML's capture size in CSS
pixels. Its convenience mesh is one scene unit high and preserves that aspect
ratio; the surrounding group controls its position and scale. For custom materials,
geometry, or multiple parts, use `SceneSurface.Root`, `.HTML`, and `.Mesh`.
This form has no native page presentation to return to; supply an appropriate
fallback when the scene is essential to the experience.

## Capture an element that stays native

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
dimensions, and anchors, or `null` while unavailable. Paints wake the renderer
without causing a React render per frame. The texture is borrowed; consumers do
not dispose it.

The native element remains in place. Attach the ref to an element, `document.body`,
or `document.documentElement`; exclude unsupported content and the capture's own
preview when capturing a document. `CaptureContent` instead supplies separately
authored React children or a detached element to a `useCaptureHandle()` identity.
`CaptureContent` requires explicit dimensions for either input. [Selection](apps/lab/src/scenes/selection/Selection.tsx)
and [Veil](apps/lab/src/scenes/veil/Veil.tsx) are complete element-capture callers.

## Sharpness by default

The canvas uses the display's native pixel ratio, and capture density follows the
rendered size on each axis. Stationary, flat HTML meshes align their rendered pixels
to the display grid. Their animation state and DOM layout remain unchanged. Moving
or warped content keeps its continuous pose. Explicit `dpr` or `resolution` limits
remain available when you choose a rendering budget; large textures still obey the
4096-pixel edge limit.

## Observe and animate a Surface

| Read | Meaning |
|---|---|
| `useSurfaceStatus().requestedInScene` | The author's boolean intent, including fallback |
| `presentation` | Accepted `page` or `scene` hold; `null` if none exists |
| `sceneReady` | Required sources and preparation draws are ready |
| `isTransitioning` | The handoff is progressing or awaiting preparation |
| `supported`, `reason` | Capability/content support and an unavailable reason |
| `useSurfaceProgress().get()` | Raw 0..1 motion, identical to driver input |
| `useSurfaceProgress().eased()` | The explicitly eased version of that motion |

`onPresentationChange` uses `page | scene | null`; `onMotionComplete` and a driver's
string target use `page | scene`. `useSurfaceDriver(step, handle?)` supplies a raw
progress value. `useSurfaceMotion(step, handle?)` supplies `position`, a numeric
0/1 target, and `scenePresented`. The protocol still decides when the page releases.
Without a handle, these hooks read the nearest Surface identity.

`useSurfaceBeforeRender` belongs inside `Surface.Mesh`. It runs after pose writers
and world-matrix updates, before each render pass, with the actual camera and render
target. It may run several times per animation frame. Advance physics in the frame
step; update shadows or other companions here. `canvasMayDraw` permits the upcoming
draw and is separate from an accepted presentation receipt. The
[postcard](apps/lab/src/scenes/home/HomePostcard.tsx) demonstrates this boundary.

## Changing page layouts and renderer availability

Use `usePageTarget()` when the same content must return to different React layout
parents. Render `ref={target.ref}` on the current slot and pass `target` to
`Surface.HTML`; the content itself stays at one stable React position.
[Flight](apps/lab/src/scenes/flight/Flight.tsx) uses one target and Root per card.
Ordinary handoffs in a fixed slot need no target.

One unnamed canvas is the default. Multiple hosts use unique IDs and an explicit
`canvas` association. Reusable client components can use React `useId`; independent
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

## When enhanced rendering is unavailable

A `Surface` keeps its HTML native and preserves author intent. No scene-only
completion callback can finish a gesture that never entered the scene, so branch
inside actions with `supportsSurfaces()` and commit their ordinary HTML outcome.
Scene-only visuals need their own fallback. Keep the content-root sizing, paint,
mask, and hover rules in [authoring](docs/authoring.md).

## Run the lab locally

The repo uses Node 24 and npm 11. The local launcher starts Vite, opens an
isolated Chrome with `CanvasDrawElement` enabled, and stops the server when
you close that Chrome window:

```sh
npm ci
npm run lab
```

Set `CHROME_PATH` if Chrome is installed somewhere unusual. `npm run dev`
still starts only Vite for a browser that already has the flag enabled.

## Go further

- [All demo API examples](ALL-DEMO-API.md) show the same API across Flight,
  Controls, Knobs, Selection, Gallery and the other scenes.
- [Authoring rules](docs/authoring.md) describe the browser capture constraints.
- [Agent workflow](docs/agent-workflow.md) maps a change to its owner and check.
- `/advanced` exports frame sources, manual presentation receipts,
  `readSurfaceFrameState`, and capture inspection. These are for custom renderers.
- The tracked [Munari skill](.agents/skills/munari/SKILL.md) teaches this API to agents.

## Repo shape

| path | what it is |
| --- | --- |
| `packages/core` | the renderer-agnostic core; no dependencies, bundled into the package |
| `packages/react` | the `@petepetrash/munari` package: React/three components over core |
| `registry/` | source you copy into your project (nothing published) |
| `apps/lab` | the demo and development app |
| `instruments/` | browser probes and CI gates |
| `tests/conformance/` | the test suites that define core's behavior |

Dependencies point one way: apps depend on `packages/react`, which
depends on `packages/core`. `tests/boundary.test.ts` checks the actual
imports.

See `AGENTS.md` for the working rules, `docs/decisions.md` for the
numbered design decisions, `docs/platform.md` for what the platform is
measured to do,
`docs/authoring.md` for how to write markup a Surface can draw, and
`docs/focus.md` for the focus and spatial-navigation contract.

## Development

```sh
npm ci
npm run lab              # Vite + a compatible local Chrome
npm run dev              # Vite only
npm run check:origin-trial
npm run typecheck
npm test
npm run lint
npm run gate:idle-zero   # browser gate: idle Surfaces cost 0 paints/s
```

[package.json](package.json) lists available gate commands;
[the CI workflow](.github/workflows/ci.yml) selects the gates run on each push.
[The instrument guide](instruments/README.md) gives each check's scope and
limits. Run GPU gates in series. A capability skip is not a passing behavior
check; use `STRICT_CAPABILITY=1` where HTML-in-canvas must be present.

`npm run build` stages the package with core bundled in and peers left
external. The staged package includes the canonical root README, license,
changelog, `llms.txt`, and Munari skill. Inspect it, then publish from the
staged directory:

```sh
npm run build
npm pack --dry-run packages/react/dist
npm publish packages/react/dist
```
