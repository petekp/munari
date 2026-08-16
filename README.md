# munari

Live DOM as physical matter in WebGL.

Bruno Munari mounted gauze, torn film, and scraps of plastic in slide
frames and threw them across a wall. He called them *proiezioni
dirette*, direct projections: the material itself, enlarged by light.
This library does that to the browser. The real DOM (layout, focus,
accessibility, text you can select) stays the source of truth, and a
WebGL scene carries its pixels. At the calibrated vantage (1 world
unit = 1 CSS pixel on the rest plane) the page resolves exactly;
everywhere else it is paper you can bend, throw, and crumple.

**Status: pre-release.** Core covers coordinate mapping, DOM capture,
pointer forwarding, the page↔scene handoff, chrome measurement, and
physics; each area has a suite in `tests/conformance/` and a lab scene
that exercises it. The public API is not frozen: the package
re-exports all of core today, and we will narrow that surface before
1.0.

## Requirements

The library is built on Chrome's **HTML-in-canvas origin trial**
(`drawElementImage`). Without that capability a Surface has nothing to
rasterize; there is no fallback path. Chrome needs
`--enable-features=CanvasDrawElement`, or a registered origin-trial
token.

`three` and `@react-three/fiber` are **peer dependencies**. three uses
`instanceof` internally; two copies in one dependency graph fail
without an error. Your app owns the single copy.

## Install

```sh
npm install @petepetrash/munari three @react-three/fiber
```

A `Surface` is one mesh whose material is a live DOM subtree. Hand it
markup for something static:

```tsx
import { Canvas } from '@react-three/fiber'
import { Surface } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

export function App() {
  return (
    <Canvas>
      <Surface
        width={400}
        height={300}
        html={`
          <div style="width:400px;height:300px">
            <h1>ordinary DOM</h1>
            <input placeholder="really, type in it" />
          </div>
        `}
      />
    </Canvas>
  )
}
```

…or `SurfaceApp` to hand it a React tree, rendered by a second React
root into the same live subtree:

```tsx
<SurfaceApp width={400} height={300} content={<Panel />} />
```

A caller-owned canvas can bypass DOM capture. Its frame number crosses the
renderer with the pixels. A handoff can wait for both the named upload and an
eligible visible presentation:

```tsx
import {
  createCanvasFrameSource,
  presentationReceiptSatisfies,
  type PresentationRequirement,
} from '@petepetrash/munari'

function FrameExample({ canvas }: { canvas: HTMLCanvasElement }) {
  const [frames] = useState(() =>
    createCanvasFrameSource(canvas, { premultiplyAlpha: false }),
  )
  const [presentation, setPresentation] = useState<PresentationRequirement>()
  const nextTransferId = useRef(0)
  const nextPresentationRevision = useRef(0)

  function publishFrame() {
    // Finish every canvas write before publishing it.
    drawNextFrame(canvas)
    setPresentation({
      transferId: ++nextTransferId.current,
      frame: frames.publish(),
      presentationRevision: ++nextPresentationRevision.current,
    })
  }

  return <>
    <button onClick={publishFrame}>draw next frame</button>
    <Canvas>
      <Surface
        frame={frames}
        width={400}
        height={300}
        presentation={presentation}
        onPresented={(receipt) => {
          if (presentation && presentationReceiptSatisfies(presentation, receipt)) {
            setPresentation(undefined)
            releasePreviousOwner()
          }
        }}
      >
        <planeGeometry args={[400, 300]} />
      </Surface>
    </Canvas>
  </>
}
```

The frame path uses an unlit, non-tone-mapped material by default, so scene
lighting does not change its color. Choose `material="standard"` only when
you want lighting.

The canvas stays with its caller. `publish()` means new pixels are ready; it
does not mean they were drawn. `onFrameDrawn` proves that the target mesh used
the named upload in a renderer pass. It fires for an off-screen or
color-disabled pass too. `onPresented` adds the exact transfer and
presentation revision and accepts only a color-writing draw to the default
framebuffer. Several publications can merge before one render, so receipts
name only the latest frame that was uploaded. A hidden or culled mesh cannot
send a receipt.

The reverse handoff has a different boundary. Prepare the native presenter
first, then call `commitRendererReleaseFrame` from `useFrame`. Its
`commitIncoming` callback gives the native presenter any translucent layers;
the helper suppresses the outgoing object in the same renderer turn and calls
`publishRelease` after that render stack. React state should publish the durable
handoff from `publishRelease`, not from an Effect.

For every premultiplied frame source, use `material="none"` and a custom
material. This also applies when the mesh does not blend: pixels with partial
alpha still contain alpha-weighted RGB. Do not multiply RGB by alpha again.
Apply masks and fades to the full `vec4`, then blend with `ONE` and
`ONE_MINUS_SRC_ALPHA` when transparency is visible.

`useSurfaceTexture()` returns null until the frame runtime exists. Replace
or update your custom material's sampler when the hook returns the texture;
do not leave Three bound to the first null uniform.

For DOM-backed Surfaces, the content root must declare its own pixel size:
Chrome rasterizes the element at its own layout box, and a container with
nothing in flow to size it measures zero and draws an empty rectangle, with
clean paints and no error.

The stylesheet is required plumbing; its header comment lists what it
expects from your CSS.

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
npm install
npm run dev          # the lab
npm run typecheck
npm test
npm run lint
npm run gate:idle-zero   # browser gate: idle Surfaces cost 0 paints/s
```

Eight browser gates exist. CI runs five on every push (`gate:idle-zero`,
`gate:frame-surface`, `gate:shaders`, `gate:dom-surface-demand`,
`gate:genie-film-reorder`); three run locally on demand
(`gate:genie-duplicate`, `gate:genie-film`, `gate:genie-shadow`), and
`instruments/knobs-hz` is a reporter with no gate script.
`instruments/README.md` explains what each one checks.

`npm run build` stages the package with core bundled in and peers left
external; publish from the staged directory:

```sh
npm run build
npm publish packages/react/dist
```
