# instruments/ — measurement is maintained infrastructure

A capture recipe that lives as prose gets re-derived by whoever needs
it next, under pressure, usually wrong. Everything here is a module
held to the same review bar as the kernel: the probes that convict bugs
are code, committed, and runnable by anyone.

## idle-zero

The economic floor of the whole library, gated in CI: mounted quiescent
Surfaces cost **0 paints/s**. `npm run gate:idle-zero`.

- `main.ts` — the page under test and the assertion. Mounts N sources,
  measures paint deltas across a quiet window, then *provokes* a real
  DOM mutation. Both halves matter: a zero-delta result is vacuous
  unless a provocation proves the `onpaint` wiring was live at all.
- `run.mjs` — transport. Finds Chrome, proves the origin-trial surface
  exists, serves the page, drives it, judges the numbers under a hard
  90s deadline.

Two policies in `run.mjs` are the durable part, and any future
browser-driving instrument should copy them:

- **Capability absence is environmental, not a regression.**
  `drawElementImage` is an origin-trial API, so a Chrome without it
  makes the gate warn loudly and exit 0 (`STRICT_CAPABILITY=1` turns
  that into a failure where the capability is supposed to exist). Past
  a successful capability probe, everything is real: a page error, a
  timeout, or a nonzero idle delta all fail.
- **The launch flags are part of the measurement.**
  `--enable-features=CanvasDrawElement` plus
  `--disable-backgrounding-occluded-windows` and
  `--disable-renderer-backgrounding` — a backgrounded renderer stops
  compositing, and a gate that measures "no paints" must never let
  throttling manufacture that result for the wrong reason. A driver that
  silently drops these flags hands back numbers from a browser that
  cannot do the thing being measured.

## frame-surface

Does a public frame-backed `Surface` draw the generation it reports, and does
its optional presentation fence reject non-writing and off-screen passes?
`npm run gate:frame-surface`.

The page runs a demand frameloop and reads WebGL pixels inside the mesh's draw
receipt. It first replaces one live source with another. It then releases and
reacquires the same persistent source three times. Each release publishes two
frames before reacquisition. The gate requires receipts
`[A0, A2, B0, B2, B4, B6, B8]`, a fresh surface epoch for each custody period,
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

Does one video decoder and one frame canvas stay current through repeated
Genie custody changes? `npm run gate:genie-film`.

The gate runs 24 minimize and restore cycles at 6x CPU throttle. It requires
stable decoder, canvas, and source identities; monotonic frame generations;
exact pixel and presentation receipt tuples; ordered native reveal before
renderer release; complete landings; and no black or uncovered compositor
frame. It then loses the WebGL context while WebGL has presentation authority
and requires immediate native fallback without a later draw receipt. Native
video loop events are reported separately from custody-induced media events.
The Genie route uses HTML capture for its window chrome, so this gate launches
Chrome with `CanvasDrawElement` enabled.

## sharpness

Is the mesh's rendering of an element as sharp as the element?
`npm run gate:sharpness`.

The question has no absolute answer, which is why the recipe kept being
re-derived wrong: a texture is only sharp or soft RELATIVE to the DOM it
stands in for, at the same size, in the same place, on the same display.
So the instrument drives the passage scene to the one frame where the
mesh is standing exactly where the page copy was — the small endpoint,
held at `t = 0` — photographs both, and reports a ratio.

- `gradientEnergy.ts` — the arithmetic, with its own contract. Mean
  squared first difference of luma over a band. Blur is a low-pass and
  first differences are what it takes away first; variance would not
  answer, and an FFT would answer more precisely at the cost of being
  something nobody reimplements correctly under pressure.
- `run.mjs` — transport, following idle-zero's two policies. Also does
  the decoding in-page rather than in Node: the browser already has a
  PNG decoder and shipping an image library to compare two rectangles is
  the wrong trade.

Three things it will not let you get away with, each one a mistake that
was actually made:

- **The band is part of the measurement.** The card's header carries a
  live frame counter the DOM is running and the held mesh has not drawn,
  and including it moved the ratio by more than the defect being hunted.
  The gate measures the typography band and prints which one.
- **A perfect score can be vacuous.** If the page copy is still visible
  under the mesh, the ratio is the DOM compared against itself and it
  passes beautifully. The gate checks the copy is hidden and fails
  loudly if it is not — idle-zero's provocation, in this instrument's
  terms.
- **The floor has to sit between two real readings.** 0.93, because the
  reported defect measured 0.841 and its fix measured 1.001. A floor
  invented rather than bracketed cannot fail for the right reason.

Negative control, and the way to check the gate still bites: force
`snapWeight` to 0 in `passagePath.ts` and re-run. It reproduces the
original defect at 0.833.

## House rules

- A scene that can't be interrogated from the console isn't done.
  Scenes hang their live state on a `window.__<scene>` hook.
- `readPixels` is only valid inside a wrapped `gl.render` call.
  Sampling outside one manufactures results, and those results have
  indicted innocent code before.
- Termination of a flight is *the trace stopping*, never a null poll —
  the flight reference outlives the flight.
- Crispness checks are scale-blind unless they are position-aware: a
  texture landing in the wrong place at the wrong size will pass a
  naive sharpness check.
- To bisect a dead effect into "the shader never ran" versus "the
  driver never sent anything", force the uniform inside the render
  wrapper.

The crispness rule now has an instrument — `sharpness` above, which is
position-aware by construction because it clips both photographs to one
measured page rect. The other three are still prose, tracked as issues
rather than listed here, so this file stays a description of what
exists.
