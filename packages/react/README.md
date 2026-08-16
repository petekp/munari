# @petepetrash/munari — the binding

The thinnest react/three binding over `@munari/core`, and the one
package that will ever be published (decisions.md #1). `three`,
`@react-three/fiber`, `react`, and `react-dom` are **peer**
dependencies — we are three-first, and renderer abstraction is banned
by the second-system guard. `tests/boundary.test.ts` holds this
directory to exactly those imports plus `@munari/core`.

The kernel is re-exported whole (see the preamble in `src/index.ts`
for why). A binding export earns its place by a scene consuming it:
the lab imports from the barrel and nowhere else, so a missing export
shows up as a broken scene, not a relative path reaching around it.

## Layout

- `src/primitives/` — the React-facing surface. `Surface` is the atom;
  `FrameSurface` and `DomSurfaceRuntime` are its two pixel paths
  (caller-owned canvas frames with receipts, and live-DOM capture);
  `SurfaceApp` renders a React tree into the captured subtree;
  `FocusScene` + `FocusOrbitRig` + `useFocusScene` are the focus
  contract (`docs/focus.md`); `useLift` drives the kernel's crossing
  law from r3f frames; `CanvasPointerGate` decides when the canvas is
  solid to pointers; `controls/` holds physical controls (`Dial`,
  `use1DOF`).
- `src/lib/` — pure helpers (`focusTree`, `spatialNav`, `cameraPose`,
  `tabbables`, `arcLayout`, `rendererRelease`, `surfaceRadiusGlsl`).
- `src/style.css` — mechanism, not theme. Its header documents the
  three things the library asks of a consumer's stylesheet; that
  contract lives only there.

## Conventions that differ from core

- **Tests sit beside the modules they test** (`foo.ts` + `foo.test.ts`),
  not in `tests/conformance/`. The boundary test licenses this with a
  `vitest`-in-`*.test.ts` carve-out. Pinned numbers in these suites are
  contract all the same.
- **Module preambles sit at the top of the file, above the imports**,
  same as core — a reader's first screenful should be the law, not the
  import block.

## Publishing

`npm run build` (from the root) stages a publishable package under
`packages/react/dist` — kernel bundled in, peers left external — and
`npm publish packages/react/dist` ships it. The workspace package
itself stays `private` with `exports` pointing at `src/`, which is
what lets the lab consume the barrel with no alias and makes a missing
export fail the build, while a stray publish at the root cannot ship
raw source.
