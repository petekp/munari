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
npm install munari three @react-three/fiber
```

A `Surface` is one mesh whose material is a live DOM subtree. Hand it
markup for something static:

```tsx
import { Canvas } from '@react-three/fiber'
import { Surface } from 'munari'
import 'munari/style.css'

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

Either way the content root must declare its own pixel size: the
element is rasterized at its own layout box, and a container with
nothing in flow to size it measures zero and draws an empty rectangle —
with clean paints and no error.

The stylesheet is mechanism, not theme; it documents the three things
it asks of a consumer's CSS in return.

## Repo shape

| path | what it is |
| --- | --- |
| `packages/core` | the kernel — pure laws, **zero runtime dependencies** |
| `packages/react` | the `munari` package — the three/r3f binding |
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
