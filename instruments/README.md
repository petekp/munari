# instruments

Browser probes and CI gates. Each section below says what one
instrument checks and how to run it. The bar for a file here: an npm
script, a section in this file, and no absolute paths.

Use the [task-to-owner guide](../docs/agent-workflow.md#route-the-task-to-its-owner)
to choose the smallest decisive check. `package.json` owns available commands;
`.github/workflows/ci.yml` owns CI membership. Keep GPU runs serial and read
each result: a successful capability skip leaves that behavior untested.
The [common evidence envelope](../docs/agent-system-plan.md#evidence) is a
proposed addition to these probes, not a format they all produce today.

## Public API, postcard, and text clarity

`npm run probe:postcard` checks the real postcard's handoff timing, companion
pixels, compositor scrolling, and desktop/mobile form input.
`npm run probe:api-targets` checks retained state and focus across layout parents.
The [API instrument guide](api-all-demos/README.md) describes these contracts,
the full demo sweep, composition fixtures, and their measurement limits.
These local probes are not added to CI.

`npm run probe:sharpness` compares native HTML with the default stationary mesh,
including inset/scaled canvases and explicit high-DPR cases. `npm run
probe:postcard-sharpness` checks the actual Home postcard with a hidden-mesh negative
control. Visible checks preserve native display density; density emulation is
explicit. The API instrument guide lists options and the 0.95–1.05 native text
contrast budget. Motion and handoff budgets remain separate.
The postcard comparison captures only within the current viewport and checks
that its light stays fixed. Beyond-viewport capture can temporarily resize
Chrome and move the light, invalidating a contrast comparison.
`probe:scene-sharpness` covers scene-only HTML. `probe:display-density` checks an
existing capture across display-density changes without replacing its content.

`npm run probe:api-regressions` covers PR #83's keyed target lists, same-canvas
capture-reader removal, continuous resize anchors, handle-swap focus, overflow
clipping during preparation, and content-attribute eligibility. It runs capable
Chrome and a separate no-flag profile. Use `HEADED=1` for native-density visual
checks, `API_CASES` for a comma-separated subset, and `API_PROOF_OUTPUT` for local
evidence. `API_SOURCE_ROOT` can point at a saved source revision for comparison.
The [API instrument guide](api-all-demos/README.md) states the pixel/anchor budgets.
This local command does not change CI membership.

## Home light and shadow

`node instruments/home-inline/run.mjs` checks Home in the actual site shell.
It moves the demo from (256, 0) to (360, 72) without resizing the browser, checks
lamp clamping and overlay placement, edits the same input through a postcard
round trip, and navigates away during a lamp drag. It verifies cleanup and Back
navigation in both capture-enabled and no-capture Chrome. An injected test-only
composition mounts two actual Homes with independent themes and postcard state.
`HEADED=1` uses the display's native density; `INLINE_OUTPUT` selects artifacts.
This is a local acceptance check; CI membership is unchanged.

`npm run probe:home-startup` builds and records the production landing route in
Chrome with an empty cache and a delayed entry script. No part of the page may
be exposed before its completed composition. The heading and postcard must
then stay within one CSS pixel, and the stationary button-shadow region must
stay within 0.01 normalized mean RGB error of the final recorded frame. On a
phone it samples the visible postcard shadow; the desktop check covers the
button shadow. A one-pixel clock outside the scene makes Chrome record static
fallback pages throughout the observation window. A
native-first reveal with a delayed shadow worker must fail both the readiness
and pixel checks. Mobile delayed fonts, no capture, no WebGL with failed fonts,
and a nonresponsive shadow worker exercise the fallbacks. The regular animated
entrance is also recorded. Home must not request other demo chunks. This checks
recorded compositor frames and visible ordering, not a network-independent
speed budget or flight continuity. Use `HEADED=1` for visible Chrome and
`STARTUP_OUTPUT` for artifacts, and `STARTUP_CASES` for a comma-separated subset.
See [decision #57](../docs/decisions.md#57).

`node instruments/home-startup/profile.mjs` measures production startup without
network delays or a screencast. It runs one fresh Chrome session by default.
`PROFILE_BASELINE` adds an alternating comparison against a directory containing
a saved `home/` scene folder and `index.html`. The rest of the application stays
current; this comparison isolates changes in the home scene and opening cover.
Timings cover both document entries, fonts, mask generation, renderer setup,
backdrop capture, composition readiness and the reveal. Worker timings come from
the worker itself. `PROFILE_OUTPUT` chooses the local build and result directory.
`PROFILE_PAIRS=2` or `3` explicitly repeats the comparison. Each browser closes
within 15 seconds even if a protocol call stalls; Puppeteer also cleans up its
own process group on interruption. The profiler refuses another build or launch
when the one-minute host load reaches 75% of the logical CPU count. Run it alone,
keep GPU checks serial, and do not treat overloaded-host timings as evidence.
This is a local diagnostic, not a portable speed budget or a visual gate.

`node instruments/home-startup/mask-fidelity.mjs` compares every shadow-mask byte
with the original dense transform on the actual desktop and phone layouts.
It covers DOM Canvas2D, OffscreenCanvas, fractional overlapping boxes, clipped
edges, empty kinds and saturated gaps. It also checks identical-headline reuse
and invalidation by a same-width text change. `MASK_OUTPUT` chooses the evidence
directory. The frozen `maskReference.mjs` is an independent test oracle. The
startup and mask checks bound each browser to 30 seconds and close it afterward.
See [decision #58](../docs/decisions.md#58) for the exactness requirements.

`npm run probe:home-headline` checks the real landing page's monospace HTML,
extruded 3D geometry, shader colour, pointer response and native selection.
The inline route must contain no scene iframe. Its black shader control compares glyph contrast with the same native text;
the 0.95–1.05 contrast range matches the existing sharpness checks. A half-density
render must lose contrast. It also checks mobile layout, reduced motion,
3x parent zoom, no-capture rendering and the native no-WebGL fallback.
Use `HEADED=1` for visible Chrome and `HEADLINE_OUTPUT` for its evidence directory.
Decision [#56](../docs/decisions.md#56) records scope and limits.

`npm run probe:heading-edges` checks the native heading's shadow-mask fringe
in a 3x zoomed iframe. It compares the current receiver clearance with a zero-
clearance control, keeping the cast-shadow field unchanged. A page-only receiver
provides the reference around the ink. Normal and selected lettering must each
reproduce the defect in the control, remove at least 99% of conspicuous fringe
pixels, and preserve the opaque ink core. The selected case positions the light
over the letter so its shadow actually overlaps that footprint. `HEADED=1` uses
native display density; `TEST_DPR` can reproduce another density, and
`LIGHT_PROOF_OUTPUT` chooses the artifact directory. Decision
[#55](../docs/decisions.md#55) records the clearance and limits.

`npm run probe:home-light` renders the actual landing-page shadow shader against
known geometry. It checks separated shadows from thin silhouettes, one visibility
result for coincident casters, raised receivers, a finite-source penumbra, and
heading shadows staying behind the foreground postcard. A page pixel still
receives the heading's shadow as a control. Decision [#50](../docs/decisions.md#50)
records the model and the combined scene.
The same edge is measured at 6px and 22px above the receiver: its 10–90% softness
must grow by more than twofold, without intensity reversals or large pixel jumps.
A point-light control must keep the higher edge sharp. These profiles read the
shader's visibility before tint and exposure, then the page checks inspect the
complete composited result.
At the actual default heights, another pair moves the bulb across the page.
The rounded bulb must broaden the distant edge beyond a control whose emitter
is parallel to the page. The gallery check then moves the real light control
around a real example image and measures its shadow offset and softness from
the completed lighting draw. It saves both page screenshots and raw light fields;
the source content and production renderer settings are unchanged by the observer.

The same run drags the real landing-page light, moves it with the keyboard,
changes its distance, and captures desktop, mobile, and the full website shell.
It checks the selection shortcut, limits raised geometry to the selected line,
double-clicks uncovered native heading text, and types into the scene.
The full website is checked at 390 and 320px, including entry and return after
resizing. Captures wait for the relief field belonging to the current layout.
Separate Chrome profiles check lighting without HTML capture and native content
with WebGL disabled. `HEADED=1` preserves native display density;
`LIGHT_PROOF_OUTPUT` chooses an output directory and `CHROME_PATH` selects Chrome.
Evidence stays outside the repo. This local probe does not change CI membership.

GPU timer queries report the complete lighting redraw, including the paper's
shadow map and native-density receiver draw, when supported and valid. CPU work and the separate
bulb/card renderers are excluded.
Frame intervals describe this machine, not a portable performance gate.
Native silhouettes use 64 deterministic rays toward a spherical light source.
Curved paper uses filtered depth maps; this is not a path-tracer comparison.
Postcard handoffs and scrolling remain `probe:postcard`'s contract.

`npm run probe:home-lamp` checks the lamp on the actual landing page. It moves
the glass over heading ink and compares its pixels with emission disabled,
an index of refraction of one, and a changed native heading color. These controls
separate the filament, refraction, and live page capture. It checks that the cord
bends while keeping both ends attached, then captures a stationary scene postcard,
scrolling, mobile widths, and the no-capture Chrome fallback. The latter retains
glass reflections and emission but cannot refract page content.

The probe reports lamp GPU time and frame intervals; these describe the current
machine. Lamp motion alone must not repeatedly repaint the captured page.
`HEADED=1` keeps native display density; use `STRICT_CAPABILITY=1` to require
the enhanced path. `LAMP_OUTPUT` selects an evidence directory outside Git.
The observer and optical controls are injected into the served copy only.
Decision [#52](../docs/decisions.md#52) records the optical and cord limits.

`npm run probe:lamp-quality` checks a 3x pinch-zoomed parent containing the real
home demo in an offset iframe. The lamp must use display density times the parent
zoom, crop its buffer to the visible area, and keep refraction aligned with live
heading content. With emission disabled, its edge error must be below 65% of the
stretched-bitmap control against a supersampled reference. Separate pixel checks
require light across the glass and outside its silhouette. Both capture-enabled
and no-flag Chrome run through the same zoom test. `HEADED=1` retains native display
density, and `LAMP_OUTPUT` chooses an evidence directory outside Git.
Decision [#54](../docs/decisions.md#54) records the zoom and emission corrections.

## Flexible postcard

`npm run probe:postcard-edges` freezes a curl on the real page and compares its
composited silhouette with a supersampled lighting draw. A half-density draw
is the negative control; native edge error must be below 65% of that control.
The test reads the actual mesh alpha to select boundary pixels, checks that
the reference buffer was not clamped, and exercises a larger 4x-density window.
The lighting band must retain native density and cover the viewport when its
offscreen margin shrinks to fit the browser's buffer limit. `HEADED=1` preserves
native density for the main comparison; `PAPER_OUTPUT` selects the evidence folder.
`EDGE_BASELINE_ONLY=1` saves a before image without asserting the new contract.
All pose and density controls affect only the served copy. Decision
[#53](../docs/decisions.md#53) records the rendering change and measured result.

`npm run probe:postcard-paper` checks the real paper mesh, its rendered outline,
corner response, stamp impulse, native field input and exact return. A flat
geometry control runs with `PAPER_FLAT=1`; it must remain planar and produce
the corresponding straight-edged outline, including where the postcard covers
heading ink. Covered letters must not create alpha holes. The probe keeps the display canvas's
buffer only in its served copy so it can inspect rendered alpha. Its timing is
diagnostic; `probe:postcard` retains the unrecorded frame-gap contract.

`PAPER_RECORD=1` saves a short Chrome sequence and encodes `postcard.mp4` with
ffmpeg. `PAPER_OUTPUT` selects the output directory, `CHROME_PATH` selects Chrome,
and `HEADED=1` uses visible Chrome at native display density. Recordings and
screenshots stay outside the repository.

`npm run probe:postcard-paper-shadows` checks the actual lighting renderer with
a known curl. The curved geometry must change the cast shadow and shade visible
parts of its own surface. Removing only the shadow-depth texture is the control;
the flat sheet must remain free of self-shadow acne. Adding an elevated heading
plane must leave the curved paper's pixels unchanged. This check needs WebGL2
floating-point render targets but does not need HTML capture. These are local
commands; CI membership is unchanged. Decision [#51](../docs/decisions.md#51)
records the model and its bounds.

## Detail issue regressions

These local Chrome checks cover the September 2026 issue batch. They require
HTML-in-canvas and run serially; `HEADED=1` preserves native display density.
They do not change CI membership.

- `npm run probe:surface-textures`: late capture growth/shrink must draw the
  current colors with no GL error; pinned resolution is the control. Lit
  white, color, and emissive samples at full, half, and quarter alpha must
  retain coverage within two 8-bit channel values, including filtered edges
  and rounded transparent corners. `API_PROOF_OUTPUT` selects saved evidence.
- `npm run probe:surface-parts`: recover from duplicate part names after
  removing either host. Eight cases cover page/scene wiring and normal/Strict
  Mode mounts, retained input identity/value, and actual red/green pixels.
  Duplicate diagnostics remain expected; `API_PROOF_OUTPUT` selects output.
- `npm run probe:detail-focus`: native editor Tab/recall, first camera drag
  and wheel during a tween, panel pose after hover/focus, and orbit proxy
  placement after damping. Explicit resynchronization may correct at most
  1 CSS px. `DETAIL_CASES=35,40,52,55` selects cases; `DETAIL_OUTPUT` selects output.
- `npm run probe:detail-motion`: early Unroll cancellation, mouse and keyboard
  Genie restoration, a Copy flight still, and Lamp's first post-release pose.
  Genie spring composition and Copy's full normal are checked numerically by
  the scene tests; the stills are visual smoke checks. `DETAIL_MOTION_CASES`
  selects `unroll,genie,copy,lamp`; `DETAIL_MOTION_OUTPUT` selects output.
- `npm run probe:detail-tuning`: actual Refraction/Gallery slider changes must
  reach the same mounted GPU targets and pointer field. Also checks Glass's
  blob-count override and Crystal's held key. The field observer exists only
  in the instrument's served copy. `API_PROOF_OUTPUT` selects output.

Decision [#48](../docs/decisions.md#48) records the corrected contracts and
the distinction between numerical, browser-input, and pixel evidence.

## capture-engines

Every capture engine holds the same source laws, against its REAL
rasterizer. `npm run gate:capture-engines`. Local; CI membership is
unchanged.

The paint conformance suite runs these laws against a fake rasterizer,
which proves the shared helper's arithmetic and nothing about pixels.
This gate runs them once per engine in a browser and judges:

- the capture holds the DOM's colors (worst channel within 4/255 of the
  CSS values on both flat halves — 0/255 measured on both engines),
- a still subtree paints 0 times in a 2s window,
- eight mutations in one task produce one paint, not eight,
- the host is born painting nothing and `setHostPainted` round-trips,
- the parked host is `position: fixed` at the viewport origin, at the
  asked-for box, taking no pointer events,
- the receipt after a resize names the new box, and `resettle()` cuts
  the backing store to exactly that box,
- **both engines draw the same pixels for the same subtree**, in two
  states. The fixture holds one of everything a structural clone cannot
  inherit, because a subtree that needs nothing rebuilt proves nothing about
  the engine that rebuilds it:
  - a `::placeholder` and an `appearance: none` checkbox wearing a
    `:checked::after` tick, the two things snapDOM drops upstream
    ([platform #24](../docs/platform.md)),
  - a headline set in a face declared by a stylesheet on **another origin**,
  - an image whose bytes have to be inlined (`mark.png`, 48×48, four flat
    quadrants behind a disc — any stable image would do; flat color keeps
    the resampled stage from turning every tolerance into a judgment call).

  The guest origin is a second port `run.mjs` serves, sending the CORS
  header a font host sends. A different port is a different origin, so the
  sheet is opaque to `cssRules` exactly as a hosted one is. A different
  hostname is not an option: `localhost` resolves to ::1 on macOS and a
  server bound to it refuses `127.0.0.1` outright.

  The fixture also reports whether it covered anything — the sheet still
  opaque, the guest face resolved, the image decoded — and the run fails if
  any is false. Two engines agreeing on a fallback face is a pass that
  proves nothing, and `document.fonts.check()` reports exactly that pass: it
  answers true for a family the document has never heard of, because the
  fallback it would use is available. The array `fonts.load()` hands back is
  the honest probe.

  Judged on 4×-downsampled blocks: SVG rasterization and direct compositing
  disagree on glyph and hairline EDGES by a subpixel, while a structural
  fault is wrong across whole blocks, so averaging first separates them.
  - `rest` — whole-number density, no floor. 0 of 3000 blocks differ; 88
    differ (worst 222) when the faces are read once per document and a
    cross-origin sheet is skipped, which is the regression that shipped
    ([decisions #62](../docs/decisions.md)).
  - `carried` — 2.4× across and 0.957× down after a resize the density band
    absorbs, so every glyph edge falls between samples and the law is on
    the block mean: 0.19 today.

  Two provocations measured on the smaller fixture this replaced: 7 blocks
  (worst 156) at rest with the field shim removed, and a carried mean of
  37.59 when the rasterizer answered at its own size and the source
  stretched it.

  On a failure all four PNGs are written to a temp directory the run names.

`main.ts` measures; `run.mjs` drives the page once per engine and
judges. The capability policy is asymmetric on purpose: HTML-in-canvas
rests on an origin trial, so its absence warns and the run continues on
snapDOM alone (`STRICT_CAPABILITY=1` makes the absence a failure).
snapDOM needs only a document, so a snapDOM failure is always real —
which is what makes this gate runnable on a machine that cannot run
`idle-zero` at all.

## idle-zero

CI gate: mounted quiescent Surfaces cost **0 paints/s**.
`npm run gate:idle-zero`.

- `main.ts`: the page under test and the assertion. It mounts N
  sources, measures paint deltas across a quiet window, then provokes
  a real DOM mutation. Without the provocation a zero-delta result
  proves nothing; the mutation shows the `onpaint` wiring was live.
- `run.mjs`: transport. It finds Chrome, proves the origin-trial
  surface exists, serves the page, drives it, and judges the numbers
  under a hard 90s deadline.

Two policies in `run.mjs` are the durable part; copy them into any
future browser-driving instrument:

- **Capability absence is environmental, not a regression.**
  `drawElementImage` is an origin-trial API, so a Chrome without it
  makes the gate warn and exit 0. `STRICT_CAPABILITY=1` turns that
  into a failure where the capability must exist. Past a successful
  capability probe, everything fails for real: a page error, a
  timeout, or a nonzero idle delta.
- **The launch flags are part of the measurement.**
  `--enable-features=CanvasDrawElement` plus
  `--disable-backgrounding-occluded-windows` and
  `--disable-renderer-backgrounding`. A backgrounded renderer stops
  compositing, which would produce the zero-paint result for the
  wrong reason. Drop the flags and the numbers come from a browser
  that cannot do what is being measured.

## frame-surface

Checks that a public `FrameSurface` — the caller-owned canvas path
behind `@petepetrash/munari/advanced` — draws the generation it reports,
and that its optional presentation fence rejects non-writing and
off-screen passes. `npm run gate:frame-surface`.

The page runs a demand frameloop and reads WebGL pixels inside the mesh's draw
receipt. It first replaces one live source with another. It then releases and
reacquires the same persistent source three times. Each release publishes two
frames before reacquisition. The gate requires receipts
`[A0, A2, B0, B2, B4, B6, B8]`, a fresh surface epoch for each hold period,
no stale receipt, no clear or wrong-color acquisition render, and sampled RGB
within one channel value. It also checks that live replacement preserves the
mesh, geometry, and material, and that the public default unlit material is a
non-tone-mapped `MeshBasicMaterial` with an sRGB canvas texture. A separate
pass draws with color writes disabled, then through an off-screen target, and
finally through the default framebuffer without a new source publication. It
requires one unchanged frame receipt and one presentation receipt from only
the final draw. A third pass resizes the source backing store and verifies the
reallocated texture at its new dimensions.

R3F currently creates its Canvas reconciler root without strict effects.
Wrapping either the DOM root or Canvas children in `StrictMode` does not prove
an effect rehearsal there. This gate makes no StrictMode rehearsal claim. Its
three explicit release and reacquisition cycles test the lifecycle directly.
This path uses an ordinary `CanvasTexture`; it does not use or enable
`CanvasDrawElement`.

## genie-film

Checks that one video decoder and one frame canvas stay current through
repeated Genie handoff changes. `npm run gate:genie-film`.

The required gate runs two minimize and restore cycles with maximum-quality
compositor frames. It requires
stable decoder, canvas, and source identities; monotonic frame generations;
exact pixel and presentation receipt tuples; ordered native reveal before
renderer release; complete landings; and no black or uncovered compositor
frame. It then loses the WebGL context while WebGL has presentation authority
and requires immediate native state and receipt fallback. Native video loop
events are reported separately from handoff-induced media events.
The Genie route uses HTML capture for its window chrome, so this gate launches
Chrome with `CanvasDrawElement` enabled.

`npm run gate:genie-film-context` is the focused stressed compositor check.
It runs one cycle at 6x CPU throttle, then loses the context and requires that,
after the first matching native frame, no later frame regresses to stale WebGL
pixels.

The 24-cycle, 6x CPU version is a deliberate soak, not a normal completion
gate: `npm run probe:genie-film-soak`. It keeps the original 240-second
watchdog and pixel thresholds. The throttle is lifted after the screencast
stops because the remaining work decodes evidence rather than exercising the
scene; each screenshot is read back once. A full soak takes about 115 seconds.

## genie duplicate drag

Checks that a restored window does not leave its final WebGL image
behind when the live DOM window moves. `npm run gate:genie-duplicate`.

The gate restores the square window at Retina density and 6x CPU throttle,
then starts a real title-bar drag as soon as the DOM copy becomes observable.
A DevTools screencast checks the old and new rectangles in every compositor
frame and requires zero frames with both copies. It then starts a new minimize
in the reveal commit. The second flight must get a fresh component lifetime
and reach the dock instead of inheriting the prior flight's landed state. Use
`HEADED=1` to exercise the real GPU compositor path.

## genie shadow handoff

Checks that translucent window shadows keep the same opacity while
presentation moves between DOM and WebGL. `npm run gate:genie-shadow`
measures the fixed shadow strip in every compositor frame around both
handoff directions. It also checks that the shadow travels with the
sheet and fades only where the funnel has squeezed it past legibility.

## knobs-hz

Reports Knobs throughput at a fixed 1440×900 viewport and DPR 2.
`npm run probe:knobs-hz` prints per-phase frame statistics against an
8.33 ms reference budget. It is a reporter, not a gate.

The browser runs headed with vsync and the frame-rate limiter off, so
`requestAnimationFrame` deltas describe free-running throughput, not display
cadence or isolated CPU/GPU time. Four phases: `idle` (the standing animation),
`art-` (idle with the SVG artwork hidden; the difference is the
artwork's raster share), `drag` (a held dial sweep through the real
input path), and `off` (POWER off, the demo's floor). Two honesty
checks print before the table: the drag must move the hue value and
the POWER click must drop the power flag, both read from the live law
module. A phase that failed to engage would measure idle twice. The
GPU string prints first because SwiftShader numbers describe
SwiftShader, not your GPU.

## knobs-resize

Checks that physical Knobs hardware stays on the live DOM layout through
each resize step, including the one-column to two-column breakpoint. Run
`npm run gate:knobs-resize`. It compares the slab geometry with the measured
panel box and projects both the DOM hue marker and its WebGL marker. The
allowed offset is fixed depth parallax; an anchor from the prior layout is a
large jump and fails the gate.

## dom-surface-demand

Checks that a successful DOM paint wakes an idle demand renderer and
keeps its paint, draw, and presentation identities consistent.
`npm run gate:dom-surface-demand`. The gate uses the real Workspace
route in a probe-only demand mode. It mutates and resizes one static
product panel without calling `invalidate`, then requires a newer
presented generation and changed framebuffer data. It also checks
that draw and presentation receipts name the same source generation.
The gate has the standard `drawElementImage` capability policy.

## degraded

CI gate: every lab gesture in a browser with no origin trial.
`npm run gate:degraded`. It launches Chrome **without**
`--enable-features=CanvasDrawElement` — that omission is the gate — and
skips loudly if the browser turns out to have the trial anyway.

A Surface without the trial keeps its DOM and reports the reason, so
nothing throws and nothing looks broken from outside. What breaks is a
gesture that arms a transition only a renderer can finish: the scene
enters a state no further input can leave, and it does so silently.
That shape shipped four times before anyone noticed — the knobs panel
carry and resize had no consumer, genie's minimize waited on a flight
that could not take off, flight's drag waited on the same thing, and
logo offered a WebGL segment whose Canvas never advanced a frame
(2026-08-23). The other gates all launch capability-enabled, which is
also every machine anyone develops on, so this path was the one nothing
exercised.

Per scene: flight carries a card across columns and requires the board
to reorder **while the pointer is still down**, the card to stay under
the hand within 4px, and delete to remove exactly one card; genie
minimizes a window to the dock, restores it, and drags one by its
titlebar; knobs moves its panel by the carry handle and resizes it by
the grip; selection drags over the prose and requires real characters
selected; logo requires the word on the page and the renderer toggle
absent. Every scene must also finish with an empty console — a scene
that throws is a blank page, and that is how the Safari fault stayed
invisible.

Every clause here was falsified before it was kept: a plausible bug was
reintroduced and the gate had to report it. Two that could not fail were
removed rather than repaired. The logo scene animates continuously, so
"a control moved the word" passed whether the control was wired up or
not.

## lab-interactions

Checks the real public lab routes through a capability-enabled browser.
`npm run gate:lab-interactions` tabs into Workspace content, clicks its
captured checkbox, recovers camera control after a panel drag, and checks
Glass, Knobs, Optics, and Explode pointer paths. It then deletes two Flight
cards, checks their column counts and two-layer drag shadow, and verifies
that a held card keeps rendering and lands without further pointer movement.
It also taps a card to float it, re-grabs it through the canvas, and checks
that movement and release reach the scene. Rendering must stop after both
landing cleanups. It also samples Logo's two
renderer handoffs for blank frames. This gate is the
regression contract for the lab
faults found in manual QA on 2026-08-18. It uses `&bare`, which can omit scene
HUD content; its Explode check proves camera movement, not interaction with
every omitted paint layer.

## genie-film-reorder

Checks that Genie replaces its old live normalized film rectangle with
the keyed anchor from the successful outer DOM paint.
`npm run gate:genie-film-reorder`. A probe-only airborne source
exchanges the titlebar and film order without changing the outer sheet
size. The gate requires a newer accepted paint and moved film UVs,
then proves the native window stays visible until the required film
frame earns a qualifying presentation receipt.

## shader-compile

Checks that the lab's shaders compile and link. `npm run gate:shaders`.
A shader is a JavaScript string until a browser compiles it, so
nothing else in CI can tell a working one from a broken one:
typecheck, lint, and the unit suites all see a string. This gate hooks
`compileShader` and `linkProgram` from inside the page, walks the logo
scene through the states that build materials (page, scene, extruded,
bump-only relief, back to page), and prints every info log against its
own source lines.

The walk covers only the programs its states construct. A new material
needs a new state here.

It exists because a shared GLSL block once dropped two sampler
declarations: used in both stages, declared in neither. The unit suite
guarding that block passed, because it checked that no uniform was
declared twice, never that each was declared at all. The failure
surfaced two commands later as a phase-wait timeout inside the
crossing-flash gate (2026-08-14, since removed). This is the cheapest
gate in the repo and the one the others assume.

## lifting-pointer

CI gate: input and hover follow the displayed content during handoff
(decisions.md #33). `npm run gate:lifting-pointer`.

The current fixture keeps one live button and records the accepted presentation
at each click. It checks page and scene clicks, three offsets within a 700ms
preparation window, and native hover during preparation. The initial scene
request must also tolerate asynchronous renderer mounting.

Page/scene requests must agree with visible content and `Surface.Scene` lifetime.
After return and cleanup, the custom child's frame subscription must stop. A
static scene hold must let the demand renderer become idle while its presenter
remains mounted. Native-versus-relayed delivery is measured by the separate
native-pointer gate, not inferred from two supposed React instances.

The original 2026-08-19 failure involved two copies and routed 3/3 preparation
clicks to the hidden one. That is historical context; this fixture now checks
the retained-content API.

## native-pointer

Local gate: the native pointer route (decisions.md #39), driven for the
through the library. `npm run gate:native-pointer`.

One exclusive Surface opts into `pointerRoute="auto"` in the gl phase.
The gate's discriminator is `isTrusted`: the relay's synthetic dispatch
can never set it, so a source-copy click record with `trusted: true` is
proof the browser itself delivered the pointer through the rig.

The judged clauses: a rest click and a default-route gl click are the
liveness baselines (native page hit, then the synthetic relay); asking
for `'auto'` on a flat pose dresses the parked canvas exactly as
`nativeRoute.ts` says (matrix3d from `transform-origin: 0 0`,
`visibility: hidden`, z lifted, drawn root visible); a trusted click at
the projected button reaches the real element; real `:hover` engages
and the `data-hover` twin follows it on and off; a click focuses the
real input and typed keys land in it; a 30°/12° tilt moves the
projected box and still takes the trusted click; and returning the
request to `'relay'` restores every written style and the relay hears
again. Clicks aim at the content's own `getBoundingClientRect()` —
under the worn pose the browser's rects ARE the projection (platform.md
#19: 0.01px), so no gate-side matrix math can drift from the rig.

The input is controlled above the Surface. After typing through the native
canvas route, the gate returns to the page, verifies the value, edits it there,
and re-enters the canvas. The same retained element must contain the edited value.

What it deliberately does not judge: the OS cursor. Whether Chrome
applies an unpainted canvas child's `cursor` is #39's open question and
no API reads the pointer's actual glyph, so the gate prints where the
hit-test landed and the answer needs `HEADED=1` and an eye on the
target. The pose-hold paint economy (0 paints/frame, platform.md #21)
is pinned by the cover-clip spike and not re-measured here.

## fisheye-pointer

Local gate: deformed-pose hit testing, pressed with a real mouse.
`npm run gate:fisheye-pointer`.

Drives the lab's fisheye scene (`?scene=fisheye`), a 28-row triage
queue whose mesh is warped on the CPU by an anchored magnifying lens
that scales BOTH axes by the same local factor (fisheyeLaw.ts). At the
scene's defaults the lens moves a rim row by 60px — nearly three 22px
rows — and moves off-center targets sideways by 85–107px, so the
warped and flat predictions name different targets on both axes and a
press can only satisfy one. The scene's `window.__fisheye` probe
computes expected screen points from the law and the live panel rect;
the runner supplies trusted clicks and keystrokes and judges which
handler ran.

The judged clauses: a flat-lens click reaches its own row through the
relay (liveness), clicks at three displaced row centers under a held
lens reach the rows whose pixels are there, a click where the FLAT map
says row 12 lives reaches the row the law says is presented there (the
y counter-clause a flat-pose raycast would pass), the done button —
107px off its flat x — fires its own handler without triggering its
row while a press at its FLAT x hits only the row (the x clause and
counter-clause), hover at a displaced center stamps `data-hover` on
the displaced row, a click on the displaced filter input lands focus
and five real keystrokes narrow the queue (no key is ever forwarded —
focus routing is the whole test), and with the lens riding the live
cursor the fixed-point row takes both hover and click while the
amplitude is engaged. That last clause drives a deliberately coarse
event stream (~50px per event over 22px rows): each event raycasts the
pose of the frame it arrived in, so before the presenter's re-route
(decisions.md #33, amended 2026-08-20) the settled hover sat more than
a row stale and never corrected — the clause is the browser proof that
routing now follows the presented pose after the hand stops. A
vertex-shader warp — geometry flat, pixels bent — fails every
displaced clause and passes the counter-clauses.

## slider-drag

Local gate: a drag under traveling glass, pressed with a real mouse.
`npm run gate:slider-drag`.

Drives the lab's slider scene (`?scene=slider`), a 5,000ms trim track
magnified by the fisheye law — with the anchor's owner changing hands
on grab: hovering, the lens follows the cursor; holding the thumb, the
lens rides the THUMB, so the magnified ruler travels with the scrub
while the value maps 1:1 from the hand (plus the grab's own offset, so
a press never teleports the value). The scene's `window.__slider`
probe computes expected points from the law and the live panel rect;
the runner presses, drags, and releases.

The judged clauses: a flat-lens grab and drag releases at the
predicted value (liveness), a press at the thumb's displaced position —
58px off flat, four thumb widths — grabs it (a flat-pose raycast hits
bare rail), the warped drag releases exactly at valueAtPress + Δpx
with the grab offset holding through the anchor handoff, the lens's
focus sits ON the thumb after every drag (the riding check — a lens
left where the cursor was fails it), the held glass never collapses
mid-scrub, a press at the thumb's FLAT position under the warp grabs
nothing and moves nothing (the counter-clause), and the real-user
path — hover in, grab at the lens's own fixed point, scrub — lands the
same predictions. The drag itself never touches the relay: trusted
window moves drive both the value and the focus.

## gallery-pointer

Local gate: mid-crossing, the gallery item that hears the pointer is the
item you can see at that point. `npm run gate:gallery-pointer`.

The scene draws two live documents in one sheet and decides per fragment
which of them a pixel shows. Hover has to make the same decision at one
point, on the CPU. It does that by giving each item its own presenter and
letting the aperture partition the plane: each mesh declines the ray
wherever the other item is on screen, so Munari's relay carries the event
into whichever subtree its own mesh accepted.

That partition is a second copy of the shader's aperture, written in
JavaScript against the same render targets read back off the GPU. Two
copies of one law fail in a way nothing else here catches: the picture
stays right, because the shader is untouched, and only the pointer goes
to the wrong document. No screenshot shows it and no diff reads wrong.

The gate walks a real mouse over a 13×9 grid and reads which card wears
`[data-hover]`. One scrub step into the crossing all 85 reachable points
must relay to the item being left; one step short of the landing all 85
must relay to the item arriving; at the midpoint both must hear part of
the sheet.

The teeth are the midpoint clause. For each grid point the gate compares
the sheet against two reference frames — the same sheet parked at each
end, with the arriving one sampled through the approach zoom — and the
item that heard the point must be the item its pixels are nearer. That
measures the CPU copy against what the GPU drew rather than against
itself. Points where the two items look alike are skipped, and so are
points on the front, found from the routing map rather than the field: a
point whose four neighbours do not all route the same way is on it.

Measured 2026-08-24 at the committed tuning: 32 of 34 judgeable points,
94%, against a 90% floor. The floor is not 100% because the router
deliberately ignores the drop's bend — up to 26 CSS px of local
displacement — and applies only the approach zoom the whole sheet shares.

The counter-clause, run the same day: swap the field the router reads for
a plain horizontal ramp. The ends stay correct, because the sweep carries
the threshold past both of them, and the sheet still splits, so the other
clauses pass unchanged. The midpoint clause fell to 20%.

## refraction-arriving

Local gate: the refraction scene's *arriving* document is a live layout
and it is the only thing on the sheet at the end of the crossing.
`npm run gate:refraction-arriving`.

That scene puts two documents in one material. Only one is presented;
the other is a resident source, sampled by handle through
`useSurfaceTextureOf` and drawn nowhere in the scene graph. Both claims
fail silently — a stalled capture still draws, it just draws a picture,
and a transmission short of 1 leaves the leaving page faintly on top
forever.

The teeth are a figure switch inside the LEAVING document, square to
grid: the sheet must change at the start of the crossing (measured 6.8
on a 12×12 luminance signature) and must not change at the end (0.0).
Liveness is a full-resolution luminance sum over the sheet while the
crossing is parked at its end and nothing is touched — both documents
print the same shared clock, so a frozen capture holds that sum still.

Everything that reads the sheet's pixels at the end of the crossing
parks at t = 0.999, one step of the scrub short of the landing, because
at t = 1 there is no sheet left to read. The stage numbers there are
relief 8.3e-16, transmission 0.999997 and zoom 1.0000007 — the landing's
picture, still drawn from a texture.

A third clause checks the landing itself: at t = 1 the scene must hold
no mesh, the GL rect over the sheet must be empty, and the browser must
give a caret at all thirty points sampled across it, all of them inside
the arriving document. Both halves are needed, because a canvas that
still covers the sheet passes the caret test on its own — the pointer
relay lets the hit through to the DOM underneath. That was the scene's
real state until 2026-08-22: it lifted at any scrub above zero and never
landed, so a GL layer sat over the page forever and none of the words a
viewer had just watched arrive could be selected.

One more clause guards the crossing's own mechanics: the midpoint is a
front and not a crossfade. Of the cells where the two documents differ,
at least a quarter must match one of them exactly. A global blend scores
zero there by construction, and no simpler statistic works, because
contrast cannot tell a working bend from a broken blend: the revealed
part of the sheet is genuinely softer than either endpoint.

Read the measured share against the glass, not on its own. Everything
optical in the scene — the bend, the dispersion, the room reflection,
the rim — lives on the drop's meniscus, so most of what the drop covers
is the arriving page shown straight. The committed tuning measures 59%,
and it measures 59% with the mirror dragged to 0 and to its maximum
alike. The 25% floor leaves room to retune the drop.

Before the drop rewrite on 2026-08-22 the same front scored 37%: the
glass was then a relief of the leaving page's ink, so the reflection sat
on every glyph edge on the sheet rather than on a thin band.

What this gate no longer checks is the raking light. It used to sweep
the pointer the width of the panel and require that more than 2% of the
sheet's pixels moved by eight luminance units or more (measured 4.2%,
against a mean that shifted by 0.002 — the highlight lives on glyph
edges, so a mean is blind to it). The committed tuning now ships with
`sheenAmount` at 0, which multiplies the light out entirely, and the
pointer drives nothing else in the scene. Turn the sheen back up and the
check is worth restoring.

The gate also pins the law's three stage numbers at `t = 0.5` against
the material's own uniforms, which catches the r3f uniform-copy trap
(`apps/lab/src/scenes/candidates/README.md` gap 1), and it stands in as
a compile check for the scene's program: a shader that fails to link
draws nothing and the coverage clause reads 0 instead of the full rect.

## crystal-pointer

Local gate: the key you SEE under the crystal cursor's tip is the key the
click reaches. `npm run gate:crystal-pointer`.

The crystal scene floats a cut solid of glass over the whole page — a real
stone with a crown, a girdle and a pavilion, not a picture of one — and
traces a ray through it: into a crown facet, bouncing between the inside
faces until its light runs out, then out through the pavilion and across the
air gap to the page. At the pointer's own hotspot the page arrives 48.1
CSS px away from where the hand is, against a 52 px key pitch on the pad
underneath. The DOM never moved, so a click delivered at the hand's own
coordinates lands on the next key down from the one the eye picked. The scene
closes that by handing Munari's relay the same trace the shader drew with,
through the authored `raycast` prop.

That is two copies of one function, which is the shape of bug this repo is
worst at noticing: the picture comes from the shader, so it stays perfect
while the copies drift, and only the click goes somewhere nobody looked.
`crystalLaw.test.ts` pins them by transcription, which catches an edit to
one and not the other. It cannot catch a disagreement about what the numbers
MEAN, and this gate can, because the two only ever actually meet in a
browser.

Six clauses. With the scene's correction switch off, a click at a key's
own layout box types that key — which also fixes the frame the other two are
measured in. With it on, the same click types a DIFFERENT key. Then the
pixels: two frames grabbed with the hand held still, one per switch
position, so the crystal's pose is identical in both and everything optical
cancels in the difference. What is left is the hover twin moving from one
key to another, drawn through the same glass, and the tip has to sit inside
the patch that came on.

Measured 2026-08-26 at the committed tuning, aiming at G: 2100 px came on
and 1535 px went off across the window, and inside a 6 px disc at the
hotspot 23 px came on against 0 that went off. The disc's count scales with
`scalePx` and has to be re-derived when the stone changes size — at
`scalePx: 9.75` the same disc read 50 px.

"Came on" means DARKER. The pad is lit paper and the highlighted key fills
near-black, so the sign that says which way the highlight moved is a palette
fact, not a physical one. `SIGN` in `__diff` is the only place it lives.

The last clause counts pixels rather than averaging their brightness, and
that is not a detail. An average over the same disc is a tug of war: the
disc is a fixed 6 px circle and the hotspot sits inside the silhouette, so
part of it reads undisplaced page that gets darker as the old key's
highlight leaves. A count ignores that; an average would need its floor
retuned every time the edge profile moved.

This clause failed once at a flat-topped version of the solid, and the
reason is worth keeping. A slab with parallel faces deviates nothing at
normal incidence, so a flat top is a window over its interior and a lens
only at its rim — 12 px in along the arrow's axis there were zero displaced
pixels at all. The median displacement over the crystal's interior pixels
was 2.7 px against 21.2 at the hotspot. The fix was the shape, not the gate:
crown facets sprung from the girdle now cover 78% of the outline's area and
the same median is 130 px. The stone was later cut a pavilion as well, so
the exit face is not flat either.

The fifth clause moves the hand, and the four above are why it has to. They
all hold the hand still, which is not a simplification but a blind spot: the
raycast reads the pose the last DRAWN frame used, so with the hand parked the
pose and the pointer cannot disagree, and every clause reads the one case that
works. Sweeping 360 px at about 1000 px/s puts the drawn pose a frame behind
the hand, and the clause records where the relay actually delivered each move.

Measured 2026-08-26: 67 px median from the hand and 99 px worst, against a
ceiling of 130 and a designed bend of 48.1. Tracing the HAND's position
through a crystal that has not caught up to it read 160 px median and 180
worst, and held a key lit for 19 of 46 samples against 38 — keys three away
from the cursor lighting up, with long stretches of nothing lit at all.

The reading comes off the relayed event rather than off which key is lit,
and that is the same trap the pixel clauses set for themselves. When the
correction is wrong it mostly returns no correction, and the key under an
UNcorrected pointer sits 12 px from the hand — so the lit-key reading scores
the broken build better than the fixed one. Hop-to-hop between lit keys fails
for the matching reason: the highlight drops out too often to measure a hop
across.

The sixth clause asks whether the caustic reaches the page at all. The
scene's light is steep — 75 degrees over a solid 187 px across — so the
shadow lies almost entirely under the stone and the caustic is what the page
is supposed to show. The measurement is the caustic's own knob turned to
zero and back: one term changes, so every pixel that moves moved because of
it, and nothing has to be masked off the stone.

It exists because the caustic drew NOTHING for as long as it had been
written. It inverted the light map with a single Newton step to find which
ray landed on a pixel, but that map's image is a sliver of page mostly
hidden under the stone; from any pixel outside the sliver the step landed
where no ray enters, the guard on the Jacobian never opened, and the gain
was zero on every pixel of every frame. Three `toContain` pins in
`crystalLaw.test.ts` passed the entire time, because the code they name was
present and correct and never ran. Measured 2026-08-27 after the rewrite:
peak +52/255 over 4275 px; before it, +0 over 0.

Inverting it properly is not a tuning fix. At a fold the map is many-to-one
and the iteration has no fixed point to find — light landing in two places
at once has to be SCATTERED into the page, which is a second pass and not a
fragment. What is drawn instead is the band a lens actually makes: keyed on
the same silhouette distance the shadow is keyed on, weighted by the outline
gradient against the light so only the far side lights, and carving the
shadow it brightens so the light it adds is light the shadow lost.

No clause asks where the HAND's key ended up. It sounds like a
second independent reading and is not one — the two keys differ and the
glass is one function of position, so "B is under the tip" already says G is
not.

The first clause has teeth beyond the scene. Munari's canvas gate swallows
the browser's own click after a press it already relayed, and it decides by
coordinate. An uncorrected press puts the relay's retelling within a pixel
of the hand, so the retelling was what got eaten — hover correct, press
correct, nothing typed. `CanvasPointerGate.tsx` now checks `isRelayed`
first, and this clause is what would catch that guard being dropped.

## plume

Local gate: `npm run gate:plume`. Opens the real `?scene=plume` route in
isolated flag-enabled Chrome, then a separate browser without the flag.

Full-cloud framebuffer samples at 0.5, 2, and 4 seconds must contain visible
particles. The probe then isolates real ink quads with the existing geometry's
draw range, without changing the shader: sprites must fit within 36px and have
an aspect ratio no greater than 2.5. Smoke puffs grow as they thin, and 16
real sprites at 4s top out at 27px, so the cap sits a third above what the
shader actually produces. The aspect clause is what rejects the former
22–40× strings; a stretched grain fails it at any diameter.
RGB must stay within alpha, with one byte of rounding tolerance. The cloud
must leave no visible pixels once its lifetime ends.

Native text and caret survive evaporation; Restore restamps the same buffer
and visibly replays it. The closed-by-default panel is the only page control;
the gate checks focus restoration, all four effects and text actions. It
also checks plain backgrounds, viewport centering on desktop and 390px
mobile, equal typography across all text copies, intrinsic height changes,
and native scrolling with a stable caret. The 36 tuning values are checked
against the native fields and renderer: type edits need fresh painted keys,
spacing must not change sprite size, and pointer response must change the
measured drift.

Two clauses cover the 2026-08-31 smoke rework. Color retention writes text in
a purple ink against an orange particle swatch, then measures the hue of the
flying particles: at Tint 0 it must sit within 20 degrees of the ink and more
than 60 degrees from the swatch, and at Tint 1 within 20 degrees of the
swatch. Neither the page background nor the swatch can supply the measured
hue, so a shader that ignored the captured color would fail. Character
release then switches the release unit to characters and types with a 40ms
delay: every non-whitespace grapheme must get its own anchor, at least half
must hold distinct clocks, and those clocks must span at least the typing
time minus the hold. The same run repeats the puff-shape and same-buffer
Restore clauses in character mode and times a getBoundingClientRect pass over
every anchor. Copy keeps fractional values and milliseconds; Reset keeps
the text. Maximum stagger must still end within a 600ms lifetime and a
150ms reduced-motion fade. Reduced motion and the no-flag DOM dissolve
remain covered. `PLUME_ARTIFACT_DIR` saves the page
and transparent particle images. The usual capability skip policy and
`STRICT_CAPABILITY=1` apply.

## marble-hand

Local gate: the anatomical cursor keeps its real index vertex on the
browser hotspot. Run `npm run gate:marble-hand`.

The gate opens the real `?scene=marble-hand` route in its own Vite
server and Chrome with HTML-in-canvas enabled. It requires one visible native
sheet plus one hidden inert capture, no main-scene page presenter, a clear
canvas, direct native click/focus, and real H1 text selection. It verifies
that the removed header, descriptions, page status, notice and footer are
absent from both native and captured content. While STL is held, the
page and OS pointer must remain usable. Trusted moves then require a
projected tip within 1 CSS px, a wrist that trails down/right, and stone
above the page. Press heights come from `marbleHandTuning.ts`, not the
rendered hand. The native page hides its cursor only while the hand is ready.

It reads the existing `window.__r3f`, named sculpture, and native DOM;
it adds no scene probe fields. The standard Chrome/capability skip policy and
`STRICT_CAPABILITY=1` apply. A separate no-flag browser checks native input
and the full-reflection-unavailable notice inside the tweak panel. The
panel's background pause control must also work before the hand loads.

A second page opens the normal route and tests its native tweak panel:
parked preview, live degree inputs, scale, material and lighting updates,
typed-value precision, copied values, reset, hold-press, and close/reopen.
Editing the panel must leave the preview still and add no theme-button clicks.
Click accounting is owned by the probe; the page has no contact counter.
With page lights disabled, recoloring the native H1's ink must update the
PMREM source signature and change opaque hand pixels in the overlay
framebuffer.
This isolates the reflection term from the page's direct colored light.
The decisive full-page clause hides only the native H1: its actual captured
ink must disappear, the capture must advance, and opaque hand pixels must
change. The old color-field approximation cannot pass that clause.
The finish switch must install a vein-free metallic Chrome material without
replacing the hand or its pose. Its pixels must change, while a return to
Marble restores the edited stone settings. Copy and reset also preserve the
selected material mode correctly.
Mirror reflection must change opaque hand pixels from zero to nonzero
strength without rebuilding an unchanged reflection map. This checks the
scene-level intensity used by Three for inherited environments, not only
the material property. Switching back restores Marble's reflection strength.
The idle tap gets its own section, and it is the one place the gate reads the
overlay's pixels twice with nothing touched in between. After 1.2 seconds of
rest the drum must start, at least two of three frames a third of a period
apart must differ, and at least 300 overlay pixels must move across the cycle
while the projected index fingertip stays within 0.5 CSS px. A 40 px pointer
move must flatten all three bends within 500 ms, after which repeated moves to
one point hold the pose still and the overlay must stop changing. Reduced
motion and the panel's Idle tapping switch must each leave the fingers flat.
Pose, height and every projected vertex stay correct when the vertex patch is
missing, so only the pixel clause can see that failure.

Stroke checks compare the actual hand and outline at two heights and DPR 1/2.
The body must grow while a 6px outline keeps its CSS-pixel width. Width,
color, opacity, toggle, material switch, copy and reset are also checked.
Reflection pixel checks disable the stroke so it cannot supply false evidence.
The moving poster is a second WebGL canvas inside the page, so the checks
are about two renderers agreeing rather than about CSS animations. The
canvas must exist in the native sheet with a live context (never the CSS
gradient fallback), and the capture must hold exactly one blank clone of it.
While running, the field's frame counter and a pixel hash read back from a
freshly drawn frame must both advance, the reflection must keep baking, and
the page must not reclone itself per frame. The environment's copy of the
field must sit within 1ms of the page canvas's published second — it
measures 0.00ms, because both read the same number. Pause color must stop
the frame counter, hold the second, bake once and stop, hold that second
against a full wall second, then resume from it rather than from wall time.
Reduced motion must draw one still at a fixed second and hold it in both
renderers. Theme changes must move the page canvas and the reflected plane
to the same shader together. Mouse and keyboard input must activate the
actual theme buttons. Each theme pair must change the captured page and
opaque hand pixels without changing the hand's mesh, geometry, or pose.
The H1 optical check selects and pauses Waves, so unrelated motion cannot
fake a reflection change. The 390px layout must retain the heading and theme
controls in view. Pause checks open the tweak panel and use its real
background control.

## chrome-over-canvas

`npm run gate:chrome-over-canvas` — page UI painted above a
`pointerMode="surfaces"` canvas must still receive clicks where it
overlaps Surface content.

The gate parks the refraction crossing at `t = 0.5`, which is the only
state where the scene holds a mesh, and clicks three headers in the lab's
tuning panel. `crossing` sits above the mesh and is the control: it must
open in every build, and a failure there means the probe is broken rather
than the kernel. `aperture` and `room` sit inside the overlap.

The aim is the header's left end, 20px in, not its centre. At the gate's
1280x900 viewport the stage row (caption 300 + gap 88 + stage 560) centres
so the holder's right edge lands at x=1114 and the panel spans 964..1264 —
the panel's own centre sits on the mesh's far edge, where the raycast
grazes and the fault does not reproduce.

What it caught: `CanvasPointerGate` decided a press belonged to the glass
from a raycast alone. A raycast answers in scene coordinates and knows
nothing about what the browser paints on top at the same point, so presses
on the panel were claimed, stopped in the document capture phase, and their
clicks swallowed by the 8px suppressor. Hover kept working the whole time,
because hover never consults the raycast — the buttons highlighted and
would not activate, which reads as a React state fault (2026-08-23).

## House rules

- Scenes hang their live state on a `window.__<scene>` hook so a probe
  can interrogate them from the console.
- `readPixels` is valid only inside a wrapped `gl.render` call.
  Sampling outside one returns numbers that have blamed the wrong code
  before.
- A flight ends when its trace stops, never when a poll returns null;
  the flight reference outlives the flight.
- Crispness checks must be position-aware: a texture landing in the
  wrong place at the wrong size passes a naive sharpness check.
- To bisect a dead effect into "the shader never ran" versus "the
  driver never sent anything", force the uniform inside the render
  wrapper.
