# @petepetrash/munari

React components and hooks that render live DOM (or a canvas you draw
into) as textured meshes inside a `@react-three/fiber` scene.

```sh
npm install @petepetrash/munari three @react-three/fiber
```

`three`, `@react-three/fiber`, `react`, and `react-dom` are peer
dependencies: your app supplies them. Keep one copy of `three` in the
dependency graph; three uses `instanceof` internally, and two copies
fail without an error.

This package re-exports everything in `@munari/core`, so you import
from it alone.

## What's where

- `src/primitives/`: the components and hooks.
  - `Surface`: a mesh whose material is a live DOM subtree or a
    caller-owned canvas; everything else supports it.
  - `SurfaceApp`: mounts a React tree as a Surface's DOM.
  - `FrameSurface`, `DomSurfaceRuntime`: the two pixel paths behind
    `Surface`, canvas frames with draw/presentation receipts and live
    DOM capture.
  - `FocusScene`, `FocusOrbitRig`, `useFocusScene`: keyboard focus and
    spatial navigation. `docs/focus.md` explains the model.
  - `useLift`: moves a Surface between the page and the scene without
    a visible seam.
  - `CanvasPointerGate`: lets a full-page canvas pass pointer events
    through to the page, except where a pointer hits scene content.
  - `controls/`: draggable physics controls (`Dial`, `use1DOF`).
- `src/lib/`: plain functions used by the primitives (`focusTree`,
  `spatialNav`, `cameraPose`, `tabbables`, `arcLayout`,
  `rendererRelease`, `surfaceRadiusGlsl`).
- `src/style.css`: required styles for DOM capture. Its header comment
  lists what it expects from your CSS.

## Conventions

- Tests sit next to the modules they test (`foo.ts` + `foo.test.ts`).
- A module opens with a comment block, above the imports, that says
  what it does and why it works the way it does.
- Numbers asserted in tests are deliberate. Record a change in
  `docs/decisions.md` before adjusting one.

## Publishing

From the repo root:

```sh
npm run build              # writes packages/react/dist; core bundled in, peers external
npm publish packages/react/dist
```

The workspace package stays `private`; you publish only the staged
`dist`.
