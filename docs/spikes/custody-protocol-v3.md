# Proposal: custody protocol v3

**Status:** Proposal. Revised after commit `3a1ff82`, *One film clock crosses
the DOM and WebGL seam*. Supersedes `custody-protocol-v2.md`, which stays on
disk with `custody-protocol-v2-review.md` as the record of the first review.

**Date:** 2026-08-09

**Baseline.** The commit already ships `FrameSource`, frame-backed `Surface`,
`FrameDrawReceipt`, one persistent decoder, and one canvas shared by the DOM
and WebGL. This proposal does not rebuild them. It adds the smaller fact the
current code still cannot prove: a specific transfer drew through the intended
output pass, with color writes enabled, at the required presentation revision.

---

## What the latest commit settled

| Before `3a1ff82` | Baseline now | Effect on this plan |
| --- | --- | --- |
| Genie used two video elements and tried to align their clocks | One decoder writes one persistent sRGB canvas | Complete; no media clock belongs in core |
| A caller could request a texture update but could not name the frame Three drew | `FrameSource` names writes; `FrameDrawReceipt` names the frame sampled at upload and released after mesh traversal | Keep this public contract unchanged |
| Film and captured chrome had no proven composition path | An outer DOM `SurfaceApp` supplies chrome and an inner frame-backed `Surface` supplies film | The old Option A/Option B branch is obsolete |
| Canvas-child paint propagation was a branch point | Genie does not depend on canvas-child capture | Remove that probe from the critical path |
| The proposed protocol had no consumer | Genie now has a local transfer token, frozen frame requirements, and forward and reverse gates | Promote only the parts that still belong upstream |

The latest commit validates the main direction. It does not complete the
release proof. Genie's first film receipt is earned while the film material has
`colorWrite={false}`. That receipt proves upload and mesh traversal. It does not
prove visible presentation. Genie then enables color writes and releases the
DOM copy from `useFrame`, before a second `onAfterRender` receipt can name that
visible draw.

---

## 1. Language

Six terms. Do not add another term until a second consumer needs it.

| Term | Meaning |
| --- | --- |
| **Canonical source** | The one retained state every presentation derives from: a DOM root, decoder, or frame canvas. |
| **Presenter** | A visible representation of the source, such as native DOM or a WebGL mesh. Two can overlap during transfer. |
| **Presentation authority** | The presenter the user should read as current. |
| **Input authority** | The one presenter that accepts pointer input. |
| **Requirement / receipt** | What a target must prove, and the evidence that it did. |
| **Epoch** | A binding-owned lifetime identity that rejects late work from a replaced source or surface. |

Three related facts stay outside the protocol model:

- **Raster authority.** Genie fixes this at takeoff with `resolution={2}`.
- **Focus, selection, and IME.** The browser owns them. Genie parks focus and
  returns it; a mesh cannot own a caret.
- **Time authority.** Genie's persistent decoder owns it. Core sees completed
  canvas generations, not video time.

---

## 2. Two gates and two receipts

The renderer composites above the DOM. A target cannot rehearse behind the old
presenter. The transfer therefore needs two different gates.

| Gate | Question | Evidence | Genie now |
| --- | --- | --- | --- |
| **Pixel gate** | Does the target have usable source pixels? | Source generation plus the shipped `FrameDrawReceipt` | `painted && framed`; the film material can still have color writes disabled |
| **Release gate** | Did this transfer draw through the intended output pass at the required revision? | New `PresentationReceipt` | Not yet proven; `shown` still comes from `useFrame` |

The distinction is necessary because `onAfterRender` also runs for a material
whose color writes are disabled. A `FrameDrawReceipt` remains useful: it proves
which source frame crossed upload and mesh traversal. It must not gain transfer
semantics, and its callback count must not change.

The new presentation receipt is optional. A normal frame-backed `Surface` does
not have to invent a transfer ID or a presentation revision.

---

## 3. Laws

Marked **(bled)** when a repository defect produced the law and **(new)** when
the protocol adds it.

1. **One canonical source.** A seamless transfer cannot rest on two decoders or
   two unsynchronised browser states. **(bled: film frame drift)**
2. **Acquire before release.** The current presenter stays valid until the
   target supplies acceptable evidence. **(bled: the hole in the desk)**
3. **No uncovered frame.** Cancellation, failure, and replacement cannot leave
   both presenters absent. **(bled: the empty-texture flash)**
4. **Evidence, not time or traversal.** A frame count, timeout,
   `texture.needsUpdate`, or an off-screen or non-writing draw cannot release
   custody. **(bled: the rest snap; new: the hidden film receipt)**
5. **A transfer needs a stable handoff state.** During acquisition, the
   presentation revision must stay stable, or both presenters must read the
   same versioned state. **(new)**
6. **Custody is revocable, and the reverse never blocks on proof.** A committed
   presenter that loses validity starts a reverse transfer at once. The reverse
   preserves coverage and records what happened, but never waits for evidence.
   **(new)**
7. **A presentation receipt names the transfer and revision.** Pixel identity
   alone cannot say which handoff a draw belongs to. **(new)**
8. **Newer pixels can satisfy an older minimum; the revision must be exact.**
   Generation `N+1` can satisfy a requirement for `N` under the same source.
   A newer presentation revision is not assumed equivalent. **(new)**
9. **Stale work is harmless.** A receipt from a replaced source, surface,
   transfer, or revision cannot commit current custody. **(bled: stale async
   film work)**
10. **Scene policy stays outside core.** Core knows nothing about video rates,
    animation curves, dock geometry, React, Three, or stacking. **(new)**

Pixel format fixed at source birth is already a shipped rule under decisions
#5 and #24. It does not need another custody law.

---

## 4. Keep the shipped receipt; add a presentation receipt

The shipped low-level receipt stays as it is:

```ts
interface FrameDrawReceipt {
  readonly surfaceEpoch: number
  readonly frame: FrameId
}
```

The optional custody layer adds separate types:

```ts
interface PresentationRequirement {
  /** Minted by the consumer when a transfer starts. */
  readonly transferId: number
  readonly frame: FrameId
  /** Opaque to core. Monotonic within one presenter. */
  readonly presentationRevision: number
}

interface PresentationReceipt {
  readonly transferId: number
  readonly frame: FrameId
  readonly presentationRevision: number
  /** Diagnostic. The binding validates its own runtime identity. */
  readonly surfaceEpoch: number
}
```

Core supplies one predicate:

```ts
receipt.transferId === requirement.transferId
receipt.frame.sourceId === requirement.frame.sourceId
receipt.frame.generation >= requirement.frame.generation
receipt.presentationRevision === requirement.presentationRevision
```

The consumer mints `transferId`. It owns the event called "transfer starts";
the binding does not. The ID only has to be unique within that presenter's
active history. Genie's existing film token is the first implementation.

---

## 5. Binding contract

The frame runtime keeps two frame facts:

- the current one-use pending frame for the existing `onFrameDrawn` callback;
- the last uploaded frame for an optional presentation requirement.

Keeping the last uploaded frame must not cause another `onFrameDrawn` callback.
It only lets a later visible draw prove that it used pixels already on the GPU.

The presentation fence follows this order:

1. `mesh.onBeforeRender` samples the active requirement and presentation
   revision.
2. It accepts the pass only when it targets the intended output. The default
   rule is `gl.getRenderTarget() === null`.
3. It accepts the material only when color writes are enabled.
4. The renderer draws. If it uploads a newer frame during this draw, the
   runtime records that frame in `texture.onUpdate`.
5. `mesh.onAfterRender` reads the last uploaded frame and emits one receipt for
   a satisfying `(surfaceEpoch, transferId, presentationRevision, frame)` tuple.

This is a draw fence, not a framebuffer readback. A custom shader can still
discard every fragment. The consumer owns that shader and must keep it eligible
to present. Core must not inspect scene materials or shader text.

The first public shape can stay additive:

```tsx
<Surface
  frame={source}
  presentation={requirement}
  onFrameDrawn={openPixelGate}
  onPresented={releaseOldPresenter}
/>
```

The exact prop names are not final. The split between the two callbacks is.

The binding also:

- rejects stale runtime and source identities as it does now;
- omits both `onBeforeRender` and `onAfterRender` from forwarded mesh props;
- emits once for each accepted tuple;
- counts rejected draws for one transfer and warns once in development;
- does not use timeouts and does not warn in production.

If a future consumer presents through a composer, it must select that output
pass explicitly. An off-screen pass must never qualify by accident.

---

## 6. Genie adoption

The shipped film architecture stays intact:

- one persistent decoder;
- one persistent opaque sRGB canvas;
- that same canvas in the resting DOM and the WebGL texture;
- captured DOM chrome on the outer `SurfaceApp`;
- film on the aligned inner frame-backed `Surface`;
- the existing freeze and resume rules at both walls.

Only the release edge changes:

1. The current frozen frame and chrome open the pixel gate.
2. Genie enables color writes on the film composite.
3. Genie passes its existing film token as `transferId` and supplies the stable
   handoff revision.
4. The clocked flight stays at its wall until `onPresented` returns a matching
   receipt.
5. That receipt sets `shown`, releases the DOM copy, and lets motion and video
   resume.

The manual-grab path needs an explicit rule. If the hand changes the target
pose during acquisition, Genie must either hold one pose long enough to present
it or advance the revision and keep the old presenter. A receipt for an older
grab pose cannot release custody.

The reverse path does not wait for a native paint receipt. It reveals the DOM
canvas while the WebGL copy still covers it, then releases WebGL. The shared
canvas keeps their pixels equal during this overlap.

---

## 7. Measurements before implementation is complete

Three probes remain. They use current apparatus where possible.

**P1 — visible-presentation fence.** With one uploaded frame, draw first with
color writes disabled, then enable them without publishing another source
frame. Require a `FrameDrawReceipt` from the first draw, no
`PresentationReceipt` from it, and exactly one matching presentation receipt
after the writing draw. Repeat through an off-screen render target and require
no presentation receipt. Read the default framebuffer to verify the named
pixels. Extend `instruments/frame-surface`.

**P2 — reverse coverage under load.** Reuse `film-window.mjs` and
`rest-blink.mjs`; do not build a third harness. Run the restore direction at
6x CPU throttle and count composited frames in which neither presenter covers
the handoff rectangle. The current film gate already checks 24 round trips at
4x and records compositor pixels, source identity, and frame receipts. Tighten
that evidence before marking this probe complete.

**P3 — post-commit invalidation.** Lose the WebGL context while the renderer is
the presentation authority and verify that native coverage returns without
waiting for a draw receipt. Test backing-store reallocation separately on a
generic frame-backed `Surface`. Resize is not reachable in Genie because its
flight box and raster are fixed; context loss is reachable.

The removed canvas-child paint probe can remain a separate HTML-capture study.
It no longer decides this protocol or the Genie film seam.

---

## 8. Smallest implementation slice

**Core**

- Add `PresentationRequirement`, `PresentationReceipt`, and the pure predicate.
- Do not add a reducer, lease, clock, renderer type, or abort operation.

**React binding**

- Preserve `FrameDrawReceipt` and `onFrameDrawn` exactly.
- Retain the last uploaded `FrameId` inside the frame runtime.
- Add the optional requirement and separate presentation callback.
- Add the qualified `onBeforeRender` to `onAfterRender` fence.
- Reject off-screen and color-disabled draws.
- Add the development-only rejection warning.

**Genie**

- Reuse the current token as `transferId`.
- Replace the film release through `useFrame` with a matching presentation
  receipt.
- Keep the present decoder, canvas, composite shader, and reverse handoff.

**Proof**

- Core: valid acceptance; stale transfer, source, and revision rejection;
  newer-generation acceptance.
- Unit: no change to current `onFrameDrawn` callback count; retained uploaded
  frame; tuple deduplication; source replacement and cleanup.
- Browser: P1, P2, and P3 above.

---

## 9. Not in scope

- A second canvas or a second decoder for Genie.
- Canvas-child bitmap propagation through HTML capture.
- A transfer reducer, leases, or a public coordinator.
- Borrowed DOM and `Element.moveBefore`.
- A generic DOM presentation receipt.
- Changes to `onFirstUpload`.
- Automatic inspection of custom shaders, depth, occlusion, or final pixel
  coverage.

Those items need a second consumer or a separate measured defect.

---

## 10. Open questions

1. Should the additive props be named `presentation` and `onPresented`, or
   should the fence be a small child component attached to the mesh?
2. What exact event should the Canvas host expose for context loss and restore?
   The host owns the browser event; the consumer owns fallback policy.
3. For a manual grab during acquisition, should Genie hold the target at the
   last presented pose or keep advancing revisions until one draw catches the
   hand? This is interaction policy and must stay out of core.
