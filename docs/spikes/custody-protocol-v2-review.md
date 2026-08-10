# Review: custody protocol v2

**Reviewing:** `docs/spikes/custody-protocol-v2.md` (2026-08-09)

**Date:** 2026-08-09

**Verdict:** The law is earned. The framework is not. Take Slice 1, cut three
of its four parts, and add one law the proposal is missing. Two claims in §4
and §5 are wrong about this repository and must be corrected before anyone
builds from them.

Everything below is grounded in the code as it stands. File and line
references are to the working tree at HEAD `52089c8` plus the uncommitted
frame path.

---

## Summary of findings

| # | Finding | Severity |
| --- | --- | --- |
| 1 | §4 has the stacking order backwards. The renderer draws **above** the DOM, not under it. | Fatal to the design as written |
| 2 | Law 8 plus a moving target is a livelock. The missing precondition is a still frame. | Fatal, silent hang |
| 3 | `pixelSize` exact-equality cannot be stated by a DOM consumer. It blocks Slice 3. | Cut it |
| 4 | Slice 2 cannot be built on the current API. One mesh cannot hold two sources. | Blocking gap |
| 5 | §5's "receipt without new pixels" solves a problem Genie does not have. | Defer |
| 6 | Retaining the last uploaded frame is **not** additive. It changes `onFrameDrawn`'s cardinality. | Contract change |
| 7 | Every law governs the transition. Nothing governs the tenure. | Missing law |
| 8 | `onAfterRender` proves a draw into *some* framebuffer, not the presented one. | One-line fix |
| 9 | `receiptSatisfies(..., currentEpoch)` makes the consumer hold state it does not own. | API shape |
| 10 | §6 puts a reducer in core; §10 Slice 1 does not. | Internal inconsistency |

---

## 1. §4 has the stacking order backwards (fatal)

The proposal says:

> The renderer becomes renderable behind or under the native presenter.
> … The old presenter provides visual coverage while the target draws
> underneath.

That is not true of the only real consumer. Genie's `<Canvas>` is a fixed
full-page overlay above the desk:

```ts
// apps/lab/src/scenes/Genie.tsx:1853
style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: OVERLAY_Z }}
```

The comment above that line explains why the number is load-bearing: the
sheet must land in the same stacking layer it left, and the desk's windows
are `1..n`. The renderer composites **over** the DOM.

The consequence is not cosmetic. It changes what a receipt is for.

- If the renderer drew underneath, its first drawn frame would be invisible,
  and the receipt could safely gate *showing* it.
- Because the renderer draws on top, its first drawn frame is on screen. A
  mesh that is renderable is visible. So the first drawn frame must **already
  be correct** — there is no free rehearsal.

This is the deadlock decision #24 already records, from the other side:
scenes hide the only renderable ancestor until `onFirstUpload`, so a draw
receipt cannot be what un-hides it.

So there are **two gates, not one**, and Genie already has both:

| Gate | Question | Genie's answer |
| --- | --- | --- |
| Pixel gate | May the target be drawn at all? | `ready = painted && lit` (Genie.tsx:1890) |
| Release gate | May the old presenter go away? | `shown`, set from the frame loop (Genie.tsx:800-808) |

The proposal collapses these into one "acquire" step. Anyone implementing
from §4 will wire the receipt to the pixel gate and reintroduce the blank
white rectangle the comment at Genie.tsx:951-964 describes.

**Fix.** Rewrite §4 as: the target earns the right to be *drawn* from source
evidence (it has pixels, and they are the right pixels); it earns the right
to *release the old presenter* from draw evidence. Say which gate each new
identity serves.

---

## 2. The missing law: a transfer needs a still frame (fatal, silent hang)

Law 8 says the presentation revision must match exactly. Genie's flight loop
rewrites every vertex on every frame:

```ts
// apps/lab/src/scenes/Genie.tsx:906-915
for (let i = 0; i < pos.count; i++) { … }
pos.needsUpdate = true
```

If the scene advanced its revision whenever it wrote that geometry, the
revision would advance every frame. A requirement pinned at revision `R`
could never be satisfied, because the draw always carries `R+n`. The transfer
would never commit. Coverage holds, so nothing flickers — the window simply
never minimizes. A hang is worse to diagnose than a flash.

Genie avoids this today by accident of good design: the drive is pinned until
the sheet is on screen.

```ts
// apps/lab/src/scenes/Genie.tsx:814-816
if (!drawn && d.mode === 'clock') {
  d.clockStart = null
  d.t = restoring ? 1 : 0
}
```

The same precondition holds on the source side. Two presenters can only be
proven identical if the thing they present is not changing under them. Genie
freezes the airborne content and pins its raster (`resolution={2}`,
Genie.tsx:945). The film window is the exception that proves the rule: its
content *is* moving, and it is exact only because both presenters are meant
to read one pixel store.

State it once, and it replaces the vague parts of laws 1, 7 and 8:

> **A transfer requires a still frame.** During acquisition the presentation
> revision must not advance, and either the canonical source must be
> quiescent or both presenters must read the same pixel storage.

That sentence is also the honest one-line explanation of why the shared frame
canvas fixed the film seam and the second decoder did not.

**Fix.** Add the law. Add its failure row: a target that animates during
acquisition never commits. Add its proof: a conformance test that a
revision advancing during acquisition is reported, not silently retried.

---

## 3. `pixelSize` cannot be stated by a DOM consumer (cut it)

```ts
receipt.pixelSize[0] === requirement.pixelSize[0]
```

For a caller-owned `FrameSource` the consumer owns the canvas and knows its
size, so this is stateable. For a DOM `Surface` it is not. The backing store
floats inside a density band (decision #15) and dynamic LOD retiers it from
inside the frame loop:

```ts
// packages/react/src/primitives/Surface.tsx:751-759
const proposal = selectLodTier(density, lod.tier, tiers)
… source.setScale(proposal)
```

A consumer that had to name the exact backing-store size would be naming a
number the binding chooses and can change between the requirement and the
draw. Exact equality then livelocks — the same shape as finding 2.

This directly blocks Slice 3, which is where the DOM receipt lives.

**Fix.** Remove `pixelSize` from both structures. If a scene needs the seam to
agree on a size, that is a *logical* size the scene already controls, so it
belongs inside the opaque presentation revision. Backing-store size is
renderer policy and should stay there.

---

## 4. Slice 2 cannot be built on the current API (blocking gap)

Genie's windows are `SurfaceApp`, which is DOM-only by construction:

```ts
// packages/react/src/primitives/SurfaceApp.tsx:19
extends Omit<ComponentProps<typeof Surface>, 'frame' | 'html' | 'onSource'>
```

and pinned as an error in the type contract:

```tsx
// tests/surfaceTypes.tsx:32-33
// @ts-expect-error SurfaceApp remains a DOM-owned React root.
;<SurfaceApp frame={frame} content={<div />}>{geometry}</SurfaceApp>
```

A `Surface` has exactly one pixel source; `html` and `frame` are mutually
exclusive, also pinned (tests/surfaceTypes.tsx:26-27).

Slice 2 wants the film window to keep its captured chrome **and** take its
film pixels from the shared canvas. That is one mesh with two textures. The
API forbids it. The only escape today is for Genie to build its own
`CanvasTexture` from the shared canvas, outside the package — at which point
it has no receipt, which is the single thing Slice 1 exists to give it.

**Fix.** Slice 2 needs a fifth deliverable the proposal does not list: a way
to get a frame texture **and** its receipt without a mesh. Something like
`useFrameTexture(source)` returning the texture plus a receipt sampler, which
`FrameSurface` then also consumes. Decide this before Slice 1 ships, because
it decides whether the receipt lives on the mesh or on the runtime.

Worth probing first, because it may delete the whole problem: put a
`<canvas>` in **both** copies of the film window and feed both from one
decoder with the same `drawImage`. One decoder, two canvases, identical
pixels, no new API, no second presentation path, and `lit` disappears with
the seek. The one unknown that decides it: does HTML-in-canvas advance
`paintCount` when a `<canvas>` child's bitmap changes without a DOM
mutation? That is a small probe and it is worth running before building the
two-texture seam. I have not measured it; treat it as a hypothesis.

---

## 5. "Receiptable without new pixels" solves a problem Genie does not have

§5 is correct about the mechanism:

```ts
// packages/react/src/primitives/FrameSurface.tsx:113-118
takeDrawReceipt() {
  if (!active || !pendingFrame) return null
  …
  pendingFrame = null
```

A consumed receipt cannot be re-earned without a publication. But the case
needs a Surface that **persists across transfers**, and Genie has none: each
flight mounts its own `SurfaceApp` (Genie.tsx:1874-1900), so every transfer
builds a fresh runtime, and a fresh runtime arms an upload at birth:

```ts
// packages/react/src/primitives/FrameSurface.tsx:107
texture.needsUpdate = true
```

An upload therefore always follows a mount, and a receipt always follows the
upload. The browser gate publishes twice per acquisition cycle
(`instruments/frame-surface/main.tsx:561-564`) to make generations
*distinguishable*, not to make the receipt possible.

**Fix.** Defer this item until a consumer holds a Surface across two
transfers. Right now it is generality with no bleed behind it.

---

## 6. Retaining the last uploaded frame is not additive

§10 Slice 1 says "keep the existing DOM `Surface` behavior unchanged", which
is true, but the retained-frame change is not free either. If the runtime
holds the last uploaded frame instead of clearing it, `onFrameDrawn` fires on
**every drawn frame** rather than once per uploaded frame. In Genie's
airborne state the frameloop is `'always'` (Genie.tsx:1858), so that is 60
callbacks a second.

The current cardinality is pinned in two places:

- `packages/react/src/primitives/FrameSurface.test.ts:44-45` — take once, then
  null.
- `instruments/frame-surface/main.tsx:141-149` — an exact seven-receipt trace,
  with `passed` requiring `generations.length === expectedGenerations.length`.

**Fix.** If you do it, emit on **tuple change**: `(frame, transferId,
presentationRevision)`. Cardinality stays bounded, a new transfer earns a
receipt with no new pixels, and an idle sheet stays quiet. And change both
contracts in the same commit — a law ships with the contract that pins it.

---

## 7. Every law governs the transition. Nothing governs the tenure.

Laws 1-12 are all about moving custody. After the commit the renderer is the
only presenter, and no law says it has to stay valid.

Concrete sequence, still possible after Slice 1:

1. A minimize commits. The DOM copy is hidden (`shown` is true). The sheet is
   the only presenter.
2. The user resizes the browser window mid-flight, or dpr changes.
3. `uploadNeedsRealloc` is true, so the texture's GL storage is released:
   `texture.dispose()` (Surface.tsx:806-810; the same shape at
   FrameSurface.tsx:95-100).
4. The mesh is drawn before the replacement upload lands. Three re-initialises
   the disposed texture as an empty one.
5. The desk shows a blank rectangle where a window used to be. Both presenters
   are absent, and law 3 said that cannot happen.

Context loss after commit has the same shape. §7's table has a row for it, but
that row reads as an acquisition rule, and no proof item in §11 covers the
post-commit case.

> **Correction (same day, after review).** The resize sequence above is not
> reachable in Genie. A flight measures its box once (`f.w`, `f.h`) and pins
> its raster with `resolution={2}`, so `pinnedScale` is non-null and the LOD
> block is skipped (`Surface.tsx:733`). Store size is a function of box and
> scale, and both are constant for the flight. So steps 2-5 describe a hazard
> for a future consumer whose Surface resizes while it is the sole presenter,
> not a live defect. **Context loss is the reachable justification for the law
> today.** The resize case still needs a browser test before it is claimed.
> The law itself stands on the reachable case.

**Fix.** Add the law:

> **Custody is revocable.** A committed presenter that loses validity must
> start a reverse transfer immediately. The reverse transfer takes no
> evidence, because coverage cannot wait for proof.

This also answers question 9, and it reframes risk 3: the evidence asymmetry
between the two directions is not a weakness to apologise for. It is what
keeps the protocol non-blocking. The direction that can hang is the one with
proof; the direction that must never hang has none, by design.

---

## 8. `onAfterRender` proves a draw into *some* framebuffer

Shadow passes are safe — since r165 Three calls `onBeforeShadow` /
`onAfterShadow` there, not the render pair. Off-screen passes are not. The lab
renders whole scenes into targets in three places today:

- `apps/lab/src/scenes/Veil.tsx:388-398`
- `apps/lab/src/scenes/Wake.tsx:555-583`
- `apps/lab/src/scenes/glassSdf.tsx:669-839`

None of them contains a `Surface`, so this is latent rather than live. It goes
live the day a consumer adds post-processing, at which point every Surface
reports a receipt from a pass the user never sees.

**Fix.** One line in the adapter: ignore the draw when
`gl.getRenderTarget() !== null`. Default it on, because "the presented
framebuffer" is the honest reading of the receipt. Give post-processing users
an explicit escape rather than a silent one.

---

## 9. `receiptSatisfies(requirement, receipt, currentEpoch)` is the wrong shape

The consumer does not own `surfaceEpoch`; the binding mints it
(`nextSurfaceEpoch`, FrameSurface.tsx:130) and already validates it by runtime
identity before it calls back:

```ts
// packages/react/src/primitives/FrameSurface.tsx:225
if (!current || current !== runtime || current.source !== frameRef.current) return
```

Passing the epoch back in as an argument asks the consumer to hold binding
state so it can re-check something the binding checked already.

**Fix.** Split the predicate. The binding checks epoch and runtime identity —
it owns them. Core checks transfer, source, generation and revision — they are
the consumer's. Keep `surfaceEpoch` on the public receipt as a diagnostic; the
browser gate uses it well (`freshSurfaceEpochPerCustody`,
instruments/frame-surface/main.tsx:435-443). Just do not make it an argument.

Related, smaller: if the adapter starts sampling `mesh.onBeforeRender`, add it
to the `Omit` beside `onAfterRender` (FrameSurface.tsx:14). Otherwise a
consumer prop and the adapter's own handler collide, and which one survives
depends on spread order.

---

## 10. Internal inconsistency

§6 puts "a small reducer for stable, acquiring, committed, and aborted states"
in core. §10 Slice 1 lists only "pure receipt validation in core". Pick one.

Recommendation: no reducer. Four states with one consumer is the second system
the proposal's own risk 1 warns about. The predicate earns its place because
it is eight comparisons and a name; the reducer does not, until a second scene
has an opinion about what "aborted" means.

---

## Does this pass the second-system guard?

Split the question.

**The law has bled three times, all in Genie, all the same law:**

1. The empty-texture flash — mounting a Surface put a blank rectangle over a
   live window (Genie.tsx:951-964).
2. The hole in the desk — the DOM hid before the sheet was drawn
   (Genie.tsx:1401-1423).
3. The rest snap — a landed flight kept computing and drew itself back at the
   window's rest position (Genie.tsx:749-762).

Three bleeds, one law: **acquire before release, on evidence, not on time.**
That clears the guard comfortably.

**The framework has no bleeds at all.** Eleven terms, twelve laws, a state
machine, leases, coverage, and a reducer are proposed on the strength of one
consumer that has not yet adopted the first version. Cut to the law, and let
the vocabulary arrive with the second consumer that needs it.

---

## Answers to §14

**1. Which authority is missing?** Three.

- **Raster authority** — who chooses the backing-store size. It is real and it
  already moves: takeoff pins it (`resolution={2}`, Genie.tsx:945) precisely
  because the renderer's LOD would otherwise decide from deformed geometry.
  This is separate from layout host and from presenter.
- **Focus, selection and IME.** The table folds these into input authority,
  but they are not the same kind of thing. Pointer routing can move to a
  renderer. Focus cannot — a mesh cannot hold a caret. It can only be *parked*
  and handed back, which is what Genie does (`wantsFocus`, Genie.tsx:1468-1480;
  the `:focus-visible` test at 1610-1613). Splitting them would have caught the
  mousedown bug that comment records.
- **Time authority.** Both copies must read one clock or the swap frame jumps.
  Genie derives both phases from the document clock (Genie.tsx:347-350). It is
  a real authority in a real consumer and it is not in the table.

**2. Is an opaque `presentationRevision` enough?** Yes, and a structured stamp
would be worse. Structure invites per-property generations, which is risk 2
coming true. But it is only safe with the still-frame law from finding 2.
Without that law, opacity hides a livelock; with it, opacity is exactly right.

**3. Must a receipt include pixel size?** No. See finding 3. Logical size
belongs in the revision; backing-store size belongs to the binding and should
never appear in a consumer's requirement.

**4. Is upload → before-render → after-render enough?** For which pixels, yes —
the ordering spike measured 285 writes against 165 receipts with zero false
labels, and reading earlier was wrong in 30 of 30 trials. For which
*framebuffer*, no. See finding 8. Add the render-target check and the fence is
honest.

**5. How should a reused texture produce a fresh receipt?** Emit on tuple
change, not on a one-use latch. See finding 6. But do not build it yet — see
finding 5.

**6. What is the smallest honest native coverage proof?** There is none for
arbitrary DOM, and the good news is that you do not need one. `element-timing`
reports a first paint only, so it cannot serve a window that has painted
before. But in this architecture the release direction is safe without proof:
the DOM change composites at its own commit, while the WebGL canvas cannot
change until the renderer runs again. Reveal native first, release the renderer
later, and the renderer's own lag is the coverage. That is a local, checkable
property — "did we release the renderer in a later frame than we revealed
native" — rather than a platform proof you do not have.

I have reasoned this from how R3F drives the renderer, not measured it. The
probe that would settle it: reveal a native copy and unmount the sheet in the
same commit under a 6× CPU throttle, and count composited frames that show
neither. `instruments/genie-drain/rest-blink.mjs` is the apparatus, run in the
other direction.

**7. Where does context-loss recovery belong?** The Canvas host detects it —
it owns the context and the event. Each Surface invalidates its own resources.
The coordinator decides policy. Splitting it that way keeps core free of the
event and keeps the scene free of the plumbing. See also finding 7: recovery is
the reverse transfer, so it must not require evidence.

**8. Does a pure reducer earn its place?** No. The predicate does. See
finding 10.

**9. Which race still leaves neither presenter?** Post-commit invalidation.
Full sequence in finding 7.

**10. What is unnecessary?** In order: `pixelSize` (finding 3), the reducer
(finding 10), the retained-frame change (finding 5), `Lease`, `Coverage` and
`Layout host` as named terms — three vocabulary entries with no code behind
them and no second consumer asking.

---

## Recommended Slice 1

Smaller than the proposal's Slice 1, and it preserves every law that has
actually bled.

**Core** (~40 lines, still pure)

- `PresentationRequirement` and `PresentationReceipt` with four fields each:
  `transferId`, `frame`, `presentationRevision`. No `pixelSize`. No
  `surfaceEpoch` in the argument list.
- One predicate over those fields.
- No reducer.

**Binding** (~25 lines)

- Sample the active transfer and revision at `mesh.onBeforeRender`; release
  the combined receipt at `onAfterRender`. Add `onBeforeRender` to the `Omit`.
- Ignore draws where `gl.getRenderTarget() !== null`.
- Leave the one-use receipt latch alone.

**Docs**

- Rewrite §4 with the correct stacking order and the two-gate rule
  (finding 1).
- Add the still-frame law (finding 2) and the revocability law (finding 7).

**Proof**

- Core: valid acceptance; stale transfer, source and revision rejection;
  generation coalescing; idempotent abort.
- Browser: no receipt from an off-screen pass; a revision advancing during
  acquisition is reported rather than silently retried; post-commit realloc
  restores coverage.

**Then stop and decide finding 4 before Slice 2**, because whether the receipt
lives on the mesh or on the runtime is the question Genie's film window will
ask first, and Slice 1's shape should not answer it by accident.

---

## What the proposal gets right

Worth saying plainly, because the findings above are all objections.

- "Evidence, not time" is the correct central rule, and the ordering spike's
  numbers back it.
- Separating source authority from presentation authority dissolves the
  apparent contradiction of two visible presenters. That reframing is the most
  valuable paragraph in the document.
- The alternatives in §12 are honestly argued, and rejecting "render arbitrary
  live DOM twice" is right for the reason given.
- The recommendation to stop after Slice 1 and review again is the correct
  instinct. This review only asks it to cut deeper before it starts.
