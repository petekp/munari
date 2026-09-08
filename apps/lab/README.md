# apps/lab

The demo and development app. Run `npm run lab` from the repository root
for Chrome with HTML-in-canvas enabled, or `npm run dev` for Vite alone.

The lab consumes `@petepetrash/munari` and its `/advanced` entry through
the same exports as an outside application. Do not import package internals.
`tests/boundary.test.ts` checks this boundary.

Start with the [task-to-owner guide](../../docs/agent-workflow.md) and
[authoring rules](../../docs/authoring.md). The [system model](../../docs/system-model.md)
explains renderer ownership and evidence. The [agent-system plan](../../docs/agent-system-plan.md)
contains unbuilt work; it is not an API reference.

## Routes and examples

`src/App.tsx` owns routes and the full scene inventory. `?scene=home` is
the overview. Scenes omitted from navigation remain available by URL;
`?scene=controls` and `?scene=candidates` are maintained examples too.
Candidates select a study with `&candidate=<id>`.

`src/components/sceneCatalog.ts` supplies navigation descriptions and source
links pinned to a verified development revision. The overview displays the
actual [HomeStarter source](src/scenes/home/HomeStarter.tsx). Browser fallback
uses a labelled [postcard recording](public/previews/README.md).

Use the real scene route for visual work. `?bare` removes the surrounding UI
and can remove content under test; use it only when an instrument requires it.

## First load

`index.html` supplies the landing background before either React root loads.
`App` selects other scene backgrounds before paint. Home stays in the entry
bundle; other demos load only when selected. Keep each scene in its frame:
its DOM-to-scene coordinates assume that frame is its viewport.

The first document paints an inline wordmark while the page prepares. The
navigation and homepage appear together after fonts, current shadow masks,
headline treatments and the lamp backdrop have reached a completed draw. The
cover stays outside the iframe so preparation can still paint. There is no
minimum display time. Failed graphics preparation selects native content for
that visit, rather than adding effects after the page is visible.
`probe:home-startup` checks the first exposed frames and the resting button
shadow afterward, including a deliberately early reveal that must fail those
checks. [Decision #57](../../docs/decisions.md#57) records the opening contract.

## Code and evidence

- `src/scenes/<scene>/` contains each scene, its styles, tuning and local tests.
  Supporting filenames use the scene prefix; `*Law.ts` holds pure behavior,
  `*Shaders.ts` holds GLSL, and `*Tuning.ts` holds tuned values.
- `src/lib/` contains shared lab helpers. `devGlobals.ts` declares inspection
  hooks used by instruments; it is not a public application API.
- `src/components/ui/` contains the shadcn primitives still used by the app.
- `src/scenes/fontCarry.test.ts` checks the shared font requirement across scenes.
- [The instrument guide](../../instruments/README.md) identifies browser checks
  and their limits. Run GPU checks serially and distinguish a capability skip
  from a pass. Check native fallback separately.

Plume keeps text editing native and uses paint-matched capture anchors for its
particles. Its [laws](src/scenes/plume/plumeLaw.ts), [tuning](src/scenes/plume/plumeTuning.ts)
and `gate:plume` cover release clocks, replay, colors, layout and fallback.

Marble Hand uses a [hidden page mirror](src/scenes/marble-hand/marbleHandPageCapture.tsx)
through `CaptureContent`. Its environment borrows the resulting texture;
native HTML remains visible and interactive. Page background shaders use a
[shared clock](src/scenes/marble-hand/marbleHandBackgroundClock.ts) so the reflected
background matches the page. `gate:marble-hand` checks the full scene.

DOM-aligned objects use `Surface.Anchor` or `useSurfaceAnchorRects`. Manual
receipt-based collection is available through the `/advanced` anchor helpers;
the collector and projection laws live in `packages/core/src/mapping/surfaceAnchors.ts`.
There is no separate lab or registry implementation.

## Files copied into registry

These reference files must stay byte-identical to their registry copies.
`tests/registry/*Pack.test.ts` checks them; edit both copies together.

- `src/scenes/glass/glassSdf.tsx` and `glassSdfShader.ts` → `registry/glass/`.
- `src/scenes/workspace/recipe/FocusOrbitRig.tsx`, `cameraPose.ts`, and
  `arcLayout.ts` → `registry/focus-orbit/`.

## Asset provenance

- `public/fonts/fonts.css` and its WOFF2 files are the Google Fonts faces
  previously loaded by `index.html`, with the same subsets and variation axes.
  The document preloads the first screen's Latin faces from this origin;
  remaining subsets load when used. Each family's OFL is in `public/licenses/`.
  `font-display: block` remains deliberate for captured text. The wordmark's
  optional changing typefaces still load separately from `logoScene.tsx`.
- `homeHeadlineGlyphs.ts` retains only Archivo's `3` and `D` outlines at weight
  900 and width 100. Its metadata records the source and hash; the SIL Open Font
  License is included at `public/licenses/archivo.txt`.

- `tools/runLab.mjs` launches Chrome and checks the origin-trial token.
- `tools/captureThumbs.mjs` captures scene thumbnails used by dynamic gallery URLs.
- `tools/make-film.sh` builds the Genie film; [film provenance](src/scenes/genie/film.provenance.md)
  records its source and license.
- `tools/make-marble-hand.mjs` prepares the hand model; [model provenance](public/models/marble-hand/PROVENANCE.md)
  records the source, geometry checks and rebuild process.

Run React Doctor against the current diff when changing React code. A past
diagnostic count or line number is not a current exemption; inspect the owning
code and preserve measured constraints when deciding whether a finding applies.
