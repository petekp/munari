# Platform re-audit — smoke pass verdicts, 2026-08-02

Phase 2 gate artifact. Checklist:
`three-ui/docs/seed/platform-reaudit.md` at `362c5a1`. Probes ran
against the frozen oracle's lab pages (dev server, lab 006 + probe
harness), **Chrome 150.0.7871.187**, macOS, 120Hz, **dpr 1** (baseline
claims were captured at dpr 2 — none of the smoke items are
dpr-sensitive; every probe pins its own scale), launched with
`--enable-features=CanvasDrawElement`, capability chips verified before
every run.

**Result: 7/7 confirmed, zero claims flipped.** Per protocol ("on any
surprise, run the full section it belongs to") no full sections were
triggered. The kernel inherits the archive's platform claims as still
true on current Chrome.

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Capability chips | CONFIRMED | `drawElementImage ✓` / `texElementImage2D ✓` on load |
| 2 | Self-paint | CONFIRMED | one DOM mutation → `selfPaintsOnRed: 1`, `requestPaintCalls: 0` |
| 3 | Resolve | CONFIRMED | red → blue mutation: buffer reads `[255,0,0,255]` then `[0,0,255,255]`, exactly one self-paint each |
| 4 | Root-vs-descendant hinge | CONFIRMED both directions | root opacity keyframes: `paintDelta 1, distinctColors 1` (frozen); descendant: `paintDelta 133`, 9 distinct colors, landmark ramp 232→206→179→154 |
| 5 | Scale | CONFIRMED | `?probe=128` idle: 119.995fps at 0/0/0 paints/s; `?probe=96&live=1`: 93.4fps, min==mean==max frame time (no starvation), p95 17.1ms |
| 6 | Rescale (tier commit + caret) | CONFIRMED | lab 006 `approach('email')`: source 0.5→1.5, one paint per tier boundary crossed (8/11 moved sources exactly 1; 2-paint entries crossed two boundaries; the focused panel's extra paints are caret-blink self-paints), glyphs visibly sharpen, focused textarea holds caret `[7,7]` + value through its own source's swap |
| 7 | Replay scale (position-aware) | CONFIRMED | standalone source, 6px dot at CSS (20,30): k=0.5 → centroid (11.5,16.5) size 3; k=3 → centroid (69,99) size 18 — exactly k× position, k× size under identity CTM |

Incidental (not a claim change): a focused field's caret blink
self-paints its source ~2/s — a focused Surface is never idle-zero.
Known in the archive; re-observed here; the idle-zero CI gate's probe
pages must not hold focus in a source.
