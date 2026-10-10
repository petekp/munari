# Test audit

Status: done, 2026-09-30. Six commits are on `main`. One choice is left to
you, under [Your call](#your-call).

## On main

| Commit | Change |
|---|---|
| `a6d7e7c` | Rewrote seven tests that passed with the behavior they name broken, and removed eighteen that duplicated stronger tests or compared a value with its own definition. |
| `d99de64` | Removed or merged thirteen tests covered by a stronger test. The knobs accounting test now reads the production `knobsValues`. |
| `9df3653` | Added two binding tests: source content reaches its own Surface through the host's context, and the source runtime's mipmap rule. |
| `a0eff6e` | Removed `filterPolicy`, `styleChannel`, `overCenterField`, `flipImpulse`, `stopsField`, and `endStops`, with their tests. Decision #37 is amended. |
| `63665df` | Removed `partSetForget`, `partSetUnregister`, `partSetComplete`, `resolveFixedScale`, and `rectEquals`. The store now calls `crossingDraws` instead of repeating it. |
| `5be3183` | Removed lab code that only tests call: `rampLag`, `fisheyeSourceX`, `capIsValid`, `veilProfile`, `registry/glass/rippleLaw.ts`, and the `includePage` branch. `apertureAt` now calls `signedSpread` and `apertureField`. Four `spatialNav` helpers are no longer exported. Seven tests are gone, and stale comments are fixed. |

The suite went from 1,459 tests to 1,399. Each rewrite that claims to detect a
fault was checked by applying that fault to production and confirming the test
fails.

## Your call

`apertureReveal`, `blobHeightPx`, `veilSeamAlpha`, and `veilLod` are
JavaScript copies of shader math. Their tests check only the JavaScript copy,
and nothing compares it with the TSL node code it mirrors (`refractionNodes.ts`
for the first two, `veilNodes.ts` for the last two). Each could be removed, or
kept as documentation of the shader's intent.

## Kept after review

- `posePoint`, `poseMatrix3d`, `planeToScreen`: the route-parity and camera
  tests use them to measure production laws.
- `isRelayedEvent`: consumer-facing. `isRelayed` on a React wrapper always
  answers false, and this function covers that case.
- `rejectedPresentationDraws`, `deferredPresentations`, `hasController`: each
  is a one-line accessor on an internal interface. Tests use it to observe
  real behavior.
- `litGate`, `dampingRatio`, `maxBlobBendPx`, `blobBendPx`, `blobSlope`,
  `bendTaper`, `channelSeparationPx`, `veilRadius`: each is how a test measures
  a tuned production constant or function. Tuning comments cite those tests.
  Spring settling tests assert position and velocity limits directly.
- `topAt`, `bottomAt`: tests use them to build points for `sdCrystal` and
  `normalAt`, which production calls.
- `ART_MAX_RADIUS`, `ART_U`, `CAMERA_U`: each names a bound or layout that a
  test of production code reads.
- `packages/react/src/index.test.ts` export lists, `relayTripwire.test.ts`,
  `tests/boundary.test.ts`, registry byte-identity tests, and the marble-hand
  STL tests. The structure each one reads is the contract.

## Gaps that were not filled

- **Valid then refused frame through one route controller.** Already covered.
  The controller's safety depends on `surfacePose` resetting a reused pose.
  The kernel test rewritten in `a6d7e7c` fails when that reset is removed.
- **Plume Restore during flight, 2026-09-05.** Reverting that fix no longer
  reproduces the frozen frame. With the fix reverted, a screenshot check
  measured 2,002 particle pixels before Restore and 0 after, with the panel
  closed and with it open. Something else now draws the frame. A check that
  cannot fail on the old fault was not added.
- **Relay tripwire scope.** Not a gap. `CanvasPointerGate` dispatches a clone
  that stands in for the native event it replaces. Branding it as relayed
  would be wrong, and the gate skips its own clones.

## Evidence

- Full suite after `5be3183`: 1,399 of 1,399 passed with a 60 s timeout.
  `npm run typecheck` and `npm run lint` passed.
- Under heavy load (load average 54 to 87), two to four tests outside the
  audit timed out at the default 5 s and passed on rerun.
- `gate:lifting-pointer` fails locally with and without the `crossingDraws`
  change, at a load average of 30 to 50. Hosted CI failed it once on `63665df`
  and passed it on an unchanged rerun.
- The Plume gate with `STRICT_CAPABILITY=1` passed on the unchanged product.
