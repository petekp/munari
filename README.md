# munari

Live DOM as physical matter in WebGL.

Bruno Munari mounted gauze, torn film, and scraps of plastic in slide
frames and threw them across a wall — *proiezioni dirette*, direct
projections, where what you see is not a picture of the material but
the material itself, enlarged by light. This library does that to the
browser: the real DOM — layout, focus, accessibility, text you can
select — stays the retained truth, and a custody protocol lets a WebGL
scene carry its pixels as matter. At the calibrated vantage (1 world
unit = 1 CSS pixel on the rest plane) the page resolves exactly;
everywhere else it is paper you can bend, throw, and crumple.

**Status: pre-release.** The kernel is complete through six custody
layers — mapping, paint, pointer, transfer, chrome, physics — each defined
by a conformance suite in `tests/conformance/` and exercised by a scene
in the lab. The public API is not frozen: the binding re-exports the
kernel whole, so every kernel law is currently reachable, and that
surface will be narrowed before 1.0.

## Requirements

The library is built on Chrome's **HTML-in-canvas origin trial**
(`drawElementImage`). Without that capability a Surface has nothing to
rasterize — there is no fallback path, by design. Chrome needs
`--enable-features=CanvasDrawElement`, or a registered origin-trial
token.

`three` and `@react-three/fiber` are **peer dependencies**. three does
internal `instanceof` checks, so two copies in one graph fail silently;
the consumer owns the single instance.

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

…or `SurfaceApp` to hand it a React tree instead, rendered by a second
React root into the same live subtree:

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
lighting is wanted.

The canvas stays with its caller. `publish()` means new pixels are ready; it
does not mean they were drawn. `onFrameDrawn` proves that the target mesh used
the named upload in a renderer pass. It can also fire for an off-screen or
color-disabled pass. `onPresented` adds the exact transfer and presentation
revision and accepts only a color-writing draw to the default framebuffer.
Several publications can merge before one render, so receipts name only the
latest frame that was actually uploaded. A hidden or culled mesh cannot send a
receipt.

The reverse handoff has a different boundary. Prepare the native presenter
first, then call `commitRendererReleaseFrame` from `useFrame`. Its
`commitIncoming` callback gives the native presenter any translucent layers;
the helper suppresses the outgoing object in the same renderer turn and calls
`publishRelease` after that render stack. React state should publish durable
custody from `publishRelease`, not from an Effect.

For every premultiplied frame source, use `material="none"` and a custom
material. This also applies when the mesh does not blend: pixels with partial
alpha still contain alpha-weighted RGB. Do not multiply RGB by alpha again.
Apply masks and fades to the full `vec4`, then blend with `ONE` and
`ONE_MINUS_SRC_ALPHA` when transparency is visible.

`useSurfaceTexture()` is initially null while the frame runtime is created.
A custom material must replace or update its sampler when that hook returns
the texture; do not leave Three bound to the first null uniform.

For DOM-backed Surfaces, the content root must declare its own pixel size: the
element is rasterized at its own layout box, and a container with
nothing in flow to size it measures zero and draws an empty rectangle —
with clean paints and no error.

The stylesheet is mechanism, not theme; it documents the three things
it asks of a consumer's CSS in return.

## Repo shape

| path | what it is |
| --- | --- |
| `packages/core` | the kernel — pure laws, **zero runtime dependencies** |
| `packages/react` | the `@petepetrash/munari` package — the three/r3f binding |
| `registry/` | copyable behaviors, shadcn-style (nothing published) |
| `apps/lab` | the lab application, a *consumer* of the barrel |
| `instruments/` | probes and gates; measurement as maintained code |
| `tests/conformance/` | the specification, one suite per custody layer |

The dependency shape is an hourglass — core ← binding ← consumers — and
`tests/boundary.test.ts` walks real import specifiers to enforce it.

See `CLAUDE.md` for the working rules, `docs/decisions.md` for the
ledger, `docs/platform.md` for what the platform is measured to do,
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

Publishing builds a staged package (the kernel bundled in, peers left
external) and publishes from it, so the workspace can keep resolving
source:

```sh
npm run build
npm publish packages/react/dist
```
