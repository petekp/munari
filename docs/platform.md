# The platform, as measured

Anamorph rests on Chrome's HTML-in-canvas APIs (`drawElementImage`,
`texElementImage2D`), which are an origin trial — moving ground. Every
claim below is something the library depends on, stated as what the
platform does, with the measurement that established it. Re-run these
when Chrome moves; a surprise here invalidates a kernel layer, not
just a test.

Last measured **2026-08-02** against **Chrome 150.0.7871.187**, macOS,
120Hz, dpr 1, launched with `--enable-features=CanvasDrawElement`.
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
| 5 | Idle sources are free, and ~96 concurrently painting sources hold 120Hz | `?probe=128` idle: 119.995fps at 0/0/0 paints/s; `?probe=96&live=1`: 93.4fps, min==mean==max frame time (no starvation), p95 17.1ms |
| 6 | Rescaling commits one paint per LOD tier boundary crossed, and a focused field keeps caret and value across its own source's swap | workspace scene `approach('email')`: source 0.5→1.5, 8/11 moved sources paint exactly 1 (2-paint entries crossed two boundaries); glyphs visibly sharpen; focused textarea holds caret `[7,7]` + value |
| 7 | Replay is position-aware: a capture at scale k lands at k× position and k× size under an identity CTM | standalone source, 6px dot at CSS (20,30): k=0.5 → centroid (11.5,16.5) size 3; k=3 → centroid (69,99) size 18 |

**A focused field is never idle-zero.** Caret blink self-paints its
source about twice a second. This is correct behavior, not a leak —
but it means the idle-zero gate's probe pages must not hold focus
inside a source.

Item 4 is the one that has cost the most: it is invisible in review
(clean paints, no error) and self-heals on the next unrelated repaint,
so a transition on a content root leaves a *stale* end state that
looks intermittent. Animate descendants, or move the mesh.
