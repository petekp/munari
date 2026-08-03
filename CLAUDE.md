# anamorph — working rules

Anamorph makes the live DOM available as physical matter in WebGL
(Chrome HTML-in-canvas). One sentence of theory governs everything:
**this is a custody protocol between two renderers that both believe
they own the pixels.** Idle is compositor custody; flight is a custody
excursion; the swap rules are the transfer protocol. When a change is
hard to place, ask whose custody the pixels are in at that moment.

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
  tuned constants and perceptual-floor tests travel with the code.
- `apps/lab` — a consumer. Imports **only** the `anamorph` barrel,
  exactly as an outside project would. When a scene wants something
  unexported, export it — don't reach around.
- `instruments/` — measurement is maintained infrastructure, committed
  and reviewed like kernel code. A capture recipe that lives as prose
  has to be re-derived by whoever needs it next; that is the failure
  this directory exists to prevent.

`tests/boundary.test.ts` enforces every seam above.

## Conformance

The kernel's behavior is defined by `tests/conformance/`, one
directory per layer: **mapping → paint (custody) → door (forge) →
transfer (handoff) → chrome (measurement) → physics**. The suites are
the specification — describe/it names, comments, and pinned numbers
are all load-bearing. A law ships with the contract that pins it, and
changing a law means changing its contract in the same commit.

## Standing decisions (do not re-litigate; docs/decisions.md)

- **Second-system guard:** no new generality (multi-flight, non-planar
  sheets, extra renderers) unless a lab bleeds on it twice. The
  conformance suite defines done.
- **Premultiplied alpha, library-wide** (decisions.md #5): every
  DOM-sourced texture uploads premultiplied and every material
  consuming one blends premultiplied.
- **Perceptual floors are named peers of the theorems:** a mechanism
  isn't shipped until a budget pinned to real hand speeds says a human
  can see and feel it.
- **Browser evidence beats reasoning.** Numbers from a probe outrank
  any argument, including the ones in these documents. What the
  platform actually does, and how it was measured, is `docs/platform.md`.

## Verifying changes

`npm test` (vitest) and `npm run typecheck`. CI runs both on every
push, plus the idle-zero browser gate (`npm run gate:idle-zero`):
mounted quiescent Surfaces must cost 0 paints/s.
