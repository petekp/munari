# apps/lab

The demo and development app. Run `npm run lab` from the repository root
for Chrome with HTML-in-canvas enabled, or `npm run dev` for Vite alone.

The lab consumes `@petepetrash/munari` and its `/advanced`, `/snapdom`, and
`/style.css` entries through the same exports as an outside application. Do not
import package internals. `tests/boundary.test.ts` checks this boundary.

Start with the [task-to-owner guide](../../docs/agent-workflow.md) and
[authoring rules](../../docs/authoring.md). The [system model](../../docs/system-model.md)
explains renderer ownership and evidence. The [agent-system plan](../../docs/agent-system-plan.md)
contains unbuilt work; it is not an API reference.

## Routes and examples

`src/App.tsx` owns routes and the full scene inventory. `?scene=home` is
the overview. Scenes outside the demo catalog remain available by URL;
`?scene=controls` and `?scene=candidates` are maintained examples too.
Candidates select a study with `&candidate=<id>`.

`src/components/sceneCatalog.ts` supplies each demo's title, headline and
instruction, and source links that follow `main`. The Postcard demo falls back
to a labelled [recording](public/previews/README.md) in browsers without a
renderer.

Use the real scene route for visual work. `?bare` removes the surrounding UI
and can remove content under test; use it only when an instrument requires it.

By default (`auto`), the lab uses native HTML-in-canvas where Chrome exposes it
and dynamically imports `@petepetrash/munari/snapdom` as an automatic fallback
everywhere else — regardless of URL parameters. `?capture=snapdom` forces every
Surface onto snapDOM even in Chrome 157+ for side-by-side parity checks, and
`?capture=none` skips the snapDOM fallback so browser gates can verify
native-HTML degradation when no capture engine is installed. Non-default
overrides ride navigation; `window.__munari.engine()` reports which engine
answered.

## Overview

`?scene=home` is the overview, in `src/scenes/home/`. It holds no Munari demo
itself. Under the tagline, the chosen demo runs in an iframe loaded with
`&framed&bare&capture=auto`, scaled down from a 1100px-wide layout, or 720px on
narrow screens. `capture=auto` keeps HTML-in-canvas where Chrome has it and uses
snapDOM elsewhere, so the demo runs live in every browser the demos support. A
`--bench` ground sits under the frame until it loads. Below the frame, an index of
every demo chooses which one runs.

## Style guide

`?scene=style` shows the site system: the tokens in
`src/components/system/tokens.css` and every component class in
`src/components/system/system.css`, in each of its states. The page renders
those classes directly, so it changes when they do.

## Adding a demo

`src/components/sceneCatalog.ts` `DEMOS` lists the advertised demos in display
order. The overview, the demo bar's previous and next links, and the routes all
read it. To add one:

1. Build the scene in `src/scenes/<id>/`.
2. Add its entry to `DEMOS`: id, title, a short headline, and what to try.
3. Add its page to `DEMO_PAGES` in `src/App.tsx`. Typecheck fails until it exists.
4. Add a 1280×720 thumbnail at `public/thumbs/<id>.jpg`. `npm run thumbs -w @munari/lab`
   captures the scenes listed in `tools/captureThumbs.mjs`.

## First load

`index.html` paints the overview's white background and an inline wordmark before the
app loads. The shell removes that cover once the overview's fonts are ready, or when a
scene's iframe loads. Home stays in the entry bundle; every other scene loads
only in its own frame. A framed or `&bare` document never shows the cover.

## Light and Postcard

The Light and Postcard demos, at `?scene=light` and `?scene=postcard`, share
one lamp in `src/scenes/light/`. `LightLamp` draws the shadow canvas and the
glass bulb, and takes the page content as a render prop. Light passes the
headline and Postcard passes the form. `components/DemoHost.tsx` gives each
page a measured, clipped viewport and a separate overlay layer for the lamp,
so the page scrolls while the lamp stays in place.

Each page sets `.light-page[data-page-ready]` once its shadows, any headline
treatment and the lamp backdrop have drawn. If graphics are not ready within
four seconds, the page shows native content instead and sets the mark then.
[Decision #57](../../docs/decisions/lab.md#57) sets that limit. Inside a frame the
page is visible while it prepares, like every other scene.

## Code and evidence

- `src/scenes/<scene>/` contains each scene, its styles, tuning and local tests.
  Supporting filenames use the scene prefix; `*Law.ts` holds pure behavior,
  `*Nodes.ts` holds TSL node materials, and `*Tuning.ts` holds tuned values.
- `src/lib/` contains shared lab helpers. `devGlobals.ts` declares inspection
  hooks used by instruments; it is not a public application API.
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

- `src/scenes/glass/glassSdf.tsx` and `glassSdfNodes.ts` → `registry/glass/`.
- `src/scenes/workspace/recipe/FocusOrbitRig.tsx`, `cameraPose.ts`, and
  `arcLayout.ts` → `registry/focus-orbit/`.

## Distortion wave

`?scene=distortion-wave` keeps the shared Munari demo bar around a distinct
Night studio interface. Its six examples are an album reaction, file deletion
and undo, an invitation pass that copies its code, a filtered asset collection,
individual release-checklist rows, and a customizable pocket player. The theme
control demonstrates a page wave alongside local interactions.

Motion and palettes adapt LukyVJ’s [reference](https://codepen.io/LukyVj/pen/jEBJpLp);
the MIT notice is in `public/licenses/distortion-wave.txt`. Artwork is drawn
with local CSS and inline SVG. Every effect targets a filled, bounded surface.
The Like pill has a solid caption rail behind it, each checklist row captures
independently, and finish controls target the player body.

Each action supplies an outgoing snapshot through `CaptureContent`. Its native
update waits for that cover to draw. Ordered masks reveal successive states,
while independent light pulses draw above them. Eight snapshot slots, including
at most three page snapshots, bound the retained images. Extra actions wait in
order. Ordinary hover does not request snapshots.

Larger targets bend the outgoing image before the traveling front reveals the
new state. Rounded containers capture the incoming state too, so the front
reveals it along the same bent outline before returning to the live control.
Overlapping waves on one container share a single bend and reveal each state
in order. The bend keeps its origin until it settles.
Targets set the buildup in milliseconds and its displacement in
CSS pixels with `data-wave-buildup-duration` and
`data-wave-buildup-displacement`. A target with no buildup launches immediately.
While a target moves or scrolls, the wave follows its position and reuses its
snapshot. A page-wide wave moves its original viewport crop along with the page,
so areas outside the original capture show the live document.

Hover uses a fading highlight without changing text contrast. Capture reads only
the opacity of explicitly marked highlights, preserving their in-progress fade
without serializing whole element styles. The fast copy still depends on ancestor
CSS, opaque flat parent fills, and stable target bounds. Checklist marks follow
committed React state during native activation. Copy writes from the trusted
click handler and animates confirmation after the clipboard write succeeds.

The [wave probes](../../instruments/distortion-wave/README.md) cover native
interaction, state reveals, containment, overlapping light, and black-background
regressions. Shader warmup draws transparent pixels once through the actual
renderer pipeline, then returns to demand rendering.

## Asset provenance

- `public/fonts/fonts.css` and its WOFF2 files are the Google Fonts faces
  previously loaded by `index.html`, with the same subsets and variation axes.
  The document preloads the first screen's Latin faces from this origin;
  remaining subsets load when used. Each family's OFL is in `public/licenses/`.
  `font-display: block` remains deliberate for captured text. The wordmark's
  optional changing typefaces still load separately from `logoScene.tsx`. The official
  wordmark uses [generated outlines](src/components/wordmark/README.md).
- `light/lightHeadlineGlyphs.ts` retains only Archivo's `3` and `D` outlines at weight
  900 and width 100. Its metadata records the source and hash; the SIL Open Font
  License is included at `public/licenses/archivo.txt`.

- `tools/runLab.mjs` launches Vite and a Chrome that can draw HTML.
- `tools/captureThumbs.mjs` (`npm run thumbs -w @munari/lab`) re-captures `public/thumbs/<scene>.jpg`,
  the thumbnails shown in the scene nav, Home's example cards and the gallery.
  The `selection` thumbnail is picked by hand and is not re-captured.
- `tools/make-film.sh` builds the Genie film; [film provenance](src/scenes/genie/film.provenance.md)
  records its source and license.
- `tools/make-marble-hand.mjs` prepares the hand model; [model provenance](public/models/marble-hand/PROVENANCE.md)
  records the source, geometry checks and rebuild process.

Run React Doctor against the current diff when changing React code. A past
diagnostic count or line number is not a current exemption; inspect the owning
code and preserve measured constraints when deciding whether a finding applies.
