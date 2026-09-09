# Spike: native matrix3d hit-testing on canvas children

Measured 2026-09-02, Chrome 151 (headless, dpr 1) with
`--enable-features=CanvasDrawElement`, via a disposable page + puppeteer
runner in `spikes/matrix3d-hit/` driving trusted CDP input. The apparatus
is deleted; this report is the artifact. Prompted by three.js PR #31233's
`InteractionManager`, which CSS-`matrix3d`-transforms a canvas child over
its mesh each frame so the browser hit-tests it natively — the follow-up
question left open by `texel-upload.md`.

**Questions asked:**

1. Is a matrix3d-transformed child of a `layoutsubtree` canvas natively
   hit-testable at its transformed screen position — and not painted?
   (kill criterion)
2. Do the relay's hardest behaviors work natively there under a real 3D
   tilt: hover, focus, caret and typing, text selection — with trusted
   input?
3. Does the browser's hit region agree with a GL quad rasterized from the
   same MVP (three's exact matrix recipe), within ~1px?
4. Can munari's OWN parked source element be simultaneously captured
   (drawElementImage) and natively hittable, and which invisibility rig
   survives?

**Verdict: viable — all four yes, including the munari marriage.** The
browser will hit-test, focus, and type into the real parked source
element through a tilted matrix3d, with the capture running untouched.
The costs are real but named: the hit region is clipped to the canvas's
CSS box, invisibility must come from `visibility` (never `opacity`), and
a matrix3d is planar — deformed poses keep the relay.

## What we learned

**1. Hit-testable, unpainted, trusted.** A trusted CDP click at the
transformed position reached the child's button (`isTrusted: true`) and
bubbled through the canvas; a click off the element reached the canvas.
`elementFromPoint` agrees. Children are never painted: screenshots of the
canvas region with the child present and `display:none` are
byte-identical, while a control div at the same spot changes them. So a
canvas child is pure hit-geometry — invisible by construction, no
`opacity:0` needed.

**2. Every prize behavior works natively under a 30°/12° tilt.** Click on
the transformed input → focused, caret placed (position 5 of "hello");
typed " world" → value "hello world", caret 11. Native `:hover` engaged
and cleared on an invisible transformed button (computed background
followed the rule). A drag along a `Range.getBoundingClientRect()` of
chars 0–11 selected exactly "select this". One aim point (caret at the
field's right AABB edge) missed — the AABB of a tilted quad has corners
off the element, an apparatus artifact, not a platform failure.

**3. Browser hit region ≡ GL rasterization within ≤1.25px.** The page
drew a magenta quad with the same MVP (perspective 40°, camera z=4,
rotY/rotX poses 30°/12° and 55°/25°) and scanned all four edges in 0.25px
steps, `elementFromPoint` vs `readPixels`: max disagreement 1.0px and
1.25px, median 0.75px at both poses. The pure-math prediction (three's
viewport·P·V·M·pixelToLocal recipe, w-divide) matches
`getBoundingClientRect` to 0.01px at the corners. Well inside a 2px
budget; the browser edge sits ~0.25–1.5px outside the mathematical edge,
the GL edge within ±1px of it.

**4. The munari marriage works, with three hard rules.**

- **Hit-testing is clipped to the canvas's CSS box.** An in-box transform
  hits; the same child transformed outside the box does not (the page
  element under it wins). So the parked canvas's box must cover the
  projected quad during flight — a viewport-sized box works. Capture
  density couples to that box (replay scale = backing/CSS ratio), so a
  density-1 viewport box carries a viewport-sized backing (~4.6MB at
  1280×900 dpr 1), or flight accepts a crushed density and `resettle`
  restores rest — which is already the kernel's law (motion approximate,
  rest exact). A hit-only canvas can shrink its backing to 8×8 and stay
  fully hittable.
- **Invisibility must be `visibility`, never `opacity`.** Static
  `opacity:0` on the drawn root BAKES into the paint record: capture
  reads `[0,0,0,0]`, including across fresh records after a mutation.
  (Platform item 4 is about *animating* root opacity — a static value is
  captured.) But `visibility:hidden` on the canvas with
  `visibility:visible` on the child keeps paints firing and the capture
  fully alive — that is the rig. `opacity:0` on the *canvas* fires
  onpaint but blanks the capture too.
- **A transform on the drawn root is free.** It never enters the capture
  (byte-identical before/during) ~~and provokes zero repaints — the
  matrix3d can be restyled per frame without touching the paint
  economy~~. *Corrected same day by the cover-clip probe
  (`docs/spikes/cover-clip.md`): each transform restyle on the root
  costs one paint (30/30 across five setups) — this run counted paints
  around a single write, not per restyle. Restyling the CANVAS's
  transform is what is paint-free after the first, and that is where
  the pose now lives (platform.md #20–#21).*

The end-to-end rig — parked canvas `visibility:hidden`, lifted to a
z-index above the GL canvas, `pointer-events:none` with the child back to
`auto` (munari's existing parking split), child transformed by a tilted
matrix3d over GL territory: trusted click delivered to the real button,
native `:hover` engaged, capture byte-identical throughout, and the hover
state change SELF-PAINTED the source (paints 2→4) — the loop that would
draw a hover twin into the texture with no relay code at all.

## What surprised us

- The clip-to-box rule. It silently ate the first full-rig attempt and
  masqueraded as "not hittable at all"; in-box vs out-of-box was the
  entire difference.
- Static root opacity baking into the record, given item 4's "animating
  root opacity changes nothing." The record excludes *compositor-driven*
  root opacity, not the computed style.
- `visibility:hidden` on the canvas keeping paint records alive — the
  off-screen-skip analogy predicted the opposite.
- How exact three's matrix recipe is: 0.01px against the browser's own
  rects.

## Still unknown

- ~~dpr ≠ 1, page scroll/nested offsets, and the lab's iframe shell were
  not exercised~~ — since measured, same day: all three pass. See the
  kill-probe addendum below.
- Style-recalc cost of restyling N transforms per frame (~~the transform
  is paint-free~~ *corrected: root restyles paint, canvas restyles don't
  — cover-clip.md*; recalc wasn't measured at scale).
- Interplay with `CanvasPointerGate`, the relay, and the focus ledger —
  native routing bypasses all three; arbitration between "native for
  planar flights, relay for deformed poses" is design work, not platform
  work.
- Whether text selection can span from a native page element INTO a
  transformed canvas child (single-element selection worked; crossing was
  not tried).

## Recommended approach

- This is worth designing toward, not folding in casually: a gl-phase
  pointer mode where a flying planar Surface's source element rides the
  presenter's matrix3d and hears input natively — decisions.md #33
  ("input follows the eye") implemented by the browser's own hit-testing,
  with hover/caret/selection for free. The relay stays for deformed poses
  (fisheye, slider, crystal — a matrix3d cannot express them) and as the
  no-capability fallback.
- The rig, exactly: box covering the flight region, backing per the
  density law, canvas `visibility:hidden` + child `visibility:visible`,
  z above the renderer canvas while airborne, transform on the source
  root synced from the presented pose. *Superseded same day: the
  cover-clip probe put the transform on the CANVAS instead — the clip
  follows the transformed box, so a content-sized box needs no covering
  and the restyle stops costing a paint per frame
  (`docs/spikes/cover-clip.md`, decisions.md #39).*
- Platform facts recorded as platform.md #18–#20 (#20's transform
  clause corrected and #21 added by `docs/spikes/cover-clip.md`);
  re-verify on Chrome moves, especially clip-to-box and the visibility
  asymmetries.

## Cost signals

Adoption would touch the pointer layer (relay arbitration), the source
host (parking styles per phase), and the presenter (pose → matrix3d
sync); conformance suites for pointer + transfer would grow a native
mode. No new dependencies. The measured platform is ready; the work is
kernel design.

## Addendum: kill-probe (same day)

Three environment unknowns could have killed the approach before design.
A follow-up apparatus (`spikes/pointer-kill/`, deleted like the rest)
probed each with the same trusted-CDP protocol. **None kill it.**

1. **The lab's iframe shell — passes.** The full rig was rebuilt inside
   a replica of the shell (`App.tsx`: 240px nav rail, same-origin
   borderless iframe, no sandbox). The capability exists in the iframe's
   own realm; `elementFromPoint` inside the iframe returns the
   transformed child while the parent document returns the IFRAME
   element — the browser routes through. A trusted click aimed at
   top-viewport coordinates (iframe offset + in-iframe point) reached
   the child's button (`isTrusted: true`), native `:hover` engaged, and
   the capture stayed alive (`[204,0,0,255]`). Identical at dpr 1
   and 2. One coordinate rule for the kernel: CDP/OS input addresses
   the top viewport, but everything the kernel itself does (matrix,
   `elementFromPoint`, `getBoundingClientRect`) lives in the iframe's
   coordinate space and needs no offset — the browser translates.
2. **dpr 2 — passes, precision unchanged.** The 55°/25° pose's 12-edge
   scan at `deviceScaleFactor: 2` (backing 2× CSS, `readPixels` at
   device coords): max DOM-vs-GL disagreement 1.0px, median 0.75px —
   the dpr-1 rerun in the same session read 1.25px/0.75px. Hit
   precision does not degrade with density.
3. **Scroll and offset canvases — pass, standard CSS composition.**
   A `position:fixed` parking at the origin is scroll-transparent: at
   `scrollY` 800 the transformed child hits and takes a trusted click
   unchanged. An absolute canvas at document (150, 1000) scrolled into
   view composes exactly as CSS says: child viewport origin =
   `canvas.getBoundingClientRect()` origin + translate — predicted
   [200,230], measured [200,230], hit and trusted click both good. No
   special scroll handling is needed; `getBoundingClientRect` already
   answers in viewport space.
