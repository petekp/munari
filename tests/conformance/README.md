# Kernel tests

These suites check the kernel's intended behavior. The [retention and evidence
rules](../../AGENTS.md#conformance) apply to every case. A passing stub-based
suite does not establish browser rendering or native input behavior.

| Layer | Behavior | Suites |
|---|---|---|
| mapping | Coordinates, camera projection, pixel alignment, and anchors | `camera`, `densityIdentity`, `domRect`, `pixelGrid`, `surfaceAnchors`, `uvSampling` |
| paint | Capture scheduling, frame identity, storage, and filtering | `capabilityProbe`, `captureEngines`, `filterPolicy`, `frameSource`, `htmlInCanvas`, `lodTier`, `paintStats`, `styleChannel`, `textureStorage` |
| pointer | Input targets, provenance, routing, and native policy | `forwardEvents`, `pointerRoute`, `relayDuplication`, `relaySynthetic`, `relayTripwire`, `routeParity`, `surfacePose` |
| transfer | Renderer holds, presentation evidence, and motion | `choreography`, `crossing`, `crossingDrive`, `motionCarrier`, `presentation`, `surfaceIdentity`, `surfaceReadiness` |
| chrome | Borders, radii, and shadows measured from HTML | `surfaceChrome` |
| physics | Physical control behavior | `physics1D` |

Some suites test a contract shared by several modules:

| Suite | Contract owner |
|---|---|
| `mapping/densityIdentity` | `mapping/camera.ts`: pixel demand and plane size agree |
| `paint/capabilityProbe` | `paint/htmlInCanvas.ts`: capture capability detection |
| `paint/captureEngines` | `paint/rasterizedSource.ts` and the shared capture ledger |
| `paint/paintStats` | Capture counts, errors, and source disposal |
| `pointer/relayDuplication` | `pointer/relay.ts`: independent event streams do not interfere |
| `pointer/relayTripwire` | Static dispatch sites remain in the relay module; actual delivery is tested separately |
| `pointer/relaySynthetic` | Event provenance survives React's event wrapper |
| `pointer/routeParity` | Route policy and relay behavior; native caret placement needs a browser |
| `transfer/choreography` | `transfer/crossing.ts`: interval and pulse curves |

Files needing a document declare `// @vitest-environment happy-dom`.
Use controlled doubles for ordering and failures at real interfaces. Capture
pixels, native selection, and compositor timing require the corresponding
[browser instrument](../../instruments/README.md). `gate:idle-zero` measures
idle source paints; it does not measure all renderer or GPU work.

Kernel tests live here. Binding and lab tests live beside their modules.
Registry tests verify actual copyable files. Measurement-helper tests live
beside those helpers under `instruments/`. The [repository guide](../../AGENTS.md#where-tests-live)
owns this layout. [Decision #2](../../docs/decisions.md#2--the-conformance-suite-is-the-specification-2026-08-02)
records the test policy.
