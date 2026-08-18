# apps/lab

The demo and development app. Run it with `npm run lab` from the repo
root. `npm run dev` starts Vite only.

The lab imports only from `@petepetrash/munari`, the same way an
outside project would; `tests/boundary.test.ts` enforces this. If a
scene needs something the package doesn't export, add the export;
don't import package internals.

Each scene exercises a different part of the library: workspace,
glass, flight, explode, genie, veil, knobs, and optics, plus a logo
playground.

## What's where

- `src/App.tsx`: the scene registry and router.
- `src/scenes/<scene>/`: one folder per scene. `SceneName.tsx` is the
  entry, `sceneName.css` its stylesheet. Supporting modules carry a
  suffix: `*Law.ts` for pure math and logic, `*Shaders.ts` for GLSL
  strings, `*Tweaks.tsx` for tuning panels, `*Tuning.ts` for tuned
  values. Filenames keep the scene prefix so every module name is
  unique across the repo. Tests sit next to their modules. (In the
  knobs scene the value file is `knobsTuning.ts`; "Knobs" is the
  scene's name.)
- `src/scenes/fontCarry.test.ts`: cross-scene on purpose, a CSS rule
  every scene stylesheet must follow.
- `src/lib/`: lab-local helpers. `devGlobals.ts` declares every
  `window.__*` debug handle in one place.
- `src/bareMode.ts`: the `?bare` URL flag, which strips the lab UI so
  browser probes measure the scene alone.
- `src/components/ui/`: vendored shadcn primitives.
- `tools/runLab.mjs`: opens Vite in an isolated, flag-enabled Chrome and
  checks the public origin-trial token.
- `tools/make-film.sh`: rebuilds the genie film asset;
  `src/scenes/genie/film.provenance.md` records its source and
  license.

## Files with copies in registry/

Three files must stay byte-identical to their copies under
`registry/`; `tests/registry/*Pack.test.ts` fails if they differ. Edit
both copies in the same commit:

- `src/scenes/glass/glassSdf.tsx` ↔ `registry/glass/glassSdf.tsx`
- `src/scenes/glass/glassSdfShader.ts` ↔ `registry/glass/glassSdfShader.ts`
- `src/lib/surfaceAnchors.ts` ↔ `registry/surface-anchors/surfaceAnchors.ts`

(`glassSdf.tsx` is camelCase, unlike other component files, because it
is shared with the registry.)

## Retained React Doctor diagnostics

`react-doctor --scope changed` reports 13 warnings and 0 errors across the
scenes, all of them pre-dating this branch and all of them in `apps/lab`,
never in `packages/`. They are kept, with the reasons:

- **A parent told from an effect** (`no-prop-callback-in-effect`,
  `no-pass-data-to-parent` — `Genie.tsx:853,867`, `Knobs.tsx:2086,2108`).
  The values handed up are anchor rectangles and a host element, both
  measured from the DOM after layout. There is no render-time value to
  lift: the measurement does not exist until the browser has laid the
  subtree out.
- **An effect that re-subscribes on a callback** (`prefer-use-effect-event`
  — `Flight.tsx:1201`). `useEffectEvent` is still experimental in React
  19.2; the handler here is a pointer listener whose identity changes once
  per gesture, not per frame.
- **Chained state updates** (`no-chain-state-updates` —
  `Flight.tsx:1705,1706`). The second update reads the first one's
  committed layout, which is the point: they are two commits on purpose.
- **`useRef(new Map())`** (`rerender-lazy-ref-init` — `Genie.tsx:1885,1897`).
  One Map allocated and dropped per render of one component. Measured
  against `gate:genie-film`, which runs 24 throttled round trips: not
  visible.
- **`<button>` with no `type`** (`button-has-type` — `Logo.tsx:1540`) and
  **`useContext`** (`no-react19-deprecated-apis` — `Workspace.tsx:1`).
  Both are in tuning panels that are not part of any published surface.

Re-run with `react-doctor --scope changed --no-supply-chain --no-dead-code`.
