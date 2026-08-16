# munari

## Munari seamlessly bridges HTML with WebGL, unlocking a new frontier of visual expression on the web.

Munari enables you to seamlessly 'lift' any single or group of HTML elements, including whole pages, into a WebGL context, and back, on demand. Seamlessness is the key and focus on Munari. Here's what happens when an element is lifted into WebGL and returned back to the DOM:

- 
- 
-

I'm continually surprised at what this simple technique can unlock, and I'm often adding new examples in the labs.

The [Flight demo] is a good example. It's an ordinary drag and drop card stack. But what if the cards really behaved like actual paper? Not a lot of options there. You could build your app in WebGL, add a landing loading bar, and have max flexibility. But then you lose all the benefits of the DOM. There are some hacks that might work like (the `<foreignObject>` trick)[https://surma.dev/things/dom2texture/], but it's limited and brittle.

Munari is built upon ThreeJS and the experimental (HTML-in-Canvas API in Chrome)[https://developer.chrome.com/blog/html-in-canvas-origin-trial]. Today, this means it's only visible to an infinitesimally small number of design engineering nerds, like myself, who happen to have this Chrome flag enabled.

Munari is a bet on the future of web UI. The HTML-in-Canvas API is a big deal. It's like Core Animation for the web. Coveted effects like liquid glass, depth of field, real progressive blur, and other shader-driven effects are all unlocked. Because of this, I believe HTML-in-Canvas will get the momentum it needs to become a standard. When that day arrives, I want Munari to be one of the first things you reach for when building a new UI.

While we all wait, I intend to make Munari easy to use as a progressive enhancement with a clear fallback path. Apparently, you can also register a token with Google that enables the experimental API for your users automatically! That's over a billion people to treat to the impossible, with an easy fallback.

[ web api adoption chart ].

### Why 'Munari'

Bruno Munari was a playful Italian designer, artist, and inventor. Sometimes he'd mount gauze, torn film, and scraps of plastic in slide frames and throw them across a wall. He called them *proiezioni dirette*, direct projections: the material itself, making them larger and immersive with light. This library brings the same energy to the web. The real DOM (layout, focus, accessibility, scrolling, selectable text) is the source of truth, and can now project into WebGL, coming alive, while still the DOM.


## Requirements

The library is built on Chrome's **HTML-in-canvas origin trial**
(`drawElementImage`). Without that capability a Surface has nothing to rasterize; there is no fallback path. Chrome needs `--enable-features=CanvasDrawElement`, or a registered origin-trial token.

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
