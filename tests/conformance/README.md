# The conformance suite

This is the kernel's specification. Each directory is one hold
layer, and each suite defines what that layer's laws mean — not by
describing them, but by pinning them: describe/it names, the comments
explaining what failure a case catches, and every measured number are
all load-bearing. When a law and its contract disagree, the contract
is right until a browser measurement says otherwise.

Layers, in the order they build on each other:

| layer | what it owns | suites |
|---|---|---|
| mapping | coordinate hold — the pixel-calibrated camera, UV anchoring | `camera`, `parkingCoincidence`, `densityIdentity`, `pixelGrid`, `domRect`, `surfaceAnchors`, `uvSampling` |
| paint | DOM → texture, and what a paint costs | `lodTier`, `htmlInCanvas`, `paintStats`, `styleChannel`, `filterPolicy`, `capabilityProbe` |
| pointer | provenance and the pointer protocol | `forwardEvents`, `relayDuplication`, `relayTripwire`, `relaySynthetic` |
| transfer | the handoff between page and mesh | `crossing`, `presentation`, `pointer`, `motionCarrier`, `choreography`, `surfaceIdentity`, `surfaceReadiness` |
| chrome | measuring what the DOM won't hand over in pixels | `surfaceChrome` |
| physics | physical controls | `physics1D` |

These suites are named for the law they pin, not for a module, so a
search by module name will miss them:

| suite | pins |
|---|---|
| `mapping/densityIdentity` | `mapping/camera.ts` — `texelDemand` and `planeScale` agree |
| `mapping/parkingCoincidence` | the parked identity across `paint/htmlInCanvas.ts` — a client point IS a page point |
| `paint/capabilityProbe` | `paint/htmlInCanvas.ts` — `detectHtmlInCanvas` |
| `paint/paintStats` | `paint/htmlInCanvas.ts` — the paint ledger |
| `pointer/relayDuplication` | `pointer/relay.ts` — one door, one dispatch |
| `pointer/relayTripwire` | `pointer/relay.ts` — a source scan, not a behavior test |
| `pointer/relaySynthetic` | `pointer/relay.ts` — `isRelayedEvent` through React's wrapper |
| `transfer/choreography` | `transfer/crossing.ts` — `crossingRange`, `crossingCurve` |
| `transfer/pointer` | `transfer/crossing.ts` — `crossingPointer`, input follows the eye (decisions.md #33) |

`packages/core/src/math/` is substrate, not a layer. The Vec3 types are
covered with the core modules that use them.

## Rules

- **A law lands with its contract, in the same commit.** A behavior
  change that no suite notices is indistinguishable from a regression.
- **Numbers are the contract.** Pinned constants, tolerances, and
  captured fixtures (the spatial-nav field rects, the pose numbers)
  are evidence from real browser measurement. Adjusting one to make a
  test pass is a decision, and needs an entry in `docs/decisions.md`.
- **Perceptual floors count as correctness.** Several suites assert
  that a mechanism is *visible or felt* at real hand speeds — that a
  bend clears a swell threshold, that a settle actually settles. A
  mechanism that is live but imperceptible is not shipped.
- **DOM suites carry their environment.** Files needing a document
  declare `// @vitest-environment happy-dom` at the top.
- **The idle-zero gate is part of this contract**, even though it
  can't run here: mounted quiescent Surfaces cost 0 paints/s, enforced
  in CI by `npm run gate:idle-zero` against a real browser.

Where tests live, by area — there are four homes, and only these four:
kernel law lands here, one directory per layer. The binding's suites
sit beside the modules they test, under `packages/react/src/`. Lab
scene tests sit beside their scene modules, under
`apps/lab/src/scenes/`. `tests/registry/` holds the welds that keep
copyable registry code identical to the reference scene that proves it.
A core test placed anywhere but here will fail `tests/boundary.test.ts`
(the `vitest` import escapes core's allowlist) — that failure means
"move the test", not "widen the allowlist".
