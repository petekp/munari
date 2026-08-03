# The conformance suite

Contracts land before implementations (CLAUDE.md: contracts first). A
contract file is a complete vitest suite that cannot run yet, because
the surface it tests does not exist. The conventions that make that
safe (decisions.md #2):

- **`*.contract.ts`** — typechecked (root tsconfig includes `tests/`)
  but invisible to the runner (vitest collects only `*.test.ts`).
  Nothing in a contract file executes, so ported module-scope fixtures
  are safe. `describe.skip` would not be: vitest runs describe
  factories at collection even when skipped, and every missing import
  would throw before the skip took effect.
- **Contract holes** — the surface the suite demands from
  `@anamorph/core`, written as a `declare` block (plus local `type`
  copies) under a `// ---- CONTRACT HOLES` marker: typed, body-less,
  erased at compile time. The holes are the API half of the contract;
  the suite bodies are the behavior half. Core's barrel stays empty —
  throwing stubs would let other packages compile against surface
  that doesn't exist.
- **The ledger** (`ledger.test.ts`) — live from first commit. It
  reports every contract file as an `it.todo` on every `npm test`
  (skipped cannot decay into forgotten) and enforces this README:
  headers, citations, hole markers, no `@anamorph/core` imports in
  contracts, no oracle imports anywhere, layer directories restricted
  to the six kernel layers. The import bans are raw-text checks,
  comments included — phrase flip instructions without the literal
  `from '…'` specifier.

## Flip protocol (landing a layer)

1. `git mv tests/conformance/<layer>/<name>.contract.ts` →
   `<name>.test.ts`.
2. Replace the CONTRACT HOLES block with real imports from
   `@anamorph/core`. Adapting names/shapes away from the oracle is
   allowed — with a decisions.md entry when the divergence is
   deliberate.
3. Run it red. Implement in `packages/core` until green. Then check
   the oracle agrees: same behavior in `../three-ui` at `362c5a1`.
4. Layer prerequisites, owed WITH the flip and not after:
   - **paint** — the idle-zero browser gate joins CI (archive#3), and
     the premultiplied-alpha decision is made (archive#36; no fourth
     deferral). `mapping/parkingCoincidence` flips with THIS layer —
     it pins a coordinate fact, but its subject API is the source
     factory — and brings `happy-dom` if door hasn't already.
   - **door** — `happy-dom` joins root devDependencies (the DOM
     suites carry `// @vitest-environment happy-dom`).
   - **transfer** — the density schedule gets its pure test (page
     density at handoff, altitude density at cruise, hysteresis on
     plate z — archive#53; carrier today is the mapping camera suite
     plus lab driver logic).

## File headers

Line 1 and line 2, exactly:

```ts
// CONFORMANCE CONTRACT — <layer> (typechecked, not yet run)
// Ported from three-ui@362c5a1 <origin path> (archive#N[, archive#M…])
```

or, for contracts that never had a carrier in the archive:

```ts
// CONFORMANCE CONTRACT — <layer> (typechecked, not yet run)
// New contract (owed by seed manifest): <one-line reason> (archive#N…)
```

## Porting rules

Suite bodies port near-verbatim: describe/it names, comments, and
pinned numbers ARE the contract. Sanctioned adaptations, no ceremony
needed:

- Import rewrites into contract holes; exported types the suite uses
  are copied next to the holes (cited by the file header).
- Tuple-typing loop fixtures (`Array<[number, number]>` or
  `as const`) — this repo sets `noUncheckedIndexedAccess`, the oracle
  does not.
- Non-null assertions where the oracle's looser tsconfig let indexing
  pass.
- Default-parameter erasure in holes: an ambient `declare function`
  has no body to default from, so `x = 12` becomes optional `x?` with
  the default noted in a comment.
- A ported file may host a manifest-owed NEW describe block; mark it
  `// NEW (seed manifest owed):` with its archive citation.

Anything behavioral — a changed number, a dropped test, a reordered
protocol — is not an adaptation; it needs a decisions.md entry.

## Inventory (Phase 1 inc 2)

| layer | file | origin (three-ui@362c5a1) | cites |
|---|---|---|---|
| mapping | camera | `app/scenes/lab014Camera.test.ts` | #44 |
| mapping | uvAnchor | `src/lib/uvAnchor.test.ts` | #6 |
| mapping | parkingCoincidence | new | #16 #20 #22 |
| mapping | densityIdentity | new | #52 #53 #44 |
| paint | lodTier | `src/lib/lodTier.test.ts` (+ new warn-and-clamp) | #8 #9 #12 #35 #52 |
| paint | htmlInCanvas | `src/lib/htmlInCanvas.test.ts` (+ new identity-CTM) | #10 #11 #22 |
| paint | styleChannel | `src/lib/styleChannel.test.ts` | #28 |
| paint | filterPolicy | new | #9 #36 #37 |
| door | forwardEvents | `src/primitives/forwardEvents.test.ts` | #19 #20 #24 #26 #27 #29 #32 #50 #51 |
| door | hoverGrace | `src/lib/hoverGrace.test.ts` | #31 |
| door | forgeDuplication | new | #50 |
| door | forgeTripwire | live test, not a contract | #50 |
| transfer | motionSamples | `src/lib/motionSamples.test.ts` | #17 |
| transfer | conductorTiming | new (END_EPSILON_MS, cancel-holds-last-pose) | #17 |
| chrome | surfaceChrome | `src/lib/surfaceChrome.test.ts` | #55 |
| chrome | shadowQuadFrame | `app/scenes/lab014Plate.test.ts` (shadow-quad slice) | #56 |
| physics | physics1D | `src/lib/physics1D.test.ts` | #2 |
| physics | plate | `app/scenes/lab014Plate.test.ts` (minus shadow-quad slice) | #45 #49 #59 #60 #61 #62 |
| physics | gestures | `app/scenes/lab014Gestures.test.ts` | #48 #50 #61 |
