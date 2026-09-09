# Spike: texElementImage2D vs the 2D-canvas upload path

Measured 2026-09-02, Chrome 151 (headless, real GPU: ANGLE Metal, Apple
M4 Max) with `--enable-features=CanvasDrawElement`, via a disposable page +
puppeteer runner in `spikes/texel-upload/`. The apparatus is deleted; this
report is the artifact. Prompted by three.js PR #31233 (`HTMLTexture` +
`InteractionManager`), which uploads elements to GL textures through
`texElementImage2D` directly — no 2D canvas in the middle — and which
munari's kernel detects (`detectHtmlInCanvas().texElementImage2D`) but has
never used.

**Questions asked:**

1. Does `texElementImage2D` work here, and under what contract — which
   canvas must parent the element, is `layoutsubtree` required, when may
   the call happen, which signature does this Chrome have?
2. Is the direct upload measurably cheaper than munari's
   drawElementImage → parked 2D canvas → `texImage2D` path at real
   Surface sizes (640×480 to 2048×1536)?
3. Does it deliver premultiplied alpha (decisions.md #5 requires it
   library-wide)?
4. What fixes the texture's raster density, and can a consumer ask for
   more? (kill criterion — no per-Surface density means no LOD ladder)
5. Does `onpaint`'s event carry `changedElements`, and does it correctly
   name which child changed? (three.js's code relies on it)

**Verdict: not viable as a replacement — keep the 2D-canvas path.** The
call is not faster where it counts, its density is a property of the
canvas rather than the element (which kills the per-Surface LOD ladder,
question 4's kill criterion), and it forces every source to be an
immediate child of the one visible renderer canvas. The spike still paid:
three platform facts worth keeping came out of it (platform.md #14–#17).

## What we learned

**1. The contract is drawElementImage's contract, at the GL entry point.**
The element must be an immediate child of the same canvas whose GL context
uploads — a child of a *different* canvas and a body element are both
refused with `InvalidStateError: Only immediate children of the <canvas>
element can be passed to texElementImage2D()`. The canvas needs
`layoutsubtree` (explicit error without it; the `canvas.layoutSubtree`
property works too — it reflects the attribute). Before the first paint
completes the call throws `No cached paint record for element`. After one
paint it succeeds *outside* `onpaint`: 210 uploads from plain
`requestAnimationFrame` callbacks, zero errors. Chrome 151's signature is
the 3-arg `(target, internalformat, element)` (three.js also handles a
6-arg form for Chrome 138–149 — below munari's floor, irrelevant here).

**2. No speed win. Both paths are sub-millisecond and size-independent on
the CPU.** Per-paint main-thread cost, medians over 60 samples, dpr 1
and 2 alike:

| CSS size | drawElementImage | texImage2D(canvas, premult) | A total | texElementImage2D |
|---|---|---|---|---|
| 640×480 | 0.0ms (p90 0.1) | 0.1–0.2ms (p90 0.3) | ≤0.2ms | 0.2ms (p90 0.3–0.4) |
| 1024×768 | 0.0ms | 0.1ms | 0.1ms | 0.1–0.2ms |
| 2048×1536 | 0.0ms | 0.1–0.2ms | ≤0.2ms | 0.2ms (p90 0.3–0.5) |

`gl.finish()`-bounded samples read 0.0–0.5ms, so the GPU-side tail is
bounded too. Path A's flat medians from 640×480 to 2048×1536 say the CPU
cost never scales with texels — the copy the direct path would remove is a
GPU-side blit between two GPU-resident images, not main-thread work. One
honesty note: the shared test canvas's backing/CSS ratio scaled path B's
textures well below path A's stores (its "640×480" texture was actually
157×154), so path B uploaded far fewer texels — and still measured equal
or slightly slower. The medians sit near the 0.1ms timer floor; the
finding is "neither path is a bottleneck," not a precise ratio.

**3. Alpha: straight by default, and the pixel-store flags are honored.**
A `rgba(255,0,0,0.5)` element reads back `[255,0,0,128]` — un-premultiplied,
the opposite of decisions.md #5's library-wide invariant. Setting
`UNPACK_PREMULTIPLY_ALPHA_WEBGL` first reads `[128,0,0,128]`, byte-identical
to what the 2D-canvas path stores. `UNPACK_FLIP_Y_WEBGL` is honored too;
by default DOM-top lands at texture row 0, like every other DOM upload.
So #5 would survive on this path — but only via the flag, and three.js's
`HTMLTexture` path does not set it.

**4. Density is the canvas's, not the element's — the kill.** The texture
rasters at exactly `element CSS size × (canvas backing / canvas CSS)`,
per axis: a 200×100 child of a 400px-CSS canvas read [100,50] / [200,100] /
[400,200] / [600,300] at backing = 0.5×/1×/2×/3×, and a non-uniform canvas
(512×512 backing over 2100×1600 CSS) read the two axes at their two
ratios. That is item 8's auto-scale law surfacing at the GL entry point.
Page DPR is irrelevant; `transform: scale(2)` on the element changes
nothing; the 3-arg signature has no scale parameter. Since every source
would have to be a child of the one visible renderer canvas (finding 1),
and that canvas's backing/CSS ratio is pinned to DPR, every Surface would
share one fixed density — no `setScale`, no LOD tiers, no `resettle`.

**5. `changedElements` is real and precise.** `onpaint` delivers a
`CanvasPaintEvent` whose `changedElements` is a true Array of the
immediate children whose paint records changed: mutating a span inside
child X yielded exactly `[X]` — the top-level child, not the span, and
not the untouched sibling Y. three.js's `.includes` usage is valid. This
works on the parked 2D canvases munari already owns; nothing needs the GL
path to use it.

## What surprised us

- The upload working *outside* `onpaint` (finding 1). The kernel's
  platform preamble (`htmlInCanvas.ts`, measured against Chrome 150)
  records drawElementImage as succeeding only inside the callback.
  Whether drawElementImage's rule has also relaxed in 151 was not
  measured — the preamble's caveat ("dated empiricism on a moving origin
  trial") is earning its keep.
- Headless Chrome 151 has the trial surface with a real GPU (ANGLE
  Metal); no headed fallback was needed.
- The density law reproducing per-axis, non-uniformly, from the canvas's
  two backing/CSS ratios — it made three unrelated "wrong-sized" textures
  in early runs decode into one rule.

## Still unknown

- **Native matrix3d hit-testing** (the other half of PR #31233's
  `InteractionManager`): whether canvas children receive native pointer
  events when CSS-`matrix3d`-transformed over a mesh, and how focus,
  hover, and caret behave there. Untested here. Two prior constraints
  bound its value before any spike: the element would have to be a child
  of the visible renderer canvas (finding 1), and a matrix3d is a planar
  homography — it cannot express the deformed poses the relay already
  routes correctly (fisheye, slider, crystal gates). At most it could
  serve flat surfaces. *(Since measured — `matrix3d-hit.md`, same day: it
  works, on the parked source element itself; the same-canvas guess above
  was wrong for hit-testing, which only requires the child's own canvas
  box to cover the point.)*
- Whether drawElementImage's inside-`onpaint`-only rule has relaxed like
  texElementImage2D's (cheap re-probe; changes a comment, not the design —
  upload-on-paint stays the economy either way).
- Per-frame GPU time was not compared (no timer-query on Metal ANGLE);
  the `finish()`-bounded samples (≤0.5ms) cap what it could reveal.

## Recommended approach

- Keep the drawElementImage → parked 2D canvas → premultiplied
  `texImage2D` path exactly as is. The parked canvas is not overhead to
  eliminate; it is where per-Surface density, paint receipts, and paint
  stats live, and removing it buys no measured time.
- `changedElements` has no consumer today — each part parks its own
  canvas, so "which child changed" is always "the only child." It becomes
  valuable only if sources ever consolidate into shared parked canvases;
  record it, don't build on it yet.
- If a Surface flat-plane pointer path ever wants native focus/caret
  instead of the relay, spike matrix3d hit-testing separately, with the
  two constraints above stated up front.

## Cost signals

None — the recommendation is to change nothing in the kernel. The durable
output is platform.md #14–#17 and this report.
