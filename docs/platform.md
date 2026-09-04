# The platform, as measured

The library rests on Chrome's HTML-in-canvas APIs (`drawElementImage`,
`texElementImage2D`), which are an origin trial — moving ground. Every
claim below is something the library depends on, stated as what the
platform does, with the measurement that established it. Re-run these
when Chrome moves; a surprise here invalidates a kernel layer, not
just a test.

Baseline measurements **2026-08-04** against **Chrome 150** (items 11–12; item
9–10 on 2026-08-03; items 1–8 on **150.0.7871.187**), macOS, 120Hz,
dpr 1, launched with
`--enable-features=CanvasDrawElement`.
None of these items are dpr-sensitive — every probe pins its own
scale — but capability chips (`drawElementImage ✓` /
`texElementImage2D ✓`) must be verified on load before trusting any
run: a relaunch without the flag fails silently into a different set
of answers.

Later entries carry their own measurement dates. Editorial corrections on
2026-08-31 clarify cross-references, throughput wording and source ownership;
they do not change the recorded samples or claim a new browser run.

| # | What the platform does | Evidence |
|---|------|---------|
| 1 | The capability APIs are present under the flag | `drawElementImage ✓` / `texElementImage2D ✓` on load |
| 2 | The compositor self-paints on DOM mutation — no repaint request is needed | one DOM mutation → `selfPaintsOnRed: 1`, `requestPaintCalls: 0` |
| 3 | A mutation resolves into the captured buffer, one self-paint each | red → blue mutation: buffer reads `[255,0,0,255]` then `[0,0,255,255]` |
| 4 | **The root-vs-descendant hinge.** Animating the drawn element's OWN opacity/transform does not invalidate its paint record, so nothing repaints. On descendants both animate correctly, at one paint + one upload per frame. | root opacity keyframes: `paintDelta 1`, `distinctColors 1` (frozen); descendant: `paintDelta 133`, 9 distinct colors, landmark ramp 232→206→179→154 |
| 5 | Idle sources are free; the recorded throughput includes 96 concurrently painting sources | idle half: `instruments/idle-zero` (CI gate). Throughput half — 128 idle sources at 119.995fps / 0 paints/s, 96 live at 93.4fps with min==mean==max frame time and p95 17.1ms — was measured on a load harness that has **not** been migrated; see below |
| 6 | Rescaling commits one paint per LOD tier boundary crossed, and a focused field keeps caret and value across its own source's swap | workspace scene `approach('email')`: source 0.5→1.5, 8/11 moved sources paint exactly 1 (2-paint entries crossed two boundaries); glyphs visibly sharpen; focused textarea holds caret `[7,7]` + value |
| 7 | **A `mask-image` on ANY descendant of a drawn element blacks out the whole capture** — solid black except independently composited descendants, with clean paints and no error. Even a mask computed to a fully opaque no-op gradient. (measured 2026-08-01) | panel wearing a `scroll-fade-*` utility: capture all black, `paintDelta` normal, no console error; removing the mask restores it |
| 8 | Replay is position-aware: a capture at scale k lands at k× position and k× size under an identity CTM | standalone source, 6px dot at CSS (20,30): k=0.5 → centroid (11.5,16.5) size 3; k=3 → centroid (69,99) size 18 |
| 9 | **The capture is clipped to the DRAWN element's border box** — ink outside it (shadow, outline, escaping absolute child, `filter: drop-shadow` spread) is in the paint record and cut. Drawing a padded *wrapper* recovers it, because the clip follows whichever element was passed. (measured 2026-08-03, headless and headed identical) | 200×120 div, `box-shadow: 0 60px 0 0 red`: drawn bare → **0** red px; the same div inside `padding: 100px`, drawing the wrapper → **12000** red px (= 200×60 exactly) at x 100–299, y 220–279. Body px 24000 both ways — the control: the wrapper changes nothing inside the box, only what survives outside it |
| 10 | Only IMMEDIATE children of the trial canvas can be drawn — a page element and a *descendant* of a legitimate child are both refused, explicitly | `InvalidStateError: … Only immediate children of the <canvas> element can be passed to DrawElementImage`, 0 non-empty px in both cases |
| 11 | **`@container` resolves against the parked subtree's OWN box; `@media` does not.** A container query is an element question, and the parked canvas is that element's containing block — so a component inside a Surface re-lays-itself-out at the Surface's size, live, reversibly, at every intermediate width. Viewport questions stay page-global. (measured 2026-08-04) | one subtree, `container-type: inline-size`, a `@container (min-width:500px)` rule and a `@media (min-width:500px)` rule. Canvas 400→800→300 CSS px: font-size **10→40→10**, flex-direction **row→column→row**, color 1,1,1→2,2,2→1,1,1. `letter-spacing` from the media rule: **7px at all three widths** — the page is 1280 wide, so it matched once and never re-asked |
| 12 | **A backing-store write clears the canvas, and the refill lands after the frame that asked.** Setting `canvas.width`/`height` zeroes the store (spec), and the compositor's repaint is scheduled, not synchronous — so a source resized on every animation frame is BLANK at every upload. (measured 2026-08-04) | passage flight, sampling the parked canvas at every rAF: coverage **0/576 on 38 of 40 frames**; the 2 exceptions are the 2 frames whose width repeated, and both read 576/576. Holding the store instead (density band, `storeForBox`) → **576/576 on every frame**, 4 backing-store writes over 120 |

| 13 | **The DevTools screencast goes dark for ~250ms after a return handoff** — when the presenting WebGL canvas leaves the composite (opacity 0 or unmount, same either way), `Page.screencastFrame` emission stops for ~250ms while the graphics pipeline runs on: a trace of the same window shows compositor frames submitted and PRESENTED with gaps ≤17ms, forced composites (`Page.captureScreenshot`) show the page's animation advancing smoothly, and rAF + style writes never pause. Constant across headless/headed and CPU throttle 1×/6×; not reproduced by a minimal DOM+WebGL swap page, so the trigger sits somewhere in the full rig (capture sources present) and is not yet isolated. The screen never freezes — the *instrument channel* does. (measured 2026-08-14) | crossing-flash debug runs: screencast inter-frame gap 246–261ms after every `landing→dom` swap, 12 swaps across 5 runs in all configs; trace `PipelineReporter`: 496 present events through the same window, largest gap 17ms; screenshot burst: ink centroid advancing smoothly (~3px/s, no step) through the dark window |

**Item 13 is a fact about the measuring rig, not the screen** — and it
is load-bearing for anyone instrumenting a crossing: a passive
screencast read of the first ~250ms after a return swap measures
nothing, and an instrument that trusts it will report a freeze that is
not there. `crossing-flash` read that window with forced composites
instead — each screenshot is the compositor's own output of the
committed state, clocked by the instrument rather than by damage. In
headed runs the same blindness skewed the cast's timestamps enough that
path-continuity over-read by ~3.5px at forward swaps, so that gate's
contract was the headless run. The gate itself was removed on
2026-08-15 (instruments/README.md); the recipe is the part worth
keeping, and it is this paragraph.

| 14 | **`texElementImage2D` is drawElementImage's contract at the GL entry point, with one relaxation.** The element must be an immediate child of the SAME canvas whose GL context uploads (item 10's rule — a child of a different canvas is refused), the canvas needs `layoutsubtree` (the `layoutSubtree` property reflects it), and the first paint must have completed. But once painted, the call succeeds OUTSIDE `onpaint` — from plain rAF callbacks. Chrome 151's signature is the 3-arg `(target, internalformat, element)`. (measured 2026-09-02, Chrome 151) | before any paint: `InvalidStateError: No cached paint record for element`; other-canvas child and body element: `Only immediate children of the <canvas> element can be passed to texElementImage2D()`; no attribute: `requires the canvas to have the layoutsubtree attribute`; 210 uploads from rAF tasks, zero errors — `docs/spikes/texel-upload.md` |
| 15 | **`texElementImage2D` rasters at the canvas's backing/CSS ratio, per axis — item 8's auto-scale law, owned by the CANVAS.** Every child shares one density; the 3-arg signature has no scale parameter, page dpr is irrelevant, and a CSS `transform: scale(2)` on the element changes nothing. On a visible renderer canvas the ratio is pinned to dpr, so per-Surface density (the LOD ladder) cannot ride this path. (measured 2026-09-02, Chrome 151) | 200×100 child, 400px-CSS canvas: texture exactly [100,50]/[200,100]/[400,200]/[600,300] at backing 0.5×/1×/2×/3×; non-uniform canvas (512×512 backing over 2100×1600 CSS): the two axes raster at their two ratios ([25,26] from 100×80); `scale(2)` → size unchanged |
| 16 | **`texElementImage2D` uploads STRAIGHT alpha by default; `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_FLIP_Y_WEBGL` are honored.** Default orientation puts DOM-top at texture row 0, like every DOM upload. Decisions.md #5's premultiplied invariant survives this path only through the pixel-store flag. (measured 2026-09-02, Chrome 151) | `rgba(255,0,0,0.5)` element reads `[255,0,0,128]` bare, `[128,0,0,128]` with the premultiply flag — byte-identical to the 2D-canvas path's stored bytes; red-top/blue-bottom flips with the flip flag |
| 17 | **`onpaint` delivers a `CanvasPaintEvent` whose `changedElements` is a real Array naming exactly the immediate children whose paint records changed.** A mutated descendant is reported as its top-level child; untouched siblings are absent. A per-child dirty signal on the canvases the kernel already parks — no consumer yet, since each source parks its own canvas. (measured 2026-09-02, Chrome 151) | two children X,Y in one parked canvas; mutate a span inside X → `changedElements.length === 1`, contains X, not Y, not the span |

| 18 | **Canvas children (`layoutsubtree`) are laid out and natively hit-testable, but never painted — and the hit region is CLIPPED to the canvas's CSS box.** Hit-testing follows CSS transforms including a full perspective matrix3d (browser does the w-divide); trusted clicks, focus, caret placement, typing, `:hover`, and drag selection all reach the child through a tilted pose. A child transformed outside its canvas's box stops being hittable there — the element under it wins. Holds at dpr 2, inside a same-origin iframe (the parent document hit-tests to the IFRAME and the browser routes through), and under page scroll: composition is standard CSS — child viewport position = canvas `getBoundingClientRect` origin + transform, for fixed and absolute canvases alike. (measured 2026-09-02, Chrome 151, dpr 1 and 2) | screenshots byte-identical with the child present vs `display:none` (a control div at the same spot changes them); trusted click → child button, `isTrusted: true`; typed into a transformed input, selected exact chars 0–11 by range-rect drag; in-box transform hits, out-of-box returns the page element — `docs/spikes/matrix3d-hit.md`; iframe/dpr/scroll: trusted click + `:hover` + live capture in a lab-shaped offset iframe at dpr 1 and 2; absolute canvas at doc (150,1000) at scrollY 800: predicted child origin [200,230] = measured — the addendum in the same report |
| 19 | **Browser hit-testing of a matrix3d child agrees with GL rasterization of the SAME MVP within ≤1.25px** (median 0.75px, edge scans at 0.25px steps, poses rotY/rotX 30°/12° and 55°/25°), unchanged at dpr 2, and the viewport·P·V·M·pixelToLocal recipe (three.js PR #31233) predicts the browser's own rects to 0.01px. (measured 2026-09-02, Chrome 151, dpr 1 and 2) | 24 edge scans, `elementFromPoint` flip vs `readPixels` flip: max 1.0px / 1.25px per pose; dpr 2 rerun of the steep pose: max 1.0px, median 0.75px; corner prediction vs `getBoundingClientRect`: [90.91,145.45,709.09,454.55] both |
| 20 | **Capture asymmetries of the drawn root:** a TRANSFORM on the root never enters the capture (bytes identical), but each transform RESTYLE on the root costs one paint — a per-frame transform paints every frame, on visible and hidden canvases alike (an earlier same-day run reported this paint-free from a single write; the denser count supersedes it); a STATIC root `opacity:0` is baked into the record — capture reads `[0,0,0,0]`, and stays blank across fresh records after mutations (item 4 covers *compositor-animated* root opacity only); canvas `visibility:hidden` with the child `visibility:visible` keeps paints firing and capture alive; canvas `opacity:0` keeps `onpaint` firing but blanks the capture. Consequence: an invisible hit-hosting canvas is possible via `visibility`, never via `opacity` — and a pose held by restyling the CHILD is a paint per frame (item 21 is the paint-free shape). (measured 2026-09-02, Chrome 151) | matrix3d'd root: capture byte-identical; root transform restyles: 30/30 paints under a canvas cover, 30/30 bare, 10/10 pre-capture, 10/10 post-capture, 10/10 on a visible canvas — `docs/spikes/cover-clip.md`; `opacity:0` root: `[0,0,0,0]` before and after a painted mutation; hidden-canvas rig: mutation paints, capture `[204,0,0,255]`; `opacity:0` canvas: mutation paints, capture `[0,0,0,0]` |
| 21 | **Native hit-testing clips to the canvas's TRANSFORMED box, and transform restyles on the CANVAS are paint-free after the first** — so the pose belongs on the canvas. The rig that follows: canvas CSS box = content box, canvas wears the full pose `matrix3d` from `transform-origin: 0 0`, child stays identity. The transformed box is then exactly the projected quad, so the hit clip is the content and nothing else — no cover geometry, no box growth, no density change (the CSS box never changes size, so item 8's replay ratio is untouched) — and holding or animating a pose costs 0 paints/frame while the capture stays alive underneath. (measured 2026-09-02, Chrome 151) | child quad fully outside the untransformed canvas box: unhittable bare, hittable when the canvas cover moves over it; perspective child under an affine cover agrees with predicted edges to 0.25px; canvas transform restyles: 0/10 translate, 0/30 full-perspective wobble, ~1 on first application; canvas-wears-pose run: centre hit + 0.25px edge agreement + trusted click, mutation under the worn pose captures correctly — `docs/spikes/cover-clip.md` |

**Items 14–15 are why the kernel stays on the 2D-canvas path.** The direct
GL upload (three.js PR #31233's `HTMLTexture` route) was measured no faster
— both paths' main-thread cost is 0.1–0.2ms medians, flat from 640×480 to
2048×1536, so the copy it removes is a GPU-side blit — and adopting it
would parent every source to the one visible renderer canvas at one shared
dpr-pinned density. The parked 2D canvas is where per-Surface density,
paint receipts, and paint stats live; it is not overhead. Numbers and
apparatus: `docs/spikes/texel-upload.md`. Item 14's relaxation also casts
doubt on the "drawElementImage only succeeds inside onpaint" note in
`htmlInCanvas.ts` (recorded against Chrome 150) — unverified for
drawElementImage itself in 151.

**Items 18–21 are the native pointer route** (decisions.md #39): for
PLANAR poses, the parked canvas — `visibility:hidden`, lifted above the
renderer canvas, wearing the presenter's full matrix3d per item 21 —
hears trusted input natively on exactly the projected quad: hover,
focus, caret, selection, while its capture runs untouched and its
`:hover` self-paint draws the hover twin into the texture with no relay
code. Measured end-to-end in `docs/spikes/matrix3d-hit.md` and
`docs/spikes/cover-clip.md`. The remaining boundary is planarity:
deformed poses — fisheye, slider, crystal — stay on the relay, which
also remains the no-capability fallback. The three environment kills
were probed and cleared the same day (the matrix3d report's addendum):
the lab's iframe shell, dpr 2, and scrolled/offset canvases all behave;
only OS-level input needs iframe-offset coords — the kernel's own math
stays in its frame's space. `pointer/pointerRoute.ts` owns the
arbitration between the two routes.

**Item 11 defines the responsive seam.** Use container queries for layout
that must respond to a Surface's own width. Viewport units and media queries
still answer for the page viewport; they do not make each parked source a
separate viewport. Item 3 records captured DOM mutation, not a list of failed
viewport features. The earlier cross-reference to item 3 was incorrect.

The consequence worth naming: a Surface's `width`/`height` are not just
texture dimensions, they are a LAYOUT INPUT. Sweeping them re-runs the
real layout engine at every step (item 2 — a size change re-lays-out in
place, one paint each), which is what lets a component be transitioned
by *resizing* it rather than by interpolating two pictures of it.

**Item 12 is the price of item 11**, and the two have to be read
together: the layout input is free to move every frame, but the canvas
holding the answer cannot be re-cut every frame without going dark. The
resolution is that a store does not have to match its box — see
`storeForBox` and decisions.md #15 — because item 8 says the replay
scales to whatever store it finds. The general lesson is worth keeping
separate from the fix: the clear is synchronous and the refill is not,
so ANY per-frame write to `canvas.width` is a per-frame blank, however
the pixels are consumed.

**Item 5 is half re-runnable.** The idle half is a committed instrument
and a CI gate. The throughput half is not: the harness that produced
those frame times mounted N synthetic sources under a query parameter,
and it was never committed as code — the numbers stand as a record of
what was measured, not as something this tree can reproduce. Treat the
~96 ceiling as a budget inherited from a previous measurement until a
throughput instrument joins `instruments/`. That directory's charter is
exactly this: a capture recipe that lives as prose has to be re-derived
by whoever needs it next.

**A focused field is never idle-zero.** Caret blink self-paints its
source about twice a second. This is correct behavior, not a leak —
but it means the idle-zero gate's probe pages must not hold focus
inside a source.

**Items 9 and 10 constrain source placement and capture bounds.** The drawn
root must be an immediate canvas child. This does not require a clone:
the current API can also adopt an existing element. The source owner must
respect that ownership contract. To capture ink outside the content box,
wrap the source in padding and draw that larger root.
Item 9 also retro-explains `chrome/surfaceChrome.ts`, which
reconstructs a Surface's shadow analytically from `parseBoxShadow`
rather than capturing it. That was not a stylistic preference — a
Surface draws its content root, so its own shadow is cut at the border
box and there is nothing to capture. The two answers are for different
jobs and should not be merged: analytic chrome for a live Surface,
a padded-wrapper capture when the shadow is itself the subject.

Item 4 is the one that has cost the most: it is invisible in review
(clean paints, no error) and self-heals on the next unrelated repaint,
so a transition on a content root leaves a *stale* end state that
looks intermittent. Animate descendants, or move the mesh.
