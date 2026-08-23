# munari decisions

Standing decisions, numbered from #1 and cited from code as
`decisions.md #N`. Each entry records the decision, the evidence
behind it, and what it cost to learn. Entries are not renumbered;
a decision that is superseded is amended in place, with the reason.

## #1 — The name is munari, and the hourglass is the shape (2026-08-02, renamed 2026-08-04)

**Decision.** Project and repo: `munari`. Sole public package:
`@petepetrash/munari`. The monorepo is an hourglass — `@munari/core` (kernel:
holds and handoffs, provenance, arbitration; zero runtime dependencies;
never published independently), `@petepetrash/munari` at `packages/react` (the
three/r3f binding; `three` + `@react-three/fiber` as peer
dependencies; the only installable), `registry/` (copyable, never
published), `apps/lab` (consumer, barrel-only), `instruments/`
(maintained measurement).

**Why this name.** Bruno Munari's *proiezioni dirette* mounted real
matter — gauze, torn film, scraps of plastic — in a slide frame and
threw it across a wall, so what arrived was the material itself under
light and not a picture of it. That is this library's central
contract, not a mood: the DOM stays the retained truth and the scene
carries its actual pixels, never a rebuilt likeness. Rejected fields,
deliberately: paper and bookbinding names (slipsheet, endpaper — they
name the flight-card demo's material, and the demo is one registry
item, not the library); `three-*` names (the namespace files us with
three-mesh-ui and uikit — the rebuild-UI-as-GL-geometry architecture
this library is the inversion of); legal and stagecraft words
(bailment, greenroom, foley — precise but the wrong register).

**Amended 2026-08-04 — renamed from `anamorph`.** Not forced by
availability: `anamorph@0.0.1` was published and held, and now carries
a deprecation pointing here. The change is a deliberate move in what
the name argues. `anamorph` argued from the *vantage* — an anamorphosis
resolves true from one designed viewpoint, which matched the
pixel-calibrated camera making screen and world equal on exactly one
plane. `munari` argues from the *matter*. Both are true of the library
and the vantage contract is unchanged, still pinned by
`tests/conformance/mapping`; but the material claim is the one a
reader meets first and the one flight, wake, and passage actually
demonstrate. Cost of the name: `Munari` at the head of a sentence
reads as the man, so prose says "the library" and reserves `munari`
for the project.

**Amended 2026-08-04 — the published package is scoped.** The
unscoped `munari` is unpublishable: npm's typo-squatting guard rejects
it as *"too similar to existing package minami"* (a JSDoc theme,
~88k downloads/month), with a 403 on `PUT`. That guard is a registry-side
check on the real publish — `npm publish --dry-run` passes clean, so
there is no way to learn this before attempting it. Note for anyone
choosing a name later: a 404 on `npm view` proves the name is
*unclaimed*, not that it is *publishable*.

**Why an owner scope and not `@munari/react`.** A project scope was the
first instinct — it matches the workspace vocabulary and reads like
`@tanstack/*`. It was rejected because those scopes are families, and
the member name is the family member: `@munari/react` promises
`@munari/vue` and `@munari/svelte` next. This library is three-first
and renderer abstraction is banned outright, so that name would
advertise an architecture the repo forbids —
unacceptable in a project whose whole claim is faithfulness. Under an
owner scope the package is named `munari` exactly, and the scope is
ownership rather than identity. Also rejected: `munari-gl` / `munarijs`
(bare, but might trip the same guard — discoverable only by
publishing) and appealing to npm support (days to weeks, uncertain).
Known cost: an owner scope has to be abandoned and re-published if the
project ever outgrows a single author, which costs exactly what
today's rename cost. `@munari/core` keeps the project scope — it is
workspace-internal and never published, so it answers to no registry.

The owner scope is `@petepetrash`, not `@petekp`, and the reason is
the same collision in a second costume: **npm packages and orgs share
one namespace**, and `petekp` is already a package here — the `npx
petekp` terminal portfolio. An org can never take a name a package
holds, so `@petekp/*` is unreachable without unpublishing the
portfolio. It fails as a 404 on `PUT` to the scope, which reads like a
permissions problem and is actually a naming one. `@petepetrash` is
the username scope, which exists automatically and cannot be taken;
`@petepetrash/circuit` already ships from it.

**Why one public package.** The shadcn model: a thin published
substrate with a copyable registry on top. Publishing the kernel
independently is a *promise* — semver, changelogs, unknown consumers —
that nothing in the project needs. Not yet, maybe never. Core stays a workspace-internal discipline, real because the
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

**Why the suite is organized by layer.** mapping → paint →
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

## #3 — The lab preserves six scenes (2026-08-02)

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
overlap — input/focus ownership, rendering and composition, and the
flight excursion itself. Each is a standing consumer: if the public
barrel can't express it, the barrel is wrong (export it; don't reach
around).

**Amended 2026-08-03.** These scenes were originally numbered by their
position in a longer sequence of experiments. The numbers outlived the
sequence, so they were replaced with names that say what each scene
proves.

**Amended 2026-08-04 — five, and the rule is unchanged.** Two scenes
joined, each admitted on the same terms: it proves something no other
scene does, and it is a standing consumer of the public barrel.

- **explode — the paint order.** One childless `div` decomposed into
  its own paint layers (shadow, background, border, text) as separate
  plates in true CSS paint order. It is the only consumer of the node
  door (#13) and of the padded-wrapper capture (platform.md #9), and
  the only thing in the tree that treats a paint record as something
  with *parts*.
- **passage — the layout engine in flight.** A route transition where
  the transitioning element re-lays-itself-out at every intermediate
  width, because a Surface's size is a layout input and container
  queries answer it (platform.md #11). The claim is comparative and the
  scene ships the comparison: the same click runs through
  `document.startViewTransition` behind a toggle, which captures the
  old state as a static image. This scene is what bought #14 and #15 —
  it is the tree's only Surface that resizes on every frame, and both
  bugs were invisible until something did.

The count is not the decision; "a scene exists to prove a claim, and a
scene that proves nothing the others don't is deleted" is. A sixth needs
the same argument, and any of these five stops earning its place the
moment its claim is pinned somewhere cheaper.

**Amended 2026-08-04 — six, and here is the sixth's argument.**

- **wake — the page as a sampled thing.** Two routes, both live DOM,
  composited by a per-pixel rule read from a texture that did not exist
  a frame earlier: a 2D wave equation stepped in a ping-pong render
  target. Navigation is the front of the wave, and the front's radius is
  displaced by the height of the water it is crossing, so the boundary
  belongs to the same event as the ripples rather than playing over
  them.

  Every other scene composites a Surface. This one **samples** one —
  `material="none"` plus `useSurfaceTexture`, with the page read at a
  displaced uv and R/G/B read at three different displacements. That is
  the claim, and it is the one thing CSS has no expression for at any
  effort: an element cannot sample another element's rendering, and no
  filter, mask, or view transition can make it. The passage scene proves
  the *layout* engine keeps running in flight; this one proves the
  *raster* is addressable while it does.

  It is also the tree's only scene whose visual correctness is a numeric
  stability question, which is why the wave law lives in `wakeField.ts`
  under test rather than only in GLSL: an explicit leapfrog past the
  Courant bound does not raise, it fills the field with NaN and the page
  goes black with a clean frame buffer. The test found the sharp part —
  AT c² = ½ the recurrence's two roots collide at −1 and a repeated root
  makes the field grow *linearly* (8000× after 4000 steps), so the bound
  is unattainable rather than merely uncomfortable.

  And it is where "rest is exact" got a second proof. A textbook
  specular against the surface normal evaluates to a CONSTANT on flat
  water, so a settled page would wear a veil forever and stop matching
  the DOM it stands for; tilting the light until that constant is
  invisible kills the moving term with it (exponent 48 measured 4e-13 on
  a fully-lit wave face). The sheen is therefore slope-driven — zero at
  rest *by construction*, not by tuning. Measured: 806 → 806 paints
  across two seconds of settled page.

**Amended 2026-08-10 — back to seven; wake is deleted.** The rule
above cuts both ways. Wake's claim was real (the raster is addressable
in flight) but the scene never made it *legible*: as a demo it read as
a water shader, not as a capability of the library, and a scene is
judged as a demo. `useSurfaceTexture` stays exercised by every other
scene, so nothing in the public surface lost its consumer. What went
with it: `Wake.tsx`, `wake.css`, `wakeField.ts` and its wave-law
tests, the `?scene=wake` route. The displaced-uv *sampling* claim —
reading the page at a uv the shader chose — no longer has a scene
arguing it; if it earns one again, it needs a demo where the sampling
is the point, not the weather.

**Amended 2026-08-10 — six; passage is deleted, same day, same rule.**
Judged as a demo, a route transition did not carry munari's argument.
What it *bought* survives it: the laws its bugs forced (#14, #15, the
density band of #10, platform.md rows 11 and 12) are pinned in
`tests/conformance` and stay. What went with it, beyond the scene
files and the `?scene=passage` route: the **sharpness gate**
(`instruments/sharpness`, its CI job, `gate:sharpness`), because its
recipe was passage-specific to the bone — the one frame it measured
was the passage flight's small endpoint held at t = 0, and no other
scene currently offers a frame where the mesh stands exactly where a
page copy was. The mesh-vs-DOM crispness *floor* therefore has no
browser gate for now; the `gradientEnergy` metric and the bracketed
floor (0.841 defect / 1.001 fix → 0.93) are in history at this commit
if a scene earns the measurement again. Two claims then had no scene:
live relayout during a route flight and displaced-uv sampling. Knobs
later proves container-query relayout during direct resize, but it does
not reverse this Passage decision: no scene currently changes layout as
part of an in-flight route transition.

**Amended 2026-08-10 — seven; knobs joins.**

- **knobs — the instrument rail.** A generative SVG visualization
  (ordinary page DOM, free to animate every frame) paired with a control
  rail of rotary knobs, toggle switches, and indicator lamps that live
  DOM controls, presented as a Surface on a raked, embossed mesh
  (`knobsGeometry.ts`) lit by the Surface's own default material. Every
  other panel-shaped scene in this roster either goes unlit
  (`material="none"` plus a custom unlit shader — genie, flight, wake
  before it) or is flat and head-on. This is the tree's only scene that
  argues the DOM-and-WebGL claim from the *lit-geometry* side: a bowed
  panel with real bosses standing proud of it, shaded by real lights, is
  something a flat CSS layer under perspective cannot draw regardless of
  effort — and the same mesh's real triangles are what a dragged knob's
  pointer event raycasts against, so the geometry is load-bearing for
  input as well as for light.
  It also proves responsive DOM-to-GL reflow: one logical width drives
  container-query layout, the successful paint stamps keyed source-UV
  anchors, and the matching WebGL hardware keeps its physical size while
  moving to the presented raster's positions.

**Amended 2026-08-15 — eight; optics joins, and the ledger catches up.**

- **optics — the bench.** A refracting loupe rides live specimens:
  re-raster sharpness under magnification (`opticsLod`'s tier walk),
  forward-ray refraction so a click lands where the bent light says it
  does, and the measured paint cost of a moving lens
  (`docs/spikes/optics-loupe.md` holds the numbers). It entered
  `App.tsx` on 2026-08-14; the roster comment there moved to eight
  while this entry still said seven.

The same amendment settles an older debt: genie and veil entered the
roster on 2026-08-09 without the argument bullet every other member
received. For the record — **genie** is the minimize-to-dock handoff
under a live film clock, the scene whose bugs forced #24–#27 and whose
retained gates are `instruments/genie-drain`; **veil** is progressive
blur over a live Surface, its law pinned in the scene's `veilLaw`
tests. The roster is workspace, glass, flight, explode, genie, veil,
knobs, optics. The logo playground stays what its registering commit
called it: a sketch off the roster.

**Amended 2026-08-22 — nine; selection joins, off the candidates bench.**

- **selection — the words stay the page's.** A run of selected text
  lifts into a bead of glass that refracts it, one strip of glass per
  selected line box. It is the roster's only **inclusive** scene: every
  other member takes the pixels away for the length of the effect, and
  this one adds a second presentation on top of live DOM that never
  stops being live. The paragraph under the glass is still selectable,
  still copyable, still found by Cmd-F, still read by a screen reader
  while the bead is on it. That is the whole argument — a capability
  that reads as decoration in a screenshot and as something else
  entirely the moment you try to copy the words out of it.

  It is also the only scene whose geometry is driven by a browser-owned
  primitive the page does not control: `document.getSelection()`'s
  client rects, arriving at whatever line breaks the layout chose, up to
  eight strips welded by a soft-min. And it is the only scene that must
  capture a DIFFERENT copy of its content than the one the user touches
  — a captured selection arrives as a black bar, so the source is a
  parked twin pinned to the live copy's measured width. That constraint
  belongs in `docs/authoring.md`'s territory and no other scene meets
  it.

  It grew up on the candidates bench and graduated on its own terms:
  the bench exists for prototypes to be COMPARED, and a scene that has
  stopped being a comparison has stopped belonging there. What moved
  with it: `scenes/selection/` (entry, shaders, tuning bag, tweak panel,
  css) and the `?scene=selection` route. What stayed behind: the stage
  helpers (`PixelPerfect`, `worldBoxOf`, `useOwnUniforms`), which are
  the bench's and which the lab already duplicates four times over
  (candidates/README.md, gaps 6 and 7).

## #4 — Core speaks in shapes; three satisfies them (2026-08-02)

**Decision.** `@munari/core` cannot import `three` (zero-dep,
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

**Decision.** The library's texture contract is premultiplied from birth:
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
passthrough, and nothing in the lab needs it, so it is not designed
for. Documented as unsupported; a
future lab that needs it reopens this entry with measurements.

## #6 — The binding re-exports the kernel whole, and the shader string lives beside the material (2026-08-03, react binding)

**Decision.** `munari`'s barrel is `export * from '@munari/core'`
plus the binding's own primitives — no curation between the kernel and
the consumer. Every name in `@munari/core` is contract-covered, so a
second doorway would only accumulate drift between what the kernel
guarantees and what consumers are allowed to see. A name earns barrel
placement in the binding's OWN half by a preserved lab consuming it:
Surface, the texture/chrome hooks, the focus kit, Dial,
arcLayout. Everything else waits for a consumer.

**SURFACE_RADIUS_GLSL** lands in the binding
(`lib/surfaceRadiusGlsl.ts`), not the kernel: a shader chunk belongs
beside the material that splices it, and core is renderer-free. The
GLSL and core's `surfaceRadiusSd` are twins BY CONTRACT — the
conformance suite pins the JS SDF, and the chunk must compute the same
distance so a ray and a fragment agree about where a corner ends. The
uniform names are the library's own (`uMunariRadii`,
`uMunariSize`, `munariRadiusMask(vUv)`) because a custom
material's opt-in call sites are consumer-visible contract.

**Amendment (2026-08-17, react binding).** The root is CURATED, and
`@petepetrash/munari/advanced` is the second doorway that re-exports the
kernel whole. Uncurated worked while the only consumer was the lab. It
stopped working when the root started carrying scene recipes
(`FocusOrbitRig`, `arcLayout`) whose tuning is one demo's answer, and
escape hatches (`FrameSurface`, `useCarriedMotion`, the manual presenter
seam) a newcomer finds before the primitive they actually want. Both are
paid for by consumers who then depend on them. So the root is the
supported way to use a Surface and nothing else, `./advanced` is the
deliberate opt-in, and `packages/react/src/index.test.ts` pins both lists
by name — adding an export is now an edit to that test, not a side
effect. `FocusOrbitRig` and `arcLayout` leave the package entirely:
copyable behaviors are `registry/` policy (#10), welded to the lab
reference.

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
the lab hangs it at `window.__munari.stats()` in App.tsx. A zero-dep
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
browser-verified reference for an untested abstraction. The same
reasoning gates kernel surface (#7: a consumer arrives holding the
need, or nothing crosses).

**What the charter is.** The inventory of what lives where, the rules
any future extraction must preserve, and the tuned-constant table —
welded by test the way the glass pack is: the kernel claims by import
(`TOSS_SPIN_V0`, the AMP/2 spot-check at half-saturation), the scene
claims by text (the 6×3 fold grid, the 0.35 remainder, `CRUMPLE_Z`). A
charter whose claims are executable cannot quietly rot into wishful
documentation.

## #11 — The published package is staged, and the kernel travels inside it (2026-08-03)

**Decision.** `npm run build` bundles `packages/react` into
`packages/react/dist` with `@munari/core` **inlined** and
`three`/`@react-three/fiber`/`react` left external, writes a purpose-built
manifest into that directory, and publishing runs from there
(`npm publish packages/react/dist`). The workspace manifest keeps
`exports` pointing at `src/`, and keeps `private: true`.

**Why the kernel is bundled rather than published beside the binding.**
One public package is #1's promise. A published `@munari/core` would
be a second doorway with its own version line, and a consumer who
installed both could hold two kernels — the same failure mode as two
copies of three, minus the `instanceof` error that would announce it.
Bundling makes the kernel an implementation detail that cannot be
depended on by accident. The staging script checks the emitted bundle
for a surviving `@munari/core` import rather than trusting the config,
because that import resolves fine inside the workspace and fails only
for consumers.

**Why staging instead of repointing `exports` at `dist`.** The lab
resolves `@petepetrash/munari` through the workspace with no alias standing in for
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

## #13 — The paint source has a node door, and it is adopt-only (2026-08-03, paint layer)

**Decision.** `createDomTextureSource` takes `string | HTMLElement`.
Markup is parsed as before; an element is **adopted** — and only if it
has no parent. A parented element is refused with a message naming
`cloneNode(true)`. Adoption is one-way: the source restyles the node,
relayouts it inside the canvas box, and `dispose()` removes the canvas
with the subtree still inside it. Nothing is handed back.

**Why a node door at all.** Some subtrees cannot survive a round trip
through `innerHTML`. An exploded-paint plate is a `cloneNode` of a live
page element, wrapped in padding to defeat the border-box clip
(platform.md #9), carrying an injected descendant-wide neutralizing
stylesheet. The consumer assembles and *measures* that subtree; asking
them to serialize it back to a string would discard the assembly and
re-parse into a different object graph than the one they measured.

**Why adoption refuses a parented node.** `appendChild` MOVES a node,
it does not copy it. A consumer handing over an element still in their
page would have it torn out mid-frame, their layout reflowing around
the hole, with no error anywhere — the exact shape of bug this kernel
spends its comments on: invisible in review, expensive to notice,
found only by debugging. A parent check makes it unwritable instead.
The refusal is ordered ahead of construction for the same reason the
capability gate is (#12): a refused source owns no DOM, and the
consumer's tree is left exactly as it was.

**Why dispose releases the node.** A loan, not a confiscation: the node
is required to *arrive* unparented, so it leaves that way and adoption
is exactly invertible. The first version of this entry said ownership
never reverses and left the subtree inside the dead canvas. Two things
say otherwise. React StrictMode mounts, cleans up, and mounts again, so
a `<Surface html={node}>` adopts the same node twice with a dispose
between — and the second adoption would be refused for a parent the
source itself installed: correct by the rule, nonsense in the
situation. And a consumer holding a released-in-name-only node holds
its dead canvas through the parent pointer, leaking one parked canvas
per disposed plate. Note what release does *not* mean: the node is not
put back where it came from. The page never had this subtree — it had
the original the consumer cloned.

**Evidence.** Ten cases in `tests/conformance/paint/htmlInCanvas.test.ts`.
Proven on a planted violation: deleting the parent check fails three of
them, and one fails specifically because the live node had been moved
out of its parent — the bug, reproduced. The remount case was written
red before release existed, and failed with the refusal itself.

## #14 — Immutable storage is reconciled by comparison, not by schedule (2026-08-04, paint layer)

**What.** A Surface reallocates its GL texture storage from inside the
upload path, by comparing the canvas it is about to upload against what
the storage was allocated for — dimensions and filter-policy pair. No
resize, scale change or pin marks anything for later.

**The law it enforces.** `texStorage2D` is immutable. three allocates a
`CanvasTexture` once at first-upload dimensions and `texSubImage2D`s
every upload after, without ever re-reading the canvas. So an upload
into storage allocated for a different size is wrong in one of two
silent ways: a shrink *succeeds*, landing the whole re-raster in one
corner of the stale texture and leaving the previous frame around it
(the LOD ghost); a grow is rejected outright — `GL_INVALID_VALUE:
glTexSubImage2DRobustANGLE: Offset overflows texture dimensions` — and
the old texels stay on screen. Neither raises in JS. The mip count bakes
at allocation as well, so the mip DECISION is the other half of the
comparison — and only the mip decision, not the tier that implies it
(see the amendment under Cost).

**Why not a mark.** It was a mark, and the mark was right for the
resizes it was written for: `paintCount` at the moment of the resize,
dispose on the first upload to arrive after the counter moved past it —
deliberately never from the swap frame itself, where the canvas is a
cleared, unpainted backing store. That reasoning holds for an
*occasional* resize. It cannot survive a continuous one. The passage lab
flies a card whose layout width is swept from a tile's box to an
article's box, resizing its Surface on every frame of the flight; every
commit re-armed the mark to the current paint count, so "wait for the
counter to pass the mark" chased its own tail. Traced at the GL
boundary: one `ALLOC 308x324`, then a hundred and twenty uploads growing
to `811x498`, every one rejected, ending in a lost context — while the
scene's own instruments reported a healthy flight, because from the DOM
side it *was* one.

**Why comparison is the stronger form.** A mark is a claim about the
future ("something will need to happen later"); the thing that owns that
claim is the resize, which does not know how many more resizes are
coming. A comparison is a claim about the present, made by the only code
that knows both operands — the upload, holding the canvas and the
allocation. It has nothing to re-arm and cannot be outrun, and it
subsumes all three arming sites (`setSize`, LOD `setScale`, pinned
`setScale`) plus one case none of them could express: a pin or unpin
that lands on the *same* tier now gets fresh storage, where before it
kept whatever mip count was baked at birth — trilinear sampling with no
pyramid to sample from, or a pin asking for one and never getting it.
That was a documented caveat in the code. It is now just gone.

**Cost.** A comparison per upload, and an allocation whenever the
answer changes. Measured on the passage flight at 120Hz: idle median
8.3ms, flight median 8.3ms, p95 10.1, max 17.1, zero frames over 20ms.
An idle Surface asks the same question and is told no.

**Amended the same night, by #15.** As first written, this compared the
whole `(pinned, tier)` pair through `filterPolicyTransition`, on the
reasoning that the tier is what sizes the store. #15 severed that: the
store now floats inside a density band, so the tier no longer decides
the allocation and keying on it would dispose the texture on every frame
of a Surface that follows its own depth — the passage card asks for a
new density every frame. What actually bakes into an allocation is the
dimensions and the mip count, so those are what is compared, and
`filterPolicy(pinned).mips` is read directly. #15 also made the
allocation rare: four for a whole flight, where this entry as written
produced one per frame.

**Evidence.** `tests/conformance/paint/textureStorage.test.ts` — seven
cases in the `uploadNeedsRealloc` block, including the regression as a
loop (a hundred and twenty frames of a growing box, asserting the
allocation equals the store after every single upload, never one frame
behind) and its complement (six hundred
frames of a Surface that only repaints: one allocation). In the browser,
the same GL trace that convicted the mark now shows every `ALLOC` paired
with an upload at its own dimensions, and a full round trip — out and
back — drains 478 frames of `getError()` with nothing in them.

## #15 — The backing store floats inside a density band; rest is exact (2026-08-04, paint layer)

**What.** A paint source's canvas is no longer cut to `box × scale` on
every resize. `storeForBox` keeps the store it has as long as the
density it supplies — `store / box`, per axis — is within ±40% of the
density that was asked for, and re-cuts exactly only when it drifts
out. The CSS box is still moved exactly, every time. When the box stops
moving, `resettle()` cuts the store exact again; `Surface` calls it
after eight quiet frames.

**The measurement that forced it.** Writing `canvas.width` CLEARS the
backing store, and the paint that refills it is the compositor's to
schedule — it lands after the frame that asked. A Surface resized every
frame therefore uploads a *blank* canvas every frame. Traced on the
passage flight, sampling the parked canvas at every rAF: coverage
**0/576 on 38 of 40 frames**. The two exceptions are the tell — both
were frames whose width happened to repeat, and on those the canvas was
full.

This had been invisible for as long as it existed, because #14's bug was
covering it: the uploads GL was rejecting were the blank ones, so the
stale texels it refused to overwrite were the only thing on screen.
Fixing the storage bug made the card render its actual texture, and its
actual texture was nothing. **The first correct frame is what showed the
second bug** — worth remembering the next time a fix appears to make
something worse.

**Why a band is the right shape.** A canvas is not a framebuffer that
has to match its box. `drawElementImage` replays paint records scaled by
the backing/CSS ratio (platform.md #8), so a store that merely fits
loosely rasters the same layout at a slightly different density — and
density is a budget this library already spends deliberately, all the
way down to an LOD ladder. Letting it float converts a per-frame clear
into a handful: measured over the flight, **four allocations for 120
frames**, and every upload full. What does NOT float is the box. The
subtree still lays out at exactly the size it was given on every frame,
which is the entire point of a resizable Surface — only the number of
texels spent on the answer drifts.

**Why rest is exact.** ±40% is a real softness, and #1 commits this
library to crispness as a *rest state*. A band with no settle would
leave a landed card under-supplied forever, with nothing to knock it
back out of tolerance. So the tolerance is scoped to motion: eight quiet
frames (~67ms at 120Hz — over before anyone reads the card, long enough
that a spring's last sub-pixel twitches don't each buy a re-cut) and the
store is cut exact. Measured on a held flight: density 1.006 against an
asked-for 1.175, then 1.175 after the quiet.

**Why the re-cut carries the raster forward.** A re-cut still clears. It
is rare now, but rare is not never, and a blank frame in the middle of a
flight is exactly the artifact this entry exists to remove. So `recut`
blits the old store into the new one before asking for the paint,
stretched from old dimensions to new. Both hold the same element box, so
the stretch IS the density change and nothing else — one frame of
slightly-wrong sharpness in place of one frame of nothing.

**Evidence.** `storeForBox`'s eight conformance cases, including the
flight as a loop (120 frames of a growing box: 120 exact-fit re-cuts
become at most 5) and the axis case (either axis leaving the band re-cuts
both, because writing either attribute clears the whole canvas). The
`createDomTextureSource sizing` suite gained four: the store holding
through an absorbable resize, the paint still being requested when it
holds, and `resettle` in both states. In the browser: coverage 576/576 on
every frame of a flight, four `ALLOC`s in the GL trace, zero
`getError()` across a 479-frame round trip, idle paints still zero, and
frame timing unchanged (median 8.3ms, max 17.1, none over 20).

## #16 — The box follows the layout, and the card is told the box (2026-08-04, lab)

**What.** The passage's flying card no longer takes the height its
layout hands back. `followHeight` moves the box toward that answer with
its own critically damped spring (`HEIGHT_OMEGA` 30), and the card is
then TOLD the box it is in — an explicit `height`, with
`align-content: start` and its own `overflow: hidden` answering in
whichever direction the two disagree. The flight ends on `landed`, which
waits for both springs and then renders one frame at the exact
destination box before handing back.

**The complaint.** "Quite glitchy and janky." It was not a frame-rate
problem and the trace said so immediately: warm runs hold median 8.3 ms,
max 11.9, zero long tasks. The three >100 ms stalls in the first trace
were first-open shader and texture compile, which is a different entry's
problem.

**The measurement that found it.** Per-frame deltas of the box.
**91 px of height arrived in a single frame**, and five frames moved the
height *against* the width. Swept one pixel at a time, this component's
honest height is a step function: +29 px crossing its 430 px breakpoint,
+88 px crossing its 720 px one, and five separate ~19 px drops as a
paragraph loses a line. Seven discontinuities, non-monotonic, inside
700 ms. Every frame was correct. The scene was rendering the layout's
truth faithfully and the truth is a staircase.

This is the price of the thing the scene exists to demonstrate. An
interpolator cannot produce this curve — that is the claim — and the
same fact means the curve is not smooth. So the layout is not smoothed:
the DOM still reflows at every intermediate width, and the height still
comes from nothing but what the layout answered. What is smoothed is how
fast the BOX is allowed to adopt it.

**Why the card has to be told.** A follower trails a ramp in proportion
to the ramp's speed, and this one climbs 370 px in 700 ms. Measured
after the follower shipped: the box disagreed with the card's natural
height on **106 of 138 frames, worst 120 px** — and in both directions,
because of those five drops (worst overshoot 13.15 px). The first
attempt padded the difference with `padding-bottom`, which can only fill
a box that is too tall; for two thirds of every flight the box was too
SHORT, the card overflowed its frame, and it lost its bottom edge and
its radius for the whole crossing. One imposition handles both: the card
is the box, its background fills what the content does not reach, its
`overflow` crops what does not fit. A panel opening into its new shape,
which is what it is.

**Why the imposition must be exactly invertible.** The scene asks the
card how tall it WANTS to be every frame, of an element it is
simultaneously telling how tall it is. `min-height` cannot be asked —
`offsetHeight` answers `max(natural, imposed)` and there is nothing to
subtract. Reading the children back cannot either: `offsetTop +
offsetHeight` misses bottom margins, measured 12–13 px short on 172 of
317 widths. Lifting the imposition for the length of one read is
invertible by construction. It costs a second forced layout per frame on
a subtree that is already re-laying-out every frame.

**Two bugs the landing was hiding.** The flight ended on the position
spring alone, and the two springs do not finish together — measured, the
position settled with the box still 1.9 px short, so the mesh unmounted
and the DOM reappeared taller in the same frame. And `atTarget`'s
threshold is on PROGRESS, not distance: 0.0015 of progress is 0.41 px of
width at the end of a `t^1.5` size curve, and 0.41 px of width is 1.09 px
of HEIGHT once the height is measured rather than interpolated. Hence
the snap, and hence the snap being its OWN frame — `onLanded` clears the
pass and unmounts the component, so a `setPose` in the same commit is
discarded and the last thing rendered would be the frame before. The
snap is also recorded as *which* target it was for, not merely that it
happened, so a reversal in that one frame turns the card around instead
of landing it somewhere it is no longer going.

**Evidence.** Eight cases under `followHeight` in
`passagePath.test.ts`, carrying the real 159-sample measured height curve
as data: that the layout really does step (the premise — if it ever goes
continuous, that test says so), that the follower crosses the same steps
without ever jumping, that it smooths without erasing the dip, that it
lands exactly, that it settles a visible distance short (why the snap
exists), that the position cannot finish while the box is still growing,
and that the lag is large and two-sided (why the card is told the box).
In the browser, all three paths: biggest single-frame height change
**91 px → 12.7 px** open, 16.7 close, 11.6 on a mid-flight reversal;
departure pops −16/−18 px → −0.5/−0.8; zero gap and zero clip frames
across 139; and every path landing on its destination
`getBoundingClientRect()` to the pixel — 694.664 against 694.6640625,
seam 0. The worst-lag frame captured out of the drawing buffer shows an
intact card, full border and radius, stats row mid-reveal.

## #17 — The layout runs twice, and every word flies between the two answers (2026-08-04, lab)

**Decision.** The passage is no longer a live relayout in flight. The
layout engine runs **exactly twice** — once at each endpoint width,
off-screen, in a parked canvas — and the two answers are compared: every
word box and every painted block is measured in both, matched by
identity, and flown between its two positions. Nothing re-lays-out
in between. Each part is one instance carrying `aBoxA`/`aBoxB`,
`aUvA`/`aUvB` and `aMeta`; one `uT` uniform per frame moves all of them.
The whole flying card is **6 draw calls and 200 triangles**, and the
pose is a pure function of `t`, so a mid-flight reversal replays the
outbound frames exactly backwards rather than re-deriving anything.

`relayout` — the previous design, #16 and all — is kept as a mode
beside it, because the comparison is the point.

**The complaint.** "It still looks very rough. There is tons of text
re-layout happening, some kind of glitchy shading effect near the
corners, and the way the elements inside change dimensions doesn't look
smooth." And then, decisively: "another issue is that there's an
intermediate two column layout that appears during the transition."

**Why #16 could not have fixed it.** #16 smoothed how fast the BOX
adopts the layout's answer. It could never smooth the answer. At
308 px this card is a stacked column; at 940 px it is a wide sheet;
somewhere in between a container query flips it to two columns, and the
passage crosses that width on its way. Every frame was correct. The
two-column composition exists at neither end of the journey and is
therefore not part of the journey — the honest intermediate layout is
the wrong thing to draw. That is the whole argument for measuring the
endpoints and interpolating between them instead.

**Why this cannot be done in the DOM at all.** A line box is not an
element. There is no node for "line 3 of this paragraph", so nothing
that animates *elements* — View Transitions, every FLIP library — can
move a word from one line to another. The browser's own answer is
visible in the A/B: `::view-transition-old` and `-new` are two
photographs cross-fading, and mid-transition the old card's ghost is
sitting scaled-up underneath the new one, its counter frozen at the
frame the snapshot was taken. Measured at this card's two widths:
27 parts at the source, 96 at the destination, **27 matched, 69
arriving, 0 departing**. Sixty-nine of the destination's words are
under a fold at the source; every one of the 27 that is shared changes
line, column, or size. Word-level correspondence is a thing only a
renderer that owns the pixels can offer.

**A part with no history borrows the card's.** An arriving word has no
source box, and the obvious answer — start it where it will end — is
wrong, because at `t=0` the card is 308×324 and the destination
coordinate is at y 430. Measured: arrivals hung *below the panel*, on
the page background, for most of the flight. `carriedInto` scales a box
from one endpoint's frame into the other's proportionally, and
`arrivalSource` is that carry plus a small rise; `departureTarget` is
the same identity run the other way, which is what makes a close the
open played backwards. Two tests fix it in place: *starts an arrival in
the card it is arriving into*, and *keeps every part inside the card
that is carrying it*.

**Only the word that actually changes line gets to move.** Words that
cross a line break need to be legible as moving rather than as
smearing, so a crossing word lifts off the card (`CROSS_LIFT` 30) and
dims (`CROSS_DIP` 0.55) at mid-flight, returning to exactly flush and
exactly opaque at both ends. The first metric for "is this word
crossing" was geometric — residual displacement over the word's own
size — and it **convicted the innocent**: this card grows 3.05× in
width but only 2.15× in height, so every word carries a large vertical
residual by construction, and a short word like "in" divides that
residual by 23 px and clears any threshold. The whole meta line dimmed
and floated. The predicate that is correct is not geometric at all:
a word crosses when its **adjacency to the word before it changes** —
`sharesLine(prev, self)` differs between the two layouts. At this
card's two widths that fires for exactly one part, `w3:7`, the word
"box", which is on line 2 of the title at 308 px and on line 1 at
940 px. It is the only thing in the frame that lifts.

`crossBump` is a parabolic smoothstep, `x = 4c(1-c)`, `x²(3-2x)`, and
not `sin(πt)`, because `Math.sin(Math.PI)` is `1.2e-16` and a test that
asks for a part to be exactly opaque at rest is right to fail on that.
The same three lines are in the vertex shader.

**One thing on the card stays a live document.** The counter. It is
excluded from the measurement by selector, its band is measured and its
element hidden in the same pass, and it rides the flight as a real
Surface whose box is lerped between the two measured bands. A
frozen counter is the exact charge this scene levels at
`startViewTransition`; a demo that froze its own would be making the
foil's argument for it. Its content root has to declare
`background: transparent` — `.ui-root` carries the app's opaque page
background because it stands in for `<body>`, and without the
counter-declaration the band paints a white slab across the artwork
behind it. Same declaration, same reason, as the glass scene's.

**Evidence.** 28 cases in `passageParts.test.ts`, all pure. In the
browser, the same instant held in all three modes: `munari` at
`debug.hold = 0.5`, `relayout` at the same hold through the same
spring, and `view-transition` paused through the Web Animations API —
`document.getAnimations()`, seek each `::view-transition-*` to half its
1100 ms duration. The relayout capture is the two-column intermediate,
in full. Reversal verified live: turns around mid-air, lands home,
`pass` null, `route` null. At rest the scene owns zero surfaces.

## #18 — Seven flickers, one report (2026-08-04, lab + paint layer)

**What.** "Still a lot of flickering and glitchy artifacts" on the
passage flight, taken apart into seven independent defects. None of
them shared a cause; six of the seven produced no error, no warning
and no stripe; three were in the library and four in the lab. They are
recorded together because the *sequence* is the lesson — every one of
them was hidden behind the one before it, and each was found only by
measuring the same pixels twice.

**1. Punctuation was silently dropped from every flying word.**
`Intl.Segmenter` at `granularity: 'word'` emits punctuation as its own
non-word-like segment, so filtering on `isWordLike` — which is what the
API's own examples do — deletes every hyphen, comma and period from the
card. The mesh read *"A box shadow lives outside the border box  and
the"* against a DOM that read *"A box-shadow lives outside the border
box, and the"*, and at speed that is not a missing comma, it is a
flicker: the words either side sit at their real DOM positions, so the
gap opens and closes as the line reflows. `textRuns` coalesces adjacent
segments into runs and ends a run **after** its punctuation rather than
before it, because a line break may fall there — `box-` on one line and
`shadow` on the next is a real wrap, and a run that spanned it would
take the union of two lines' rects and fly as a box the height of the
paragraph.

**2. The source plate was never re-cut at the magnified density.**
`createDomTextureSource` ADOPTS its node (#13), and the re-cut handed
over the node the first cut already owned — so it threw, into a `catch`
that returned. The scene went on flying a plate cut at resting density
stretched across three times its area, for the whole of every open.
`node.cloneNode(true)` is the fix the adopt contract prescribes and the
error message names; the `catch` now `console.error`s, because what it
swallowed cost a rewrite to find.

**3. Oversupply is not headroom.** Both endpoints were cut at 1.25× on
the argument that the card rises toward the camera mid-flight. What
that bought was a permanent 1.25× *minification* at both ends, sampled
trilinearly — about a third of a mip level of blur on the two frames a
reader can actually stare at. The lift belongs with the magnification,
which is the only cut ever seen in motion; a resting endpoint is now
supplied at exactly one texel per device pixel, pinned by test.

**4. The shadow was in front of the card at both ends of the flight.**
A shadow is clipped out of its caster's silhouette by the depth test
(archive #58), and a depth test only clips while the caster is *nearer*
than the shadow. A landed card is at z = 0; the shadow quad was at
z = +1. So it sat in front of the very card it was supposed to hide
under and painted a card-sized 50% veil over it — correct in mid-air,
wrong at both endpoints, which is precisely the shape that reads as a
flash rather than as a bug. Proved by forcing the card's fragment
shader to opaque red and reading the drawing buffer: 128 at +1, 255 the
moment the constant changed sign.

**5. Straight alpha uploaded into a premultiplied blend.**
`premultiplyAlpha` (an upload flag) and `premultipliedAlpha` (a blend
equation) are different claims about the same pixels and nothing checks
that they agree. A 2D canvas holds premultiplied texels; with the
upload flag false, `texImage2D` *un*-premultiplies them, and the
premultiplied blend then draws every partially covered texel at up to
twice its weight. There is no stripe and no error — only text that
reads heavier than the page it is standing in for. Measured on the
title row: GPU 138, DOM 115, and a CPU composite of the very same plate
109. The flag went true and the row read 111.

**6. The alloc ledger was seeded one event too late** — #14's blind
spot. That decision reconciles storage *at upload time* by comparing
the allocation to the store, and the comparison is only as truthful as
the baseline it starts from. The baseline was taken by the first
`upload()`. But the allocation is not made by the upload path: it is
made by the RENDERER, the first time it draws a material whose map has
`needsUpdate` set, at whatever the canvas measures then — and a Surface
sets `needsUpdate` twice before any upload runs. So `texStorage2D`
routinely lands first, and if the canvas is re-cut in between, the
first upload records a baseline that was never allocated. After that
the ledger and the driver agree with each other, forever, about a size
neither is using. Traced at the GL boundary on the live counter:
`texStorage2D 308×43` once, then `texSubImage2D 940×106` returning 1281
on every frame of the flight, with `uploadNeedsRealloc` answering
*false* to all of them — correctly, from a lie. The ledger is now
seeded where the allocation is armed. Same trace after: allocations at
308×43 **and** 940×106, 2200 uploads, zero errors.

**7. A brand new Surface's first paint is an empty div wearing the page
background.** `.ui-root` carries the app's opaque background because it
stands in for `<body>`, and the transparency opt-out was written as
`:has(> [data-marker])` — read literally, "clear the background once a
child exists", which is one frame too late. The container is built and
handed to the compositor synchronously; the React root inside it
renders concurrently. Frames 1 and 3 of every open were a white bar
across the card, and on frame 1 it was the only thing drawn at all.
The marker moved onto the root, stamped in the same call that builds
the container.

**The method, which is the durable part.** Every one of these was
found the same way: hold the flight at a fixed `t`, capture the mesh
and the real DOM at the *same pixels*, and difference them. Reasoning
found none of them and convicted three innocents — sub-pixel phase
(swept ±0.75 px; sharpness peaked at offset 0 and troughed at ±0.5,
so phase was already right), double-drawn text (hiding either mesh
changed nothing on the title row), and the capture itself (plate texels
matched the DOM exactly, throughout). The landing went from **104,598
differing pixels of 480,340 to 11,347**, and the row statistics now
mesh: 119.8/20180 and 38.1/10143 against the DOM's 115.0/20610 and
39.7/9751.

**Evidence.** `passageRuns.test.ts` (7 cases, written failing),
`passageField.test.ts` (`captureScale` density law + a `plateTexture`
tripwire), `passageShadow.test.ts` (the sign), and a seeding case in
`tests/conformance/paint/textureStorage.test.ts`. 579 passing. In the
browser: the counter runs, in the mesh, for the whole flight — which
is the argument this scene exists to make.

## #19 — The shutter, not the streak (2026-08-04, lab)

**What.** The flight has motion blur, and it is not a post pass. There
is no velocity buffer, no previous-frame matrix, no accumulation
target, and the CPU's entire per-frame contribution is one subtraction
— `shutterSpan`, velocity times the exposure time.
Everything else falls out of a property the field already had: **the
flight is a pure function of `uT`**, so "where was this exact corner of
this exact word when the shutter opened" is not a history to keep, it
is the same three lines evaluated at `uT - span`.

**Why that is the interesting part.** Real-time motion blur is
normally expensive because velocity is not knowable — the renderer has
to *remember* the last frame, per object or per pixel, and reconcile it
with this one. Here the trajectory is closed-form and every part
carries both of its endpoints as attributes, so each vertex's own
velocity is available for the cost of evaluating a `mix` twice. Not
per object. **Per vertex** — which is why the title's left end is soft
while its right end is sharp in the same frame: the card grows from its
centre, so the two ends of one line of one paragraph are travelling at
different speeds, and each corner of each word gets its own smear.
That is the claim the whole scene exists to make, arriving in a second
form. A DOM filter is per element; there is no element for "the left
half of this line".

**How it is integrated.** The quad is swept — corners on the leading
side of the travel stay put, trailing corners pull back to where they
started, which for a convex quad is exactly the union of the two poses,
so the trail has somewhere to land instead of being clipped at the box
it came from. The fragment shader then walks twelve taps back along the
smear **in the box's own local units**, and a tap that falls outside
the box contributes *nothing* rather than being clamped. That last
clause is not fussiness: the uv rects are windows onto a whole card's
plate, so the texels just past a word's box are the next word along —
clamping would smear a neighbour into this one's trail. Averaging over
all twelve taps rather than over the ones that landed is likewise
deliberate; a fragment the word only covered for part of the exposure
really did receive less light, and that partial coverage is what makes
the leading and trailing edges fall off instead of ending on a cut.

**THE EXPOSURE IS A TIME, AND THIS IS THE WHOLE ENTRY.** The first cut
shipped a shutter *angle* — 180°, half a frame, chosen against a fully
open one that rendered the card unreadable. It was verified in the
drawing buffer, at a held instant, on a 2× crop, and it looked right.
Pete's verdict on the shipped build was **"I don't see any motion
blur"**, and he was correct. Measured on a live flight immediately
after: **peak smear 4.4 px, median 0.76 px, not one frame above 6 px.**

An angle is a fraction of a frame, and a frame is not a quantity this
scene controls. 180° is 1/48 s at cinema's 24 Hz and 1/240 s at the
120 Hz this machine actually runs at — so the effect got *weaker the
better the machine performed*, and the same build would have rendered a
different photograph on a 60 Hz display. That is a bug about units,
not about taste, and no amount of tuning the angle would have found it.

Stated as a time — `EXPOSURE = 1/48 s`, cinema's own number — the span
is velocity × exposure, identical on every display. Peak smear went
4.4 px → **24.4 px**, median 0.76 → 3.7, frames above 6 px 0 → 48 of
116. And it is allowed to reach back further than the frame that
reported it: at 120 Hz this covers about two and a half frames of
travel, which no single camera could do. That is deliberate. What is
being simulated is a photograph of the flight, not a sample of it.

Tap count is a function of the widest smear, so it moved too: twelve
taps were sized for a 4 px streak, and a forty-texel one walked that
sparsely is a row of ghosts. Twenty-four.

**The lesson is about the instrument, not the effect.** Every earlier
defect in this scene was caught by differencing mesh against DOM at the
same pixels, and that habit is what failed here — a 2× crop is the
right magnification for asking *is this correct* and the wrong one for
asking *is this visible*. Correctness was never in question; the effect
was in the buffer the whole time. **Judge a perceptual quantity at 1:1,
and prefer a number in pixels to a picture.** "Peak 4.4 px" would have
ended this in one line at any magnification.

**A held frame is exactly the still.** `shutterSpan` is zero when
progress did not move, and the shader takes a single-tap branch on a
zero smear — so a paused flight is bit-identical to the unblurred
image, not an average of twenty-four copies that agrees to within
rounding. The endpoints of this flight are compared against real DOM at
the same pixels; a hold that blurred would be measuring the blur.

**Cost.** None a frame timer can see, at either tap count: median
8.3 ms through a live flight, p95 9.3, worst 10.9, zero frames over
20 ms. Twenty-four taps times two samplers, on a few hundred small
quads, against a field that was already one draw call.

**Evidence.** Seven cases in `passageField.test.ts`, the first of which
is the regression stated directly — *does not depend on the frame
rate*: the same stretch of flight at 60 Hz and at 120 Hz must produce
the same span, because a camera pointed at that flight would record the
same streak. In the browser: shader compiles clean, the endpoint held at
`t = 1` is pixel-for-pixel the pre-blur still, five frames pulled from
the drawing buffer across one live flight show heavy directional smear
through the fast middle resolving to a crisp landing, and the title —
which sits near the card's centre and barely travels — stays legible
throughout while the small type at the edges smears hardest. 586
passing.

## #20 — Every endpoint is a destination, and a card has one grid (2026-08-04, lab)

Pete, after the shutter landed: *"the webGL texture of the DOM becoming
noticeably more blurry than the native DOM, particularly at the smaller
card size. it's very noticeable when the card shrinks back to its small
size when the switch between GL and native happens because the
typography gets a lot clearer."*

Two separate defects, found in that order, and the second is the one
worth keeping.

**One: the smaller endpoint was being oversupplied.** `captureScale`
took the OTHER endpoint's width and cut the smaller of the two denser,
so the plate would still have texels left when the flight magnified it.
The argument is real — mid-flight the small card's capture is blown up
toward the large card's size — but it silently reclassified the small
endpoint as a *source* and nothing else. It is also where the card comes
to rest, at the start of an open and the end of a close. Measured live at
the two resting sizes, supply being texels carried over device pixels
covered:

    large endpoint (940 px):  1.000    exact
    small endpoint (308 px):  2.526    two and a half times oversupplied

Oversupply is not free headroom. It is a minification, and a 2.5×
minification through a trilinear sampler is over a mip level of blur. The
headroom was being paid for out of the wrong budget: both endpoints are
now cut at exactly `dpr`, and the mid-flight softness that lift was
buying off — which peaks at 1.75× at the geometric mean of the two
widths — is left to the motion blur that now covers exactly that stretch
of the flight (#19). Sharpness where a reader can stop; the exposure
where they cannot.

The corollary deletes work. The source's density used to change the
moment the destination was measured, several frames in, so every open
re-cut its own plate mid-flight — the re-cut `publishedCut` exists to
hide, and the one that quietly handed `createDomTextureSource` a node it
had already adopted (#18). It cannot happen now. There is nothing left
for the destination's arrival to change.

**Two: the card's origin was off the display's pixel grid, and that was
most of it.** Supply was exact at both endpoints and the type was still
soft. The mip chain was the obvious next suspect and it is innocent:
poking the sampler down to `LINEAR` through the raw GL parameter produced
a byte-identical frame, which is what 1:1 supply predicts — the
derivative picks mip 0 and the chain is never read.

What was left is phase. The field draws every word as its own quad at its
own measured box, and those boxes are fractional — 27 of 27 measured
live, median 0.31 px off the grid. **That is correct and it must stay.**
A word's fraction is baked into the capture, and its uv rect is exactly
`box / card`, so the texel it wants and the texel it asks for are the
same one. There is one grid per card, not one per word.

The card's own origin is the one that matters. Its texture is a capture
of its own box, so the texture's texel grid *is* the card's pixel grid —
offset the card by a fraction of a pixel and every texel in it is read
across two, which is one bilinear tap of blur applied uniformly to type
that was rasterized to be read. The tile's page rect put its top at
147.84375. Measured on the small endpoint, held at `t = 0`, gradient
energy over the typography band against the same pixels of real DOM:

    DOM                       900.90
    mesh, origin at 147.84    758.02   0.841 — the report
    mesh, origin snapped      902.19   1.001

Sixteen percent of the type's edge energy, for a sixth of a pixel.

**The snap is presentation, so it lives outside the path.** `poseAt` is
the physics and stays exact; `gridSnap` is a display correction applied
where the pose is consumed. It costs a displacement of up to half a pixel
from the DOM the card is standing in for, and that trade is not close: a
half-pixel displacement is invisible, a half-pixel blur is what gets
reported. It is weighted by `snapWeight`, full strength at BOTH endpoints
and off by 8% into the flight — mid-flight the card is magnified, tilted
and lifted, there is no phase to be right about, and quantizing a moving
card's position is just a way to make it move in steps.

**The through-line of both halves is the same sentence.** *Every endpoint
is a destination.* The first defect conditioned density on which endpoint
was smaller; the second inherited a fractional origin from the page. Both
treated the small end as somewhere the flight passes through. It is where
the reader stops, twice — and the landing is the only frame in the whole
transition where the mesh and the page are shown the same type at the
same size, one after the other, which is exactly why Pete could see it
there and nowhere else.

**Evidence.** `sharpness = supply × phase × transfer` (#53 in the
archive) has three independent budgets, and phase is the one nothing else
can compensate for — no amount of density fixes a bad phase, because the
extra texels land off-grid too. Eight cases in `passagePath.test.ts` led
by the live numbers; three in `passageField.test.ts` for the density.
Browser: supply now 1.000 at both endpoints, the shipped code path
reproduces the poke exactly (902.19, 1.001×), the large endpoint reads
0.976 against its own DOM, both corners land on integers at steady state,
and a full flight is unchanged at median 8.3 ms / worst 10.2 / zero
frames over 20 ms. 592 passing.

**Instrument note.** The large endpoint first measured *off* the grid at
`top = -37.5`, which was the probe and not the scene: uniforms are
written imperatively in `useFrame` while the group's position arrives
from React state one commit later, so the first frame that qualifies has
a destination-sized card at a not-yet-destination pose. Reading a value
that is written on two different clocks means waiting for both.

## #21 — A law with no callers is a rumour (2026-08-04, kernel + lab)

Pete, after the sharpness arc closed: *"let's take stock of what we've
built so far this session and evaluate what we've learned, and decide if
there are any learnings we want to pull into the core API."*

The stock-take found the kernel and the scenes drifted apart on the one
subject the whole session had been about, and drifted in **opposite
directions**.

**The kernel owned the supply law and nobody called it.** `texelDemand`,
`densityScheduleStep` and `densitySupply` are contract-covered, correct,
and had zero production consumers. Meanwhile `Flight.tsx` re-derived both
of them by hand — `dpr * planeScale(cameraDistance(viewH, FOV), LIFT_Z)`
for the supply, and the schedule open-coded down to its two hysteresis
constants:

    f.mode === 'crumple'
      ? f.hiDensity
      : f.mode !== 'home' && f.plate.p.z > LIFT_Z * (f.hiDensity ? 0.5 : 0.65)

and `passagePath`/`passageField` each had a third and fourth copy. The
copies were not wrong. That is the point — a law nobody calls is not a
law, it is a rumour that happens to be true, and the next scene that
needs it writes a fifth version from memory. `densitySupply` is the same
multiplication in the same order, so this rewire is *bit*-identical
arithmetic; what changed is that the constants now have one home.

The translation stays scene-side and that is the seam. The kernel speaks
two mechanism flags — `returning`, `frozen` — and the lab has four
gesture modes. Mapping `home → returning` and `crumple → frozen` is a
statement about *this* scene's vocabulary, and it is the only part of
those seventeen lines that was ever scene-specific.

**The 4096 guard was the mirror image: a kernel number the scenes could
not cite.** Both lab scenes capped their own density at **4000** — a
fear-margin invented around a boundary they had no name for. `Surface`
warns off exactly `4096`, from `clampScale`, which was a private default
parameter in four signatures. So the scenes were guarding against the
kernel's guard, approximately, and a guard nobody can cite gets
approximated. `MAX_TEXTURE_EDGE` is now exported, `Surface`'s warning
interpolates it instead of restating it, and both scenes call
`clampScale` — the *same call* `Surface` makes before deciding whether to
warn, so a density that has been through it can no longer trip it.

That rewire fixed a live bug on the way past. `captureScale` took only a
width, so its ceiling only ever looked at how wide an endpoint was: a
tall narrow card walked straight through it. `clampScale` guards the long
edge because that is what the platform limits. Now tested on both axes.

**What did not cross.** The phase law from #20 has the opposite problem —
two independent scene copies and nothing in the kernel — and a second
consumer has now arrived holding the need. That extraction is the next
entry, and
it waits for the superset, because the two copies are not the same law.
`Flight`'s pins the projected *footprint* to the texture's exact texel
count as well as the corner; `passage`'s pins only the corner and is
correct today by the luck of two integral card sizes.

**Evidence.** 593 passing, `tsc -b` clean. Browser, real CDP drag against
a live flight, tracing every edge of the pin: rise `false → true` at
z = 68.0 against a 62.4 threshold, fall `true → false` on the frame the
mode became `home` at z = 94.7 — forced low from full altitude, because
the descent is the motion mask. Identical to the law it replaced, which
is the whole claim.

## #22 — The phase law crosses, and the probe that found it becomes a gate (2026-08-04, kernel + instruments)

#21 left one thing on the board: the phase correction had two
independent scene copies and nothing in the kernel. A second consumer
had arrived holding the need, so this is the extraction, plus the
instrument that made the need visible in the first place.

**What crossed is the superset, not either copy.** The two were not the
same law. `Flight`'s pins the projected footprint to the texture's exact
texel count *and* the top-left corner to an integer device pixel;
`passage`'s pinned only the corner, and was correct there by the luck of
two integral card widths. `getBoundingClientRect` promises no such
thing: a 307.6 px endpoint drifts its own phase across its own width
with the corner nailed down, because 307.6 × 2 texels is not a whole
number of device pixels. `pixelGridSnap` does both, so passage gained a
correction it never had.

What did NOT cross is the judgement of when a card is at rest. That is
genuinely scene-specific — a flight reads it off plate speed, a route
transition off how far into the flight it is — and it is the seam the
kernel/consumer split is for. Tilt stayed behind too: flat-at-rest is
this scene's idea of rest and it needs a quaternion.

**The instrument.** `instruments/sharpness`, `npm run gate:sharpness`.
The recipe it replaces was prose and was re-derived wrong three times in
one session, because "is this blurry" has no answer — a texture is sharp
or soft only RELATIVE to the DOM it stands in for, at the same size, in
the same place. So it drives the passage scene to the one frame where
the mesh is standing exactly where the page copy was, photographs both,
clips them to one measured rect, and reports gradient energy as a ratio.

Three things in it are the durable part, and each was a mistake actually
made on the way to #20:

- **The band is part of the measurement.** A live frame counter that the
  DOM is running and the held mesh has not drawn moved a whole-card
  ratio by more than the defect being hunted.
- **A perfect score can be vacuous.** With the page copy still visible
  under the mesh, the ratio is the DOM against itself and it passes
  beautifully. The gate checks the copy is hidden — idle-zero's
  provocation in this instrument's terms.
- **The floor sits between two real readings.** 0.93, because the
  reported defect measured 0.841 and its fix 1.001. A floor invented
  rather than bracketed cannot fail for the right reason.

**Evidence.** 618 passing, `tsc -b` and `oxlint` clean. The gate reads
**0.9989** on the shipped code (DOM 491.73, mesh 491.18, typography band
at dpr 2), and the negative control — `snapWeight` forced to 0 —
reproduces the original defect at **0.833** against the 0.841 that was
reported. Flight, live: a card held still at cruise settles to a
footprint of exactly 573 × 175 device px with its corner at exactly
(83, 105), fractional part 0 on both axes; a landing converges toward
514 × 157 with the corner fraction shrinking monotonically frame over
frame.

**A finding the rewire surfaced, not a regression.** The footprint half
matches the *demand* — `round(width × density)` — and the store it is
matching may not be that size. `storeForBox` keeps an existing backing
store that is merely within `DENSITY_BAND` of the demand, and at dpr 1
the whole altitude pin fits inside that band: a card held at cruise
reported demand 573 × 175 against a real store of 514 × 157. So the
altitude density pin can be a no-op that nothing reports, and up there
the footprint correction is matching a texel count that does not exist.
Neither is new — the hand-rolled copy computed the same thing — and
neither matters where the law is for: at rest on the page the store was
born at exactly this density, so `storeForBox`'s `exact` and this
function's `tw` are the same expression. Written down because the next
person to hold a card at altitude and wonder why it is soft should find
this paragraph instead of the phase budget.

## #23 — The bench: one visual language, and its tokens live on `:root` (2026-08-04, lab)

**Decision.** The six lab scenes share one design language — a
machined grey chassis with black control clusters, coded colour, tiny
silkscreened labels, tabular mono numerals — and its tokens are
declared **once, on `:root`**, in `apps/lab/src/app.css`. Per-scene
sheets derive from those tokens (`--panel: var(--screen)`) rather than
carrying hexes of their own. Sticker sheet: `docs/spikes/design-language.html`.

**Why `:root` specifically, and not a scene class.** Flight and
passage had each duplicated their token block onto the flying
component, and the two copies had drifted. The duplication was not
carelessness — it was structural. While a card is airborne its DOM is
re-rendered into a parked canvas subtree hanging off `<body>`, the same
document, so class *rules* still match; but the scene's own ancestors
(`.l14`, `.psg`, `.wk`) are not in that element's chain, so anything
scoped to them is out of reach. `:root` is the one ancestor a parked
subtree still has. Moving the tokens there deleted both copies and the
whole class of drift with them.

What does **not** come along is anything *inherited* rather than
*matched* — `font` above all, which would otherwise be the parking
host's. A flying component still declares its own `font` (and its own
pixel size, per #16's neighbours). Custom properties inherit too, which
is exactly why `:root` works and a scene class does not.

**The bug this framing found.** `.wk-page` painted `background:
var(--bg)`, and `--bg` is declared on `.wk` — its own **child**. The
variable had never been in scope there and the declaration had always
resolved to nothing. It looked correct for as long as `<body>` happened
to be the same near-black; the frame the body became bench grey, the
wake scene's water was standing on a light table. A token that is
declared below the element that reads it is invisible until something
underneath it changes colour.

**The webfont is a capture gate.** The bench type (Archivo variable,
Archivo Narrow, Martian Mono) loads from a blocking `<link>` in
`<head>`, not `@font-face` discovered during render. A face must be
resident before a card's first rasterization or the texture bakes the
fallback and keeps it; blocking first paint is the gate, and the lab's
first grab is thousands of frames later, so it costs nothing that is
measured.

**One measured detail worth keeping.** The scene chips are
`flex: 0 0 auto`, not `flex: 1`. Six labels of very different lengths
in a 430 px strip got equal cells under `flex: 1` and the longer ones
printed over their neighbours'. A key is as wide as the word on it.
Found by cropping the render — the markup looked right.

## #24 — A published frame is not a presented frame (2026-08-09, core + react binding)

**Decision.** A caller-owned canvas enters through a renderer-free
`FrameSource`: stable source identity, monotonic generation, fixed sRGB and
alpha interpretation, and a notification after the producer finishes a
write. The React binding owns the GPU half. It samples the generation inside
Three's texture upload callback and releases it only after the target mesh
renders. The lab sees `{ sourceId, generation }`, never Three callbacks.

The distinction closes the gap the DOM `Surface` cannot close for a caller.
Setting `texture.needsUpdate` asks for an upload. It does not prove which of
several fast canvas writes Three chose, and it does not prove that a visible
mesh used those pixels. Several publications may therefore merge; a receipt
names only the frame that crossed both renderer boundaries.

The frame path is a separate internal primitive behind the public `Surface`
door. It does not branch through DOM adoption, layout, LOD, chrome, focus, or
pointer forwarding. The caller keeps the canvas. The binding owns only its
`CanvasTexture`, applies the pinned texture filter policy, reallocates if the
backing dimensions change, and invalidates demand-driven render loops when a
new frame arrives.

Frame input defaults to an unlit, non-tone-mapped material. A standard
material is an explicit request for scene lighting, so it is not a color-exact
handoff. All premultiplied input uses the custom-material seam, even on an
opaque mesh: the texture already carries alpha-weighted RGB. Masks multiply
the full vec4, and transparent output blends ONE / ONE_MINUS_SRC_ALPHA without
multiplying RGB again.

`onFirstUpload` keeps its existing DOM-ready meaning. Genie and Veil hide the
only renderable ancestor until that callback runs; redefining it as a draw
receipt would make the draw it waits for impossible. Frame-backed Surfaces
use `onFrameDrawn`. A later DOM receipt needs separate ready and presented
states and a renderable acquisition path.

**Evidence.** The disposable ordering spike recorded 285 writes, 165 real
uploads and draws, zero false receipts, and zero reordering under bursts and
CPU stalls. The retained Chrome gate uses the shipped public API in a demand
frameloop, merges publications, replaces a live source, releases and
reacquires it three times, and requires receipts
`[A0, A2, B0, B2, B4, B6, B8]`. Every receipt is checked against the drawn
sRGB pixels in the framebuffer.

## #25 — Mesh traversal is not visible presentation (2026-08-09, core + react binding)

**Decision.** `FrameDrawReceipt` keeps its upload-and-traversal meaning. A
handoff that will release another presenter uses a separate optional
`PresentationRequirement` and `PresentationReceipt`. The consumer owns the
transfer ID and presentation revision. Core accepts a receipt only when the
transfer, source, and revision match exactly and the drawn generation meets or
exceeds the required minimum.

The React binding samples the requirement in `onBeforeRender`. A draw can
qualify only when it targets the default framebuffer and the rendered material
has color writes enabled. `onAfterRender` then uses the last uploaded frame,
not a new frame callback, and emits one receipt for the accepted surface,
transfer, revision, and frame tuple. Off-screen and color-disabled draws are
counted as rejections and warn once per transfer in development.

This split is necessary because Three calls `onAfterRender` for a material
whose `colorWrite` is false and for off-screen render targets. Those draws can
open the pixel gate, but they cannot release presentation authority. Custom
shader discard, depth, and occlusion remain caller policy; the binding does
not inspect shader text or read back the framebuffer.

Genie is the first consumer. Its frozen generation opens the pixel gate. It
then enables color writes and holds the sheet at the wall until the matching
presentation receipt releases the native canvas. A manual grab can change its
hidden target during acquisition, while the visible wall pose and revision
stay fixed. The reverse transfer does not wait for proof: it reveals the same
canvas under WebGL, then removes WebGL on the next frame. Context loss hides
the invalid renderer and revokes all active flights immediately.

**Evidence.** The Chrome gate earns one unchanged `FrameDrawReceipt` while
color writes are disabled, rejects the same uploaded frame through an
off-screen target, and earns exactly one `PresentationReceipt` when the default
framebuffer draw writes color. The same gate verifies a real backing-store
resize. Genie's retained gate passes 24 minimize and restore cycles at 6x CPU,
then loses the WebGL context and returns native coverage without a later draw
receipt.

## #26 — Releasing a mesh requires one post-removal draw (2026-08-10, react binding)

**Decision.** Both DOM-backed and frame-backed Surfaces invalidate their r3f
root when they unmount. A consumer may change a Canvas from `always` to
`demand` in the same commit that removes its final Surface. Scene removal then
does not guarantee a render. Without one, the transparent canvas keeps its
last framebuffer and a later move of the restored DOM presenter exposes two
windows.

The binding owns this rule because it is part of presenter release, not Genie
animation policy. The extra frame renders the scene after removal, preserves
any remaining presenters, and clears the released pixels. It costs nothing at
steady idle and applies to every Surface consumer. Genie still gives each
flight a unique lifetime and rejects callbacks from older flights; those are
scene-owned transfer rules and do not belong in core.

There is also a valid third-party upstream improvement. R3F changes an
`always` loop to `demand` without guaranteeing one final render. It could
schedule that frame itself and protect all Three meshes from retained output.
Munari must still keep its binding invalidation: presenter erasure is part of
its public handoff promise and cannot depend on a future renderer release.

**Evidence.** A headed Chrome trace at Retina density and 6x CPU reproduced
the exact duplicate: the restored DOM square moved while its last WebGL image
stayed at the old rectangle. The retained gate starts a real title-bar drag at
the first observable reveal and checks every compositor frame for both blue
windows. It also starts a new minimize in that reveal commit and requires the
fresh flight to land.

## #27 — A handoff must not visibly change alpha (2026-08-10, react binding + Genie)

**Decision.** A DOM-backed `Surface` exposes a separate one-shot
`onFirstPresented` boundary. It fires only after the first real DOM raster has
uploaded and a color-writing draw has completed in the default framebuffer.
It runs synchronously before browser composition. It does not change the
legacy `onFirstUpload` meaning, and it is not a reusable, versioned handoff
receipt.

The React binding also exports `commitRendererReleaseFrame` for the reverse
handoff. A consumer calls it from `useFrame` after the incoming presenter is
warm. It commits incoming visual ownership, suppresses the outgoing renderer
object synchronously, and defers the durable React-state publication until the
current renderer stack has drawn. Core keeps only the handoff law; the binding
owns this React/r3f timing.

The binding also enforces decision #5 at texture birth: every DOM
`CanvasTexture` is sRGB and premultiplied before a material or renderer can see
it, and the built-in material uses matching premultiplied blending. A scene
must not repair source format from a later effect.

Genie releases its native presenter inside the qualified post-draw callback.
For the reverse direction, it first warms the native presenter under the
landed WebGL sheet for one frame. The private bridge keeps the public hold and
input on WebGL and masks only the native shadow. On the next renderer frame,
the same `useFrame` callback transfers the shadow to the native presenter and
makes the WebGL group non-renderable. The browser cannot composite between
those two synchronous writes. After that draw stack clears the framebuffer,
React publishes the native hold and the private bridge becomes inert. This
bridge is narrow and intentional: the DOM and r3f reconcilers cannot make an
atomic shared commit, while one renderer turn can hand each translucent layer
to one presenter.

**Why.** Acquire-before-release prevents holes, but visible overlap is safe
only for opaque pixels. The same 15% shadow composited twice is a different
shadow. Before this change, the normal strip measured 187 luma and the handoff
frame dropped to 163. An earlier reverse bridge also left one frame with no
shadow at 216 luma because it waited for React after clearing WebGL. After the
change, both minimize and restore boundaries measure 187, with no doubled or
uncovered frame. The retained `shadow-travels` Chrome gate checks both
directions and fails on a change larger than six luma.

## #28 — The crossing is library law (2026-08-13, core + react binding + instruments; renamed by #31)

**Decision.** The threshold toggle — content moving between the page's
hold and the canvas's hold and back — is now a kernel law with a React
orchestrator, not a per-scene idiom. Core owns a pure four-phase reducer
(`page → lifting → gl → landing`): the page releases only on evidence
— every incoming presenter's post-draw presentation boundary
(`onFirstPresented`, never the weaker upload receipt) plus a settle dwell
for the page's idle motion to ease flat — and a request that arrives
mid-crossing reverses, never skips. The drawing accounting theorem, "at
every phase someone presents", is a conformance clause
(`tests/conformance/transfer/crossing`). The Surface binding collects
receipts, advances the reducer per rendered
frame, and publishes both swaps as single React commits; scenes state
their presenter count and timing and consume `progress()`.

Three scenes earned the promotion: Flight gated its swap on upload, Genie on presentation, and the logo playground
on presentation plus a dwell — three hand-rollings of one protocol, with
the evidence standard drifting between them. The standard is now fixed at
presented receipts.

The promotion also forced a source-host rule: a parked root's FIRST
render is flushed (`flushSync` in `useSourceHost`), because a
concurrently scheduled initial commit leaves the container mounted and
empty for a paintable gap. A capture in that gap is a blank card wearing
`.ui-root`'s opaque background — and it legitimately fires both
receipts, which certify pixels, not the right pixels. A source must never
exist without the content it claims to be.

**Evidence.** The `crossing-flash` gate screencast the logo page under a
default 6x CPU throttle and scored every composited frame's ink coverage
over the wordmark's rectangle — vanishing is the flicker, blooming is the
blank-card fault. Before the flush rule it photographed the second fault
exactly: warm lifts presented five white cards, ink blooming from a
resting 18.6% to 72.8% (first lifts passed — cold GL setup delays the
first capture past the content commit, which is why no one had seen it by
hand). After the rule: 1,245 frames across four round trips plus an
abandoned lift and a reversed landing, every frame inside 18.2–18.9%.

**Amended 2026-08-15 — the gate is gone; the laws are not.** The
`crossing-flash` instrument was deleted along with the three Knobs
browser gates: it photographed a lab scene that is still provisional, and
its carry clause had been failing on a measurement artifact since it
entered CI. This decision, #29 and #30 keep their evidence — the numbers
above were measured, and the conformance suites still pin every law's
shape. What is gone is the browser check that the two reconcilers agree
in the same frame. Nothing enforces that now. The recipe, and the
screencast blind spot any replacement must handle, are in
`docs/platform.md` item 13.

## #29 — Presentation is exclusive (2026-08-14, core + react binding + instruments; renamed by #31)

**Decision.** Drawing is not showing. `crossingDraws` says who must
DRAW in each phase and is inclusive — during 'lifting' both sides draw,
because the warm-up is where the canvas earns its presented receipts.
`crossingPresentation` says who may be SEEN and is exclusive: exactly
one side is composited in every phase, and visibility changes hands only
at the two swap edges. The binding exposes it as `glHolds`, and a
consumer wires that to the canvas element's own visibility (opacity or
`visibility`), never to mount — an unmounted canvas cannot draw, an
uncomposited one still can, and the receipts come from the framebuffer,
which compositing never touches.

The rule exists because the lifting overlap has two ways to be wrongly
visible, and the logo found both in one day. Canvas composited above the
page: a twin that painted early covers a letter still finishing its hop,
a snap. Canvas composited below: the settling page displaces off its
flat twin and both copies peek out around each other for the whole
dwell, a ghost leading or trailing every animated element. Z-order just
picks which fault you get; the only correct amount of early canvas is
none.

**Evidence.** The ghost was visible by eye on the logo whenever the
letters were animating at a crossing (2026-08-14). The conformance
contract pins the law's shape (presentation is exclusive, implies
drawing, and the canvas draws unseen exactly during 'lifting'); the
`crossing-flash` gate photographs the browser fact — it cranks the idle
float to its ceiling so a composited twin would fringe the ink
measurably, then requires every lifting-span frame to hold the resting
ink band within +2pp.

## #30 — Carried motion crosses mid-flight (2026-08-14, core + react binding + instruments)

**Decision.** Motion whose source of truth lives outside both renderers
does not need to stop for a crossing. The kernel gains the
motion carrier (`createMotionCarrier`): one clock, one program, one
evaluation per frame, and any number of readers — sampling never
advances time, so the page's style write and the mesh's transform read
the same number in the same frame. The binding (`useCarriedMotion`)
owns the rAF driver and the page-side applier; the mesh side reads
`sample()` in useFrame at FULL value, never scaled by the crossing's
progress. A carried motion is exempt from the settle dwell — every
frame of it is a plateau, because both presenters output one source of
truth — so the swap lands mid-flight with position and velocity intact.
`settleMs` now covers only what stays on the compositor's clock.

This is the drag-handoff insight generalized: Flight always carried a
drag seamlessly because the pointer is a shared truth neither renderer
owns. The carrier gives autonomous idle motion the same property, at
the honest price of riding the main thread instead of the compositor
thread — which is why carrying is a per-motion declaration, never a
default, and the ease-flat authoring pattern remains for everything
else.

Promoted on ONE lab, at the owner's explicit direction (2026-08-14):
seamless threshold crossing is the library's core claim, and "the
animation pauses when it crosses" was judged the most likely common
complaint from consumers.

**Evidence.** The logo's float, rebuilt on the carrier: the letters
breathe through both swaps with no park and no jump. The `crossing-flash`
gate grew a fourth clause — with the float at its ceiling, it fits the
moving word's ink-centroid path before each swap and requires the first
frames after the swap to continue that path within budget, both
directions. Building the clause surfaced two findings. One is a real
hazard: reclamation shared the return swap's commit, and tearing a
renderer down is a ~280ms longtask under the gate's throttle — long
enough to hold every carried style write at exactly the handoff. The
binding now lingers the dead canvas — invisible, progress zero — for
300ms and unmounts it in a commit of its own; deferred, never skipped.
The other is a platform fact that first masqueraded as a freeze the
linger failed to fix: the DevTools screencast emits nothing for ~250ms
after a return handoff while the screen runs on — trace, forced
composites, and rAF all continuous (platform.md item 13) — so the
clause reads that window with forced composites instead of the cast.
The carrier's discipline (epoch at birth, one evaluation per tick,
sampling never advances) is pinned in
`tests/conformance/transfer/motionCarrier`.

## #31 — The lift, and choreography as pure functions of progress (2026-08-14, core + react binding)

**Decision.** Two moves in one commit pair, because a rename and an API
should be born together.

First, the vocabulary. "Custody" is retired everywhere — code, tests,
docs, instruments — at the owner's direction: it is courtroom language
in a library whose register is physical (lift, land, float, jelly,
balloons). The replacements are the words the register already used:
a renderer **holds** the pixels (state), a **handoff** moves them (the
swap edges), and the excursion is a **flight**. Phases rename
`dom → page` and `renderer → gl` — the
words consumers actually say — so the reducer reads
`page → lifting → gl → landing`. `crossingCustody` becomes
`crossingDraws` (it always answered "who must draw"),
`crossingAmplitude` becomes `crossingProgress`, and the binding publishes
`pageHolds`/`glMounted`/`glHolds` for
`domHolds`/`rendererMounted`/`rendererHolds`. Nothing behavioral moved;
the conformance contracts were renamed in the same commit as their
laws, per #2. Historical entries above keep their numbers and their
evidence; titles that named custody are amended in place.

Second, the API the rename makes room for. A scene scripts its
transition as pure functions of the lift's progress — never as
timelines. The kernel gains two choreography laws:
`crossingRange(progress, from, distance)`, a clamped linear window
(drei's `useScroll().range` shape, deliberately — our consumers are
R3F developers and their hands know it), and
`crossingCurve(progress, from, distance)`, the sine bell over the same
window for effects that exist only mid-flight. The binding exposes
them on the lift as `range()`/`curve()` beside `progress()`, plus
`entering`/`exiting` for the two transition phases. Because every
window composes with the eased progress, any choreographed effect is
zero — with zero velocity — at both handoff edges by construction:
reversal-safety and handoff-identity are properties of the functions,
not disciplines asked of the consumer. Pinned in
`tests/conformance/transfer/choreography`.

The logo is the reference consumer: its cooling gate
(`MATTER_LIGHT_GATE`, since widened to relief and extrusion and renamed
`MATTER_GATE`) reshaped from an ad-hoc smoothstep window to
`lift.range(0.25, 0.35)` — same numbers, now the library's own idiom.

## #32 — A tested demo law is still a demo law (2026-08-16, core + Flight)

**Decision.** Flight now owns its plate solver, bend and crumple rules,
gesture state, texture-density schedule, and custom shadow geometry. Their
tests move beside the scene. These laws are pure and well tested, but they
have one consumer and name that consumer's card modes, delete gesture, lift
height, and visual tuning. Tests prove behavior; they do not make a demo
detail a shared API.

Core keeps the parts that describe Munari itself: capture, coordinate mapping,
pointer relay, handoff, CSS chrome measurement, and the 1D control physics
used by the published `Dial`. The unused `motionSamples` and
`conductorTiming` modules
are removed with the deleted experiment they described. The standalone
quaternion class goes with Flight's plate solver; the scene uses `three`
directly.

The earlier entries remain as history. This entry changes their ownership
conclusion before the next package release.

## #33 — Input follows the eye (2026-08-19, core + react binding + instruments)

**Decision.** The crossing gains a third per-phase theorem,
`crossingPointer`: who HEARS the pointer. It equals
`crossingPresentation` in every phase — the side that is seen is the
side that hears — and it is exclusive: exactly one side, never zero,
never both. Pinned in `tests/conformance/transfer/pointer`.

**The fault.** Before this law, input followed mesh registration: the
pointer gate made the canvas solid the moment a presenter's mesh
registered, which happens at the start of 'lifting' — a full settle
dwell before presentation changes hands. Measured 2026-08-19
(`gate:lifting-pointer`): during 'lifting', 3/3 real clicks routed
through the relay to the parked, hidden source copy while the page copy
was the composited one, and hover mirroring stamped `data-hover` on the
parked copy — the visible copy showed no hover or pressed feedback for
the entire dwell (450ms at default timing, on every lift). Because both
copies render from one React tree, a click handler that writes shared
state still appears to work; content with local state (an uncontrolled
input, a `useState` counter) diverges invisibly between the copies.

**The consumption.** The binding reads the law in the presenter's
raycast: while `canvasHearsPointer()` is false the mesh declines every
ray, so neither the pointer gate nor r3f's relay ever sees it. Declining
at the raycast rather than in handlers is the same principle the hit
region already uses — an intersection r3f never sees is one it never
counts.

**The edge bursts.** The theorem routes the next event and says nothing
about state either side holds across a flip; the relay speaks only on
pointer motion, so a pointer that sits still through a flip leaves the
loser wearing stale state and the gainer blind to a pointer already
over it. When the canvas loses input (the hold returning to the page),
the presenter cancels any active relayed press and clears the stamped
twins, synchronously from the hold flip. When it gains input (the page
releasing), the presenter forwards one buttonless move at the pointer's
last trusted position — kept by `trackPointerPlace`, since the flip is
a protocol event with no pointer event attached — so hover the page
copy was showing continues on the texture instead of popping off at
the swap.

**The press fate, pinned.** A press that straddles a flip dies at the
edge. Canvas-side, the burst cancels it explicitly. Page-side (down on
the page copy during 'lifting', flip mid-press), the copy goes hidden
and the browser itself drops its `:active`; the release is lost.
Measured (spike, 2026-08-19): no state sticks on either copy. Holding
the swap open for an active press was considered and rejected — the
lift gate's evidence rules must not gain an input-dependent clause. A
burst of 14 clicks at ~35ms across the flip landed every one on exactly
one copy: there is no dead window, because the gate's pointerdown path
raycasts directly rather than waiting for an arming move.

**The refinements (adversarial review, 2026-08-19).** The binding reads
the HOLD, not the phase: `canvasHearsPointer()` is
`!exclusive || !holdsPage()`. The phase turns at the top of a frame and
the pixels turn in that frame's draw, so a phase-read would open a
window at gl entry — phase already 'gl', releasing draw not yet run —
where the canvas hears clicks the page copy is still showing. Reading
the hold also puts every hearing flip at the exact moment
`subscribeHold` fires, and `setExclusive` notifies the same listeners,
because a Twin gaining `view` is the one hearing flip with no hold
movement. The bursts run one microtask after the flip (the flip fires
from inside the frame loop; a synchronous burst would run consumer DOM
handlers mid-draw) and the arrival burst declines when placement is not
`match-dom` (a manual mesh is not at the page box), when `pointerEvents`
is `"none"`, or when any button is held — a held button means some
pointer's press story is open, possibly another surface's live relayed
drag, which one buttonless document-bubbling move would break. Samples
that outlive their event are plain copies (`pointerSampleOf`): a
retained PointerEvent spreads to nothing, and a cancel built by
spreading one carries `pointerId: undefined` and is refused by the
relay's own cancel guard.

**Known, accepted.** A press CLAIMED by the canvas gate that straddles
a gl→page flip has its tail consumed by the claim (the gate retargets
every event of that pointerId until release, and the declining raycast
gives the clones nowhere to land); the gesture dies at the edge, which
is the pinned fate, but a click within the suppression window after
release is also eaten. Cross-module machinery to cancel gate claims at
the flip is open work, judged not yet worth its coupling. The arrival
burst also cannot know about page content occluding the Surface (a
modal over the page box); the first real pointer motion corrects it.
Every kind of crossing matter follows the law: `<Surface.WebGL>` gates
its own raycast; `<FrameSurface surface={handle}>` gates its default
raycast when told which crossing it participates in (an authored
`raycast` prop wins — `raycast={() => {}}` is the full opt-out); and the
manual-presenter seam exposes `hearsPointer()` for meshes the library
never touches. A `FrameSurface` in a crossing whose author passes
neither `surface` nor `raycast` cannot be gated — the component does
not know it is crossing matter — but it can be caught: receiving a
presentation requirement is the one moment it knows, and an ungated
raycast at that moment warns once in development.

**Amended 2026-08-20 — the eye's pose, not just the eye's side.** The
theorem picks which side hears and says nothing about a frame in which
the presented geometry itself moves. Every event raycasts the pose of
the frame it arrived in, so under a per-frame deformation each relay is
one frame stale — and a pointer that then stops over still-animating
matter keeps the last frame's routing forever. Measured 2026-08-20
(`gate:fisheye-pointer`, before the fix): a coarse synthetic stream
(~50px per event, 22px rows) settled with `data-hover` more than one
row off the fixed-point row and never corrected. The presenter now
takes the position attribute's version as the deformation's own receipt
(`deformSurfaceGeometry` bumps it) and, on any frame the version moved
while the canvas hears, replays the pointer's last position through
r3f's event manager — routing and the stamped twins catch up within a
frame whether the hand moved or only the matter did. The gate's
live-follow clause drives the coarse stream on purpose.

**Amended 2026-08-20 — the bursts reach both shores.** Three
refinements above are superseded. The arrival burst no longer declines
manual placement: the mesh itself answers, through the same instance
raycast every live pointer event uses, so a flight-only mesh re-arms
hover wherever the scene put it. `lastPointerPlace` now records
pointerup (a lift triggered on release otherwise flipped the hold with
the down as the newest sample, and its `buttons: 1` made the burst
read a finished press as still open) and is tracked from the always-
mounted root, not only the presenter (a presenter mounted at press
time installs its tracker after the last trusted event and read null).
And the losing burst gains a third act, the landing bridge
(`bridgeHover`): clearing the parked twins is not enough, because the
gaining page copy hears only the browser, and real `:hover` cannot
re-form until a trusted contact hit-tests the copy — the pointer
gate's canvas stays solid until its first post-flip miss. Measured
2026-08-20: a pointer sweeping through a landing showed two frames
with no hover on either copy, and a pointer that moved during flight
then stopped left the canvas solid over nothing — the browser's own
hover recompute hit the canvas and a motionless follow-up click died
on it. The bridge stamps the hover twin onto the page copy in the
same microtask that clears the parked one and lifts it on the first
trusted contact proving the real story resumed; the gate re-asks its
raycast each frame while solid and unclaimed, so matter vanishing
beneath a still pointer clears the canvas within a frame. After both:
a full sweep through a landing shows zero unhovered frames on the
presented side, and the motionless click lands.

## #35 — Deformation moves vertices, so the hand and the eye agree (2026-08-20, react binding + lab)

**Decision.** The one sanctioned way to bend a presented Surface is
`deformSurfaceGeometry` (react binding, exported from the curated
entry): the caller supplies a placement function in content
coordinates (px, origin top-left, y down), and the helper moves the
geometry's vertices, owns the uv→content flip, the upload flag, and
the bounding-sphere reset. Deforming in a vertex shader is rejected as
a supported path: it bends only the pixels, three keeps raycasting the
flat plane, and every relayed event lands off by exactly the
displacement — with no error anywhere saying so.

**Why.** Measured 2026-08-20 by `gate:fisheye-pointer`: at that
scene's lens rim the displacement is 60px, more than one of its 44px
rows, so a flat-pose raycast routes clicks and hover to the wrong row
on every magnified target. Moving vertices makes hit testing correct
by construction — the raycast hits the shape the eye sees, and the
hit's interpolated uv rides the vertices to the correct source pixel.
Before the helper this lived as a convention copied between Genie and
the fisheye scene (per-frame CPU rewrite plus `boundingSphere = null`),
each copy re-deriving the uv flip and both footguns by hand. The
alternative — accepting a caller-supplied inverse map so shader
deformation could route honestly — was considered and rejected: it
makes correctness depend on two pieces of consumer code (the shader
and the inverse) agreeing, and nothing can check them against each
other. At texture-quad vertex counts the CPU path costs nothing worth
that risk.

**The shape.** `deformSurfaceGeometry(geometry, [w, h], place)`,
called from the consumer's own frame loop with the current
deformation. The law stays the consumer's; the mechanism is the
library's. Extra per-vertex outputs (Genie's squeeze, a curl's
normals) write through the callback's index argument. An identity
`place` restores the flat plane.

## #36 — A source is enough (2026-08-22, react binding + lab)

**Decision.** A material may name another Surface's texture by handle,
through `useSurfaceTextureOf(handle, part?)` on the curated entry. It
answers `THREE.Texture | null` — null before that Surface's runtime
lands, never a throw — so a material mounts first and binds later
rather than depending on which of two independent trees commits first.
The Surface being sampled needs no `view`, no `Surface.DOM`, and no
`Surface.WebGL`: content and a size are the whole declaration, and
such a Surface is a *resident source*.

**Why.** `SurfaceSourceRuntime`'s law is "one source, one texture, any
number of presenters", and the number may be zero. Measured 2026-08-22
(`docs/spikes/cross-surface-sampling.md`): a Surface with no
presentation rasterized, uploaded, and versioned a texture throughout,
`texture.version` climbing 175 → 318 over 1.2s, identical under
`frameloop="demand"` because a painting source claims work through the
host's reference-counted busy flag. Arbitration said nothing about it —
no warning, no readiness complaint — and its `ready: false` is correct
rather than a fault, because readiness is a statement about registered
WebGL presenters and it has none.

The capability this buys cannot be had another way. A view transition
between two live layouts needs both views painting at once, and every
alternative freezes the arriving one: a screen grab, a CSS view
transition, or a render target of a second scene all sample *pixels
already drawn*. The arriving view here is drawn nowhere in the scene
graph, so there is nothing to copy from — measured in the same spike,
2,590 pixels of the sampled Surface appeared inside the sampling
Surface's rect and 0 anywhere else on the canvas. The correspondence is
also content-space rather than screen-space: the shader picks the
arriving view at a uv the leaving view's own content decides, which is
what a morph needs and what a framebuffer copy structurally cannot
give.

**The shape.** The hook is a read over machinery separated wiring
already uses — `storeByHandle` maps handle → store, the store publishes
`SurfacePartPublication { runtime }` per part, and `subscribeParts` is
the notification. No second source, no second parked canvas, no second
texture: the runtime keeps ONE texture for its whole life and re-cuts
storage into it, so the answer is reference-stable and safe as a
`useSyncExternalStore` snapshot. Pointer routing is explicitly out of
scope — a sampled Surface has no mesh, so nothing can hit it. The
contract is `packages/react/src/primitives/surface/surfaceContext.test.ts`;
the demonstration is the refraction lab scene, gated by
`gate:refraction-arriving`.
