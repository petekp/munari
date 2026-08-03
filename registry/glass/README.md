# glass — the SDF compositor

Liquid-glass panels over live DOM: one scene render, then N screen-space
passes compositing far → near, each pass reading what the previous one
wrote — so a panel's refraction contains the glass, the ink and the world
behind it *by construction*. The glass stopped being a mesh in
archive#38; the ordering dance and its 1.95× draw-call cost went with it.

## The vendorable unit

Copy both files; they travel together:

- **`glassSdf.tsx`** — the compositor. Panels declared as rounded-rect
  SDFs (smooth-min union, archive#39), ink clipped to the rect rather
  than the coverage, per-panel ping-pong passes, capillary ripples
  driven by pointer impulses.
- **`glassSdfShader.ts`** — the GLSL: unioned field, merged-gradient
  bezel normal (the normal is the gradient of the *unioned* field —
  a merged shape needs a merged gradient, archive#39), dispersion taps,
  the ripple train.

Imports are `anamorph` + peers only (enforced by `tests/boundary.test.ts`
rule 3). Both files are byte-welded to the reference consumer at
`apps/lab/src/scenes/` — the preserved Lab 012 — by
`tests/registry/glassPack.test.ts`; the lab's typecheck and browser
evidence therefore cover this copy verbatim.

## The laws, and where they are pinned

- **Capillary ripple** (archive#40): `theta = K·r³/t²`,
  `k = dθ/dr = 3K·r²/t²`, amplitude = 1/√r spreading × viscosity ×
  finite source × bulk loss, soft tilt saturation. `rippleLaw.ts` is the
  TS twin; the pack test pins the twin against the law's mathematical
  properties (derivative consistency, r ~ t^(2/3) self-similarity,
  spreading, saturation bound) and pins the shader TEXT to contain the
  same formulas — change either half alone and the weld fails.
- **Compositing order is view-space z, never distance-to-eye**
  (archive#43): the pack test constructs the off-center counterexample
  (a side panel that is farther by Pythagoras while no deeper at all)
  and pins the view-z verdict. Any sort validated on a centered scene is
  carrying this bug — the two orders agree everywhere on the view axis.

## Tuned constants (bought in the archive's lab 012/013)

| knob | value | what it buys |
| --- | --- | --- |
| `rippleAmp` | 1.1 | peak height a unit impulse adds |
| `rippleK` | 3.0 | phase constant 4/(27C²) — the one scale knob; the train is self-similar under it |
| `rippleNu` | 0.0018 | viscosity — soft leading edge, not a drawn ring |
| `rippleSource` | 0.04 | bead radius — a contact is not a delta impulse |
| `rippleDecay` | 1.2 | bulk loss (s) |
| `rippleLife` | 1.8 | retirement age (s); MAX_RIPPLES 6 per panel |
| `rippleInk` | 0 | how far the wave drags the DOM's UV; 0 keeps text crisp |

The full knob set (bezel width, bend strength, dispersion, blur ladder)
is `GlassParams` in `glassSdf.tsx`, each field documented at declaration.

## Parked dragons (Phase 5, archive-measured)

- Per-panel passes scale linearly; the compositor held 1600 ballast
  knots but the ceiling is real (archive#42's cost model).
- Many-surface focus across glass layers.
- Floating-layer halo — the premultiply debt (archive#36, decisions #5).
