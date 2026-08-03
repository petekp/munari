# anamorph decisions

The ledger starts at #1. Inherited knowledge is cited as `archive#N`
(= `petekp/three-ui@362c5a1`, `docs/decisions.md` entry N) and never
restated — `three-ui/docs/seed/manifest.md` is the full triage of what
crossed and how. Entries here follow the archive's format: decision,
evidence, what it cost to learn.

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
plane (archive#44), and crispness is a rest state at that vantage
(archive#53). Rejected fields, deliberately: paper/bookbinding names
(slipsheet, endpaper — they name the flight-card demo's material, and
the demo is one registry item, not the library); `three-*` names
(`three-ui` is a squatted npm name, and the namespace files us with
three-mesh-ui/uikit — the rebuild-UI-as-GL-geometry architecture this
library is the inversion of); custody/stagecraft words (bailment,
greenroom, foley — precise but the wrong register).

**Why one public package.** The shadcn model: a thin published
substrate with a copyable registry on top. Publishing the kernel
independently is a *promise* — semver, changelogs, unknown consumers —
that no lab has bled for; the second-system guard says not yet, maybe
never. Core stays a workspace-internal discipline, real because the
boundary tests make it real.

**Why three as peers, unabstracted.** Every platform fact we own that
is renderer-specific is *three*-specific in load-bearing ways:
immutable `texStorage2D` allocation (archive#10), the shader-chunk
colorspace contract (archive#33/#53), the r3f raycast-prop trap
(archive#16). A renderer-abstraction layer would re-derive all of it
per backend for consumers who don't exist. Peer rather than direct
dependency for the standard reason: a consumer app has exactly one
`three` instance, and a second smuggled copy is the same split-brain
disease `forge()`'s `Symbol.for` brand was hardened against
(archive#50).

## #2 — Contracts are typechecked before they can run (2026-08-02)

**Decision.** Conformance suites land as
`tests/conformance/<layer>/*.contract.ts`: complete vitest suites
whose kernel surface is expressed as typed `declare` holes under a
`// ---- CONTRACT HOLES` marker. Contract files are typechecked (root
tsconfig includes `tests/`) but invisible to the runner (vitest
collects only `*.test.ts`). A live ledger test reports each contract
as a todo on every run and enforces headers, citations, hole markers,
and the import bans. Flipping a layer = `git mv` to `.test.ts` + holes
→ `@anamorph/core` imports → red → implement → green → oracle agrees
(`tests/conformance/README.md` is the protocol). `three` +
`@types/three` join root devDependencies at the oracle's version — the
mapping suite cites a real `THREE.Raycaster` in-suite so the fast path
can't become a second source of truth (archive#44), and the contract
types need it at typecheck. `happy-dom` waits for the door flip.

**Why not `describe.skip`.** Vitest executes describe factories at
collection even when skipped, and the ported suites build fixtures at
module and describe scope — every missing import would throw before
the skip took effect. Landing them runnable would mean restructuring
near-verbatim ports, and the port is the evidence. Renaming out of the
include glob skips all execution while tsconfig keeps every line
honest; the ledger keeps the debt visible so skipped cannot decay into
forgotten.

**Why holes instead of stubs in core.** The barrel growing a layer's
exports IS the layer landing (`packages/core/src/index.ts` charter);
throwing stubs would let `packages/react` and the lab compile against
surface that doesn't exist, and would pre-commit API shape ahead of
implementation judgment. A `declare` block is local to its contract,
erased at compile time, and names exactly what the suite demands — the
API half of the contract reviewable in the same file as the behavior
half.

## #3 — Three labs cross; the rest are archive evidence (2026-08-02)

**Decision.** Pete's call: labs **006, 012, and 014** are the demos
this repo preserves — they will be rebuilt in `apps/lab` on the
public barrel. Every other lab (001–005, 007–011, 013) stays in the
archive as frozen evidence: their knowledge already crossed as
conformance contracts and rules, and their scenes are disposable per
the charter (archive#1: scenes are evidence, not product).

**What each preserved lab pins, and what it demands:**

- **006 — the arc.** The focus grammar's home scene (33-panel arc,
  Tab/Enter/Escape spine, arrows, camera rides). Demands the
  focus/spatial-nav registry pack (archive#13/#14/#15 with the
  browser-captured full-field regressions), the control kit, and the
  `FocusOrbitRig`-class binding surface.
- **012 — the glass.** The SDF compositor direction (one scene
  render, N screen-space passes; archive#38–#43). Demands the glass
  registry pack and the material-slot seam (archive#33). Carries the
  premultiply question into the paint layer's decision (archive#36).
- **014 — the paper.** The drag/aero/crumple/toss card scene — the
  fullest exercise of the kernel: mapping (calibrated camera,
  archive#44), transfer (density schedule + readiness, #53/#54),
  chrome (measured shadow, #55/#56/#58), physics (plate, aero, #45/
  #49/#59–#62). The conformance suite's physics/chrome/transfer
  slices ARE this lab's laws; the scene is their consumer proof.

**Why these three.** Together they cover the three pillars without
overlap — input/focus custody (006), rendering/composition (012),
and the custody excursion itself (014) — and each one exercises a
registry pack the kernel must stay sufficient for. A lab that crosses
is a standing consumer: if the barrel can't express it, the barrel is
wrong (CLAUDE.md: export, don't reach around).

## #4 — Core speaks in shapes; three satisfies them (2026-08-02)

**Decision.** `@anamorph/core` cannot import `three` (zero-dep,
boundary-enforced), but the oracle's kernel math is written against
`THREE.Vector3` and `THREE.BufferGeometry`. Core therefore expresses
every vector/geometry parameter as a minimal structural interface —
`Vec3Like`, `GeometryLike`, `SampleVec` (`src/math/vec3.ts`) — that
three's objects satisfy by shape, with generic out-params so callers
get their own type back: a `THREE.Vector3` in is a `THREE.Vector3`
out, `.clone()` intact. Where an API must allocate (a sample with no
caller target), core allocates its own minimal `Vec3`. Internals use
scalar math where the oracle used vector methods (the face-normal
cross product is written out longhand) so core never needs scratch
allocations from a library it doesn't have.

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
side of the seam) — binding conformance pins it when `Surface` lands.
archive#36 decided this for the glass ink app-side and deferred the
library-wide question three times; per the standing rule there is no
fourth deferral, and this entry closes it.

**Why premultiplied is the native truth, not a preference.** A 2D
canvas's backing store is ALREADY premultiplied — the browser
composites that way. Asking for a straight-alpha upload forces an
un-premultiply conversion at texImage time that is lossy at low alpha
(the rgb of a mostly-transparent texel quantizes to garbage), and the
GPU sampler then filters that straight data incorrectly anyway:
bilinear averages raw rgb across texels, so a `white/10` texel bleeds
full-strength white into every boundary with opaque content —
archive#36's measured selection-rect halo, present in miniature on
every transparent floating layer. Premultiplied upload is the path
with no conversion, no loss, and linear-correct filtering.

**Why the blast radius is small.** The common Surface is OPAQUE by
design — archive#55's corner-texel argument rests on `.ui-root`
painting app background — and at α = 1 premultiplied and straight are
byte-identical. The change is observable exactly where straight alpha
was wrong. Costs land on the material-slot contract (custom shaders
must blend premultiplied and treat sampled rgb as already-weighted;
the oracle's glass ink already does) and nowhere else.

**Out of contract.** Lit standard materials on partially-transparent
Surfaces — premultiplied rgb entering lighting math is not a
passthrough, no lab has bled on it, and the second-system guard says
we don't design for it until one does. Documented as unsupported; a
future lab that needs it reopens this entry with measurements.

**Regression net.** The oracle's labs 009/010 next door remain the
measured baseline for floating-layer rendering; anamorph's own
floating layers arrive with the binding and inherit this contract on
day one, so the halo class is extinct here rather than migrated.

## #6 — The binding re-exports the kernel whole, and the shader string lives beside the material (2026-08-03, react binding)

**Decision.** `anamorph`'s barrel is `export * from '@anamorph/core'`
plus the binding's own primitives — no curation between the kernel and
the consumer. The oracle curated (its `lib/` stayed private) because
its internals were unconvenanted; every name in `@anamorph/core` is
contract-covered, so a second doorway would only accumulate drift. A
name earns barrel placement in the binding's OWN half by a preserved
lab consuming it (Surface, SurfaceApp, the texture/chrome hooks, the
focus kit, Dial, arcLayout); the archive's floating family, conductor,
style-channel hook and remaining controls stay archived until a
consumer crosses.

**SURFACE_RADIUS_GLSL** — the debt item from the chrome flip — lands
in the binding (`lib/surfaceRadiusGlsl.ts`), not the kernel: a shader
chunk belongs beside the material that splices it, and core is
renderer-free. The GLSL and core's `surfaceRadiusSd` are twins BY
CONTRACT — the conformance suite pins the JS SDF, and the chunk must
compute the same distance so a ray and a fragment agree about where a
corner ends. Its identifiers are renamed with the library
(`uAnamorphRadii`/`uAnamorphSize`/`anamorphRadiusMask(vUv)`): a custom
material's opt-in call sites are consumer-visible contract, and a
fresh library wearing a dead library's uniform names would be
archaeology, not compatibility — nothing published ever saw the old
names.

**Port discipline.** Binding files are verbatim oracle ports except:
imports rewired onto `@anamorph/core`, the `[anamorph]` console voice,
and `noUncheckedIndexedAccess` non-null assertions (each `!` sits
under a visible loop/length guard and is erasure-only — runtime
behavior is byte-equivalent by construction). 7 of the 10 focus-kit
files are byte-identical to the archive; every deviation in the other
3 is an assertion plus the comment justifying it.

## #7 — The kernel answers for what it observes; the app owns the window (2026-08-03, lab app)

Two kernel-surface additions arrived with the lab app, both pulled
across by a consumer rather than pushed by symmetry:

**`paintStats()`.** The initial paint flip shed the oracle's
`window.__threeUI` registry as "a devtools concern." The seed triage
already disagreed (instruments.md classifies `stats()` as a kernel
seam — `[]` after a lifecycle is the canonical nothing-left-painting
proof, `paints` deltas the idle-zero gate's raw feed), and Lab 006's
HUD is the consumer that proved it: the "40 live documents, zero
cost" claim rendered as numbers needs per-source counters that only
the source factory can keep. The registry crossed with one deliberate
divergence: **no global**. The kernel exports a function; the lab
hangs it at `window.__anamorph.stats()` in App.tsx. A zero-dep kernel
that stamps `window` at module load would be doing a consumer's job
with a library's authority.

**`Quat.premultiply`.** Lab 014's toss applies topspin in the world
frame (`plate.q.premultiply(spin)`, archive#61). The kernel Quat had
only `multiply`; the twin crossed with a contract pinning it as
exactly-multiply-with-operands-swapped (bitwise, not epsilon) plus
the frame semantics that make the order matter. Sized to the
consumer: no slerp, no euler bridge, nothing speculative.

The pattern both follow — and the reason this entry exists — is that
the kernel's public surface grows ONLY when a consumer arrives
holding the need, and each crossing brings its contract in the same
commit. "Might be useful" never crosses; "is used, and here is the
test" does.
