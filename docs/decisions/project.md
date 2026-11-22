# Decisions: project, packaging and tests

Rules for the repository shape, the published package, the kernel boundary, and what counts as evidence. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="1"></a>

## #1 — One public package, with three as a peer

The only public package is `@petepetrash/munari`, built from `packages/react`. `@munari/core` (`packages/core`) is the kernel. It has zero runtime dependencies and is never published on its own. `registry/` holds copyable behaviors that are never published. `apps/lab` is a consumer, and `instruments/` holds maintained measurements.

`three` and `@react-three/fiber` are peer dependencies, so a consumer app has one copy of three. The binding is specific to Three.js, and no renderer-abstraction layer exists. The DOM stays the retained content, and the scene shows its actual pixels rather than a rebuilt likeness.

<a id="2"></a>

## #2 — The conformance suite defines kernel laws

A kernel law is defined by its contract in `tests/conformance/<layer>/`, not by its implementation. Layers run in dependency order: mapping, paint, pointer, transfer, chrome, physics. A suite lands in the same commit as the law it pins. Changing a pinned number needs a new measurement and a decision entry.

Each retained test names a material behavior, detects a credible failure, and uses an independent oracle. Measured numbers outrank arguments. A number copied from the implementation proves nothing.

Browser recordings for the Genie gates (`gate:genie-*`) go through `instruments/screencastRecording.ts`. It scores images in batches of at most eight, which keeps decode messages under DevTools' 100 MB buffer. Coverage means every page frame in the interval appears in a recorded image; a gap limit in milliseconds does not establish it. The pose check's pixel budget is 2%: correct frames measure about 1.1%, and stale-pose controls measure 4.8% or more.

<a id="4"></a>

## #4 — Core speaks in structural shapes that three satisfies

`@munari/core` never imports `three`, not even as a type. Every vector parameter is a minimal structural interface, such as `Vec3Like` or `Vec3Readonly` in `src/math/vec3.ts`, which three's objects satisfy by shape. Out-parameters are generic, so a `THREE.Vector3` passed in comes back as a `THREE.Vector3`. Where core must allocate, it allocates its own minimal `Vec3`. A richer vector vocabulary means growing `Vec3` deliberately.

<a id="6"></a>

## #6 — The root entry is curated, and `/advanced` re-exports the kernel whole

`@petepetrash/munari` exports what a Surface author needs and nothing else. `@petepetrash/munari/advanced` re-exports the whole kernel plus lower-level parts such as `FrameSurface`. `packages/react/src/index.test.ts` pins both export lists by name, so adding an export edits that test. A name enters the root entry only when a lab scene consumes it. Scene recipes with tuned values belong in `registry/`.

The corner mask has a JavaScript form, core's `surfaceRadiusSd`, and a node twin, `surfaceRadiusMask()` in `lib/surfaceRadius.ts`. Both compute the same distance, so a ray and a fragment agree on where a corner ends. The conformance suite pins the JavaScript form.

<a id="7"></a>

## #7 — The kernel grows only when a consumer needs it, and sets no globals

The kernel's public surface grows only when a consumer arrives with the need. Each addition brings its contract in the same commit.

`paintStats()` returns per-source paint counters. An empty list after a lifecycle shows that nothing is still painting, and paint deltas feed `gate:idle-zero`. The kernel exports the function and sets nothing on `window`. The lab exposes it as `window.__munari.stats` in `App.tsx`.

<a id="9"></a>

## #9 — Focus ships as imported API

The focus and spatial-navigation mechanism (`FocusScene`, `FocusGroup`, `focusTree`, `spatialNav`, `tabbables`) ships from `packages/react` as imported API. A `registry/` copy would be a second source of truth. `docs/focus.md` is its contract, and its tests sit beside the modules in `packages/react/src/lib/`. The tuned scene recipe (`FocusOrbitRig`, `arcLayout`, `cameraPose`) is the copyable pack in `registry/focus-orbit`.

<a id="10"></a>

## #10 — `registry/flight-card` is documentation until a second consumer exists

`registry/flight-card` ships a README, not copyable source. The card's physics, shader and density driver stay in `apps/lab/src/scenes/flight` with their tests. Extracting a reusable component needs a second consumer to size it. The README lists what lives where and the rules an extraction must keep. A claim in a registry README is enforced only when a test in `tests/registry/` reads it.

<a id="11"></a>

## #11 — The published package is staged, with the kernel bundled inside

`npm run build` bundles `packages/react` into `packages/react/dist` with `@munari/core` inlined and writes the publish manifest there. Publishing runs from that folder. `three`, `@react-three/fiber` and `react` stay external, because three uses `instanceof` checks and a bundled second copy fails silently. `packages/react/scripts/stage-manifest.mjs` fails the build if an emitted entry still imports `@munari/core`.

The workspace manifest stays `private: true` with `exports` pointing at `src/`. The lab then imports the library with no alias, and a missing export fails the lab build.

<a id="32"></a>

## #32 — A law with one consumer lives with that consumer

A pure law that has one consumer and names that consumer's modes, gestures or tuning lives beside that consumer, with its tests. A tested law that one demo uses still belongs to that demo. Core keeps what describes Munari itself: capture, coordinate mapping, pointer relay, handoff, CSS chrome measurement, and the 1D control physics behind the published `Dial`.

<a id="37"></a>

## #37 — A kernel law needs a caller, and a declared part needs a presenter

A kernel law with no caller is removed together with its conformance contract. Wiring up a caller is the remedy only when the law's absence would leave a gap in enforcement. Restoring a removed law needs its caller and its contract in one commit.

The part ledger is such a gap. A Surface with a declared part and no registered presenter must not pass the readiness gate. `SurfacePartSet` in core, and `expectPart` and `registerPartPresenter` on the store, enforce this.

<a id="38"></a>

## #38 — Agent tooling uses the existing owners and states its limits

Agent-facing work uses the same content, control and evidence owners as consumer code. An agent requests application intent, then checks the relevant receipts and the visible result. There is no second mutable state and no setter that can fake readiness or a hold. Scene tuning stays scene policy. A new observation is a bounded, read-only view that claims no work and retains no sources by default.

`docs/system-model.md` names ownership and evidence. `docs/agent-workflow.md` routes a task to its control and check. `docs/agent-system-plan.md` is unbuilt except where a stage records its status. A pilot that adds state, idle work or required reading without an observed benefit is removed (#37).
