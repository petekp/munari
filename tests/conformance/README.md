# The conformance suite

This is the kernel's specification. Each directory is one custody
layer, and each suite defines what that layer's laws mean — not by
describing them, but by pinning them: describe/it names, the comments
explaining what failure a case catches, and every measured number are
all load-bearing. When a law and its contract disagree, the contract
is right until a browser measurement says otherwise.

Layers, in the order they build on each other:

| layer | what it owns | suites |
|---|---|---|
| mapping | coordinate custody — the pixel-calibrated camera, UV anchoring | `camera`, `uvAnchor`, `parkingCoincidence`, `densityIdentity`, `pixelGrid` |
| paint | DOM → texture, and what a paint costs | `lodTier`, `htmlInCanvas`, `paintStats`, `styleChannel`, `filterPolicy`, `capabilityProbe` |
| pointer | provenance and the pointer protocol | `forwardEvents`, `hoverGrace`, `relayDuplication`, `relayTripwire` |
| transfer | the handoff between page and mesh | `motionSamples`, `conductorTiming`, `densitySchedule` |
| chrome | measuring what the DOM won't hand over in pixels | `surfaceChrome`, `shadowQuadFrame` |
| physics | the laws of held and thrown matter | `physics1D`, `plate`, `gestures`, `quat` |

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

The binding has its own suites beside the modules they test, under
`packages/react/src/lib/`; `tests/registry/` holds the welds that keep
copyable registry code identical to the reference scene that proves it.
