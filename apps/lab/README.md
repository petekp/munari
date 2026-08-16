# apps/lab — the consumer

The lab is a *consumer* of the library, deliberately: everything its
scenes render reaches the code through the `@petepetrash/munari` barrel,
exactly as an outside project would (`tests/boundary.test.ts` rejects
anything else, including `@munari/core`). This app is the proof that
the public surface is sufficient — when a scene wants something
unexported, the fix is to export it, never to reach around.

Scenes are evidence, not product (decisions.md #3): each exists to
prove a claim the others don't, and one that stops proving anything is
deleted. The current roster is eight — workspace, glass, flight,
explode, genie, veil, knobs, optics — plus the logo playground, a
sketch off the roster.

## Layout

- `src/App.tsx` — the scene registry and router.
- `src/scenes/<scene>/` — one folder per scene: `SceneName.tsx` (the
  entry), `sceneName.css`, and prefixed modules whose suffix names
  their kind — `*Law.ts` pure laws, `*Shaders.ts` GLSL strings,
  `*Tweaks.tsx` tuning panels, `*Tuning.ts` tuned value bags, plain
  mechanism nouns otherwise (`genieDock`, `knobsGeometry`). Filenames
  keep the scene prefix inside the folder so every module name is
  unique repo-wide. Tests sit beside their modules. "Knobs" the scene
  is the one exception to grep for carefully: its own value bag is
  `knobsTuning.ts`.
- `src/scenes/fontCarry.test.ts` — cross-scene, on purpose: a CSS
  authoring rule every scene stylesheet must obey.
- `src/lib/` — lab-local helpers; `devGlobals.ts` declares every
  `window.__*` diagnostic handle in one place, and probe authors read
  that file as the diff.
- `src/bareMode.ts` — the `?bare` flag: strips lab furniture so
  instruments measure the scene, not the shell.
- `src/components/ui/` — vendored shadcn primitives.
- `tools/make-film.sh` — rebuilds the genie film asset;
  `src/scenes/genie/film.provenance.md` records its source and license.

## Welded files — edit both or the weld test fails

Three lab files are byte-identical twins of registry packs, enforced
by `tests/registry/*Pack.test.ts`:

- `src/scenes/glass/glassSdf.tsx` ≡ `registry/glass/glassSdf.tsx`
- `src/scenes/glass/glassSdfShader.ts` ≡ `registry/glass/glassSdfShader.ts`
- `src/lib/surfaceAnchors.ts` ≡ `registry/surface-anchors/surfaceAnchors.ts`

A change to either copy lands in both, in the same commit. This is
also why `glassSdf.tsx` is camelCase where scene entries are
PascalCase: it is a vendorable module first, a lab file second.
