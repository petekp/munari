# The platform, as measured: HTML-in-canvas capture

This file holds what Chrome's `drawElementImage` capture path does: the capability APIs and opt-in, self-paints, what a capture keeps and clips, and the backing store. It is part of [the platform measurements](../platform.md), which lists every item and the table conventions.

Baseline measurements **2026-08-04** against **Chrome 150** (items 11–12; item
9–10 on 2026-08-03; items 1–8 on **150.0.7871.187**), macOS, 120Hz,
dpr 1, launched with
`--enable-features=CanvasDrawElement`.
None of these items are dpr-sensitive — every probe pins its own
scale — but capability chips (`drawElementImage ✓`) must be verified on load before trusting any
run: a relaunch without the flag fails silently into a different set
of answers.

| # | What the platform does | Evidence |
|---|------|---------|
| <a id="item-1"></a>1 | The capability APIs are present under the flag. Chrome 158 has `texElementSubImage2D`, not `texElementImage2D`; 152–157 unchecked. | Chrome 150: `drawElementImage ✓` / `texElementImage2D ✓`. 158.0.8127.36 (2026-11-23): `drawElementImage`, 5-argument `texElementSubImage2D` |
| <a id="item-2"></a>2 | The compositor self-paints on DOM mutation — no repaint request is needed | one DOM mutation → `selfPaintsOnRed: 1`, `requestPaintCalls: 0` |
| <a id="item-3"></a>3 | A mutation resolves into the captured buffer, one self-paint each | red → blue mutation: buffer reads `[255,0,0,255]` then `[0,0,255,255]` |
| <a id="item-4"></a>4 | **Compositor-animated root opacity can leave a stale capture.** The root keyframes in this experiment did not produce updated captured pixels; descendant animation did. Do not generalize this to static opacity or transform restyles: item 20 records those separately. | root opacity keyframes: `paintDelta 1`, `distinctColors 1` (frozen); descendant: `paintDelta 133`, 9 distinct colors, landmark ramp 232→206→179→154 |
| <a id="item-5"></a>5 | Idle sources are free; the recorded throughput includes 96 concurrently painting sources | idle half: `instruments/idle-zero` (CI gate). Throughput half — 128 idle sources at 119.995fps / 0 paints/s, 96 live at 93.4fps with min==mean==max frame time and p95 17.1ms — was measured on a load harness that has **not** been migrated; see below |
| <a id="item-6"></a>6 | Rescaling commits one paint per LOD tier boundary crossed, and a focused field keeps caret and value across its own source's swap | workspace scene `approach('email')`: source 0.5→1.5, 8/11 moved sources paint exactly 1 (2-paint entries crossed two boundaries); glyphs visibly sharpen; focused textarea holds caret `[7,7]` + value |
| <a id="item-7"></a>7 | **A `mask-image` on ANY descendant of a drawn element blacks out the whole capture** — solid black except independently composited descendants, with clean paints and no error. Even a mask computed to a fully opaque no-op gradient. (measured 2026-08-01) | panel wearing a `scroll-fade-*` utility: capture all black, `paintDelta` normal, no console error; removing the mask restores it |
| <a id="item-8"></a>8 | Replay is position-aware: a capture at scale k lands at k× position and k× size under an identity CTM | standalone source, 6px dot at CSS (20,30): k=0.5 → centroid (11.5,16.5) size 3; k=3 → centroid (69,99) size 18 |
| <a id="item-9"></a>9 | **The capture is clipped to the DRAWN element's border box** — ink outside it (shadow, outline, escaping absolute child, `filter: drop-shadow` spread) is in the paint record and cut. Drawing a padded *wrapper* recovers it, because the clip follows whichever element was passed. (measured 2026-08-03, headless and headed identical) | 200×120 div, `box-shadow: 0 60px 0 0 red`: drawn bare → **0** red px; the same div inside `padding: 100px`, drawing the wrapper → **12000** red px (= 200×60 exactly) at x 100–299, y 220–279. Body px 24000 both ways — the control: the wrapper changes nothing inside the box, only what survives outside it |
| <a id="item-10"></a>10 | Only IMMEDIATE children of the trial canvas can be drawn — a page element and a *descendant* of a legitimate child are both refused, explicitly | `InvalidStateError: … Only immediate children of the <canvas> element can be passed to DrawElementImage`, 0 non-empty px in both cases |
| <a id="item-11"></a>11 | **`@container` resolves against the parked subtree's OWN box; `@media` does not.** A container query is an element question, and the parked canvas is that element's containing block — so a component inside a Surface re-lays-itself-out at the Surface's size, live, reversibly, at every intermediate width. Viewport questions stay page-global. (measured 2026-08-04) | one subtree, `container-type: inline-size`, a `@container (min-width:500px)` rule and a `@media (min-width:500px)` rule. Canvas 400→800→300 CSS px: font-size **10→40→10**, flex-direction **row→column→row**, color 1,1,1→2,2,2→1,1,1. `letter-spacing` from the media rule: **7px at all three widths** — the page is 1280 wide, so it matched once and never re-asked |
| <a id="item-12"></a>12 | **A backing-store write clears the canvas, and the refill lands after the frame that asked.** Setting `canvas.width`/`height` zeroes the store (spec), and the compositor's repaint is scheduled, not synchronous — so a source resized on every animation frame is BLANK at every upload. (measured 2026-08-04) | passage flight, sampling the parked canvas at every rAF: coverage **0/576 on 38 of 40 frames**; the 2 exceptions are the 2 frames whose width repeated, and both read 576/576. Holding the store instead (density band, `storeForBox`) → **576/576 on every frame**, 4 backing-store writes over 120 |
| <a id="item-17"></a>17 | **`onpaint` delivers a `CanvasPaintEvent` whose `changedElements` is a real Array naming exactly the immediate children whose paint records changed.** A mutated descendant is reported as its top-level child; untouched siblings are absent. A per-child dirty signal on the canvases the kernel already parks — no consumer yet, since each source parks its own canvas. (measured 2026-09-02, Chrome 151) | two children X,Y in one parked canvas; mutate a span inside X → `changedElements.length === 1`, contains X, not Y, not the span |
| <a id="item-32"></a>32 | **Native capture requires the canvas opt-in and a drawable source root.** The adapter sets `content="drawable"` and legacy `layoutSubtree`. It marks only the source root: nested `drawable` roots paint independently and are excluded from their parent. It preserves authored markers and removes its own marker on disposal. Chrome 156 renamed the canvas opt-in; Chrome 157 changed the draw return value to `undefined`, which the adapter ignores. These requirements follow [Chrome’s API migration guide](https://developer.chrome.com/blog/html-in-canvas-ot-changes) and the measurements here. | On 2026-09-30, flagged Chrome 154.0.8037.92 and CfT 155.0.8059.12, 156.0.8078.5 and 157.0.8080.0 drew a red child using `layoutSubtree`; only 156–157 accepted `content="drawable"` alone. On 2026-11-13, Chrome 157.0.8103.52 rejected an unmarked source root with `Descendants passed to DrawElementImage must have the drawable attribute`. After marking the root, `STRICT_CAPABILITY=1 npm run gate:capture-engines` passes native and snapDOM pixel checks and deliberate raster faults. `gate:lifting-pointer` also passes. |
| <a id="item-37"></a>37 | **Chrome 157 exposes `drawElementImage` with no flag.** With no `--enable-features` and no origin trial token, a `content="drawable"` canvas draws its `drawable` child. The canvas's `layoutSubtree` property is absent, and the attribute form works (item 32). One page load on one build: later releases, headed windows and other platforms are not measured, and `texElementImage2D` was not tried. (measured 2026-11-23, Google Chrome 157.0.8103.80, macOS, headless, fresh profile) | A `<canvas layoutsubtree content="drawable">` holding a 100×50 red `div` with the `drawable` attribute. `'drawElementImage' in CanvasRenderingContext2D.prototype` is `true`. After the first paint, `drawElementImage(div, 0, 0)` leaves `[255, 0, 0, 255]` at pixel (10, 10). `'layoutSubtree' in HTMLCanvasElement.prototype` is `false`. The page was a disposable script; [the spike note](../spikes/chrome-157-no-flag.md) is the record |

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
