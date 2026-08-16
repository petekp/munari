# munari

### Munari seamlessly bridges HTML with WebGL, unlocking a new frontier of visual expression on the web.

Munari enables you to seamlessly 'lift' any single or group of HTML elements, including whole pages, into a WebGL context, and back, on demand. Seamlessness is the key and focus on Munari. Here's what happens when an element is lifted into WebGL and returned back to the DOM.

The hard part is the swap. Hide the page and show the scene on different frames and you get a flash, a jump, or a frame of nothing at all. So the scene draws its copy underneath first, same size, same place, invisible, and the page keeps holding until that copy proves it has painted. When the two trade places they are identical, so there is nothing to see.

In the air it is still the same element. You can type in it, select its text, click things inside it. The page holds its old spot open the whole time, so sending it back drops it where it started and it goes on being ordinary DOM.

The `useLift` hook drives it. The protocol underneath is in [packages/core](packages/core/README.md).

I'm continually surprised at what this simple technique can unlock, and I'm often adding new examples in the labs.

The [Flight demo](https://munari.vercel.app) is a good example. It's an ordinary drag and drop card stack. But what if the cards really behaved like actual paper? Not a lot of options there. You could build your app in WebGL, add a landing loading bar, and have max flexibility. But then you lose all the benefits of the DOM. There are some hacks that might work like [the `<foreignObject>` trick](https://surma.dev/things/dom2texture/), but it's limited and brittle.

Munari is built upon ThreeJS and the experimental [HTML-in-Canvas API in Chrome](https://developer.chrome.com/blog/html-in-canvas-origin-trial). Today, this means it's only visible to an infinitesimally small number of design engineering nerds, like myself, who happen to have this Chrome flag enabled.

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

## Your first Surface

Start with `SurfaceApp`. It gives a React tree to one Three.js mesh. The
button below is still live DOM: click it on the mesh and its React state
updates normally.

```tsx
import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { detectHtmlInCanvas, SurfaceApp } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'
import './app.css'

function Panel() {
  const [count, setCount] = useState(0)

  return (
    <div className="surface-panel">
      <p>Ordinary React, rendered as matter.</p>
      <button onClick={() => setCount((value) => value + 1)}>
        Pressed {count} times
      </button>
    </div>
  )
}

export function App() {
  if (!detectHtmlInCanvas().drawElementImage) {
    return (
      <p>
        Enable <code>chrome://flags/#canvas-draw-element</code>, then fully
        restart Chrome.
      </p>
    )
  }

  return (
    <main className="munari-demo">
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }}>
        <ambientLight intensity={2} />
        <SurfaceApp width={400} height={300} content={<Panel />}>
          <planeGeometry args={[4, 3]} />
        </SurfaceApp>
      </Canvas>
    </main>
  )
}
```

```css
html,
body,
#root,
.munari-demo {
  width: 100%;
  height: 100%;
  margin: 0;
}

.munari-demo {
  background: #171612;
}

.surface-panel {
  box-sizing: border-box;
  display: grid;
  width: 100%;
  height: 100%;
  place-content: center;
  gap: 16px;
  padding: 32px;
  border-radius: 24px;
  color: #171612;
  background: #f4efdf;
  font: 16px/1.4 system-ui, sans-serif;
  text-align: center;
}
```

The `400 × 300` values are CSS pixels for the DOM layout and texture.
The `4 × 3` plane is Three.js geometry in world units. A Surface can wear
any geometry, so it never creates that geometry for you.

`SurfaceApp` creates a second React root. Context from the outer app does
not cross into it; pass values through `content`, or put the needed
providers inside `content`.

### Static markup

Use `Surface` when the content is a trusted, static HTML string. Put it
inside the same lit `Canvas` and give it geometry:

```tsx
import { Surface } from '@petepetrash/munari'

export function StaticPanel() {
  return (
    <Surface
      width={400}
      height={300}
      html={`<article style="box-sizing:border-box;width:400px;height:300px;padding:32px;background:#f4efdf;color:#171612">
        <h1>Static HTML</h1>
        <p>This is still a live DOM subtree.</p>
      </article>`}
    >
      <planeGeometry args={[4, 3]} />
    </Surface>
  )
}
```

`html` is parsed with `innerHTML`, so use it only for trusted markup.
Use `SurfaceApp` for application content.

For either path, the content root must declare its own pixel size. Chrome
rasterizes that element at its layout box. A zero-sized root produces an
empty texture without an error. Import the package stylesheet once, then
read its short header for the hover, active, focus, and floating-layer CSS
contract.

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

`useLift` and `LiftDriver` move presentation between the page and WebGL
without a blank frame. The Flight and Logo labs are the working references.

`createCanvasFrameSource` lets caller-owned canvas pixels bypass DOM capture.
Write the complete frame, then call `publish()`. Its default material is
unlit and color-preserving. Presentation receipts are available when another
renderer must not release its pixels until the named frame reaches the screen.

For a custom shader, use `material="none"` and read the texture with
`useSurfaceTexture()`. The hook returns `null` until the texture exists. DOM
textures are premultiplied; apply masks to the full `vec4` and blend with
`ONE` / `ONE_MINUS_SRC_ALPHA`.

Read [the authoring contract](docs/authoring.md) before you capture an
existing component system. Coding agents can start at [llms.txt](llms.txt)
and the shipped [Munari skill](.agents/skills/munari/SKILL.md).

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

Eight browser gates exist. CI runs five on every push (`gate:idle-zero`,
`gate:frame-surface`, `gate:shaders`, `gate:dom-surface-demand`,
`gate:genie-film-reorder`); three run locally on demand
(`gate:genie-duplicate`, `gate:genie-film`, `gate:genie-shadow`), and
`instruments/knobs-hz` is a reporter with no gate script.
`instruments/README.md` explains what each one checks.

`npm run build` stages the package with core bundled in and peers left
external. The staged package includes the canonical root README, license,
changelog, `llms.txt`, and Munari skill. Inspect it, then publish from the
staged directory:

```sh
npm run build
npm pack --dry-run packages/react/dist
npm publish packages/react/dist
```
