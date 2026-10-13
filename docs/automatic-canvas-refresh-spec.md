# Automatic canvas refresh

**Status: proposed, unbuilt. Updated 2026-10-12.**
Source baseline: `3aed4ea`. This specifies a progressive enhancement to `live`.
It does not describe behavior shipped in the package.

## Product contract

A canvas drawing changes pixels without changing its DOM. With `live` enabled,
Munari uses delivered canvas frames to request captures. Automatic observation
is best effort, including on configurations that pass the release gates. A
browser can silently discard the final notification, leaving the Surface stale
until another change or an explicit refresh requests capture.

When drawing stops, observation must settle without polling. The idle and
processing requirements below apply to accepted configurations. Other capable
configurations may attempt observation without those guarantees. Authors keep
the existing `live` option and `useSurfaceRefresh()` API.

```tsx
<Surface inScene={inScene} live>
  <CanvasContent />
</Surface>
```

Authors who can tolerate missed updates may rely on automatic observation.
For reliable invalidation, the producer must call the function returned by
`useSurfaceRefresh()` after updates that need a fresh capture, including the
final drawing. This is required on accepted configurations too. Requests
coalesce into captures of the latest state; they do not preserve intermediate
frames. An explicit request still depends on readable pixels and the capture
engine succeeding. Rendering readiness waits for the resulting frame to be
presented.

This release adds no observation-status API. Ordinary Surface input, layout,
capture, and handoff behavior continue to apply.

Automatic updates follow the capture engine's pacing. Automatic snapDOM
requests use its `250 ms` minimum interval between capture starts. Capture
and presentation add latency, so authors should expect sampled updates.
Explicit refresh keeps its existing behavior.

| Situation | Required behavior |
|---|---|
| `live` is true and a frame is delivered | Invalidate the owning HTML part |
| The final frame notification is silently dropped | The last capture may remain displayed; the producer's explicit refresh requests the new pixels |
| `live` is false | No automatic canvas subscription or canvas-driven refresh; existing input behavior remains |
| `live` changes to true | Request one catch-up capture of current pixels, including in fallback and when no new drawing occurs |
| Signal unavailable or observation fails | Preserve content and normal capture; explicit refresh remains available |
| Explicit refresh is called | Honor it independently of automatic observation and `live` |

**Idle means no producer drawing, topology changes, or existing capture demand.**
A producer repeatedly drawing identical pixels is still drawing. This feature
does not compare images to discover visual equality. After setup and queued
work settle, an idle source must produce zero observer callbacks, automatic
refresh requests, snapshot copies, paints, or demand-rendered frames.

The observer must introduce no polling or periodic media work. This includes
recurring browser work caused by tracks Munari creates, even when JavaScript
counters stay at zero. Unrelated browser activity is outside the promise.
Browser traces must corroborate the counters on each configuration accepted
for release.

**First release.** Use `HTMLCanvasElement.captureStream()` with the frame-rate
argument omitted, then consume frames through a `MediaStreamTrackProcessor`
available in the document's Window. The capture specification makes omitted
rate change-driven; a positive rate starts a timer, while zero requires manual
frame requests. [Canvas capture specification](https://www.w3.org/TR/mediacapture-fromelement/#html-canvas-element-media-capture-extensions).

Feature-test this path and handle construction failures. Browser names alone
do not establish support. Worker-only processor implementations and browsers
without the processor use explicit refresh in this release. Processor exposure
differs across browsers. [Processor documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor).

The processor may discard queued frames without ending the track or rejecting
a read. A one-frame buffer keeps the newest queued frame but cannot guarantee
that any frame remains queued. A stopped producer supplies no later notification
to reveal the loss. Silence therefore cannot distinguish an idle canvas from a
missed drawing. This design uses explicit producer refresh for reliable
invalidation; it adds no idle watchdog, loss-counter polling, or retry timer.
[Processor queue contract](https://www.w3.org/TR/mediacapture-transform/#mediastreamtrackprocessor).

The first release covers canvas content already supported by `Surface.HTML`
and `SceneSurface.HTML`, in the current document. Their explicit fallback is
`useSurfaceRefresh()`. `CaptureContent` is deferred because its
[`CaptureHandle`](../packages/react/src/primitives/capture.tsx) has no public
refresh method. Extending it needs a separate API decision that provides the
same fallback. `useElementCapture` keeps its existing canvas rejection.
Standalone `OffscreenCanvas`, worker-rendered placeholders, video-frame
observation, cross-document trees, and new shadow-root traversal are separate
work.
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
| [Retained Surface HTML](../packages/react/src/primitives/Surface.tsx) | Observe canvas descendants of the original div/span `liveRoot`. Synchronize its retained copy before the affected part captures |
| [Scene-owned HTML](../packages/react/src/primitives/surface/surfaceSourceHost.tsx) | Observe authored canvases in the source, including the root when `SceneSurface.HTML element` adopts a canvas. Request that source's capture |
| [Raster scheduler](../packages/core/src/paint/rasterizedSource.ts) | Retain the existing capture period, cost gap, and one-running-plus-one-owed policy |

**Discovery and ownership.** Observe only authored canvas elements. Exclude
Munari's snapshot copies, capture backing canvases, host renderer output, and
subtrees owned by another capture source. An authored WebGL chart is distinct
from Munari's renderer output; its compatibility is a release gate below.
Reuse existing topology notifications where possible. Otherwise use a scoped
observer for child-list changes and canvas width/height attributes. Reconcile
on additions, removals, replacements, and dimension changes, not on every
received frame. An eligible canvas belongs to the current authoritative source,
has positive bitmap dimensions, has `live` enabled, and needs observation
because native capture does not follow its drawings. Setup also requires the
Window processor capability and successful stream construction.

A healthy observer follows resize without being recreated. Remember numeric
width and height so assigning the same value does not count as a size change.
Do not call `getContext()` to classify a producer; that could claim an
uninitialized canvas's context before the author does.

A retained node moving between its page holder and capture container keeps
its producer identity. Re-evaluate whether browser-owned invalidation now
covers it; suspend or resume the transport when that need changes. Each restart
gets a new lifetime token and catch-up, with no overlapping observers. Source
replacement revokes the old lifetime. Duplicate or rejected controllers cannot
install observers. Each authoritative source owns one watcher, with at most
one track and reader per authored canvas. Presenters share that source's
runtime, so this release needs no registry of subscribers across owners.

**Refresh ordering.** Close each delivered `VideoFrame` promptly, then mark the
owning source dirty. Never turn the frame or its timestamp into a Munari paint,
readiness, or presentation receipt. Continue using the existing capture pixels
and color/alpha path. A notification means a producer frame became available;
it does not guarantee that the original canvas remains readable indefinitely.

Keep at most one pending reader operation per track and request a processor
buffer capacity of one. Close buffered or late frames during cleanup as well.
This bounds retained frames, not frame-delivery or browser capture cost.
Measure those costs at producer frame rates. Any later change to reading
cadence must process delivered notifications, resume after idle, and preserve
explicit refresh. It cannot turn this stream into a lossless change signal.

Automatic notifications refresh only the affected part. Calling handle-wide
`store.refresh()` would unnecessarily capture sibling parts. Aggregate multiple
canvases and incoming frames into one pending source request. A notification
received during capture owes one follow-up unless the owner can prove the
current capture includes that change. Further notifications share that owed
capture. Each delivered notification and explicit refresh must leave capture
demand pending until serviced or cancelled by a documented lifecycle transition.
A silent drop creates no demand and need not cause a detectable fallback state.

Retained-copy preparation must also be coalesced. The current snapshot key
contains markup and form/scroll state, but excludes canvas pixels. Reusing that
key can miss a redraw. Forcing snapshot replacement on every capture instead
creates DOM mutations that the rasterizer treats as fresh demand.

Track a preparation revision within each part's source lifetime. Advance it for
delivered canvas notifications, explicit refresh, and authored changes requiring
a new copy. At capture admission, prepare the latest requested revision once,
before the capture reads it. Mark that revision prepared only after the copy
is installed. Preparation for an already installed revision performs no writes.
This local revision tracks preparation work; it is neither a producer frame ID
nor a paint or presentation receipt.

Treat preparation and its admitted read as one capture operation. Mutations
caused only by installing that copy, and already included in the read, must not
create follow-up capture demand. Preserve unrelated authored mutations, input,
manual refresh, and later canvas notifications, including those delivered in
the same observer batch. Blanket observer disconnection or discarding all queued
mutation records is not sufficient. A failed capture may retry its prepared copy
without replacing it again. Keep native paint timing valid.

If the source interface needs an internal preparation callback, put it at that
scheduling boundary. Track automatic demand separately from manual and input
demand, even when they share an admitted capture. Cancelling automatic work must preserve the
other causes. Automatic requests use normal pacing, including the current
snapDOM live period of `250 ms`. They never request an immediate bypass.

Use browser-owned invalidation where it already observes the authoritative
canvas. A direct HTML-in-canvas source must not pay for a redundant stream or
extra capture. A retained copy may still need an observer while its original
draws elsewhere. Resolve this through source ownership and engine behavior,
not browser-name checks or assumptions based on unrelated paint counters.

**Lifecycle and failure.**

| Transition | Required action |
|---|---|
| Eligible canvas attaches | Attach once and request one catch-up through the scheduler; coalesce initial frame delivery with pending work |
| `live` becomes true | Request catch-up even in fallback; attach observation only for eligible canvases |
| Canvas leaves its authoritative subtree | Revoke observation and release that canvas's resources |
| `live` becomes false | Revoke automatic callbacks and cancel automatic-only pending work; preserve manual and input demand |
| Part or connection is replaced or unmounted | Invalidate its lifetime token before asynchronous cleanup |
| A pending read resolves after revocation | Close the frame and perform no copy, capture, or renderer invalidation |
| Track mutes | Retain the track, reader, and lifetime; mute itself requests no capture or retry |
| Track unmutes | Request one catch-up through the scheduler, coalescing frame delivery; keep the same track and reader |
| Setup throws, a track ends, the readable stream completes, or a read rejects | Clean up the observer and retain manual fallback |

`mute` describes a temporary loss of data. It is distinct from `ended`.
Keeping the track allows browser-driven recovery without a retry timer.
The idle gate also applies while muted; retaining a track that causes recurring
browser work fails that gate. [Track lifecycle](https://www.w3.org/TR/mediacapture-streams/#media-flow-and-life-cycle).

Cancel pending reads, close delivered frames in failure paths, release reader
locks, and stop only tracks created by Munari. Never stop the producer, its
animation loop, or its graphics context. No automatic retry timer is allowed.
A canvas with zero dimensions waits for positive dimensions before its first
setup attempt. After failure, allow one size-triggered retry in that canvas's
current `live` activation. It requires changed numeric dimensions that are
positive. A second failure stays on manual fallback despite further resizes.
Same-value assignments and unrelated DOM mutations do not rearm setup.

Source replacement or a new `live` activation starts a fresh attempt and size
retry allowance. A browser `contextrestored`, `webglcontextrestored`, or persisted
`pageshow` event permits one recovery attempt for a failed observer per distinct
restoration. It does not refill the size retry allowance. Treat duplicate events
for that restoration as one trigger, and leave healthy observers attached.
These events permit an attempt. They do not prove that the canvas or capture
engine has recovered.

A same-size reset may clear taint, but it does not restart failed setup because
some producers reset on every drawing. A retained muted track can recover through
`unmute`. Once the retry allowance is spent, later size changes also leave
setup stopped.
Explicit refresh or a new `live` activation remains available. Taint still
prevents capture until the canvas is origin-clean.

Missing capability is expected. Report a concise development diagnostic once
per affected owner and reason, with explicit refresh guidance. Optional observer
failure must not mark the capture engine unsupported, hide content, or change
its presentation state. Existing capture failures still follow `onError`.
Tainted canvases remain subject to normal browser security restrictions.

## Acceptance and delivery

**Resolve pixel lifetime first.** The prototype used a 2D canvas. Before enabling
an automatic, context-agnostic path, prove that recapturing after notification
still reads the producer's correct pixels. Test 2D, `bitmaprenderer`, WebGL
with both `preserveDrawingBuffer` settings, and WebGPU canvas contexts in
retained and direct sources. Include alpha, resize, clear, hidden source
holders, and a final frame followed by inactivity. GPU drawing buffers may have
a different lifetime from the captured media frame.

Use known expected pixels as the oracle. Compare explicit and automatic refresh
to locate regressions, but two incorrect captures do not count as a pass. Include
notification delay and the normal capture wait in the test. For each producer,
record the supported API contract that keeps its pixels readable until capture.
WebGL does not guarantee later readback with `preserveDrawingBuffer: false`.
A successful run on one browser cannot establish that guarantee.
[WebGL drawing buffer](https://registry.khronos.org/webgl/specs/latest/1.0/#THE_DRAWING_BUFFER).

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
| Retained and direct sources, both engines | In the normal delivery case, the known final drawing reaches visible output without producer refresh; record delivered notifications and preserve content state and identity |
| Real handoffs | Page-copy and scene ownership changes preserve the last drawing and reject stale callbacks |
| Burst and sustained drawing | Delivered notifications produce current pixels under the scheduler's pacing; one running and at most one owed capture; each prepared revision is installed at most once |
| Silent notification loss | Omit the final notification while keeping the track healthy; explicit producer refresh must recover the known final pixels without polling or false new presentation evidence |
| Preparation feedback | One redraw settles after its admitted work; copy installation alone cannot sustain captures; authored changes arriving during preparation remain captured |
| Manual and automatic overlap | Pending signals share admitted work; disabling automatic observation preserves manual/input demand; late delivery stays bounded |
| Several canvases and parts | Signals coalesce within a part; unrelated parts do not repaint; subscriptions do not duplicate |
| `live` toggles | False creates no subscriptions; true captures a static latest drawing; false during a pending read produces no later automatic work |
| Topology and teardown | Add, remove, replace, resize, unmount, and rapid remount exercise cleanup; test descendant canvases in retained Surface and an adopted canvas root in SceneSurface; late frames cannot affect a successor |
| Fallbacks and retries | Missing processor, constructor failure, taint, ended track, stream completion, and read rejection preserve manual refresh; repeated same-size resets and failed real resizes obey the retry limit |
| Recovery | Drawing after long idle, mute/unmute, context restoration, and page restoration reaches final visible pixels or the specified failure path; valid stale-callback rejection still holds |
| Native capture overlap | Already-covered canvas draws do not gain a second capture or redundant stream |
| Provenance | Observer notifications alone never make readiness true or release a page hold |

Normal automatic cases require observed delivery and the expected visible
pixels. Missing delivery fails that acceptance attempt; it cannot be relabelled
as a pass because observation is best effort. Passing runs establish behavior
under their recorded conditions, not a future delivery guarantee.

For the deliberate loss case, first let the baseline capture settle. Draw one
new final image, omit only its media notification, and keep the track and reader
healthy. Confirm that no new paint or presentation receipt is invented and no
periodic recovery work begins. Then call the producer's refresh function and
require the final image to reach visible output. Exercise this where the media
observer owns invalidation. This injected omission tests the documented recovery
path; it does not measure how often a browser drops frames.

An automatic frame can arrive after an explicit capture completed. The signals
have no shared draw identity, so exact deduplication is not promised. Do not
use media timestamps as a substitute for Munari capture provenance.

**Idle and recovery.** Use a demand renderer and stop all fixture drawing.
Require final visible pixels and pending work to settle within a fixed deadline
recorded with the configuration's latency budget. Start the deadline when the
producer stops. Captures and preparation writes cannot extend it. A missing
deadline leaves the gate unverified; expiry fails it even if the idle window
never starts.

After settling, observe one continuous `30 s` idle period, scored as three
`10 s` windows. Extend the period if traces suggest later recurring work. These are proposed test durations,
not a measured limit on browser timers.
Require zero delivered observer frames, automatic requests, copies, paints, and
renderer frames in each window. Then draw a distinct final image. In this normal
delivery case, require both a notification and visible output within the declared
latency limit, without manual refresh, remounting, or toggling `live`. A dead
observer must fail this recovery check even if its idle counters pass.
Repeat for each accepted producer, source, and engine combination, including
a retained page holder and a handoff that resumes observation.

Exercise mute/unmute separately and record whether long idle itself causes
those events. An idle or recovered healthy source must not silently fall back.
For injected terminal failures, require cleanup and working explicit refresh
where browser security still allows capture. After disposal, draw again and
require zero effects from the disposed observer.

Use an external measurement clock so the probe installs no idle frame loop.
Compare traces with an observer-disabled control in normal, muted, and resumed
states. Any additional recurring media, compositor, or timer work attributable
to Munari's observer fails the idle gate. If attribution is unresolved, the gate
is unverified. Record trace categories and intervals so another run can decide
the same claim. Zero JavaScript callbacks alone cannot pass it.

**Configurations.** Before running acceptance, record exact browser builds,
OS versions, GPU adapters and backends, flags, viewport, and device pixel ratio.
The first release must cover these configurations:

| Configuration | Required path |
|---|---|
| Desktop Chrome on macOS with hardware rendering | Both capture engines, real handoffs, pixels, recovery, idle traces, and active profiles |
| Desktop Chrome on Linux with SwiftShader | The same behavior gates using the instrument's software-rendering path; report performance separately |
| Chrome without `CanvasDrawElement` | snapDOM observation where available and normal capture fallback |
| Window processor missing, including worker-only exposure | Manual-refresh fallback with no observer resources; use real absence and injected construction/read failures |

These are acceptance targets, not recorded passes. An unavailable target leaves
its path unverified. Accepted enhanced-path configurations define the support
scope for the observation mechanism. Each needs passing pixel, recovery, idle,
and active-cost evidence. Acceptance does not guarantee delivery of every
producer change. The processor-missing row tests manual fallback and
cleanup; it cannot count as an enhanced-path pass.

Feature detection remains the runtime activation rule. A capable configuration
outside that support scope may attempt observation, but has no verified idle,
processing, or performance guarantees. Usage guidance must name the accepted
configurations and require producer refresh wherever missed updates are
unacceptable, including within that support scope.
A browser allowlist is not part of this design; API presence alone is not
acceptance evidence.

Check background/foreground and back/forward navigation against a control.
Record whether the page is restored from the back/forward cache, including any
reported reason it was excluded. A new cache exclusion or failed recovery must
be resolved or receive an explicit scoped design decision before release.
This is an investigation gate; no such browser regression is established here.

**Active cost.** Profile representative canvas sizes, canvas counts, and producer
frame rates against explicit-refresh and observer-disabled controls. Record
frame deliveries, source copies, captures, end-to-end update latency, frame
time, main-thread blocking, and retained resources. Keep hardware and software
results separate. A one-frame buffer and paced capture do not cap producer-side
media work or notification cost.

Feasibility work must produce numeric release limits for delivered-notification
latency, explicit-refresh latency, settling time, added frame time and blocking,
and retained resources. Record the workloads, comparison method, limits,
and their measured rationale in this spec before
implementing general enablement. Validate recovery within the declared latency
limit while the document is active. Missing limits, exceeded limits, or resource
growth across repeated attach/dispose cycles block release. Profiling alone is
not acceptance. No active-cost budget has been established yet.

Use deliberate implementation faults: remove the frame consumer, skip
retained-copy synchronization, stop observation after its first idle period,
leak a late callback, and add periodic invalidation. Each must fail its
corresponding pixel, recovery, lifecycle, or idle assertion.

For preparation feedback, force snapshot replacement on every capture and let
that replacement request another capture. This loop must fail the fixed settling
deadline even if the idle window never starts. The separate silent-loss case
must pass its explicit-recovery assertions; it does not require an automatic
update for a notification that was never received. Capability absence is
fallback evidence, not an enhanced-path pass.

Delivery order: first resolve producer pixel lifetime, idle recovery, and
active cost with reproducible instrument work. Record the measured configuration
matrix and numeric budgets. Then implement the source-owned watcher and its
lifecycle checks, wire the two Surface content owners, and run acceptance plus
required unit, typecheck, lint, and build checks. A failed feasibility gate
requires a design revision before general enablement. Update usage guidance
only when implemented, including pacing, possible silent notification loss,
and the producer's explicit refresh path.
Any CI membership change needs separate approval. Polling, hidden video
receivers, global drawing-method patches, and worker transports are outside
this release.
