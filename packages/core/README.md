# @munari/core — the kernel

Pure laws with **zero runtime dependencies**, never published on its
own. The DOM stays the retained model: core coordinates the handoff
between two renderers that both believe they own the pixels — it does
not own content, and it never touches `three`. Both properties are
enforced, not promised: `tests/boundary.test.ts` walks every import
specifier in this directory and rejects anything that is not a
relative path staying inside `packages/core/src`.

## Layout

Six directories are the six hold layers, in the order they build on
each other, plus one substrate:

| directory | owns |
|---|---|
| `mapping/` | who owns the coordinates — `camera` (calibration, screen↔plane), `pixelGrid` (the snap), `uvAnchor` (sampling deforming geometry) |
| `paint/` | who owns the pixels — `htmlInCanvas` (DOM→texture, the `drawElementImage` probe, paint receipts and `paintStats`), `frameSource` (caller-owned canvas frames), `lodTier` (tier selection and the texture-edge guard), `textureStorage` (allocation law), `styleChannel`, `filterPolicy`, `sourceIdentity` (internal id allocator, not in the barrel) |
| `pointer/` | provenance and the relay — `relay` (the single `dispatchEvent` door and the `isRelayed` brand), `forwardEvents` (forwarding, hit-testing, focus modality), `hoverGrace` |
| `transfer/` | the handoff — `crossing` (the state machine and its evidence), `presentation` (the receipt predicate), `motionSamples`, `motionCarrier`, `conductorTiming`, `densitySchedule` |
| `chrome/` | measuring what the DOM won't hand over in pixels — `surfaceChrome`, `shadowQuadFrame` |
| `physics/` | held and thrown matter — `physics1D`, `plate`, `gestures` |
| `math/` | substrate, **not a layer** — `vec2`, `vec3`, `quat` reimplement the formulas core would otherwise import from three (core imports nothing). `quat`'s conformance suite files under `physics/`, its consumer, and compares against a real `THREE.Quaternion`. |

`src/index.ts` is a hand-curated barrel, sectioned by layer. It grows
one layer at a time, and only after that layer's conformance contract
has landed.

## Where the tests are

Nowhere in this directory, ever. The kernel's specification is
`tests/conformance/`, one directory per layer — see its README for the
layer table and the suites named for laws rather than modules. A test
placed beside a core module fails `tests/boundary.test.ts` (the
`vitest` import escapes the allowlist); that failure means "move the
test", not "widen the allowlist".

## The comment convention here

Every module opens with a `//` preamble: the law, then the fault that
produced it, usually with a dated browser measurement, then the
ownership split. Constants carry *why this number*, citing
`decisions.md #N` or `docs/platform.md`. This directory is the
reference implementation of that convention — keep it that way when
adding a module.
