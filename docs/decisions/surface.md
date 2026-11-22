# Decisions: Surface API and presentation evidence

Rules for the public Surface components, placement, and the receipts that prove a frame reached the screen. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="24"></a>

## #24 — A frame counts as presented only when a receipt names it

A caller-owned canvas enters through `FrameSource`: a stable source identity, a generation that advances only on publish, fixed sRGB and alpha interpretation, and a notification after each write. The binding samples the generation inside Three's texture upload callback and releases it only after the target mesh renders. Several publications may merge into one upload. A `FrameDrawReceipt` names only the frame that went through both the upload and the draw. Setting `texture.needsUpdate` proves neither.

The frame path never goes through DOM adoption, layout, chrome or pointer forwarding. Frame input uses an unlit material without tone mapping by default, and premultiplied input uses a custom material (#5). `gate:frame-surface` checks the receipt sequence against framebuffer pixels.

<a id="25"></a>

## #25 — A draw releases a presenter only if it reached the screen with color

Mesh traversal is not visible presentation, because Three runs `onAfterRender` for color-disabled materials and off-screen targets. A `FrameDrawReceipt` keeps its upload-and-traversal meaning (#24). A handoff that releases another presenter uses a `PresentationRequirement` and a `PresentationReceipt`. Core accepts a receipt only when transfer, source and revision match and the drawn generation meets the minimum.

Readiness has two stages. A presenter proves the first with a `warm-up` draw (no color, depth or stencil writes) while lifting on a shared canvas, or with a color draw that reached the screen. Releasing another presenter needs the second: a color-writing draw. The binding qualifies a draw only when it targets the default framebuffer with color writes on. `presentationRoute(pass, hasHost)` classifies every pass for `FrameSurface` and `Surface.Mesh`. A draw into a render target counts only when the output mesh declared with `useSurfaceOutput` draws it with color. That output mesh stays outside `BundleGroup`, because cached bundles skip mesh callbacks. `gate:frame-surface` covers these cases on WebGPU and WebGL 2.

<a id="26"></a>

## #26 — Unmounting the last Surface forces one more render

DOM-backed and frame-backed Surfaces invalidate their React Three Fiber root when they unmount. A consumer may switch a Canvas from `always` to `demand` in the same commit that removes its last Surface, and removal alone schedules no render. Without that render, the transparent canvas keeps its last framebuffer, and a stale copy shows beside the restored page. The binding owns this extra render because it is part of releasing a presenter.

<a id="42"></a>

## #42 — Placement, renderer loss and routing follow the actual canvas and source

The binding projects client coordinates relative to the GL canvas's own client rectangle. Core mapping takes viewport-local coordinates. One shared frame observer reads placements, including position-only changes in an idle canvas, and invalidates only the placements that changed. A rotated block is measured from three zero-size probes, so the host stands in the block's own coordinates.

Renderer loss or unmount returns a handoff to its page hold and discards preparation evidence. Author intent survives, and recovery prepares again. A presenter owes no evidence while its mesh is outside the camera frustum. Development builds warn after 10 s (`WAIT_WARNING_MS`) when a requested presentation still waits for its host; the warning never forces a handoff.

Capture copies on the Controls and Selection fixtures stay at p95 ≤ 5 ms and max ≤ 8 ms, with no idle copies (`instruments/api-contracts/capture-cost.mjs`).

<a id="43"></a>

## #43 — Surface is one live HTML component with explicit parts

`Surface` holds one live HTML tree and accepts `inScene`. Its explicit form is `Surface.Root`, `HTML`, `Scene`, `Mesh` and `Anchor`. `SceneSurface` presents HTML only in the scene, and `SceneSurface.Mesh` is one world unit high at the authored aspect ratio. `useElementCapture` observes native HTML in place. `CaptureContent` supplies separately authored pixels. `canvasId` selects the `SurfaceCanvas` with the matching `id`.

The public presentation is `page`, `scene` or `null`. Author intent stays `requestedInScene` during fallback. `onPresentationChange` reports the hold, and `onMotionComplete` reports the end of motion. Handles and drivers read raw progress, and `eased()` names a curve.

One mesh may display several named parts. `sampledParts` lists the extra sources its material samples. All must be usable before the mesh is ready, and its qualifying draw is their evidence. A color-disabled pointer proxy supplies routing only. A source or mesh registers when its resource appears. `layout="reflow"` removes the page slot only after a proven canvas presentation, and restores it on return.

A manual presenter (`Surface.Mesh presentation="manual"`) covers every declared part and reports only its final compositor draw. `useSurfaceBeforeRender` runs one callback per render pass, after pose writers.

`useSurfaceRefresh(handle?)` returns a function that requests a capture of mounted HTML parts. It creates no readiness or presentation evidence. Public exports, types, examples, docs and the tracked skill change together.

<a id="45"></a>

## #45 — Retained content keeps React ownership and clips like the page

A Surface placed through a page target sits in a wrapper that React owns and never moves. The element that moves is the wrapper's only child, with the same tag. React inserts, reorders and removes the wrapper. The moving element returns to its wrapper before React removes an old parent, so a detach and attach in one commit keeps focus and local state. Native server HTML and hydration stay intact.

Each capture reader owns its own frame subscription, so removing one reader cannot remove another's wakeup. A color-writing pass records its paint for anchors before the density check for initial presentation, so anchors follow a resize within 1 CSS px. Page-owned preparation clips its capture to the page's overflow ancestors. Rectangular clips intersect per axis, and rounded edges use a convex polygon with a chord error of 0.1 device px. `probe:api-regressions` holds mean channel error ≤ 0.5 against the same native page.

<a id="70"></a>

## #70 — No receipt for a frame that could not be drawn

A draw that shows nothing issues no draw or presentation receipt. `FrameSurface` and `Surface.Mesh` withhold receipts when the geometry's index or position count and draw range leave nothing to draw.

`SurfaceCanvas` requests the adapter's `maxTextureDimension2D` for its WebGPU device and records `MAX_TEXTURE_SIZE` on the WebGL fallback. `FrameSurface` neither uploads nor issues receipts for a source over that limit, and reports it once in development. DOM captures stop at `MAX_TEXTURE_EDGE` (#21).

`FrameSurface` replaces a tainted source canvas with a blank stand-in. It checks when the runtime is created and at the first publish after each allocation, because a check on every publish costs a readback. `Surface` needs no origin check, because neither capture engine taints its canvas (platform.md #34).
