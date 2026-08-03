# anamorph — working rules

Anamorph makes the live DOM available as physical matter in WebGL
(Chrome HTML-in-canvas). One sentence of theory governs everything:
**this is a custody protocol between two renderers that both believe
they own the pixels.** Idle is compositor custody; flight is a custody
excursion; the swap rules are the transfer protocol. When a change is
hard to place, ask whose custody the pixels are in at that moment.

## The oracle

The predecessor repo — `petekp/three-ui`, frozen at `362c5a1` — is the
runnable oracle: 62 decisions, 357 tests, every platform measurement.

- Cite it as `archive#N` (= three-ui `docs/decisions.md` entry N).
  Inherited knowledge is cited, never restated.
- Check it out side by side (`../three-ui`) for diffing and probing.
  **Never** vendor it, copy it wholesale, or import from it.
- Its distilled index is `three-ui/docs/seed/` — read `manifest.md`
  before porting anything; `instruments.md` before writing probes.
- Its platform claims are dated empiricism on a moving origin trial:
  untrusted here until `three-ui/docs/seed/platform-reaudit.md` runs
  on current Chrome (the Phase 2 gate).

## Contracts first

Knowledge moves as contracts: a layer's conformance tests land — red
or skipped — **before** its implementation. Kernel layers land in this
order: **mapping → paint (custody) → door (forge) → transfer
(handoff) → chrome (measurement) → physics**. A layer is done when its
slice passes here and the oracle agrees on behavior.

Contracts live as `tests/conformance/<layer>/*.contract.ts` — complete
suites, typechecked but not yet run, their kernel surface as typed
`declare` holes; the ledger test keeps them visible on every run, and
the flip protocol is `tests/conformance/README.md` (decisions.md #2).

## Shape (the hourglass)

- `packages/core` (`@anamorph/core`) — the kernel: custody,
  provenance, arbitration, pure laws. **Zero runtime dependencies**,
  never published independently. The DOM stays the retained model —
  core coordinates, it does not own content.
- `packages/react` (`anamorph`) — the thinnest binding, and the one
  package that will ever be published. `three` +
  `@react-three/fiber` are **peer** dependencies. We are three-first;
  renderer abstraction is banned by the second-system guard.
- `registry/` — copyable behaviors (shadcn model, nothing published):
  tuned constants + perceptual-floor tests + archive citations travel
  with the code.
- `apps/lab` — a consumer. Imports **only** the `anamorph` barrel,
  exactly as an outside project would. When a scene wants something
  unexported, export it — don't reach around.
- `instruments/` — measurement is maintained infrastructure, committed
  and reviewed like kernel code. (In the archive every capture recipe
  lived as prose and had to be re-derived; that is the failure this
  directory exists to prevent.)

`tests/boundary.test.ts` enforces every seam above.

## Standing decisions (do not re-litigate; docs/decisions.md)

- **Second-system guard:** no new generality (multi-flight, non-planar
  sheets, extra renderers) unless a lab bleeds on it twice. The
  conformance suite defines done.
- **Premultiplied alpha is decided during the paint layer**
  (archive#36 deferred it three times; there is no fourth).
- **Perceptual floors are named peers of the theorems**
  (archive#49/#53/#59/#62): a mechanism isn't shipped until a budget
  pinned to real hand speeds says a human can see and feel it.
- **Browser evidence beats reasoning.** Numbers from a probe outrank
  any argument, including the ones in these documents.

## Verifying changes

`npm test` (vitest) and `npm run typecheck`. CI runs both on every
push. The idle-zero browser gate (idle Surfaces = 0 paints/s,
archive#3) joins CI when the paint layer lands and **must** land with
it, not after.
