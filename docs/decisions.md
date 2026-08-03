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
