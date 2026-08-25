# instruments

Browser probes and CI gates. Each section below says what one
instrument checks and how to run it. The bar for a file here: an npm
script, a section in this file, and no absolute paths.

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

Reports whether the knobs scene holds 120 Hz.
`node instruments/knobs-hz/run.mjs`. A reporter, not a gate: it
prints per-phase frame statistics against the 8.33 ms budget and a
verdict line.

The browser runs headed with vsync and the frame-rate limiter off, so
`requestAnimationFrame` deltas measure the cost of producing a frame,
not display cadence. Four phases: `idle` (the standing animation),
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
cards, checks their column counts and two-layer drag shadow, and samples
Logo's two renderer handoffs for blank frames. This gate is the
regression contract for the lab
faults found in manual QA on 2026-08-18.

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
scene through the states that build materials (page, matter, extruded,
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

CI gate: input follows the eye (decisions.md #33) — which DOM instance
hears a real click in each crossing phase. `npm run gate:lifting-pointer`.

One exclusive Surface whose page copy and parked source each count
their own clicks; the runner fires trusted clicks at rest, at three
offsets inside a widened lifting window (`settleMs: 700`), and in the
gl phase, then samples hover mirroring mid-lift. The rest and gl
clicks are liveness baselines — if either lands wrong the lifting
answer is vacuous. The judged clauses: every lifting-window click
reaches the presented page copy, that copy wears real `:hover`
mid-lift, and the parked copy wears no `data-hover` — the last clause
also covers the #33 edge burst, because an earlier gl-phase hover
leaves a stamped twin that only the burst clears.

This began as the probe that found the fault (2026-08-19: 3/3 lifting
clicks routed to the parked copy while the page copy was presented;
the pointer gate made the canvas solid at mesh registration, a full
settle dwell before presentation changed hands) and was promoted when
`crossingPointer` shipped.

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

## chrome-over-canvas

`npm run gate:chrome-over-canvas` — page UI painted above a
`pointerMode="surfaces"` canvas must still receive clicks where it
overlaps Surface matter.

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
