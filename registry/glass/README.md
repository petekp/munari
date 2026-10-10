# glass

Liquid-glass panels over live DOM: one scene render, then N
screen-space passes compositing far → near, each pass reading what the
previous one wrote, so a panel's refraction contains the glass, the
ink, and the world behind it. The glass is not a mesh; a mesh version
costs 1.95× the draw calls plus an ordering problem, for a worse
result.

## What to copy

Both files; they travel together:

- **`glassSdf.tsx`**: the compositor. Panels declared as rounded-rect
  SDFs (smooth-min union), ink clipped to the rect rather than the
  coverage, per-panel ping-pong passes, capillary ripples driven by
  pointer impulses.
- **`glassSdfNodes.ts`**: the node materials, in Three Shading
  Language (TSL). Unioned field, merged-gradient bezel normal (the
  normal is the gradient of the unioned field; a merged shape needs a
  merged gradient), dispersion taps, the ripple train, and the blit
  that applies Neutral tone mapping once on the way to the screen.

Both need Three's `WebGPURenderer`, which `SurfaceCanvas` supplies.

Imports are `@petepetrash/munari` + peers only (enforced by
`tests/boundary.test.ts`). Both files must stay byte-identical to the
copies in `apps/lab/src/scenes/glass/`; `tests/registry/glassPack.test.ts`
fails if they differ, so the lab's typecheck and browser tests cover
this copy too.

## What the tests check

The pack test checks the two actual copied files for byte identity.
`npm run gate:glass-effects` measures the lab renderer's ripple contribution
and draw order using independent pixel controls. A nearer panel must remain
in front even when it is farther from the camera by radial distance.

No unit test runs the renderer's ripple math. The browser check does not cover
every ripple parameter, retirement, glow, or layered input behavior.

## Tuned constants

| knob | value | what it buys |
| --- | --- | --- |
| `rippleAmp` | 0.5 | peak height a unit impulse adds |
| `rippleK` | 3.0 | phase constant 4/(27C²); the one scale knob, and the train is self-similar under it |
| `rippleNu` | 0.0018 | viscosity: a soft leading edge instead of a drawn ring |
| `rippleSource` | 0.04 | bead radius; a contact has finite width |
| `rippleDecay` | 3.4 | bulk loss (s); the retirement taper does most of the fade |
| `rippleLife` | 1.4 | retirement age (s); MAX_RIPPLES 10 per panel |
| `rippleWaveSpeed` | 2.9 | reference wave speed c; keeps the satellites' wakes subsonic |
| `rippleInk` | 0.02 | how far the wave drags the DOM's UV; past a few hundredths the text swims |

The full knob set, including bezel width, bend strength, dispersion, and
frost (`roughness`), is `GlassParams` in `glassSdf.tsx`.

## Known limits

- Per-panel passes scale linearly. The compositor held 1600 ballast
  knots in testing; cost is per panel, not per pixel of glass.
- Nothing tests many-surface focus across glass layers yet.
- Floating-layer halo on partially transparent panels: see
  decisions.md #5 (premultiplied alpha).
