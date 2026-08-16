# flight-card — the drag trilogy (charter, not yet a vendorable unit)

The card that becomes matter under your hand: drag with aero bend,
tap-to-float (type in it mid-air), throw between columns, crumple-toss
delete. This entry is deliberately NOT copyable source yet — the honest
inventory of what exists and where:

## What already has a home

- **The laws live in the kernel, contract-covered**
  (`tests/conformance/physics/`): the plate integrator and `HAND` grip,
  `aeroAmplitude` (AMP 55 / V0 650, set by measurement after a version
  tuned by eye shipped a bend nobody could see) with its perceptual
  visibility-floor tests, `aeroFollowStep` (the gated fork),
  `crumplePhase` (crush exactly 0 through rise; rise IS the handoff
  window), `tossSpin` (V0 220, MAX 7, topspin ẑ×d̂), `wadOffscreen`
  (the exit is a PLACE), `wadShrink`, and the window gesture
  (`attachFlightGestures` — `isTrusted` as the provenance gate,
  tap/throw/crumple release semantics, the `tossed` flag that makes a
  released ball ballistic immediately).
- **The chrome laws** (`tests/conformance/chrome/`): `parseBoxShadow`,
  `shadowQuadFrame` (geometry and uniforms from ONE computation).
- **The reference implementation is the flight scene**
  (`apps/lab/src/scenes/flight/Flight.tsx`), browser-verified:
  tap→float→type→Escape home, cross-column throw with real velocity,
  crumple ball under the ✕ with the board forgetting LAST, paint ledger
  empty after the wad exits.

## Why no copyable source yet

The scene-side machinery — aero vertex bow, crumple shader,
depth-tested shadow quad, density-pin driver — lives inside the
reference scene as one organism. Extracting a reusable component is
design work in its own right, and no second consumer exists to
size it. The kernel's own doctrine applies (decisions.md #7): surface
grows when a consumer arrives holding the need. Until then, a consumer
wanting a flight card reads the reference scene next to the kernel
contracts.

## Rules any future extraction must preserve (each one paid for)

- **The shadow is deleted by depth, not blend order:** the card renders
  first writing depth; the shadow draws after, depth-tested behind it —
  blend order cannot express a clip, depth can. Corner notches keep
  their fringe because the radius-mask discard writes no depth.
- **Folds are coarse cells, not vertex noise:** 6×3 uv cells with a
  0.35 per-vertex remainder — per-vertex targets read as confetti,
  cells read as paper folding in chunks.
- **The crumple happens at altitude** (`CRUMPLE_Z = 55`, below the
  approach plane) with density pin and REST-SNAP frozen for its
  duration.
- **The bend faces the camera, shades multiplicatively, and is
  gate-forked:** away-bow is invisible head-on and dips behind the
  shadow plane; additive light clips at white; the output gate outside
  the smoother was both the flicker and the settle hitch.
- **Handoffs key on `onFirstUpload`, never frame counts**, and a
  vacated slot may change PAINT properties only — a 1.5px border
  marched the page 2px at every liftoff.

## Scene-side tuned constants (welded to the reference by the pack test)

| constant | value | where |
| --- | --- | --- |
| fold grid | 6×3 uv cells | flightShaders.ts, crumple shader |
| fold remainder | 0.35 per-vertex mix | same |
| crumple altitude | `CRUMPLE_Z = 55` | Flight.tsx |
| kernel twins | AMP 55 / V0 650 / spin V0 220 / MAX 7 | `@munari/core` plate.ts, contract-covered |
