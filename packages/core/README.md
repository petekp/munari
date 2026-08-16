# @munari/core

Coordinate mapping, DOM-to-texture capture, pointer forwarding, the
page↔scene handoff, and the physics behind the controls: everything
that doesn't touch React or `three`. It has no dependencies and ships
only inside `@petepetrash/munari`.

The DOM keeps the real state; this package computes when and how its
pixels move between the page and a WebGL scene.

## What's where

| directory | what it does |
|---|---|
| `mapping/` | coordinates: `camera` (screen↔plane calibration), `pixelGrid` (pixel snapping), `uvAnchor` (sampling deforming geometry) |
| `paint/` | pixels: `htmlInCanvas` (DOM→texture via `drawElementImage`, the capability probe, paint receipts), `frameSource` (caller-owned canvas frames), `lodTier` (resolution tiers), `textureStorage`, `styleChannel`, `filterPolicy`, `sourceIdentity` (internal, not exported) |
| `pointer/` | input: `relay` (the one `dispatchEvent` call and the `isRelayed` marker), `forwardEvents` (hit-testing and forwarding into the DOM), `hoverGrace` |
| `transfer/` | the page↔scene handoff: `crossing` (the state machine), `presentation` (when a draw counts as shown on screen), `motionSamples`, `motionCarrier`, `conductorTiming`, `densitySchedule` |
| `chrome/` | measuring what the DOM won't rasterize: `surfaceChrome` (corner radii, shadows), `shadowQuadFrame` |
| `physics/` | motion: `physics1D` (force fields for controls), `plate`, `gestures` |
| `math/` | `vec2`, `vec3`, `quat`: small reimplementations of the formulas this package would otherwise have to import from `three` |

`src/index.ts` is the export list, grouped to match the directories.
Export a module once its tests exist.

## Tests

Tests for this package live in `tests/conformance/`, one directory per
area, never next to the modules. `tests/boundary.test.ts` enforces
both rules: it rejects any import here that is not a relative path
inside `packages/core/src` (the no-dependencies check), and it rejects
test files in this directory (move the test; don't edit the
allowlist).

## Comments

A module opens with a comment block: what it does, then the browser
behavior or bug that shaped it, with dates and measured numbers where
they exist. Constants say where their values came from, citing
`docs/decisions.md` or `docs/platform.md` by entry number. Keep that
pattern when adding a module.
