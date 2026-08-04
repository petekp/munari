# Spike: exploded paint (the inspector lab's kill-switch)

Run 2026-08-03, Chrome 150 + `--enable-features=CanvasDrawElement`,
headless, dpr 1. Apparatus was a standalone page + puppeteer-core
(launch recipe lifted from `instruments/idle-zero/run.mjs`); it has
been deleted. Nothing in this doc was measured by reasoning.

**Questions asked**

1. Must the element handed to `drawElementImage` be a child of the trial
   canvas — i.e. can we capture live-page elements, or must we clone?
2. Does `box-shadow` reach the capture, and does ink outside the layout
   box survive?
3. Can ONE element decompose into four clean plates (shadow /
   background / border / text) via geometry-preserving neutralizing CSS?
4. Do the plates register, and does recompositing them reproduce the
   undecomposed capture?

**Verdict: viable.** All four differentiators survive, but only through
one non-obvious trick — every capture must be of a *padded wrapper*, not
of the element itself.

## What we learned

### 1. Only immediate children. No live-page capture, no sub-element capture.

```
InvalidStateError: Failed to execute 'drawElementImage' on
'CanvasRenderingContext2D': Only immediate children of the <canvas>
element can be passed to DrawElementImage.
```

Same error for a page element that was never reparented, AND for a
*descendant* of a legitimate canvas child. Both drew 0 non-empty pixels.

Two consequences, both structural:

- Every plate is a **clone in its own parked canvas**. This is not a
  workaround — it's why the "without mutating the live page" property is
  free. The original is never touched, never restyled, never relaid out.
- Exploding a subtree of N elements costs **N canvases**, one per plate.
  Same shape as N Surfaces, so the paint economy is the one already
  measured (idle sources free, ~64–96 concurrently painting).

### 2. The capture is clipped to the element's border box — defeated by a padded wrapper.

Baseline: a 200×120 div with `box-shadow: 0 60px 0 0 red`, drawn
directly. Red pixels in the capture: **0**. The shadow is in the paint
record but cut at the layout box. (This is why `chrome/surfaceChrome.ts`
reconstructs shadows analytically from `parseBoxShadow` — archive #55.)

Same element inside `padding: 100px`, drawing the **wrapper**:

| | red (shadow) px | bbox |
|---|---|---|
| bare element | 0 | — |
| padded wrapper | **12000** | x 100–299, y 220–279 |

12000 = exactly 200×60, the shadow band below the opaque body, landing
exactly 60px offset from the body's box. The clip is on the *drawn*
element's box, so giving the drawn element a bigger box is the whole
fix. The shadow plate is a real capture, not a reconstruction.

### 3. Decomposition is clean. Zero cross-contamination.

Neutralization is geometry-preserving by construction — `border-color:
transparent` not `border: none`, `color: transparent` not `display:
none`, `background: transparent` (which zeroes color AND image). Layout
never moves, so the plates cannot drift.

One card, four captures, opaque-pixel tallies:

| plate | red | green | blue | yellow |
|---|---|---|---|---|
| shadow | **88** | 0 | 0 | 0 |
| background | 0 | 0 | **23708** | 0 |
| border | 0 | **4636** | 0 | 0 |
| text | 0 | 0 | 0 | **588** |
| (undecomposed) | 92 | 4644 | 18236 | 614 |

Every plate carries its own feature and nothing else. Note the blue:
23708 in the background plate vs 18236 in the composite — the plate
holds the *full* background including the region the border and text
paint over. That's the point: each plate is complete, not a leftover.

The shadow plate's 88 red px are the rounded-corner notches where the
shadow shows inside the bounding rect but outside the radius curve —
correct per spec, and it's the bare-element run, so it also confirms the
clip independently.

### 4. Registration is pixel-exact; the only disagreement is corner AA.

Recompositing the four plates in paint order (shadow → background →
border → text) against the undecomposed capture, over 120 000 px:

- pixels differing by > 2: **107** (0.09 %)
- by > 16: 94 · by > 64: 53 · max channel delta: 123

All 107 sit on the `border-radius` arcs. Worst pixel: recomposite
`(0,132,123,α29)` vs full `(0,255,0,α15)` — two plates each carrying
partial coverage of the same curve and double-blending. It is an
artifact of *recompositing*, which the real feature never does (plates
live at different depths). Registration itself is exact.

## What surprised us

- **The border-box clip.** Assumed the capture was "the element and its
  ink". It is the element's box, hard. This also means an
  absolutely-positioned child escaping its parent, an `outline`, a
  `filter: drop-shadow` spread — all get cut unless the drawn element is
  a padded wrapper. Worth promoting to `docs/platform.md`; it is a
  general fact about the paint path, not a spike detail.
- **Descendants ignore root neutralization.** Setting `color:
  transparent` on the root leaked ~10 magenta px into *every* plate from
  a `<span>` carrying its own `color`. Fix measured working: inject a
  scoped `#root *, #root { color: transparent !important }` stylesheet
  into the clone → magenta pixels **0**. Neutralization must be a
  cascade-wide rule, never an inline root style.
- **Counterfactual unclip works, and it needs the wrapper too.** A
  200×120 `overflow: hidden` box holding 340×300 of content captured
  24 000 content px (clipped). The same clone flipped to `overflow:
  visible` inside a padded wrapper captured **66 000** — the content
  spilling out to the canvas bound. The "here's what the clip is hiding"
  plate is real.

## Follow-up probes (2026-08-03, run headless AND headed)

Three items the adversarial review flagged as asserted-not-measured.
**Every number below is identical headless and headed** — the same page
run in two separate browser processes, both with the capability chip
verified true.

### A. Corner texels: the premise is architecture-dependent, not wrong

`chrome/surfaceChrome.ts` argues the texture cannot say where the
element ends, because corner texels carry the app background (its
recorded measurement: `255,255,255,255` under a 14px-radius card). A
200×120 card, radius 24, inside a 240×160 container:

| drawn element | texel at the card's bbox corner |
|---|---|
| container with opaque background (today's structure) | **255,255,255,255** — reproduces the archive claim exactly |
| container with `background: transparent` | **0,0,0,0** |

So premise 2 is **true for how Surfaces are actually built** — a content
root carrying `var(--background)` — and false only under the transparent
padded wrapper. Since the wrapper structure costs 2.2×+ texels and puts
capturable ink into the `hitTest="content"` alpha, the honest conclusion
is that `surfaceChrome` is *more* defensible than either the original
claim (premise dead) or its retraction (unmeasured) had it.

The alpha ramp across the corner, walked one backing texel at a time:

| backing scale | partial-alpha texels | edge width in CSS px |
|---|---|---|
| 1.0 | 0 (hard 0→255 transition) | ≤ 1 |
| 0.35 | 1 (α = 142) | **2.86** |

The AA edge is ~1 texel at any scale, which is 1/scale CSS px. The
analytic SDF is crisp by construction at every tier, so it wins — but
note the honest size of the win: while the tier ladder tracks screen
density, one texel ≈ one screen pixel and alpha's softness is invisible.
It bites where tier < screen density — tier transitions, pinned-low, the
#52/#53 failure mode. The SDF's other advantage is unconditional: the
raycast filters through it, and alpha cannot do that without a readback.

### B. Four properties paint through `color: transparent`

| property under test | ink px leaked | after neutralization |
|---|---|---|
| `text-shadow: 0 0 0` | 2068 (1598 pure) | **0** |
| `text-shadow: 0 3px 6px` | 4836 | **0** |
| `text-decoration-color` | 512 | **0** |
| `-webkit-text-stroke` | 2019 | **0** |
| *control* (transparent text, no extra ink) | **0** | — |

One descendant-wide rule kills all four:

```css
#root, #root * {
  color: transparent !important;
  text-shadow: none !important;
  text-decoration-color: transparent !important;
  -webkit-text-stroke-color: transparent !important;
}
```

The set is still open — but the control proves the harness reads zero
when nothing paints, so any candidate property can be screened the same
way. That's a method, where before there was only a worry.

### C. The clip fact, re-verified headed

| | shadow px | body px |
|---|---|---|
| bare element | **0** | 24000 |
| padded wrapper | **12000** | 24000 |

Identical headless and headed. The body count matching across both is
the control: the wrapper changes nothing *inside* the box, only what
survives outside it. Ready for a `docs/platform.md` row.

### Methodology finding: two browsers in one process fakes a false chip

The first attempt launched headless and headed sequentially in one node
process. The second launch reported `drawElementImage: false` — with
Chrome not running, and with all four headed launch-arg variants
reporting `true` when launched alone. Running the modes as separate
processes made the false negative vanish.

Cause not chased further; the operational rule is what matters, and this
repo already had it. The capability chip is what caught it — an
apparatus that had trusted its own launch flags would have recorded
"headed lacks the trial" as a platform fact. **One browser per process,
and never trust a run whose chip you did not read.**

## Still unknown

- **`background-clip: text`, `mix-blend-mode`, `filter`** — not probed.
  These are the cases where "one feature per plate" is likely to be
  approximate, because the features are defined in terms of each other.
  Expect the decomposition to degrade to "best effort, labelled as such".
- **Paint order vs tree order.** The differentiator I'd rank highest was
  not tested here — it needs the real stacking algorithm, which is a
  computation over the tree, not a capture question. No platform risk
  identified; it's implementation work.
- **Cost at realistic N.** Four plates for one card is four canvases. A
  card exploded to element granularity is more like 15–40. Unmeasured
  against the ~64–96 concurrent-paint budget, though plates are static
  once exploded, so most should be idle (free).
- **Live editing of an exploded plate.** Clones aren't the live page, so
  "type into the text plate and watch the others update" needs a
  re-clone-and-recapture path on each keystroke. Feasible, unmeasured.

## Recommended approach

- One `PaintPlate` concept: **clone → padded wrapper → parked canvas →
  neutralizing stylesheet → capture**. The wrapper padding is a required
  parameter, not an optimization; derive it from the element's own
  shadow/outline extents.
- Neutralization ships as a small table of `{feature → scoped CSS rule}`,
  applied as an injected `<style>` inside the clone, `!important`,
  descendant-wide. Never inline on the root. Four members are measured
  (probe B): `color`, `text-shadow`, `text-decoration-color`,
  `-webkit-text-stroke-color`. Treat the table as open and screen new
  candidates against a zero-ink control.
- Reuse the Surface source path wholesale — each plate is a
  `createDomTextureSource`-shaped thing. The only new kernel need is
  "mount an existing cloned node" rather than "mount a markup string".
  That's a small widening of `createDomTextureSource`, not a new module.
- Shadows: the analytic path (`surfaceChrome`, archive #55/#58) stays the
  right choice for a *live* Surface's chrome. The captured shadow plate
  is a different job — it's the shadow as an object you can pick up — and
  the two should not be merged.
- Lay plates out by **paint order**, not tree order, and make the
  tree-order↔paint-order morph the headline interaction.

## Cost signals

- No new dependencies. No new kernel layer.
- Kernel: one widened entry point in `packages/core/src/paint/` to accept
  a node instead of markup. Small.
- New: a neutralization table + a clone/wrapper builder (new module,
  ~150 lines), a stacking-order computation (the real work — this is
  where the tool's value is and where the bugs will be), and a lab scene.
- One `docs/platform.md` row to add: the border-box clip, with the
  bare-vs-wrapped 0/12000 evidence.
- Hardest part is not the capture. It's the stacking-context computation
  and making the explode/collapse legible.
