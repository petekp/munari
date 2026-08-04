# The platform, as measured

Anamorph rests on Chrome's HTML-in-canvas APIs (`drawElementImage`,
`texElementImage2D`), which are an origin trial — moving ground. Every
claim below is something the library depends on, stated as what the
platform does, with the measurement that established it. Re-run these
when Chrome moves; a surprise here invalidates a kernel layer, not
just a test.

Last measured **2026-08-04** against **Chrome 150** (items 11–12; item
9–10 on 2026-08-03; items 1–8 on **150.0.7871.187**), macOS, 120Hz,
dpr 1, launched with
`--enable-features=CanvasDrawElement`.
None of these items are dpr-sensitive — every probe pins its own
scale — but capability chips (`drawElementImage ✓` /
`texElementImage2D ✓`) must be verified on load before trusting any
run: a relaunch without the flag fails silently into a different set
of answers.

| # | What the platform does | Evidence |
|---|------|---------|
| 1 | The capability APIs are present under the flag | `drawElementImage ✓` / `texElementImage2D ✓` on load |
| 2 | The compositor self-paints on DOM mutation — no repaint request is needed | one DOM mutation → `selfPaintsOnRed: 1`, `requestPaintCalls: 0` |
| 3 | A mutation resolves into the captured buffer, one self-paint each | red → blue mutation: buffer reads `[255,0,0,255]` then `[0,0,255,255]` |
| 4 | **The root-vs-descendant hinge.** Animating the drawn element's OWN opacity/transform does not invalidate its paint record, so nothing repaints. On descendants both animate correctly, at one paint + one upload per frame. | root opacity keyframes: `paintDelta 1`, `distinctColors 1` (frozen); descendant: `paintDelta 133`, 9 distinct colors, landmark ramp 232→206→179→154 |
| 5 | Idle sources are free, and ~96 concurrently painting sources hold 120Hz | idle half: `instruments/idle-zero` (CI gate). Throughput half — 128 idle sources at 119.995fps / 0 paints/s, 96 live at 93.4fps with min==mean==max frame time and p95 17.1ms — was measured on a load harness that has **not** been migrated; see below |
| 6 | Rescaling commits one paint per LOD tier boundary crossed, and a focused field keeps caret and value across its own source's swap | workspace scene `approach('email')`: source 0.5→1.5, 8/11 moved sources paint exactly 1 (2-paint entries crossed two boundaries); glyphs visibly sharpen; focused textarea holds caret `[7,7]` + value |
| 7 | **A `mask-image` on ANY descendant of a drawn element blacks out the whole capture** — solid black except independently composited descendants, with clean paints and no error. Even a mask computed to a fully opaque no-op gradient. (measured 2026-08-01) | panel wearing a `scroll-fade-*` utility: capture all black, `paintDelta` normal, no console error; removing the mask restores it |
| 8 | Replay is position-aware: a capture at scale k lands at k× position and k× size under an identity CTM | standalone source, 6px dot at CSS (20,30): k=0.5 → centroid (11.5,16.5) size 3; k=3 → centroid (69,99) size 18 |
| 9 | **The capture is clipped to the DRAWN element's border box** — ink outside it (shadow, outline, escaping absolute child, `filter: drop-shadow` spread) is in the paint record and cut. Drawing a padded *wrapper* recovers it, because the clip follows whichever element was passed. (measured 2026-08-03, headless and headed identical) | 200×120 div, `box-shadow: 0 60px 0 0 red`: drawn bare → **0** red px; the same div inside `padding: 100px`, drawing the wrapper → **12000** red px (= 200×60 exactly) at x 100–299, y 220–279. Body px 24000 both ways — the control: the wrapper changes nothing inside the box, only what survives outside it |
| 10 | Only IMMEDIATE children of the trial canvas can be drawn — a page element and a *descendant* of a legitimate child are both refused, explicitly | `InvalidStateError: … Only immediate children of the <canvas> element can be passed to DrawElementImage`, 0 non-empty px in both cases |
| 11 | **`@container` resolves against the parked subtree's OWN box; `@media` does not.** A container query is an element question, and the parked canvas is that element's containing block — so a component inside a Surface re-lays-itself-out at the Surface's size, live, reversibly, at every intermediate width. Viewport questions stay page-global (item 3). (measured 2026-08-04) | one subtree, `container-type: inline-size`, a `@container (min-width:500px)` rule and a `@media (min-width:500px)` rule. Canvas 400→800→300 CSS px: font-size **10→40→10**, flex-direction **row→column→row**, color 1,1,1→2,2,2→1,1,1. `letter-spacing` from the media rule: **7px at all three widths** — the page is 1280 wide, so it matched once and never re-asked |
| 12 | **A backing-store write clears the canvas, and the refill lands after the frame that asked.** Setting `canvas.width`/`height` zeroes the store (spec), and the compositor's repaint is scheduled, not synchronous — so a source resized on every animation frame is BLANK at every upload. (measured 2026-08-04) | passage flight, sampling the parked canvas at every rAF: coverage **0/576 on 38 of 40 frames**; the 2 exceptions are the 2 frames whose width repeated, and both read 576/576. Holding the store instead (density band, `storeForBox`) → **576/576 on every frame**, 4 backing-store writes over 120 |

**Item 11 is the responsive seam, and it is the useful half of item 3.**
Item 3 is a list of things that do NOT work in a parked canvas (`vw`,
`vh`, `@media`, `matchMedia`, `innerWidth`), and read alone it says a
Surface cannot host a responsive component. It can — just not through
the viewport. Every one of those is a question about the VIEWPORT, and
a parked canvas is deliberately not one; a container query is a question
about an ELEMENT, and the canvas is emphatically that. So the modern
authoring style is the one that works here, and the split is principled
rather than a quirk: viewport questions are page-global because there is
one page, element questions are local because there are many elements.

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

**Items 9 and 10 are the two halves of one shape.** Because only an
immediate canvas child can be drawn, everything captured is necessarily
a clone in its own parked canvas — which is why "we never touch the
live page" is free rather than defended. And because the clip follows
the *drawn* element, the way to capture ink that lives outside a box is
to hand over a bigger box: wrap the clone in padding and draw the
wrapper. Item 9 also retro-explains `chrome/surfaceChrome.ts`, which
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
