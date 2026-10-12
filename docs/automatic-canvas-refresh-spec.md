# Automatic canvas refresh

**Status: proposed, unbuilt. Updated 2026-10-12.**
Source baseline: `3aed4ea`. This specifies a progressive enhancement to `live`.
It does not describe behavior shipped in the package.

## Product contract

A canvas drawing changes pixels without changing its DOM. A live Surface
should follow those drawings automatically where the browser supplies a
usable change signal. When drawing stops, the feature must stop requesting
work. Authors keep the existing `live` option and `useSurfaceRefresh()` API.

```tsx
<Surface inScene={inScene} live>
  <CanvasContent />
</Surface>
```

On a supported path, the author does not call refresh after each drawing.
Ordinary Surface input, layout, capture, and handoff behavior continue to apply.

| Situation | Required behavior |
|---|---|
| `live` is true and observation works | New canvas frames invalidate the owning HTML part |
| `live` is false | No automatic canvas subscription or canvas-driven refresh; existing input behavior remains |
| `live` changes to true | Synchronize and capture current pixels once, even if the canvas has not drawn since activation |
| Signal unavailable or observation fails | Preserve content and normal capture; explicit refresh remains available |
| Explicit refresh is called | Honor it independently of automatic observation and `live` |

**Idle means no producer drawing, topology changes, or existing capture demand.**
A producer repeatedly drawing identical pixels is still drawing. This feature
does not compare images to discover visual equality. After setup and queued
work settle, an idle source must produce zero observer callbacks, automatic
refresh requests, snapshot copies, paints, or demand-rendered frames.

The observer must introduce no polling or periodic media work. The promise
covers Munari's work, not the entire browser process's CPU use. Browser tracing
must corroborate the counters on each supported configuration.

**First release.** Use `HTMLCanvasElement.captureStream()` with the frame-rate
argument omitted, then consume frames through a `MediaStreamTrackProcessor`
available in the document's Window. The capture specification makes omitted
rate change-driven; a positive rate starts a timer, while zero requires manual
frame requests. [Canvas capture specification](https://www.w3.org/TR/mediacapture-fromelement/#html-canvas-element-media-capture-extensions).

Feature-test this path and handle construction failures. Browser names alone
do not establish support. Worker-only processor implementations and browsers
without the processor use explicit refresh in this release. Processor exposure
differs across browsers. [Processor documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor).

The first release covers canvas content already supported by `Surface.HTML`,
`SceneSurface.HTML`, and `CaptureContent`, in the current document. It leaves
`useElementCapture`'s existing canvas rejection unchanged. Standalone
`OffscreenCanvas`, worker-rendered placeholders, video-frame observation,
cross-document trees, and new shadow-root traversal are separate work.
Raw `DomTextureSource` callers retain their current engine behavior and
explicit repaint control.

**Existing evidence.** The 2026-10-11 session used Chrome `155.0.8059.40`.

| Experiment | Observed result |
|---|---|
| Processor attached to a real snapDOM Surface | Two idle seconds produced zero frames, refreshes, and paints |
| Eight drawings in one task | One frame notification, one refresh, one paint, and the correct final blue pixels |
| Stop observer, then draw | No further callbacks or captures |
| Hidden ordinary canvas | A redraw still delivered a processor frame |
| Video element as receiver | Seven idle media events in 1.8 seconds, plus compositor work |

These were feasibility experiments, not release acceptance. Their temporary
scripts and raw logs are not retained in this checkout. Implementation must
reproduce them in the owning instrument. They do not establish GPU-canvas
fidelity, active rendering cost, long idle periods, or other browser behavior.

## Ownership and execution

Use one internal canvas-frame watcher, attached by the content owner. It owns
tracks, readers, discovery, and disposal. Its output is an invalidation signal.
The existing source owner remains responsible for copying content and capturing
pixels; the renderer remains responsible for upload and presentation evidence.

| Integration point | Observation and response |
|---|---|
| [Retained Surface HTML](../packages/react/src/primitives/Surface.tsx) | Observe the original `liveRoot`, including a root that is itself a canvas. Synchronize its retained copy before the affected part captures |
| [Scene-owned HTML](../packages/react/src/primitives/surface/surfaceSourceHost.tsx) | Observe the authoritative adopted source and request that source's capture |
| [CaptureContent connection](../packages/react/src/primitives/capture.tsx) | Follow the connection's adopted source, `live` state, and lifetime |
| [Raster scheduler](../packages/core/src/paint/rasterizedSource.ts) | Retain the existing capture period, cost gap, and one-running-plus-one-owed policy |

**Discovery and ownership.** Observe only authored canvas elements. Exclude
Munari's snapshot copies, capture backing canvases, host renderer output, and
subtrees owned by another capture source. An authored WebGL chart is distinct
from Munari's renderer output; its compatibility is a release gate below.
Reuse existing topology notifications where possible. Otherwise use a scoped
observer for child-list changes and canvas width/height attributes. Reconcile
on additions, removals, replacements, and dimension changes, not on every
received frame. A healthy observer follows resize without being recreated.
Zero-to-positive dimensions or a resize that clears taint may admit one fresh
setup attempt for a stopped observer. Do not call `getContext()` to classify a producer;
that could claim an uninitialized canvas's context before the author does.

A retained node moving between its page holder and capture container keeps
its producer identity. Re-evaluate whether browser-owned invalidation now
covers it; suspend or resume the transport when that need changes. Each restart
gets a new lifetime token and catch-up, with no overlapping observers. Source
replacement revokes the old lifetime. Duplicate or rejected controllers cannot
install observers. Multiple valid subscribers to one canvas must share one
owned track and reader, with independent releases.

**Refresh ordering.** Close each delivered `VideoFrame` promptly, then mark the
owning source dirty. Never turn the frame or its timestamp into a Munari paint,
readiness, or presentation receipt. Continue using the existing capture pixels
and color/alpha path. A notification means a producer frame became available;
it does not guarantee that the original canvas remains readable indefinitely.

Keep one pending reader operation per track and request a processor buffer
capacity of one. Close buffered or late frames during cleanup as well.

Automatic notifications refresh only the affected part. Calling handle-wide
`store.refresh()` would unnecessarily capture sibling parts. Aggregate multiple
canvases and incoming frames into one pending source request. Requests arriving
during capture may owe one follow-up; they cannot form a backlog.

Retained-copy preparation must also be coalesced. Rebuilding a DOM snapshot for
every video frame while capture waits would move the cost rather than remove it.
Synchronize the latest authored bitmap before the admitted capture reads it.
If the current source interface needs an internal preparation callback to do
this, add it at that scheduling boundary. Keep native paint timing valid and
preserve explicit refresh requests when cancelling automatic work. Automatic
requests use normal pacing, including the current snapDOM live period of
`250 ms`; they never request an immediate bypass.

Use browser-owned invalidation where it already observes the authoritative
canvas. A direct HTML-in-canvas source must not pay for a redundant stream or
extra capture. A retained copy may still need an observer while its original
draws elsewhere. Resolve this through source ownership and engine behavior,
not browser-name checks or assumptions based on unrelated paint counters.

**Lifecycle and failure.**

| Transition | Required action |
|---|---|
| Eligible canvas attaches, or `live` becomes true | Attach once and perform bounded catch-up; coalesce initial stream delivery rather than blindly discarding the first frame |
| Canvas leaves its authoritative subtree | Revoke that subscription and release resources when the last subscriber leaves |
| `live` becomes false | Revoke automatic callbacks and cancel automatic-only pending work; preserve manual and input demand |
| Part or connection is replaced or unmounted | Invalidate its lifetime token before asynchronous cleanup |
| A pending read resolves after revocation | Close the frame and perform no copy, capture, or renderer invalidation |
| Setup throws, a track ends or mutes, or a read rejects | Clean up the observer and retain manual fallback |

Cancel pending reads, close delivered frames in failure paths, release reader
locks, and stop only tracks created by Munari. Never stop the producer, its
animation loop, or its graphics context. No automatic retry timer is allowed.
Replacement, an observed dimension change that can restore eligibility, or a
new `live` activation may make one fresh setup attempt. Unrelated DOM mutations
do not retry a failed observer.

Missing capability is expected. Report a concise development diagnostic once
per affected owner and reason, with explicit refresh guidance. Optional observer
failure must not mark the capture engine unsupported, hide content, or change
its presentation state. Existing capture failures still follow `onError`.
Tainted canvases remain subject to normal browser security restrictions.

## Acceptance and delivery

**Resolve pixel lifetime first.** The prototype used a 2D canvas. Before enabling
an automatic, context-agnostic path, prove that recapturing after notification
still reads the producer's correct pixels. Test 2D, WebGL with both
`preserveDrawingBuffer` settings, and WebGPU canvas contexts. Include alpha,
resize, clear, and a final frame followed by inactivity. GPU drawing buffers may
have a different lifetime from the captured media frame.

If this gate fails, stop before broad enablement and revise the design. Do not
silently ship blank frames, probe context type by claiming it, or substitute
video-frame pixels into the capture pipeline. A narrower opt-in contract or a
different pixel-ownership design would require its own reviewed decision.

Extend [the existing refresh fixture](../instruments/api-instance/refresh.tsx)
and [lifecycle runner](../instruments/api-instance/lifecycle.mjs). Measure final
visible pixels as well as source pixels; the current refresh fixture alone
proves only the latter. Keep browser runs serial and verify the actual capture
engine and processor path before counting a pass.

| Case | Required evidence |
|---|---|
| Retained and direct sources, both engines | The final drawing reaches the texture and visible output without a producer calling refresh; content state and source identity survive |
| Real handoffs | Page-copy and scene ownership changes preserve the last drawing and reject stale callbacks |
| Burst and sustained drawing | Latest frame eventually wins; one running and at most one owed capture; snapshot-copy work follows admitted capture work, not producer frame count |
| Manual and automatic overlap | Pending signals share admitted work; disabling automatic observation preserves manual/input demand; late delivery stays bounded |
| Several canvases and parts | Signals coalesce within a part; unrelated parts do not repaint; subscriptions do not duplicate |
| `live` toggles | False creates no subscriptions; true captures a static latest drawing; false during a pending read produces no later automatic work |
| Topology and teardown | Add, remove, replace, resize, root-canvas, unmount, and rapid remount exercise cleanup; a released frame cannot affect a successor |
| Fallbacks | Missing processor, constructor failure, taint, ended/muted track, and read rejection preserve manual refresh and produce no retry loop |
| Native capture overlap | Already-covered canvas draws do not gain a second capture or redundant stream |
| Provenance | Observer notifications alone never make readiness true or release a page hold |

An automatic frame can arrive after an explicit capture completed. The signals
have no shared draw identity, so exact deduplication is not promised. Do not
use media timestamps as a substitute for Munari capture provenance.

For idle acceptance, use a demand renderer and stop all fixture drawing. Wait
for the final visible pixels and pending capture work to settle, then observe
three independent `10 s` windows. Require zero delivered observer frames,
automatic requests, copies, paints, and renderer frames in each window.
After disposal, draw again and require zero effects from the disposed observer.
Use an external measurement clock so the probe itself does not install an idle
frame loop. Compare browser traces with an observer-disabled control to detect
new recurring media, compositor, or timer work.

Measure active overhead separately at representative canvas sizes and counts.
Report source-copy counts, capture counts, frame time, main-thread blocking,
and retained resources against explicit-refresh and observer-disabled controls.
The idle result is not evidence that active stream capture is free. Record
these profiles before broad enablement; no active-cost budget was established
by the feasibility experiment.

Use deliberate faults: remove the frame consumer, skip retained-copy
synchronization, leak a late callback, and add periodic invalidation. Each must
fail its corresponding pixel, lifecycle, or idle assertion. Capability absence
is fallback evidence, not an enhanced-path pass.

Delivery order: first resolve producer pixel lifetime and active cost; then
implement the shared watcher and owning-boundary lifecycle tests; wire the
three content owners; finally run the browser matrix and required unit,
typecheck, lint, and build checks. Update usage guidance only when implemented.
Any CI membership change needs separate approval. Polling, hidden video
receivers, global drawing-method patches, and worker transports are outside
this release.
