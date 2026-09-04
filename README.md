# munari

### Munari seamlessly bridges HTML with WebGL, unlocking a new frontier of visual expression on the web.

Munari enables you to seamlessly 'lift' any single or group of HTML elements, including whole pages, into a WebGL context, and back, on demand. Seamlessness is the key and focus of Munari. Here's what happens when an element is lifted into WebGL and returned back to the DOM.

The hard part is the swap. Hide the page and show the scene on different frames and you get a flash, a jump, or a frame of nothing at all. So the scene draws its copy underneath first, same size, same place, invisible, and the page keeps holding until that copy proves it has painted. When the two trade places they are identical, so there is nothing to see.

In the air it is still the same element. You can type in it, select its text, click things inside it. The page holds its old spot open the whole time, so sending it back drops it where it started and it goes on being ordinary DOM.

One `<Surface>` declares its source and any presentations, and its
`renderIn` prop says where the content should be held. The protocol underneath is in
[packages/core](packages/core/README.md).

I'm continually surprised at what this simple technique can unlock, and I'm often adding new examples in the labs.

The [Flight demo](https://munari.vercel.app) is a good example. It's an ordinary drag and drop card stack. But what if the cards really behaved like actual paper? Not a lot of options there. You could build your app in WebGL, add a landing loading bar, and have max flexibility. But then you lose all the benefits of the DOM. There are some hacks that might work like [the `<foreignObject>` trick](https://surma.dev/things/dom2texture/), but it's limited and brittle.

Munari lets a live piece of your page behave like an object in a ThreeJS scene. The element keeps its state and focus while it tilts, bends, or sits at depth among 3D objects, and you can still click it and select its text. At rest the mesh is pixel-identical to the page element it came from. Chrome's [HTML-in-Canvas API](https://developer.chrome.com/blog/html-in-canvas-origin-trial) supplies the raw pixels and ThreeJS draws them; Munari does the work in between: it keeps the texture sharp and current, carries your input to the real element wherever its picture stands, and trades the pixels between page and scene without a flash.

The HTML-in-Canvas API is experimental. Today, this means Munari is only visible to an infinitesimally small number of design engineering nerds, like myself, who happen to have this Chrome flag enabled.

Munari is a bet on the future of web UI. The HTML-in-Canvas API is a big deal. It's like Core Animation for the web. Coveted effects like liquid glass, depth of field, real progressive blur, and other shader-driven effects are all unlocked. Because of this, I believe HTML-in-Canvas will get the momentum it needs to become a standard. When that day arrives, I want Munari to be one of the first things you reach for when building a new UI.

While we all wait, I intend to make Munari easy to use as a progressive enhancement with a clear fallback path. Apparently, you can also register a token with Google that enables the experimental API for your users automatically! That's over a billion people to treat to the impossible, with an easy fallback.

### Why 'Munari'

Bruno Munari was a playful Italian designer, artist, and inventor. Sometimes he'd mount gauze, torn film, and scraps of plastic in slide frames and throw them across a wall. He called them *proiezioni dirette*, direct projections: the material itself, making them larger and immersive with light. This library brings the same energy to the web. The real DOM (layout, focus, accessibility, scrolling, selectable text) is the source of truth, and can now project into WebGL, coming alive, while still the DOM.


## Requirements

The library is built on Chrome's **HTML-in-canvas origin trial**
(`drawElementImage`). Chrome needs `--enable-features=CanvasDrawElement`,
or a registered origin-trial token.

Without that capability a Surface has nothing to rasterize, so it stays on
its page copy and never presents in WebGL. Your DOM is still there and
still works. See [When the trial is absent](#when-the-trial-is-absent) for
the one thing you have to handle yourself.

`three` and `@react-three/fiber` are **peer dependencies**. three uses
`instanceof` internally; two copies in one dependency graph fail
without an error. Your app owns the single copy.

## Install

```sh
npm install @petepetrash/munari three @react-three/fiber
```

## Your first Surface

A `<Surface>` names one piece of content and declares the presentations
you need: `<Surface.DOM>` is the page copy and `<Surface.Mesh>` is the
scene copy. `<SurfaceCanvas>` is the shared r3f `Canvas` that hosts them.
`renderIn` defaults to `'page'`; set it to `'canvas'` to request a handoff
to the scene, or to `'both'` when both declared presentations should stay
visible. `'none'` keeps the source available without showing either copy.

The button below is still live DOM in both places: click it on the mesh
and its React state updates normally.

```tsx
import { useState } from 'react'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceSupport,
} from '@petepetrash/munari'
import '@petepetrash/munari/style.css'
import './app.css'

function Panel({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <div className="surface-panel">
      <p>Ordinary React, rendered as matter.</p>
      <button type="button" onClick={onPress}>Pressed {count} times</button>
    </div>
  )
}

export function App() {
  const supported = useSurfaceSupport()
  const [selected, setSelected] = useState(false)
  const [count, setCount] = useState(0)
  const panel = <Panel count={count} onPress={() => setCount((value) => value + 1)} />

  return (
    <main className="munari-demo">
      {supported && (
        <SurfaceCanvas
          pointerMode="surfaces"
          frameloop="demand"
          camera={{ position: [0, 0, 6], fov: 45 }}
          style={{ position: 'fixed', inset: 0 }}
        />
      )}

      <Surface source={panel} renderIn={selected ? 'canvas' : 'page'}>
        <Surface.DOM />
        <Surface.Mesh alpha="source" pointerEvents="content" />
      </Surface>

      <button
        type="button"
        disabled={!supported}
        onClick={() => setSelected((value) => !value)}
      >
        {selected ? 'Show on the page' : 'Show in the canvas'}
      </button>
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
  width: 400px;
  height: 300px;
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

`source` is what Munari captures. With no children, `<Surface.DOM>` renders
that part's source as the page presentation. The captured source and the
`<Surface.DOM>` page presentation are separate React instances, so any state
they share is held above the Surface — that is why `count` lives in `App`.

By default `<Surface.Mesh>` stands exactly where the page copy stands, at
the page copy's size, so you do not size or place the mesh yourself.
Pass `placement="manual"` and your own `geometry` when you want to put it
somewhere else.

For separate page and scene trees, create a handle once and pass it to the
declarations. A separated `<Surface.DOM surface={handle}>` must receive
explicit children; this lets a stable native page copy live outside the
captured source tree.

```tsx
const handle = useSurfaceHandle('panel')

<Surface surface={handle} source={capturePanel} renderIn="page" />
<Surface.DOM surface={handle}>{nativePanel}</Surface.DOM>

<SurfaceCanvas id="main" pointerMode="surfaces" frameloop="demand">
  <Surface.Mesh surface={handle} />
</SurfaceCanvas>
```

`capturePanel` and `nativePanel` are separate React instances. Keep shared
state above them. With multiple hosts, give each `<SurfaceCanvas>` a distinct
`id` and pass the matching `canvas="…"` to the Surface declaration.

### A detached element

When the content is not React — markup you built by hand, or a subtree
another system owns — hand the element to `adopt` instead of `source`.
Munari takes ownership of it; do not also mount it in the page.

```tsx
import { useEffect, useState } from 'react'
import { Surface } from '@petepetrash/munari'

export function StaticPanel() {
  const [element, setElement] = useState<HTMLElement>()

  useEffect(() => {
    const node = document.createElement('article')
    node.style.cssText =
      'box-sizing:border-box;width:400px;height:300px;padding:32px;background:#f4efdf;color:#171612'
    node.innerHTML = '<h1>Static HTML</h1><p>This is still a live DOM subtree.</p>'
    setElement(node)
  }, [])

  return (
    <Surface name="static" adopt={element} renderIn="canvas">
      <Surface.Mesh />
    </Surface>
  )
}
```

`innerHTML` is your call to make, so use it only for trusted markup.

Either way, the content root must declare its own pixel size. Chrome
rasterizes that element at its layout box. A zero-sized root produces an
empty texture without an error. Import the package stylesheet once, then
read its short header for the hover, active, focus, and floating-layer CSS
contract.

## When the trial is absent

Most browsers do not have the trial, and that is a supported state rather
than a failure. A Surface with a declared page presentation keeps rendering
it, `useSurfaceState().presented` stays `'page'`, and the capability answer
is available through `useSurfaceSupport()` or `supportsSurfaces()`.

Ask before you branch:

```tsx
import { useSurfaceSupport } from '@petepetrash/munari'

function Workspace() {
  const supported = useSurfaceSupport()
  return supported ? <WorkspaceScene /> : <WorkspaceDOM />
}
```

The hook answers `false` on the server and through hydration, then the
real answer. Reading the capability directly during render instead — a
`useMemo`, a module constant — disagrees with server markup on exactly the
machines that do have the trial. `supportsSurfaces()` is the same question
without the hook, for events, effects and diagnostics.

### The one thing that does not degrade by itself

Content degrades on its own. **Gestures do not.** If a pointer handler
puts the scene into a state that only the renderer can leave, and the
renderer never arrives, no further input can leave it either:

```tsx
// Wrong without the trial: `flying` is set and nothing ever clears it.
const onPointerDown = (id) => {
  setFlying(id)
  setSelected(true)
}
```

Branch at the gesture, not only at the scene:

```tsx
const onPointerDown = (id) => {
  if (!supported) return carryWithCss(id)
  setFlying(id)
  setSelected(true)
}
```

Prefer deriving that state from the Surface over keeping your own copy of
it. `useSurfaceState(handle?)` reports `requested`, `presented`, `ready`,
`supported` and `isChanging`. It reads the nearest Surface when no handle is
passed, and none of these observations can claim a canvas hold the browser
cannot take.

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

A Surface with page and mesh presentations and `renderIn="both"` is a
**Twin**: both copies stay visible and the page remains the primary keyboard
and accessibility presentation. `renderIn="none"` supplies a capture
without either presentation, so another material can sample live page
content without drawing a mesh copy of the page.

`renderIn="canvas"` with no declared page presentation is a resident Surface.
It has no page handoff delay or protocol frame loop; its progress starts at
the canvas endpoint. Presenter readiness and actual presentation evidence are
still separate observations.

A Surface can be split into named parts with `<Surface.Part>`. All of its
parts transfer together or not at all, so a multi-piece object cannot be
caught half in the air. `<Surface.Anchor name="…">` stands a scene object
on a box inside the source that is marked `data-munari-anchor`, in the
geometry's own coordinates.

`useSurfaceHandle(name?)` and `createSurface(name?)` give you a handle when
content is declared in separate React trees or observed externally. A name
is a diagnostic label, not a global lookup key. A basic `<Surface>` needs no
handle. `renderIn`, timing and callbacks belong to the declaration that
presents the handle.

`useSurfaceState(handle?)` reads the nearest Surface context or an explicit
handle. Its `requested` value is the application's `renderIn` request;
`presented` is the current `SurfacePresentation` (`'page'`, `'canvas'`,
`'both'`, or `'none'`); `ready` covers presenter preparation;
`isChanging` covers an active handoff; and `supported` reports capture
capability. `onPresentationChange` reports changes to the hold, while
`onMotionComplete` reports a motion endpoint. They are separate events.

The handle argument is optional for `useSurfaceState`, `useSurfaceProgress`,
and `useSurfaceDriver`; without it, each reads the nearest Surface identity,
including when page and scene declarations live in separate renderer trees.

For a specialist draw path, `<Surface.Mesh presentation="manual">` keeps the
mesh proxy and pointer relay while delegating final draw evidence. The
advanced `surfaceManualPresenter` must register every declared part and call
`prove()` after an eligible preparation draw, then `present()` only after that
part's final compositor draw. A page hold cannot
be released from readiness or an offscreen draw alone.
During a handoff, use the presenter's `canvasPresents()` to gate visible output.

`Surface.Scene` is an always-declared lifecycle boundary for one Surface's
custom scene subtree. Keep it under the shared `<SurfaceCanvas>` so the
subtree survives preparation, reversal and return until cleanup is complete.
The host itself stays mounted while its Surfaces need the renderer. If an app
uses multiple hosts, give each `<SurfaceCanvas>` a distinct `id` and pass the
matching `canvas="…"` to each Surface. A Scene cannot retain a caller-owned
host; the caller owns the host lifetime.
`useSurfaceProgress` and `useSurfaceDriver` are how a scene scales its own
motion by the crossing.
Use `useSurfaceDriver(step)` inside a Surface or Scene, or
`useSurfaceDriver(step, handle)` for an explicit identity. A `null` step
restores the built-in timed motion.

For a custom shader, pass your own `material` to `<Surface.Mesh>` and read
the texture with `useSurfaceTexture()`. In that material slot, the hook returns
a configured texture; it is not nullable. To sample another Surface by handle,
use `useSurfaceTextureOf(handle)`, which returns `null` until that source has
a texture. DOM textures are premultiplied; apply masks to the full
`vec4` and blend with `ONE` / `ONE_MINUS_SRC_ALPHA`. `SURFACE_RADIUS_GLSL`
is the GLSL half of the corner mask.

### The advanced entry

`@petepetrash/munari/advanced` is the second, deliberate doorway. It
re-exports the whole of the renderer-agnostic core — the crossing law,
paint accounting, chrome measurement, the plane/screen math — plus
`FrameSurface`, which wears a canvas you already render yourself.
`createCanvasFrameSource` publishes into one: write the complete frame,
then call `publish()`. Presentation receipts are available there when
another renderer must not release its pixels until the named frame reaches
the screen.

Names behind `/advanced` move with the kernel rather than with the
component API. If a scene only needs a Surface, it should never import
from it.

Read [the authoring contract](docs/authoring.md) before you capture an
existing component system. Coding agents can start at [llms.txt](llms.txt)
and the shipped [Munari skill](.agents/skills/munari/SKILL.md).

### Working with an agent

In a repository checkout, start with the [task-to-owner guide](docs/agent-workflow.md).
The [system model](docs/system-model.md) explains the linked abstractions and
the difference between the `renderIn` request, readiness, presentation, and
release.
The Revision 3 proposal and compound sketches are historical design material,
not current API references.

For an installed package, use its README, skill, `index.d.ts`, and
`advanced.d.ts`. The current package does not include the full repository
docs or registry. Repository-relative links outside those shipped files need
source matched to that release; GitHub `main` can describe a different API.
The version-local documentation work is [planned, not shipped](docs/agent-system-plan.md#p1-version-local-package-guidance).

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
