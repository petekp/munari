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

## genie duplicate drag

Can a restored window leave its final WebGL image behind when the live DOM
window moves? `npm run gate:genie-duplicate`.

The gate restores the square window at Retina density and 6x CPU throttle,
then starts a real title-bar drag as soon as the DOM copy becomes observable.
A DevTools screencast checks the old and new rectangles in every compositor
frame and requires zero frames with both copies. It then starts a new minimize
in the reveal commit. The second flight must get a fresh component lifetime
and reach the dock instead of inheriting the prior flight's landed state. Use
`HEADED=1` to exercise the real GPU compositor path.

## genie shadow custody

Do translucent window shadows keep the same opacity while presentation moves
between DOM and WebGL? `npm run gate:genie-shadow` measures the fixed shadow
strip in every compositor frame around both handoff directions. It also checks
that the shadow travels with the sheet and fades only where the funnel has
squeezed it past legibility.

## knobs-hz

Can the knobs scene hold 120 Hz? `node instruments/knobs-hz/run.mjs`.
A reporter, not a gate: it prints per-phase frame statistics against
the 8.33 ms budget and a verdict line.

The browser runs headed with vsync and the frame-rate limiter off, so
`requestAnimationFrame` deltas are the true cost of producing a frame
(throughput), not display cadence. Four phases: `idle` (the standing
animation), `art-` (idle with the SVG artwork hidden — the difference
is the artwork's raster share), `drag` (a held dial sweep through the
real input path), and `off` (POWER off, the demo's floor). Two
honesty checks are printed before the table: the drag must actually
move the hue value and the POWER click must actually drop the power
flag — both are read from the live law module, because a phase that
failed to engage measures idle twice and calls it interaction. The
GPU string is printed first for the same reason: numbers from
SwiftShader are numbers about SwiftShader.

## knobs-resize

Does the panel's face stay the panel's size while a hand drags it?
`npm run gate:knobs-resize`. Skips (exit 0, with a warning) where
`drawElementImage` is unavailable; `STRICT_CAPABILITY=1` makes the gap
a failure.

The gate runs minimum-to-maximum and reverse gestures at DPR 1 and 2.
It requires at least 30 moving render samples, all three arrangements in
both directions, matching panel/host/canvas boxes, bounded backing-store
density during motion, and exact requested density after eight quiet
frames. It also compares the successful paint, uploaded draw, presented
frame, and active keyed-anchor generation. A source marker must agree
with its receipt within one source texel, and a final-frame GL marker
must agree with the projected hue hardware within one CSS pixel.

`DUMP=1` writes the worst source image, final frame, and sample ledger to
the ignored `instruments/knobs-resize/out` directory.

The bug it was written for: every consumer of the panel's box was one
drag step behind the face painted for them, so 15px of the panel was
cut off the right edge on every frame, and at a breakpoint a whole
arrangement was (panel 463 tall inside a host still declaring 721,
landing in the top 0.64 of its own texture). The cause was which React
root owned the state. `<Canvas>` hands its children to the three root
after an `await`, so state held OUTSIDE the canvas reaches it a frame
late and no flush can pull it forward; state held inside commits
synchronously under r3f's own `flushSync`. This gate pins the result,
not the mechanism.

Its first version asked only about height, and passed 19 of 21 frames
while all 21 were wrong — height moves only at a breakpoint, so the
continuous fault hid under the two loud ones. Both axes, always.

## knobs-input

Does the full-page canvas accept the first mouse, touch, or pen contact
without taking input from clear page art? `npm run gate:knobs-input`.
It uses Chrome's input protocol on the real Knobs route. It checks cold
touch and pen contact, complete pen identity, hover arming, cancellation,
lost-release cleanup, clear-art pass-through, and single-click ownership.
It has the same `drawElementImage` capability policy as the other DOM
Surface browser gates.

## knobs-viewport

Can the panel keep its physical size on small glass while native scroll,
keyboard focus, and relayed pointers still reach it? Run
`npm run gate:knobs-viewport`. The real Knobs route is checked at
320x568, 360x640, 390x667, 390x844, and 640x360. The gate covers every
captured control plus the move and resize handles, dial and resize keys,
right-edge pinning, pointer UVs after scroll, exact world scale, and the
return to a large non-overflowing viewport without a logical-width change.

## dom-surface-demand

Can a successful DOM paint wake an idle demand renderer and keep its paint,
draw, and presentation identities honest? `npm run gate:dom-surface-demand`.
The gate uses the real Workspace route in a probe-only demand mode. It
mutates and resizes one static product panel without calling `invalidate`,
then requires a newer presented generation and changed framebuffer data.
It also checks that draw and presentation receipts name the same source
generation. The gate has the standard `drawElementImage` capability policy.

## genie-film-reorder

Does Genie replace its old live normalized film rectangle with the keyed
anchor from the successful outer DOM paint? Run
`npm run gate:genie-film-reorder`. A probe-only airborne source exchanges
the titlebar and film order without changing the outer sheet size. The gate
requires a newer accepted paint and moved film UVs, then proves the native
window stays visible until the required film frame earns a qualifying
presentation receipt.

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

The crispness rule HAD an instrument — `sharpness`, which clipped a
mesh photograph and a DOM photograph to one measured page rect and
compared their gradient energy. It went with the passage scene, its
only subject (decisions.md #3, amendment of 2026-08-10); the recipe
and its `gradientEnergy` contract live at that commit in history. A
future mesh-vs-DOM gate needs a scene that can hold a mesh exactly
where a page copy was, then reuses that recipe. The rules above are
prose, tracked as issues rather than listed here, so this file stays
a description of what exists.
