# anamorph decisions

Standing decisions, numbered from #1 and cited from code as
`decisions.md #N`. Each entry records the decision, the evidence
behind it, and what it cost to learn. Entries are not renumbered;
a decision that is superseded is amended in place, with the reason.

## #1 — The name is anamorph, and the hourglass is the shape (2026-08-02)

**Decision.** Project, repo, and eventual sole public package:
`anamorph`. The monorepo is an hourglass — `@anamorph/core` (kernel:
custody, provenance, arbitration; zero runtime dependencies; never
published independently), `anamorph` at `packages/react` (the
three/r3f binding; `three` + `@react-three/fiber` as peer
dependencies; the only installable), `registry/` (copyable, never
published), `apps/lab` (consumer, barrel-only), `instruments/`
(maintained measurement).

**Why this name.** An anamorphosis resolves true from one designed
vantage — which is the library's central contract, not a mood: the
pixel-calibrated camera makes screen and world equal on exactly one
plane, and crispness is a rest state at that vantage. Rejected fields,
deliberately: paper and bookbinding names (slipsheet, endpaper — they
name the flight-card demo's material, and the demo is one registry
item, not the library); `three-*` names (the namespace files us with
three-mesh-ui and uikit — the rebuild-UI-as-GL-geometry architecture
this library is the inversion of); custody and stagecraft words
(bailment, greenroom, foley — precise but the wrong register).

**Why one public package.** The shadcn model: a thin published
substrate with a copyable registry on top. Publishing the kernel
independently is a *promise* — semver, changelogs, unknown consumers —
that no lab has bled for; the second-system guard says not yet, maybe
never. Core stays a workspace-internal discipline, real because the
boundary tests make it real.

**Why three as peers, unabstracted.** Every platform fact we own that
is renderer-specific is *three*-specific in load-bearing ways:
immutable `texStorage2D` allocation, the shader-chunk colorspace
contract, the r3f raycast-prop trap. A renderer-abstraction layer
would re-derive all of it per backend for consumers who don't exist.
Peer rather than direct dependency for the standard reason: a consumer
app has exactly one `three` instance, and a second smuggled copy is
the same split-brain disease `relay()`'s `Symbol.for` brand was
hardened against.

## #2 — The conformance suite is the specification (2026-08-02)

**Decision.** A kernel law is defined by its contract in
`tests/conformance/<layer>/`, not by its implementation. Suites land
with the laws they pin, in the same commit; a behavior change that no
suite notices is indistinguishable from a regression. Describe/it
names, the comments naming the failure each case catches, and every
pinned number are all part of the contract — adjusting a number to
make a test pass is a decision that needs an entry in this file.

**Why the suite is organized by custody layer.** mapping → paint →
pointer → transfer → chrome → physics is a dependency order, not a
taxonomy: transfer cannot be specified before paint has said what a
paint costs, and chrome cannot be measured before mapping has fixed
what a pixel is. Reading the suite in that order is the shortest path
into the kernel.

**Why numbers outrank arguments.** Most of these laws exist because a
browser did something surprising: the measured constants are the
residue of that surprise. A test whose numbers came from real
measurement is evidence; one whose numbers came from the
implementation is a tautology. Perceptual floors are held to the same
standard — several suites assert that a mechanism is visible or felt
at real hand speeds, because a mechanism that is live but
imperceptible is not shipped.

## #3 — The lab preserves three scenes (2026-08-02)

**Decision.** `apps/lab` carries three scenes — **workspace**,
**glass**, and **flight** — and no others. Scenes are evidence, not
product: a scene exists to prove a claim, and a scene that proves
nothing the others don't is deleted rather than maintained.

**What each scene pins:**

- **workspace — the arc.** The focus grammar's home scene (33-panel
  arc, Tab/Enter/Escape spine, arrows, camera rides). Exercises the
  focus/spatial-nav surface, the control kit, and `FocusOrbitRig`.
- **glass — the compositor.** One scene render, N screen-space passes.
  Exercises the material-slot seam and carries the premultiplied-alpha
  contract (#5).
- **flight — the paper.** The drag/aero/crumple/toss card scene, and
  the fullest exercise of the kernel: mapping (calibrated camera),
  transfer (density schedule and readiness), chrome (measured shadow),
  physics (plate, aero, crumple, toss). The conformance suite's
  physics/chrome/transfer slices ARE this scene's laws; the scene is
  their consumer proof.

**Why these three.** Together they cover the three pillars without
overlap — input/focus custody, rendering and composition, and the
custody excursion itself. Each is a standing consumer: if the public
barrel can't express it, the barrel is wrong (export it; don't reach
around).

**Amended 2026-08-03.** These scenes were originally numbered by their
position in a longer sequence of experiments. The numbers outlived the
sequence, so they were replaced with names that say what each scene
proves.

## #4 — Core speaks in shapes; three satisfies them (2026-08-02)

**Decision.** `@anamorph/core` cannot import `three` (zero-dep,
boundary-enforced), yet its math has to accept the vectors and
geometries a three-based consumer already holds. Core therefore
expresses every vector/geometry parameter as a minimal structural
interface — `Vec3Like`, `GeometryLike`, `SampleVec`
(`src/math/vec3.ts`) — which three's objects satisfy by shape, with
generic out-params so callers get their own type back: a
`THREE.Vector3` in is a `THREE.Vector3` out, `.clone()` intact. Where
an API must allocate (a sample with no caller target), core allocates
its own minimal `Vec3`. Internals use scalar math where a vector
library would otherwise be needed — the face-normal cross product is
written out longhand — so core never needs scratch allocations from a
library it doesn't have.

**Why not `three` as a type-only peer.** `import type` would erase at
runtime and technically keep the zero-dep claim — but it would put
`@types/three`'s enormous surface in core's signatures, hide *which
slice* of a geometry the kernel actually reads, and leave the boundary
test policing a value/type distinction instead of a bright line. The
structural interfaces ARE documentation: `AttributeLike` says the
anchor reads `count/getX/getY/getZ` and nothing else. Every later
layer (chrome's quad frames, physics' plate state) follows this
pattern; a kernel API that wants a richer vector vocabulary grows
`Vec3` deliberately rather than importing one.

## #5 — Premultiplied alpha, library-wide (2026-08-02, paint layer)

**Decision.** Anamorph's texture contract is premultiplied from birth:
every texture made from a DOM source uploads with
`premultiplyAlpha = true`, and every material consuming one blends
premultiplied — built-ins via their `premultipliedAlpha` flag, custom
material-slot shaders via `One / OneMinusSrcAlpha` blending. This is
the kernel's contract even though the flag itself is set by the
binding (core produces canvases; three textures are the binding's
side of the seam), and binding conformance pins it.

**Why premultiplied is the native truth, not a preference.** A 2D
canvas's backing store is ALREADY premultiplied — the browser
composites that way. Asking for a straight-alpha upload forces an
un-premultiply conversion at texImage time that is lossy at low alpha
(the rgb of a mostly-transparent texel quantizes to garbage), and the
GPU sampler then filters that straight data incorrectly anyway:
bilinear averages raw rgb across texels, so a `white/10` texel bleeds
full-strength white into every boundary with opaque content. That is
the measured selection-rect halo, present in miniature on every
transparent floating layer. Premultiplied upload is the path with no
conversion, no loss, and linear-correct filtering.

**Why the blast radius is small.** The common Surface is OPAQUE by
design — the corner-texel argument behind measured chrome rests on
`.ui-root` painting app background — and at α = 1 premultiplied and
straight are byte-identical. The change is observable exactly where
straight alpha was wrong. Costs land on the material-slot contract
(custom shaders must blend premultiplied and treat sampled rgb as
already-weighted) and nowhere else.

**Out of contract.** Lit standard materials on partially-transparent
Surfaces — premultiplied rgb entering lighting math is not a
passthrough, no lab has bled on it, and the second-system guard says
we don't design for it until one does. Documented as unsupported; a
future lab that needs it reopens this entry with measurements.

## #6 — The binding re-exports the kernel whole, and the shader string lives beside the material (2026-08-03, react binding)

**Decision.** `anamorph`'s barrel is `export * from '@anamorph/core'`
plus the binding's own primitives — no curation between the kernel and
the consumer. Every name in `@anamorph/core` is contract-covered, so a
second doorway would only accumulate drift between what the kernel
guarantees and what consumers are allowed to see. A name earns barrel
placement in the binding's OWN half by a preserved lab consuming it:
Surface, SurfaceApp, the texture/chrome hooks, the focus kit, Dial,
arcLayout. Everything else waits for a consumer.

**SURFACE_RADIUS_GLSL** lands in the binding
(`lib/surfaceRadiusGlsl.ts`), not the kernel: a shader chunk belongs
beside the material that splices it, and core is renderer-free. The
GLSL and core's `surfaceRadiusSd` are twins BY CONTRACT — the
conformance suite pins the JS SDF, and the chunk must compute the same
distance so a ray and a fragment agree about where a corner ends. The
uniform names are the library's own (`uAnamorphRadii`,
`uAnamorphSize`, `anamorphRadiusMask(vUv)`) because a custom
material's opt-in call sites are consumer-visible contract.

## #7 — The kernel answers for what it observes; the app owns the window (2026-08-03, lab app)

Two kernel-surface additions arrived with the lab app, both pulled
across by a consumer rather than pushed by symmetry:

**`paintStats()`.** Per-source paint counters are a kernel seam, not a
devtools nicety: `[]` after a lifecycle is the canonical
nothing-left-painting proof, and `paints` deltas are the idle-zero
gate's raw feed. The workspace scene's HUD is the consumer that proved it — the
"40 live documents, zero cost" claim rendered as numbers needs
counters only the source factory can keep. It ships with one
deliberate constraint: **no global**. The kernel exports a function;
the lab hangs it at `window.__anamorph.stats()` in App.tsx. A zero-dep
kernel that stamps `window` at module load would be doing a consumer's
job with a library's authority.

**`Quat.premultiply`.** The flight scene's toss applies topspin in the world
frame (`plate.q.premultiply(spin)`). The kernel Quat had only
`multiply`; the twin arrived with a contract pinning it as
exactly-multiply-with-operands-swapped (bitwise, not epsilon) plus the
frame semantics that make the order matter. Sized to the consumer: no
slerp, no euler bridge, nothing speculative.

The pattern both follow — and the reason this entry exists — is that
the kernel's public surface grows ONLY when a consumer arrives holding
the need, and each addition brings its contract in the same commit.
"Might be useful" never crosses; "is used, and here is the test" does.

## #8 — Gesture deps are generic in the consumer's vector type (2026-08-03, physics layer)

The flight scene annotates its lift carry `(a: THREE.Vector3) => ...`, the
kernel's `GestureDeps` demanded `(a: Vec3Chain) => void`, and under
`strictFunctionTypes` a callback parameter is contravariant — the
scene's honest annotation was a TS2322. The kernel's shape-typed
vocabulary (#4) is what introduces the variance problem, so the kernel
owns the fix.

`GestureFlight<V extends Vec3Chain>` / `GestureDeps<Col, V>`: `V`
infers from the flight the consumer constructed, and the kernel's
promise narrows to exactly the vectors it round-trips. That inference
is *sound*, not merely convenient, because `toLiftPlane(f.anchor)` is
the callback's only call site and `f.anchor` is a vector the caller
put on the flight itself — the kernel never manufactures a `Vec3Chain`
to hand across. `Vec3Chain` survives as the BOUND (exported, so
consumers can name it), and `tossSpin<V extends Vec3Like>` was already
the in-layer precedent.

Contract (`gestures.test.ts`): an annotated `(a: THREE.Vector3) =>
void` dep compiles — kept as a compile-time tripwire — and the vector
it receives is identity-equal to the flight's own anchor, the fact the
soundness argument rests on.

**Refinement: `plate` is NOT `V`.** The first generic welded `plate.v`
to `V`, and that weld is wrong because a real flight is *bimodal*. The
plate is the kernel's own allocation (`makePlate` fills it with kernel
`Vec3`s) while `spin`/`anchor`/`hold` are the consumer's — so with
`V = THREE.Vector3` the field demanded the one thing no consumer can
supply. `plate.v` is typed at the bound (`Vec3Chain`), which is all
its two uses need: the release adds hand velocity onto it and reads
`x`/`y` for topspin, and it never crosses `toLiftPlane`. The same
reasoning keeps `handVel` a plain readonly. The contract mock was
complicit in hiding this — it hand-built the plate from THREE objects,
so the flight it fed the deps was uniformly THREE and the weld
typechecked. It now takes its plate from the real `makePlate()`: the
mock must be bimodal or it cannot catch the next weld either.

## #9 — Focus ships as imported API, not as a copyable pack (2026-08-03)

**Decision.** The focus and spatial-navigation mechanism ships from
the binding — `FocusScene`, `FocusOrbitRig`, and the lib beside them
in `packages/react` — and NOT as a `registry/` entry. A registry entry
duplicating an exported mechanism as copy-code would be two sources of
truth for one behavior.

What a registry pack would have carried is instead the EVIDENCE, and
that evidence rides beside the modules it judges: six suites at
`packages/react/src/lib/*.test.ts` (cameraPose's pinned browser
numbers including the 1.13 rad whip, spatialNav's curated mechanisms
and its 33 browser-captured field rects — fidelity proofs no synthetic
grid can substitute for — focusTree's 49 cases, tabbables, arcLayout),
with `docs/focus.md` as the behavior's contract doc.

**Consequence for the hourglass.** In-package suites import `vitest`,
which the react boundary rule had no answer for. The carve-out is
exactly one specifier in exactly test files; everything else in a
suite answers to the same allowlist as the module it tests, so a suite
can no more reach around the kernel than its module can.

## #10 — The flight-card pack is a charter until a consumer arrives (2026-08-03)

**Decision.** `registry/flight-card` ships documentation and tests,
not copyable source. Every LAW already has a contract-covered home in
the kernel (plate integrator, `aeroAmplitude` with its perceptual
floors, `aeroFollowStep`'s gated fork, `crumplePhase`'s invariants,
`tossSpin`, `wadOffscreen`, the window gesture), the chrome laws live
beside them, and the scene-side machinery — aero bow, crumple shader,
depth-tested shadow, density-pin driver — is one organism inside the
flight scene.

**Why not extract it now.** Extracting a reusable component from that
organism is design work in its own right, and no second consumer
exists to size it. Cutting it up now would trade a working,
browser-verified reference for an untested abstraction — the
second-system guard's exact target, and the same doctrine that gates
kernel surface (#7: a consumer arrives holding the need, or nothing
crosses).

**What the charter is.** The inventory of what lives where, the rules
any future extraction must preserve, and the tuned-constant table —
welded by test the way the glass pack is: the kernel claims by import
(`TOSS_SPIN_V0`, the AMP/2 spot-check at half-saturation), the scene
claims by text (the 6×3 fold grid, the 0.35 remainder, `CRUMPLE_Z`). A
charter whose claims are executable cannot quietly rot into wishful
documentation.

## #11 — The published package is staged, and the kernel travels inside it (2026-08-03)

**Decision.** `npm run build` bundles `packages/react` into
`packages/react/dist` with `@anamorph/core` **inlined** and
`three`/`@react-three/fiber`/`react` left external, writes a purpose-built
manifest into that directory, and publishing runs from there
(`npm publish packages/react/dist`). The workspace manifest keeps
`exports` pointing at `src/`, and keeps `private: true`.

**Why the kernel is bundled rather than published beside the binding.**
One public package is #1's promise. A published `@anamorph/core` would
be a second doorway with its own version line, and a consumer who
installed both could hold two kernels — the same failure mode as two
copies of three, minus the `instanceof` error that would announce it.
Bundling makes the kernel an implementation detail that cannot be
depended on by accident. The staging script checks the emitted bundle
for a surviving `@anamorph/core` import rather than trusting the config,
because that import resolves fine inside the workspace and fails only
for consumers.

**Why staging instead of repointing `exports` at `dist`.** The lab
resolves `anamorph` through the workspace with no alias standing in for
the library — that is what makes a missing barrel export fail the lab's
build instead of slipping past on a relative path. Pointing `exports` at
`dist` would either break that enforcement or force a rebuild between
every edit. Staging keeps the source tree honest and the artifact
correct, and it makes the workspace's `private: true` a feature: a stray
`npm publish` at the root cannot ship raw TypeScript.

**Peers, restated as a build rule.** `three` does internal `instanceof`
checks, so a bundled copy would fail silently in a consumer who already
has one. The externals list is not an optimization; it is the singleton
contract.

## #12 — The capability gate runs before construction, not inside it (2026-08-03, paint layer)

`createDomTextureSource` now calls `detectHtmlInCanvas()` first and
throws `UnsupportedPlatformError` when the trial is absent. The probe
had existed since the beginning and the lab already rendered a hint
explaining a missing trial — the factory simply never asked.

**What it cost to learn.** On a Chrome without
`--enable-features=CanvasDrawElement`, the factory built its canvas,
appended it to `document.body`, and reached `canvas.requestPaint()` —
which does not exist. The bare TypeError escaped every Surface at once,
`<CanvasImpl>` unmounted its whole tree, and the page went SOLID BLACK
with an empty `<body>`, no console message, and React's generic
"consider adding an error boundary" as the only clue. The hint that
would have named the problem was inside the tree that had just
unmounted. The one screen whose job is to say *your browser cannot run
this* must not itself require a browser that can — so the lab checks
the capability before it mounts the Canvas, not from within it.

**Why the check is ordered ahead of construction.** Refusing after the
canvas was appended orphaned a parked canvas in `document.body` on every
failed Surface. Ordering the gate first means a refused source owns no
DOM, which is pinned by its own test.

**Why two booleans are still a complete gate.** Measured 2026-08-03 in
Chrome 150: `drawElementImage`, `texElementImage2D`, `requestPaint`,
`layoutSubtree` and `onpaint` were all present under the flag and all
absent without it. They move together, so the probe needs no third key
for the members the factory happens to call, and `detectHtmlInCanvas`
keeps the exact two keys its contract pins.

**What it changed in the suites.** Three harnesses stubbed the canvas
half of the trial and not the context half, describing a browser that
cannot exist; the gate correctly refused them. They now stub
`CanvasRenderingContext2D` too — which happy-dom does not define as a
global at all, the reason the probe reaches it through `typeof`.
