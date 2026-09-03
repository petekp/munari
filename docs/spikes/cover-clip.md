# Spike: hit clip under a transformed canvas, and who pays for a restyled pose

Measured 2026-09-02, Chrome 151 (headless, real GPU) with
`--enable-features=CanvasDrawElement`, via a disposable page + puppeteer
runner in `spikes/cover-clip/`. The apparatus is deleted; this report is
the artifact. Run between the matrix3d-hit spike
(`docs/spikes/matrix3d-hit.md`) and the adoption of the native pointer
route (decisions.md #39), because the route's four candidate designs
disagreed about one unmeasured fact.

**Questions asked:**

1. Does native hit-testing of a canvas child clip to the canvas's
   UNTRANSFORMED CSS box, or to the box as transformed — i.e. can a
   canvas moved by its own transform carry its child's hit region with
   it? (The matrix3d-hit spike only measured a transformed child inside
   an untransformed canvas.)
2. What does a transform restyle cost, per restyle, on the drawn root vs
   on the canvas? (The matrix3d-hit spike claimed root restyles were
   paint-free from a single-write measurement.)
3. Does the winning shape — canvas wears the full pose, child stays
   identity — keep the capture alive and the clicks trusted?

**Verdict: the clip follows the TRANSFORMED box, and the pose belongs on
the canvas.** Recorded as platform.md #21, with #20's transform clause
corrected.

## What we learned

1. **The clip follows the transformed canvas box.** A child quad
   standing fully outside the canvas's untransformed box is unhittable
   bare — and becomes hittable when the canvas's own transform moves its
   box over the quad. There is no over-capture: points off the quad
   still fall through to the page. A perspective-transformed child under
   an affine canvas cover agreed with the predicted edges to 0.25px, and
   the click that landed was trusted.
2. **Paint economy is inverted from the earlier claim.** Transform
   restyles on the DRAWN ROOT cost one paint each: 30/30 under a canvas
   cover, 30/30 bare, 10/10 fresh pre-capture, 10/10 post-capture,
   10/10 on a visible canvas. Transform restyles on the CANVAS are
   paint-free after the first: 0/10 translate, 0/30 full-perspective
   wobble, ~1 on first application. The matrix3d-hit spike's "restyle
   per frame is paint-free" does not reproduce; it counted paints
   around a single write.
3. **The winning rig works end to end.** Canvas CSS box = content box,
   canvas wears the full pose `matrix3d` from `transform-origin: 0 0`,
   child stays identity. The transformed box is then exactly the
   projected quad: centre hit passes, edge agreement holds at 0.25px,
   the click is trusted, a mutation under the worn pose captures
   correctly, and holding or animating the pose costs 0 paints/frame.

## What surprised us

- The inversion itself. Every candidate design assumed the child carries
  the pose (the matrix3d spike's shape) and spent its budget on covering
  the projected quad with a box that cannot grow (platform.md #8). The
  transformed-box clip makes coverage true by construction and deletes
  that machinery — including the tilt refusal one design derived from
  the 215.5px overhang of a 40° tilt over a 200px box.
- The child restyle paint cost hiding behind a single-write measurement
  for a full day of design work built on it.

## Still unknown

- Whether Chrome applies an unpainted canvas child's `cursor` property
  while the canvas covers the pointer (decisions.md #39 carries this as
  the open question behind the rig's no-cursor-write policy).
- Style-recalc cost at scale (many Surfaces restyling canvas transforms
  per frame) — paints are now zero, recalc was not measured.

## Recommended approach

Adopted the same day as decisions.md #39: the native route's rig puts
the pose on the parked canvas (`pointer/nativeRoute.ts`), coverage is no
condition of the route law (`pointer/pointerRoute.ts`), and the pose
math is shared with the relay (`pointer/surfacePose.ts`).

## Cost signals

The correction deleted machinery rather than adding it: no parking-box
geometry, no coverage condition, one style target instead of two. The
platform facts to re-verify on a Chrome move are #20's per-restyle paint
counts and #21's transformed-box clip.
