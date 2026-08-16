# Spike: upstream frame contract for `Surface`

Run 2026-08-09 in local Chrome 151 with React 19.2.8, R3F 9.7.0, and Three r185.
All test code and scratch package changes lived in `/private/tmp` and were deleted.

**Status: a dated measurement, kept for its numbers.** Its recommendation
shipped — `FrameSource`, frame-backed `Surface`, and the draw receipt are
in the kernel. The proposals it fed were deleted on 2026-08-15. Read this
for what was measured, not for what to build; its vocabulary was brought
in line with decision #31 at the same time.

## Questions

1. Can a frame number pass through the real Three upload and draw path without a false receipt?
2. Can the real `Surface` entry accept a caller-owned canvas without changing the existing DOM path?
3. Can the public API keep core free of Three and keep Genie free of renderer callbacks?

The spike stopped on any wrong draw receipt, any required rewrite of the DOM `Surface`, or any API that exposed Three upload details to Genie.

## Verdict

**Yes. Fix the missing frame contract upstream. Do not put the whole video fix in core.**

Core should describe a canvas frame and its identity. The React package should turn the private GPU upload and draw events into one public draw receipt. Genie should own its video decoder, draw video frames into the canvas, and delay each handoff until the required frame receipt arrives.

The safe implementation is additive: public `Surface` dispatches frame input to a separate internal `FrameSurface`. The current DOM implementation stays intact.

## Why this is an upstream defect

A seamless handoff is a transfer protocol, not a visibility toggle:

1. A producer finishes source frame N.
2. Three uploads some source frame. Several fast source writes can merge into one upload.
3. The target mesh draws the uploaded frame.
4. Only then can the old owner disappear.

The current API cannot prove steps 2 or 3. `onFirstUpload` fires when Munari sets `texture.needsUpdate`; it fires before Three uploads or draws the texture. A lab cannot close that gap with better timing.

This problem applies to video, canvas, and any external changing pixels. That makes frame identity and draw acknowledgment package concerns. Video playback rules, `requestVideoFrameCallback`, film composition, and dock timing remain Genie concerns.

## Experiment 1: source generation to visible draw

A disposable R3F scene wrote a visible 24-bit generation code into a canvas. The test decoded that code from WebGL with `readPixels` after the mesh rendered.

- Source writes: **285**
- Actual texture uploads and mesh receipts: **165**
- False receipts: **0**
- Reordered receipts: **0**
- Callback order faults: **0**
- Normal updates: **90 of 90 acknowledged**
- CPU-stalled updates: **15 of 15 acknowledged**, including a 71.3 ms stall
- Four-write bursts: **30 latest frames acknowledged**; 90 intermediate writes merged as expected
- Source write to draw: **one rAF** in all normal samples, 8.2 ms median and 10.8 ms maximum
- Upload callback to mesh draw: **same render frame**, 0.9 ms median and 3.0 ms maximum

One ordering rule is mandatory. The renderer must read the generation inside `texture.onUpdate`, then release that stored value from the target mesh's `onAfterRender`. Reading the generation earlier in `useFrame` gave the wrong label in **30 of 30** adversarial late-write trials. The upload-time label matched the framebuffer in **30 of 30** trials.

Intermediate source frames may merge. A receipt must identify only the frame that was uploaded and drawn.

## Experiment 2: caller-owned canvas through `Surface`

The smallest scratch change added one public input dispatch and a separate internal `FrameSurface`. It used the real R3F `Surface` entry and the existing no-shading material path.

- Initial sRGB samples: native canvas and WebGL matched exactly
- Updated generation samples: native canvas and WebGL matched exactly
- Maximum sampled channel error: **0**
- Texture image: the exact caller canvas
- Canvas reparent events: **0**
- DOM raster calls: **0**
- `colorSpace='srgb'` and `premultiplyAlpha=true`: set before material exposure and first upload
- Existing checks: **48 test files and 701 tests passed**
- Root, lab, and registry TypeScript checks: passed
- Package JavaScript and declaration build: passed

The scratch package change was four files and about 140 added lines. Almost all new code was isolated in `FrameSurface`. The existing DOM source creation, LOD, chrome, focus, hit testing, pointer forwarding, and ownership logic did not gain new branches.

Putting frame input inside the current DOM implementation uses fewer new lines at first. It also adds null and mode branches across unrelated DOM systems. That shape failed the design test even though it could be made to compile.

## Experiment 3: public API boundary

Five call-site-first TypeScript sketches compiled against the installed React, Three, and TypeScript setup. The repository boundary suite also passed, 3 of 3.

The clean split is:

```ts
// @munari/core — no Three types
type FrameId = {
  sourceId: number
  generation: number
}

type FrameSource = {
  canvas: HTMLCanvasElement
  format: {
    colorSpace: 'srgb'
    alphaMode: 'straight' | 'premultiplied'
  }
  currentFrame(): FrameId
  subscribe(notify: () => void): () => void
}

// @petepetrash/munari — renderer details stay private
type FrameDrawReceipt = {
  surfaceEpoch: number
  frame: FrameId
}
```

The exact helper names are not important. These rules are important:

- `sourceId` changes when source identity changes.
- `generation` increases after the producer finishes writing a frame.
- Canvas identity and pixel format are fixed for the source lifetime.
- A source notification requests work; it does not claim that work is visible.
- React samples `currentFrame()` inside `texture.onUpdate`.
- React sends the receipt only from the target mesh's `onAfterRender`.
- `surfaceEpoch` rejects a late receipt from an old mesh or texture.
- Genie sees frame identities and receipts, not textures or renderer callbacks.

The current `<Surface html={...}>` call stays valid. A later borrowed-DOM hold is separate from `FrameSource`.

## Recommended first build

1. Add the renderer-free `FrameSource` contract to core.
2. Add frame input to the public React `Surface`, dispatched to an isolated `FrameSurface`.
3. Add `onFrameDrawn(receipt)`. Keep `onFirstUpload` for compatibility, but deprecate its current name or document it as an upload request signal.
4. In Genie, keep one persistent video decoder and one persistent canvas. Draw each accepted video frame into that canvas, then publish the new generation.
5. Use the same canvas for the resting film and the WebGL texture. Keep the old owner visible until the required `onFrameDrawn` receipt arrives.
6. Keep the mesh renderable until its first receipt. `onAfterRender` cannot fire below a `visible={false}` ancestor.

Do not add a generic media player to `Surface`. Core does not need to know about video frame rates, playback, seeking, or the Genie dock.

## Compatibility and cost

The smallest complete package change is about six production files: a new core frame-source module, core exports or shared paint types, the React `Surface` dispatcher and `FrameSurface`, `SurfaceApp` prop narrowing, and React exports. Genie adoption adds its scene code and likely one CSS file.

There are five current `onFirstUpload` users: Flight, Genie, Passage, Veil, and Wake. The first additive release can preserve that callback and migrate only Genie. A later cleanup must review all five because several use the callback as a release fence; they are not safe mechanical renames.

The minimum proof set is:

- core generation and subscription tests;
- React tests for source replacement, merged generations, stale receipts, unmount, and context loss;
- a real-Chrome pixel and receipt test;
- a Genie swap test that compares the required generation with the drawn generation.

## Still unknown

- The full Genie handoff schedule with its real warped geometry and window chrome.
- Recovery behavior for WebGL context loss between upload and draw.
- Whether a transparent readiness mesh is better than keeping the real mesh traversable for its first receipt.
- Pixel parity on other browsers and GPUs.
- Direct `HTMLTexture` color correctness. This proposal keeps the proven `CanvasTexture` path.
- General borrowed DOM holds. That remains a separate upstream improvement.

## Decision

Proceed with an upstream `FrameSource` plus `FrameSurface` and a true draw receipt. Use it to fix Genie with one decoder and one shared canvas. Keep the present DOM `Surface` and all Genie-specific media policy unchanged until their separate contracts are proven.

The implementation must be written fresh. No spike code should be promoted.
