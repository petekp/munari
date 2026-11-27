# @petepetrash/munari

**HTML, 3D, and Shaders, Unified.**

Munari lets React content appear in a Three.js scene while keeping its original
DOM and state. It captures the HTML, keeps its texture current as the user works
with it, routes input, and coordinates the handoff between page and scene. The
project is named for the Italian designer and artist Bruno Munari.

## Requirements

- **Peer dependencies:** `react` and `react-dom` 19 or later, `three` ~0.186.1,
  and `@react-three/fiber` ^9.8.1.
- **Optional peers:** `@types/three` ~0.186.0 for TypeScript, and
  `@zumer/snapdom` ^3.8.2 for the snapDOM capture engine.
- **Rendering:** `SurfaceCanvas` renders with Three's `WebGPURenderer`. Where a
  browser has no WebGPU adapter, it falls back to WebGL 2. Neither accepts GLSL,
  so `ShaderMaterial` and `onBeforeCompile` do not work. Neither do the drei
  helpers built on them, such as `Text`, `MeshDistortMaterial` and
  `MeshTransmissionMaterial`. In development, `SurfaceCanvas` logs which object
  uses one. Write custom materials as TSL node materials. See
  [Materials on a SurfaceCanvas](https://github.com/petekp/munari/blob/v0.5.0/docs/scene-content.md#materials-on-a-surfacecanvas).
- **Capture:** HTML-in-canvas is available by default in Chrome 157 and later,
  without a feature flag or origin trial token. See
  [Chrome's stable release announcement](https://developer.chrome.com/blog/html-in-canvas).
  Browsers without this API need snapDOM.
  In Safari, which has no `Element.moveBefore`, a handoff works but restarts a
  running CSS animation. The [capture engines](https://github.com/petekp/munari/blob/v0.5.0/docs/capture-engines.md) table compares
  the two.

Without a capture engine, handoff content stays native and usable, but it never
enters the scene. `useCaptureSupport()` reports capability after hydration;
`supportsCapture()` is the imperative check for an event handler.

## Install

```sh
npm install @petepetrash/munari @react-three/fiber
npm install three@0.186.1 --save-exact
```

Pin `three`. The peer range is `~0.186.1`, but npm rewrites `three@~0.186.1` to
`^0.186.1` in `package.json`, which accepts 0.187. Three changes its WebGPU API
between minor versions. Keep `~0.186.1` there by hand if you prefer a range.

In a TypeScript project, also install `@types/three`:

```sh
npm install --save-dev @types/three
```

Import the stylesheet once, as the example below does. A TypeScript project that
imports `style.css` needs a CSS module declaration, such as the one in
`vite/client` types. The package leaves React, Three.js and R3F external as peers.

A minimal app bundles to about 2 MB minified (about 550 to 640 kB gzip), mostly
`three/webgpu`, and Vite warns about the chunk size. Load the route that mounts
`SurfaceCanvas` with `React.lazy` or a dynamic `import()` to keep it off the
first page.

## Your first Surface

Put your existing HTML component inside `Surface`. Its `inScene` boolean requests
where it should appear. The component stays mounted once, so its local state and
uncontrolled inputs survive the round trip.

```tsx
import { useId, useState } from 'react'
import { Surface, SurfaceCanvas, useCaptureSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button type="button" style={{ width: 240, height: 100 }} onClick={() => setCount(count + 1)}>
      Count {count}
    </button>
  )
}

export function Example() {
  const canvasId = useId()
  const supported = useCaptureSupport()
  const [inScene, setInScene] = useState(false)
  return (
    <main style={{ position: 'relative', minHeight: 400, padding: 32 }}>
      {supported && <SurfaceCanvas
        id={canvasId}
        pointerMode="surfaces"
        frameloop="demand"
        style={{ position: 'absolute', inset: 0 }}
      />}
      <Surface canvasId={canvasId} inScene={inScene}><Counter /></Surface>
      <button type="button" disabled={!supported} onClick={() => setInScene(value => !value)}>
        {inScene ? 'Return to page' : 'Show in scene'}
      </button>
    </main>
  )
}
```

`SurfaceCanvas` owns the R3F renderer, camera, and scene. It fills its parent, so
give the parent a size; an auto-height parent leaves a 150 px canvas. `Surface`
supplies a flat mesh matching the HTML's page position. Switching alone preserves its appearance.
A `finish` gives the mesh a lit physical material. Flight, deformation and
shader effects come from your scene code.

### Give a Surface a finish

`finish` on `Surface` or `Surface.Root` is plain data, so it can be built on
the server. The canvas lights every finish with one key light, a rim light and
an environment. A finish with a `color` paints the body in the scene, and
Munari sets that color as `--munari-body` on the page copy. Give the content
`background: var(--munari-body)` so it shows the color on the page and stays
transparent in the capture. A finish's `pageLook` adds a CSS gradient and
shadow that stand in for the lighting until the scene is ready, as
`--munari-body-image` and `--munari-body-shadow`. You set the text color
in your own CSS.

```tsx
import { Surface, SurfaceCanvas, createSurfaceLight, type SurfaceFinish } from '@petepetrash/munari'

// Safe at module scope. `follow: 'pointer'` moves the key with the mouse.
const keyLight = createSurfaceLight({ follow: 'pointer' })

const lacquer: SurfaceFinish = {
  color: '#8c1022',
  roughness: 0.3,
  coat: { amount: 1, roughness: 0.02 },
}

<SurfaceCanvas id={canvasId} lighting={{ key: keyLight }} style={{ position: 'absolute', inset: 0 }} />
<Surface canvasId={canvasId} inScene={inScene} finish={lacquer}>
  <div style={{ background: 'var(--munari-body)', color: '#f5f2ee' }}>…</div>
</Surface>
```

`keyLight.set({ x, y })` moves the key in client CSS px without a React
render. Add `size: [width, height]` to make the key a softbox.
Under `lighting="none"` the canvas adds no lights, and finishes are lit by
your scene's own lights. The repository's `registry/finishes` folder holds 21 tuned
presets, such as lacquer, anodized aluminum, velvet, paper and glass, with a
suggested text color for each. Copy it into your project.

### If "Show in scene" stays disabled

No capture engine can run in this browser. The browser does not provide
HTML-in-canvas, and snapDOM has not been enabled. `useCaptureSupport()` is
`false`, so the example renders no canvas and the content stays on the page.
`useSurfaceStatus().reason` says so, and a Surface asked to enter the scene logs
the same sentence once in development. To enable capture:

- Use Chrome 157 or later, where HTML-in-canvas is available by default.
- Call [`enableSnapdomCapture()`](https://github.com/petekp/munari/blob/v0.5.0/docs/capture-engines.md), which also covers other
  browsers.

`canvasId` selects the `SurfaceCanvas` with a matching `id`. Omit `canvasId` when
using the unnamed default canvas. Several Surfaces can share the same canvas
while their HTML stays in different parts of the page.

## Guides

- [Capture engines](https://github.com/petekp/munari/blob/v0.5.0/docs/capture-engines.md) compares HTML-in-canvas with snapDOM and covers enabling snapDOM, refresh and `live`.
- [Custom scene content](https://github.com/petekp/munari/blob/v0.5.0/docs/scene-content.md) covers `Surface.Root`, custom materials, `Surface.Prewarm` and renderer settings.
- [Custom compositor output](https://github.com/petekp/munari/blob/v0.5.0/docs/compositor-output.md) covers confirming presentation when a compositor draws Surfaces into render targets.
- [HTML that belongs in a scene](https://github.com/petekp/munari/blob/v0.5.0/docs/scene-surface.md) covers `SceneSurface`.
- [Element capture](https://github.com/petekp/munari/blob/v0.5.0/docs/element-capture.md) covers `useElementCapture`, `CaptureContent` and `useCaptureTransition`, which capture an element that stays native, detached React children, and the state an update replaces.
- [Sharpness](https://github.com/petekp/munari/blob/v0.5.0/docs/sharpness.md) covers pixel ratio and capture density.
- [Observe and animate a Surface](https://github.com/petekp/munari/blob/v0.5.0/docs/observing-a-surface.md) covers status, progress, drivers and `useSurfaceBeforeRender`.
- [Page layouts and canvases](https://github.com/petekp/munari/blob/v0.5.0/docs/page-layouts-and-canvases.md) covers `usePageTarget()`, multiple canvases, pointer routing, and how a mesh in front of a Surface takes the pointer and how a prop lets it through.
- [When enhanced rendering is unavailable](https://github.com/petekp/munari/blob/v0.5.0/docs/native-fallback.md) covers the native fallback.
- [Next.js and server rendering](https://github.com/petekp/munari/blob/v0.5.0/docs/nextjs.md) covers client entries and `useCaptureSupport()` on the server.
- [Testing and troubleshooting](https://github.com/petekp/munari/blob/v0.5.0/docs/testing-and-troubleshooting.md) covers the inert copy in the DOM and known console output.
- [Authoring rules](https://github.com/petekp/munari/blob/v0.5.0/docs/authoring.md) describe the browser capture constraints.
- [Demo source map](https://github.com/petekp/munari/blob/v0.5.0/ALL-DEMO-API.md) links the implementations across Flight, Controls, Knobs, Selection, Gallery and the other scenes.
- [Agent workflow](https://github.com/petekp/munari/blob/v0.5.0/docs/agent-workflow.md) maps a change to its owner and check.
- `/advanced` exports frame sources, manual presentation receipts,
  `readSurfaceFrameState`, and capture inspection. These are for custom renderers.
- The tracked [Munari skill](https://github.com/petekp/munari/blob/v0.5.0/.agents/skills/munari/SKILL.md) teaches this API to agents.
- [Development](https://github.com/petekp/munari/blob/v0.5.0/docs/development.md) has the repo layout, the check commands and how to run the lab locally.
