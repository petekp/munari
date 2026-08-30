# apps/lab

The demo and development app. Run it with `npm run lab` from the repo
root. `npm run dev` starts Vite only.

The lab imports only from `@petepetrash/munari`, the same way an
outside project would; `tests/boundary.test.ts` enforces this. If a
scene needs something the package doesn't export, add the export;
don't import package internals.

Each scene exercises a different part of the library. Three unlisted page
studies are direct links rather than promoted navigation: `?scene=controls`
turns one live HTML form into physical hardware, `?scene=plume` lets native
typed words leave as WebGL ink, and `?scene=marble-hand` replaces the pointer
with a reflected, shadow-casting classical marble hand.

Marble Hand keeps one visible native HTML page under a pointer-transparent
overlay. Only the hand and its transparent shadow render over the page.
A source-only Surface captures a hidden, inert mirror of the full catalogue,
including headings, text, borders and other content. A private cube camera
uses that full texture for reflections; it never presents the page in WebGL.
Native colors still drive matching page lights and room bounce, as in Knobs.
Full-page reflections require HTML-in-canvas. Without it, the native page and
ordinary WebGL hand remain usable, with an explicit reflection-limit notice.

The marble-hand page opens with a parked preview and native tweak panel.
It exposes orientation, size, movement, marble, lighting, and shadows, with
view presets, reset, and JSON copy. Close the panel to resume pointer motion.
Its Marble/Chrome switch uses separate finish settings: Chrome is bare,
low-roughness mirrored metal with no stone veins. Switching back preserves
the saved marble finish. Both modes use the same native page-derived room.
Reflections has a shared 1–120 fps update limit, with 20 fps as the default.
It does not slow hand movement, and unchanged reflections do not update.
The `?scene=marble-hand&bare` route keeps the original pointer-only study for
browser gates.

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
- `tools/make-marble-hand.mjs`: extracts the anatomical cursor hand, seals
  the wrist and bakes the fingertip pivot; `public/models/marble-hand/PROVENANCE.md`
  records the source, license and rebuild command.

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
