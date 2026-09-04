# apps/lab

The demo and development app. Run it with `npm run lab` from the repo
root. `npm run dev` starts Vite only.

The lab imports only from `@petepetrash/munari`, the same way an
outside project would; `tests/boundary.test.ts` enforces this. If a
scene needs something the package doesn't export, add the export;
don't import package internals.

For a new scene or agent-driven visual change, use the
[task-to-owner guide](../../docs/agent-workflow.md) and
[system model](../../docs/system-model.md). Scene settings remain owned here;
the [proposed control descriptor](../../docs/agent-system-plan.md#p4-scene-control-descriptor-pilot)
is not an additional runtime API.

Each scene exercises a different part of the library. Three unlisted page
studies are direct links rather than promoted navigation: `?scene=controls`
turns one live HTML form into physical hardware, `?scene=plume` lets native
typed words leave as WebGL ink, and `?scene=marble-hand` replaces the pointer
with a reflected, shadow-casting classical marble hand.

Plume places centered serif writing on a plain background, with no paper
frame or surrounding labels. Tweak Plume opens its closed-by-default panel
for type, timing, particles, motion, colors, and status. It offers 36 tuning
values, four effect switches, Restore, Clear, Reset all, and Copy values.
Type changes replay the text with fresh paint-matched anchors. Timing and
spacing changes also replay it; other edits apply live or replay when idle.
Particle size is independent of particle spacing. Reset keeps the words.
One shared type rule aligns native
input, visible ink, capture, and a hidden text measurement; the writing
block stays centered as its line count changes and still scrolls natively.

Captured letter shapes leave as smoke. Every particle follows a swirling
flow field that carries it sideways as it rises, so the cloud tears and
folds instead of drifting in straight lines. Each puff is a soft, noisy
blob that grows and thins as it travels, lit from the upper left so the
mass has visible form, and particles pushed away from the viewer fade
toward the background color. Turbulence, Billow, Shading, and Depth fog
control the air; Depth sets how far particles travel toward and away from
the reader.

Particles keep the color of the ink they were captured from, so writing in
two colors evaporates in two colors. The Tint slider replaces that captured
color with the Particles swatch and starts at 0.

Release unit chooses what gets its own timer. Word is the default: a whole
word waits out the hold and then leaves together. Character gives every
letter its own clock, so a word typed slowly dissolves letter by letter in
the order it was typed. Character mode splits on what a reader sees as one
mark, so an accent stays on its letter and an emoji with a skin-tone
modifier leaves as one piece. The split changes no glyph positions: measured
drift against the plain text is 0.11px horizontally and 0px vertically.

Updraft, Ghost ink, Sparks, and Draft remain independent effects. Reduced
motion dissolves ink in place; without HTML-in-canvas the native textarea
keeps its quiet DOM fallback. `npm run gate:plume` checks particle shape,
color retention, character release, tuning, replay, input, and fallback.

Marble Hand uses a bold type poster over three full-screen fragment shaders,
drawn on a second WebGL canvas behind the native text: Waves is domain-warped
liquid silk, Tide is a luminous sea under a total eclipse with a lens flare,
and Prism is a kaleidoscope of dispersed glass. The top buttons select the
whole background, not only its colors. The page shows only the headline and
theme buttons; background controls and reflection notices live inside Tweak
hand.
Theme changes keep the hand's saved settings and the current pause state.

A cloned `<canvas>` is blank, so the page capture the hand reflects cannot
see that field. The reflection scene draws the same shader itself, on a
plane behind the captured page, from one clock both renderers read — the
page canvas publishes each second and the reflection takes that exact value.
Pause color holds that second in both; reduced motion freezes it at a fixed
one and draws a single frame. Nothing in the page animates any more, so a
settled poster costs the capture zero repaints. Without WebGL in the page,
each theme falls back to a CSS gradient and nothing throws.

It keeps one visible native HTML page under a pointer-transparent
overlay. Only the hand and its transparent shadow render over the page.
A source-only Surface captures a hidden, inert mirror of the full poster,
including headings, text, borders and other content. A private cube camera
uses that full texture for reflections; it never presents the page in WebGL.
Native colors still drive matching page lights and room bounce, as in Knobs.
Full-page reflections require HTML-in-canvas. Without it, the native page and
ordinary WebGL hand remain usable, with a reflection-limit notice in the
tweak panel.

The marble-hand page opens in Chrome mode with a parked preview and native
tweak panel. Reset all restores the user's chrome preset: roughness 0.364
and reflection strength 2.95.
It exposes orientation, size, movement, idle tap, marble, lighting, and
shadows, with view presets, reset, and copy values. Close the panel to resume
pointer motion.
Its Marble/Chrome switch uses separate finish settings: Chrome is bare
metal with no stone veins. Switching back preserves
the saved marble finish. Both modes use the same native page-derived room.
Reflections has a shared 1–120 fps update limit, with 120 fps as the default.
It does not slow hand movement, and unchanged reflections do not update.
Stroke adds a hand-only screen-space outline, with width, color, opacity,
and an on/off switch in both finishes. The default is 2 CSS pixels at
85% opacity. Its width is independent of camera distance and display DPR;
it does not change the shadow, reflection capture, or pointer hitbox.
When the pointer rests for 1.2 seconds the hand drums its three curled
fingers — middle, then ring, then little — and stops on the first move. The
pointing index fingertip does not move, so it still owns the click. The bend
happens in the vertex shader and is applied to the visible finish, the cast
shadow and the outline together. Idle tap sets the wait, the period and the
depth, and its switch turns the whole thing off; reduced motion and Motion
rocking off also stop it.

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
