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
