# flight-card

A draggable card that behaves like paper: it bends under drag, floats
on tap so you can type in it mid-air, throws between columns with real
velocity, and crumples into a ball to delete. Registry extraction has not
happened; use the lab implementation as the reference.

## What already exists

- **The physics is beside the Flight scene, covered by local tests:**
  the plate integrator and `HAND`
  grip, `aeroAmplitude` (AMP 55 / V0 650, set by measurement after a
  version tuned by eye shipped a bend too small to see; tests pin the
  minimum visible bend), `aeroFollowStep`, `crumplePhase` (crush stays
  at 0 through the rise; the rise is when the handoff happens),
  `tossSpin` (V0 220, MAX 7, topspin ẑ×d̂), `wadOffscreen`,
  `wadShrink`, and `attachFlightGestures` (only trusted user events
  start a gesture; tap/throw/crumple release rules; the `tossed` flag
  makes a released ball ballistic from the first frame).
- **Core measures the DOM shadow.** Flight's `flightShadowFrameLaw` builds
  the matching mesh geometry and shader values from that measurement.
- **The working implementation is the flight scene**
  (`apps/lab/src/scenes/flight/Flight.tsx`), verified in the browser:
  tap→float→type→Escape home, cross-column throw with real velocity,
  crumple ball under the ✕ with the board forgetting the card last,
  and no leftover paint work after the wad exits.

## No copyable source yet

The scene-side machinery (aero vertex bow, crumple shader, depth-tested
shadow quad, density-pin driver) lives inside the flight scene as one
unit. Extracting a reusable component is design work in its own right,
and no second consumer exists to shape it. Per decisions.md #7, we add
API when a real consumer needs it. Until then, read the Flight scene with
`flightPhysicsLaw`, `flightGestures`, `flightDensityLaw`, and their tests.

## Rules any future extraction must preserve

Each of these came from a shipped bug:

- **Depth deletes the shadow, not blend order:** the card renders
  first, writing depth; the shadow draws after, depth-tested behind
  it. Blend order cannot express a clip; depth can. Corner notches
  keep their fringe because the radius-mask discard writes no depth.
- **Folds are coarse cells:** 6×3 uv cells with a 0.35 per-vertex
  remainder. Per-vertex targets read as confetti; cells read as paper
  folding in chunks.
- **The crumple happens at altitude** (`CRUMPLE_Z = 55`, below the
  approach plane) with the density pin and rest-snap frozen for its
  duration.
- **The bend faces the camera, shades multiplicatively, and is
  gate-forked:** an away-facing bow is invisible head-on and dips
  behind the shadow plane; additive light clips at white; an output
  gate outside the smoother caused both the flicker and the settle
  hitch.
- **The handoff is the protocol's and the ramp is the plate's:** one
  `useSurfaceHandle` handle, its source declared in the card's own slot and
  presented by a `Surface.Mesh` with `placement="manual"` inside the Canvas, with
  `useSurfaceDriver` answering the crossing from the plate's altitude
  (`Math.max(ADMIT, Math.min(1, f.plate.p.z / LIFT_Z))`, and exact zero
  the moment the board asks for the page back). This Flight path uses the
  default automatic draw evidence. A specialist custom draw can set
  `presentation="manual"`; that seam keeps the mesh proxy and pointer relay,
  while advanced `surfaceManualPresenter` must cover every declared part and
  report the actual final compositor draw. Never a frame count and never a
  second static landing ramp. When a custom subtree is used, keep its Scene
  boundary and presenter alive through cleanup, gate mesh motion with
  `progress.get()`, and
  never hide the canvas to warm one Surface — the mesh warms by drawing
  write-free, and a scene mesh that is not a presenter (the shadow) hides
  itself instead. Do not reorder the board or start FLIP while the page
  still holds. A vacated slot may change paint properties only. A 1.5px
  border once marched the page 2px at every liftoff.

## Tuned constants

`tests/registry/flightCardPack.test.ts` checks these against the
scene:

| constant | value | where |
| --- | --- | --- |
| fold grid | 6×3 uv cells | flightShaders.ts, crumple shader |
| fold remainder | 0.35 per-vertex mix | same |
| crumple altitude | `CRUMPLE_Z = 55` | Flight.tsx |
| physics values | AMP 55 / V0 650 / spin V0 220 / MAX 7 | flightPhysicsLaw.ts |
