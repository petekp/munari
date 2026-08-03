# flight-card — the drag trilogy (charter, not yet a vendorable unit)

The card that becomes matter under your hand: drag with aero bend,
tap-to-float (type in it mid-air), throw between columns, crumple-toss
delete (archive#58–#62). This entry is deliberately NOT copyable source
yet — the honest inventory of what exists and where:

## What already has a home

- **The laws live in the kernel, contract-covered**
  (`tests/conformance/physics/`): the plate integrator and `HAND` grip,
  `aeroAmplitude` (AMP 55 / V0 650 — set by measurement after "tuned by
  eye" shipped an invisible bend, archive#59-addendum) with its
  perceptual visibility-floor tests, `aeroFollowStep` (the gated fork,
  archive#62), `crumplePhase` (crush exactly 0 through rise; rise IS the
  handoff window, archive#60), `tossSpin` (V0 220, MAX 7, topspin
  ẑ×d̂), `wadOffscreen` (the exit is a PLACE, archive#61), `wadShrink`,
  and the window gesture (`attachLab014Gestures` — isTrusted as the
  provenance gate, tap/throw/crumple release semantics, the `tossed`
  flag that makes a released ball ballistic immediately).
- **The chrome laws** (`tests/conformance/chrome/`): `parseBoxShadow`,
  `shadowQuadFrame` (geometry and uniforms from ONE computation,
  archive#56).
- **The reference implementation is the preserved Lab 014**
  (`apps/lab/src/scenes/Lab014.tsx`, byte-verbatim vs the archive's
  oracle), browser-verified in this repo: tap→float→type→Escape home,
  cross-column throw with real velocity, crumple ball under the ✕ with
  the board forgetting LAST, paint ledger empty after the wad exits.

## Why no copyable source yet

The scene-side machinery — aero vertex bow, crumple shader, depth-tested
shadow quad, density-pin driver — lives inside the reference scene as one
organism. Extracting a reusable component is design work with its own
increments (the archive took the better part of ten), and no second
consumer exists to size it. The kernel's own doctrine applies
(decisions.md #7): surface grows when a consumer arrives holding the
need. Until then, a consumer wanting a flight card reads the reference
scene next to the kernel contracts.

## Rules any future extraction must preserve (each one paid for)

- **The shadow is deleted by depth, not blend order** (archive#58): the
  card renders first writing depth; the shadow draws after, depth-tested
  behind it — blend order cannot express a clip, depth can. Corner
  notches keep their fringe because the radius-mask discard writes no
  depth.
- **Folds are coarse cells, not vertex noise** (archive#60): 6×3 uv
  cells with a 0.35 per-vertex remainder — per-vertex targets read as
  confetti, cells read as paper folding in chunks.
- **The crumple happens at altitude** (`CRUMPLE_Z = 55`, below the
  approach plane) with density pin and REST-SNAP frozen for its
  duration.
- **The bend faces the camera, shades multiplicatively, and is
  gate-forked** (archive#59/#62): away-bow is invisible head-on and dips
  behind the shadow plane; additive light clips at white; the output
  gate outside the smoother was both the flicker and the settle hitch.
- **Handoffs key on `onFirstUpload`, never frame counts** (archive#54);
  the vacated slot may change PAINT properties only.

## Scene-side tuned constants (welded to the reference by the pack test)

| constant | value | where |
| --- | --- | --- |
| fold grid | 6×3 uv cells | Lab014.tsx crumple shader |
| fold remainder | 0.35 per-vertex mix | same |
| crumple altitude | `CRUMPLE_Z = 55` | Lab014.tsx |
| kernel twins | AMP 55 / V0 650 / spin V0 220 / MAX 7 | `@anamorph/core` plate.ts, contract-covered |
