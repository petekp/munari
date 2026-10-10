# Performance audit

Status: assessment complete, 2026-09-26. Source revision: `ec99e74`, branch
`pkp/browser-gates-macos`. No runtime, dependency, or CI changes were made.

Reviewed on 2026-09-27 by Claude Opus 5.5 at maximum effort through the
read-only CLI. An independent assessment, a local file that was not retained,
was checked against source before revising this report. Remedies are
unimplemented unless a finding's status says otherwise. Some were narrowed or
rejected as described below.

iOS follow-up: completed on iPhone 17 Pro / iOS 26.2 and iPhone 16e / the
iOS 18.3 simulator runtime. Both used DPR 3. The older runtime's user agent
reports iOS 18.3.1 and Safari 18.3. Safari 26.2 reports a compatibility user
agent containing iOS 18.7; WebDriver capabilities identified its actual
runtime as iOS 26.2, build 23C54. Findings and limits are below.

The texture-size guard, the success report for a paint with no retained 2D
context, snapDOM's duplicate upload and the unused native-route host-space
read were fixed on 2026-09-29. The largest remaining shared opportunities are reducing
full-subtree copying (finding 2) and idle placement polling (finding 3). For
snapDOM, reduce excess font loading (finding 6) before attempting a new capture
scheduler. Incremental capture has substantial potential, but the current
plugins, reconciliation setting, and lab CSS all prevent it.

This assessment covers capture latency, input response, idle work, texture
memory, and scene costs. Confirmed work does not establish a measured battery
penalty. The initial audit used desktop Chrome. The follow-up used actual
Simulator MobileSafari, not desktop viewport emulation. Physical mobile
hardware performance remains unverified.

**Recommended implementation sequence, 2026-09-27.**

1. **Fix allocation and paint correctness first.** Done 2026-09-29 (finding 1
   and the missing-context paint; decisions #21 and #60). Enforce backing-size
   limits in the kernel and keep the binding's resize/density state consistent.
   Reject a rasterized paint when the retained canvas cannot draw it.
   These are reproduced failures, and the allocation fix protects both engines.
   Extend the owning conformance checks for initial allocation, growth, direct
   kernel callers, and failed drawing; update the relevant decision entry.
2. **Remove the demonstrated redundant work in small changes.** Done
   2026-09-29 (finding 4, and finding 5's host-space read). Make the
   trailing upload depend on whether captured pixels are final, preserving the
   HTML-in-canvas safeguard. Separately move native-route eligibility checks
   before expensive geometry preparation. Verify actual changed pixels and
   uploads, including resize and lit materials; do not infer success from a
   reduced callback count alone.
3. **Measure and optimize Home separately.** Count its own texture updates and
   attribute cost to the shadow, headline and bulb passes at native density.
   Compare one pass at a time. Implement the resulting crop, reuse, or redraw
   change while retaining independent animation and native text clarity.
   This has the strongest observed simulator performance opportunity, but its
   exact dominant pass remains unmeasured.
4. **Use focused probes to select the next capture work.** Measure selective
   font warming against first-frame latency. Check post-touch idle raycasts,
   exact-density allocation churn, and Selection's density/filter choices.
   Advance only candidates with a demonstrated cost and a preserved behavior.
   Defer incremental snapDOM capture, whole-tree reuse, and scheduler redesign
   until these smaller changes establish what remains expensive.
5. **Establish physical-device evidence alongside the implementation.** Use
   an iPhone and a midrange Android device for input-to-visible latency,
   scrolling, pinch zoom, keyboard changes, memory pressure and sustained work.
   Preserve device, browser, density and power-state metadata. Simulator
   comparisons remain useful, but do not replace those observations.

Keep the kernel, binding and Home changes independently reviewable. For each
runtime slice, run its owning behavioral checks and the required test,
typecheck, lint and build commands. Run relevant browser checks serially on
both engines, with explicit capability evidence for HTML-in-canvas. Retain
tests for material contracts rather than the particular patch shape.

## iOS Simulator follow-up

**Home's continuous rendering is the first iOS optimization target.** It
remains expensive with zero new snapDOM captures. In the first normal-Safari
comparison, native 3× density produced 29 animation callbacks per second;
a diagnostic 1× density produced 59.3. A later 3×/1×/3× sequence produced
15.0/53.0/17.4 callbacks per second. Each measured six seconds and performed
zero captures. The final plain-page control returned to 60.2.

Absolute timings varied between runs on this shared Mac. The repeatable
finding is sensitivity to rendering resolution, not a predicted iPhone FPS.
The diagnostic changed the JavaScript DPR value before initialization. It
reduced backing dimensions while preserving CSS layout; it did not emulate
another device or implement a shipping quality policy.

Home has five canvas elements in this configuration. Its shadow band
alone is 1206×4284 at native density, versus 402×1428 in the diagnostic.
[`HomeMasthead`](../apps/lab/src/scenes/home/HomeMasthead.tsx) keeps drawing
the shadow, headline and bulb. The bulb
[`backdrop`](../apps/lab/src/scenes/home/homeLampBackdrop.ts) uploads
already-rendered canvases into its own context. Crop the required regions,
reuse unchanged images, and separate effect resolution from text resolution.
These changes can benefit both capture engines. No GPU-duration measurement
isolated a particular pass in this audit.

The collector's upload counter covers Surface runtime textures only. Home's
own canvas-to-texture updates bypass it. A Home record with `uploads: 0`
therefore does not establish zero GPU uploads. The lighting band alone has
about 19.7 MiB of RGBA image data at the observed dimensions. Its byte size is
arithmetic, not measured transfer bandwidth. Add a counter at the backdrop's
upload helper and isolate the bulb pass before attributing the slowdown.

| Workload | Animation callbacks/s | p95 interval | Capture work in the window |
|---|---:|---:|---|
| iOS 26.2 plain page, final control | 60.2 | 17 ms | None |
| iOS 26.2 Home, native density, final pair | 15.0 / 17.4 | 123 / 71 ms | None |
| iOS 26.2 Home, diagnostic 1× density between those runs | 53.0 | 30 ms | None |
| iOS 26.2 Knobs, settled earlier run | 58.7 | 17 ms | None |
| iOS 26.2 Genie, idle | 57.7 | 23 ms | None |
| iOS 26.2 Genie, 12s window containing three programmatic round trips | 52.2 | 36 ms | 21 captures; median wall time 54 ms, p95 77 ms |
| iOS 26.2 Selection, selected text displayed | 60.0 | 17 ms | None; reused existing capture |
| iOS 18.3 plain page | 57.2 | 17 ms | None |
| iOS 18.3 Home, native density | 26.5 | 46 ms | None |
| iOS 18.3 Knobs, initial settling window | 55.7 | 20 ms | One capture taking 125 ms of wall time |

These are `requestAnimationFrame` intervals, not measured display presentation
or isolated CPU/GPU execution. Capture wall time includes yields and decode.
Genie's cycles ended at 8.3 seconds, leaving about 3.7 seconds of idle time
inside its 12-second sample.
Do not compare the two OS versions as a controlled performance regression
test: device viewport sizes differ and host load was not isolated.

The idle rows also represent different rendering policies. Knobs made about
55 draw calls per frame in its earlier settled run; Selection made one.
Genie's idle run made none. Knobs explicitly uses an always-running loop;
Selection inherits the Canvas default. Demand rendering is a candidate for
Selection only if its easing continues to request frames until it settles.

**Repeated upload identities also occur on iOS.** Genie's three round trips
completed with 19 texture upload callbacks. Seven repeated the preceding
generation and read identity. Its fixed-resolution, single-renderer path
makes these consistent with the trailing uploads reproduced in the controlled
desktop fixture. The collector does not distinguish context, texture view, or
allocation per event, so it does not independently establish seven removable
uploads. At the recorded 930×690 dimensions their image-byte equivalent is
17.1 MiB, not measured GPU traffic or demonstrated savings. All 21 captures
completed without capture failures. No JavaScript errors or WebGL context
loss were reported in that window.

**Selection captures considerably more pixels than the phone displays.**
Its [`resolution: 6`](../apps/lab/src/scenes/selection/Selection.tsx)
and fixed [520px column](../apps/lab/src/scenes/selection/selection.css)
establish a 3120-pixel capture width. The initial tool output reported
3120×3150 and two uploads, but the original JSON was overwritten by a hidden-tab
sample. The claimed height and 37.5/75.0 MiB estimates are therefore unretained
observations, not reproducible results in the saved files. Record dimensions
and uploads from navigation before relying on those totals.

Pinned resolution enables mipmaps. A lower density may preserve the displayed
glass text, but mip sampling alone does not prove that the 6× base is wasted:
the shader has varying refraction, dispersion taps, and anisotropic filtering.
Compare 6× against 3× and 4× with the same filter policy and pixel reference.
The fixed width plus horizontal padding also overflows a 402px viewport.
Responsive width can improve layout, but its taller text may offset pixel-area
savings; measure width times height.

**Zero idle draws still do not mean zero idle work.** The first settled Genie
run made zero WebGL draws and zero captures, but sampled placement 360 times
in six seconds. The final idle run repeated that relationship at its observed
frame cadence. This confirms the shared placement-polling finding on iOS.

**The tested rendering paths work on both simulator runtimes.** Home and
Knobs produced their expected scene content on iOS 26.2 and 18.3. On iOS 26.2,
three programmatic Genie minimize/restore cycles returned to visible page
content. A programmatically created five-line native selection retained its
text and produced the glass strips shown in the saved screenshot. State
completion and final screenshots do not prove every intermediate frame was
free of flashes. HTML-in-canvas capability was absent on both runtimes;
these enhanced-rendering results are snapDOM results.

Native touch scrolling and a hue change reached the page, but Safari's driver
then stopped answering diagnostics. A later touch sequence produced frame
gaps matching its programmed 1300 ms pauses and did not deliver all intended
events. Those timings and that handoff attempt were discarded. The successful
handoff and selection checks explicitly record `synthetic: true`; they do not
establish touch latency. Software-keyboard behavior, pinch zoom, physical
memory pressure, sustained thermals, and battery use remain unverified.

The audit used the lab development server with temporary instrumentation.
Automatic samples began after a route-specific readiness check and a one-second
wait. They do not establish cold-start, bootstrap, font-loading, or first-capture
performance. Some initial settling still entered the Knobs samples.
Final runs disabled hot reload and used a fresh loopback origin. Earlier
server restarts caused some old tabs to repeat samples; hidden-page records
and transport-error records were excluded. The final serial sequence completed
all nine scenarios. All final records began and ended with visible documents.
Safari reported the Long Tasks API as unsupported, so its empty long-task
arrays are not evidence of no long tasks.

The evidence was local and was not retained: a collector, a serial runner,
the final results, Genie capture/upload measurements, the Genie outcome, a
Selection screenshot and an iOS 18.3 Home screenshot.
The runner opens and measures only the two named simulator devices. Its
scripts and generated files are temporary diagnostics, not new CI gates.
The serial summary pairs each exercise's outcome with its preceding idle
metrics. The table above takes exercise timing from the separate
`-programmatic.json` files instead. A future runner should label both windows
explicitly.

Simulator executes iOS WebKit but uses the Mac's resources. Apple's
[Simulator graphics documentation](https://developer.apple.com/documentation/metal/developing-metal-apps-that-run-in-simulator)
describes the graphics differences. The next implementation order is: reduce
Home's large repeated passes, then validate capture-density and scheduling
changes on physical devices.

## Findings and fix order

**1. Growing captures can bypass the texture-size guard. Both engines.**

Status: fixed 2026-09-29. The kernel now grants each density against the
current box, as [decision #21](decisions.md#21) records. The reproduction below
cuts 532×4096 after growth, and 80×4096 and 41×4096 at birth.

High severity, confirmed bug, high confidence. In
[`setSize`](../packages/react/src/primitives/surface/surfaceSourceRuntime.ts),
automatic resolution does not reapply its density limit because its pinned
value remains `null`. A source created at 390×844 CSS pixels and DPR 3 starts
with a 1170×2532 canvas. Growing its height to 3000 produces **1170×9000**,
unchanged after 12 runtime frames. That exceeds the documented 4096-pixel
guard and needs about 40.2 MiB for one RGBA backing alone.

This is reachable through a growing body/html `useElementCapture`, which reads
full scroll dimensions and calls `setSize`. Such a capture has no mesh density
proposal to repair the allocation. Two related boundaries also fail:
[`clampTiers`](../packages/core/src/paint/lodTier.ts) retains an unsafe
minimum tier when none fit; [`clampRawScale`](../packages/core/src/paint/domTextureSource.ts)
can raise a safely clamped scale back to 0.1. The latter allocates 5000 pixels
for a 50,000-pixel document despite warning that it clamped to 4096.

Calculate bounded density and backing dimensions together, before resizing.
Verify initial allocation, growth, shrinkage, and explicit/ranged resolution.
The reproduced dimensions use the real runtime with stubbed 2D methods. A GPU
allocation failure or device crash was not reproduced.

The final bound belongs in the kernel, not only the binding. Home calls
[`createDomTextureSource`](../apps/lab/src/scenes/home/homeLampBackdrop.ts)
directly. The shared [allocation point](../packages/core/src/paint/domTextureSource.ts)
limits the scale multiplier, but not the texture edge. For its observed
402×714 box, DPR 3 and pinch scaling can request a long edge above 4096
once zoom exceeds about 1.91×. At the raw scale cap of 8, the dimensions are
3216×5712, about 70.1 MiB per RGBA image. This is source arithmetic, not a
reproduced phone allocation failure.

**An unavailable retained 2D context is reported as a successful paint.**
Status: fixed 2026-09-29. The draw now fails the capture, as
[decision #60](decisions.md#60) records.

High severity, confirmed conditional failure, high confidence. The rasterized
source's [`draw`](../packages/core/src/paint/rasterizedSource.ts) returns
without drawing when its retained canvas has no context; its caller still
publishes a completion receipt. A temporary fault-injection check, not
retained, using the real kernel returned `painted: true`, one receipt, and no
errors with a null context. Its output proved the handling defect, not an
actual memory-pressure trigger. The adapter
already rejects a missing context on its separate intermediate canvas. The
retained-canvas path should also fail without publishing success.

**2. Native-element capture repeats a costly whole-tree copy. Both engines.**

High-impact confirmed cost, high confidence. Each
[`copyElementForCapture`](../packages/react/src/primitives/elementCapture.tsx)
walks the subtree, reads computed styles and pseudo-elements, serializes all
style properties, and creates fresh nodes. The update replaces the previous
copy. With `live`, a running animation can request this every frame. The
snapDOM governor acts downstream, so it does not bound this copying.

A warmed synthetic subtree of simple divs measured as follows. Each row has
12 synchronous samples, with one additional warm-up copy:

| Elements including root | Median copy | Observed maximum |
|---|---:|---:|
| 11 | 2.6 ms | 3.2 ms |
| 101 | 23.6 ms | 27.0 ms |
| 501 | 117.5 ms | 125.3 ms |

These are desktop CPU times for copying only, before rasterization and upload.
The existing capture-cost probe passed on its native-element fixtures: 5–33
elements, with p95 copy times of 2.0–2.7 ms. Its separate 70-node Controls
fixture uses Surface's `snapshot` path and measured p95 1.0 ms. That is a
different operation; neither result establishes bounded full-page copy cost.

Start by avoiding rebuilds for placement-only changes and coalescing work with
the capture that will consume it. Then evaluate reuse of unchanged nodes and
styles. Preserve live form state, pseudo-elements, exclusions, and source/frame
identity. Measure real Selection and Veil interactions alongside larger trees.
On snapDOM, copying is only the first style pass. The parked copy is styled
again for snapDOM, then the font plugin reads styles across the subtree.
Measure the combined pipeline before designing incremental reuse or bypassing
the retained-copy contract.

**3. Demand rendering still polls placement every frame. Both engines.**

Medium severity, confirmed work, high confidence. Every
[`SurfaceCanvas`](../packages/react/src/primitives/surface/SurfaceCanvas.tsx)
registers a placement watcher. [`sample`](../packages/react/src/primitives/surface/surfacePlacement.ts)
reads rectangles, creates snapshots, and schedules another animation frame
while any watcher remains.

An empty demand canvas and a settled scene each performed **60 placement
samples in one second**, with zero capture paints and zero texture uploads.
This repeated under snapDOM without the native feature flag. More surfaces
add watched boxes, although shared elements are deduplicated within each frame.
The current idle-zero gate measures capture paints and cannot catch this cost.

Scope polling to relevant motion and use explicit invalidation where possible.
Retain the existing sibling-layout movement behavior: ResizeObserver alone
cannot detect every position change. Measure idle main-thread time and device
energy before claiming a battery saving.

**4. snapDOM retains an unnecessary trailing-upload policy.**

Status: fixed 2026-09-29. A source states whether its draw can trail its
paint, and the runtime makes the second upload only for one that does, as
[decision #60](decisions.md#60) records. `npm run probe:texture-uploads`
measures 1 upload per changed image on snapDOM and 2 on HTML-in-canvas. The
environment-bake cost described below is unmeasured.

Medium severity, confirmed duplicate uploads, high confidence. The shared
[`source runtime`](../packages/react/src/primitives/surface/surfaceSourceRuntime.ts)
adds one trailing upload to cover deferred HTML-in-canvas rendering. snapDOM
finishes drawing its bitmap before reporting completion, but inherits the rule.

For one changed 240×120 source, the browser observed one paint receipt and
**two actual Three.js texture upload callbacks with the same generation and
read identity**, about one frame apart. The no-flag snapDOM run reproduced it.
HTML-in-canvas also uploaded twice, as the current policy intends.
This is a fixed-size, single-renderer fixture. The trailing upload occurs
when the paint counter stops changing; captures can otherwise be coalesced,
superseded, or never sampled. Separate contexts, lit texture views, and
allocation changes can legitimately upload the same generation again.

Represent completion timing at the capture-engine boundary and omit the extra
upload for completed rasters. Preserve the native trailing upload until pixel
evidence proves it unnecessary. Validate changing pixels, in-flight resizing,
and mipmapped materials before accepting the optimization. This probe counted
uploads; it did not prove an optimized implementation's pixel correctness.

The cost can propagate beyond the upload. [Capture publication](../packages/react/src/primitives/capture.tsx)
includes texture version, so the trailing upload can publish another frame
revision. Marble Hand uses that revision in its environment-bake key.
If both revisions reach separate eligible frames, an otherwise unchanged
environment can be invalidated twice. Rate limiting and coalescing can prevent
that outcome. Count environment raster, cube render, and PMREM work with its
background paused before claiming a twofold saving.

**5. Native pointer preparation runs even when it cannot be used. Both engines.**

Status: fixed 2026-09-29 for the host-space read. The route checks the
request, capability, hearing, planarity, and source ownership before it
measures host space. The route's verdicts are unchanged. The saved frame time
is unmeasured.

Medium severity, code-confirmed work, high confidence. The native route
[`step`](../packages/react/src/primitives/surface/surfaceNativeRoute.ts)
prepares its rig and measures host space before checking native capability and
the requested route. Registered page sources cause three rectangle reads and
a DOMMatrix allocation in
[`hostSpace`](../packages/react/src/primitives/surface/surfaceHostSpace.ts).
snapDOM cannot take that route. Default relay routing also discards the result.
Mesh frame and before-draw paths can both do this work.

Check cheap eligibility before expensive native preparation. Keep the separate
page-preparation measurements required for native input. Measure avoided reads
and frame time on many page-backed surfaces; the current timing impact is
unmeasured.

**6. snapDOM eagerly fetches and encodes every declared font.**

Medium severity, confirmed cost, high confidence.
[`warmCaptureFonts`](../packages/react/src/snapdomFonts.ts) starts every
declared face at installation, before capture-specific family/codepoint
selection. Encoded URL promises remain cached for the page lifetime.

The lab declares 18 font files totaling 479,528 raw bytes. Thirteen files,
totaling 291,472 bytes, are outside the five existing Latin preloads. The
encoded payloads contain roughly 639,392 base64 characters. A disposable test
confirmed all 18 requests even when a later Latin Archivo capture needed one
face. These are file sizes and fetch calls, not measured network transfer.

Warm the faces needed by the first surfaces and fetch other subsets on demand.
Keep once-per-document encoding. Compare cold-cache first-frame time and input
response so reducing unused work does not delay necessary fonts.

**7. Several conditions block snapDOM's incremental recapture.**

High potential, confirmed mechanism, unmeasured benefit. All three Munari
plugins use `afterClone`. Installed snapDOM 3.0.0-beta.1 explicitly excludes
clone-construction hooks from differential recapture, including pure hooks.
See [`capturePlugins`](../packages/react/src/snapdom.ts) and the installed
[`plugin contract`](../node_modules/@zumer/snapdom/types/snapdom.d.ts).
Unchanged-repeat memoization still works; a content change forces full work.

The installed differential path also rejects
[`reconcile: true`](../packages/react/src/snapdom.ts) independently.
It checks document CSS for selectors requiring wider dependency tracking,
including sibling selectors and `:has()`. The lab's always-imported
[`shadcn.css`](../apps/lab/src/shadcn.css) contains `:has()`, so a plugin
change alone cannot establish a benefit in the current lab.

Investigate incremental-compatible hooks, reconciliation, and stylesheet
eligibility together. First prove that the differential path executes.
Moving the existing hooks unchanged to `beforeRender` is unsafe: differential
capture reuses a clone, while the current hooks append font blocks and
pseudo-element overlays without removing old ones. An idempotent update must
preserve resource handling and pixel parity. Removing fidelity shims or the
frame yield would lose measured fixes.

The font plugin also repeats whole-tree computed-style reads and selects faces
by family/codepoint rather than weight/style. Reusing descriptors from snapDOM's
style pass could reduce work and duplicate payloads. Compare a one-field change
in 50/500/2000-node trees, including styled-node counts, longest main-thread
block, input latency, and pixel parity.

**8. Capture scheduling needs an aggregate budget and input priority.**

High potential, confirmed policy costs, mobile impact needs measurement.
[`rasterizedSource`](../packages/core/src/paint/rasterizedSource.ts)
paces each source independently. A disposable test created nine sources and
observed nine rasterizers start before any resolved. Coalescing within each
source works, but many sources can still concentrate work in the same frame.

The real Genie recording also observed two captures in flight. Quadrato
advanced six paint receipts during the scheda exercise without a recorded
Surface texture upload. This supports investigating priority for unpresented
sources, not an exact waste ratio: carried-pixel receipts are not rasterization
counts, window boundaries can separate captures from uploads, and an unused
capture may serve a later handoff.

The same scheduler imposes a 150 ms post-capture gap on ordinary input events.
A `live` source also follows a 250 ms start-to-start period. Input arriving
just after completion can wait the gap plus rasterization; inexpensive live
content can wait nearly a full period. This is an intentional frame-time
tradeoff, not a newly introduced regression.

Evaluate an admission budget that distinguishes direct input, handoff readiness,
visible animation, and background updates. Keep only the latest needed work and
prevent starvation. Do not repeat the simple global FIFO queue: the
[earlier experiment](decisions.md#60) froze dragging in 26 of 33 screenshots.
The existing governor, cached fonts, and frame split improved historical Safari
and Chrome measurements together. Removing pacing would undo that protection.

## Further opportunities

| Opportunity | Evidence and affected paths | Required check |
|---|---|---|
| Reduce transient bitmap allocation, snapDOM | A fresh target-sized canvas in [`snapdom.ts`](../packages/react/src/snapdom.ts) is copied into the retained canvas in [`rasterizedSource.ts`](../packages/core/src/paint/rasterizedSource.ts). | Compare direct decoded-SVG drawing or buffer reuse. Preserve WebKit sharpness and resize-in-flight behavior. |
| Budget total captured pixels, both engines | A 390×844 DPR-3 image has 11.3 MiB per RGBA plane. Multiple canvas/GPU/intermediate copies multiply this. A per-edge guard does not bound aggregate area. | Count resident and transient backing pixels. Prefer cropping and demand control before lowering text density. |
| Pause unneeded captures, both engines | [`capture.tsx`](../packages/react/src/primitives/capture.tsx) counts readers, but the capture scheduler does not use the count. | Distinguish invisible, unconsumed, reflected, and handoff-preparing content. Preserve first-frame readiness. |
| Cancel obsolete asynchronous work, snapDOM | An in-flight rasterizer receives no abort signal. Disposal ignores its result but does not stop the work. The frame-split plugin can wait while a tab is hidden. | Cancel between stages during route changes and hide/show cycles. This is pending-work retention, not a demonstrated permanent leak. |
| Reduce stationary-pointer work, both engines | [`CanvasPointerGate`](../packages/react/src/primitives/CanvasPointerGate.tsx) preserves the armed state after a touch releases over a target, and has no touch-out cleanup. Its raycast loop can continue while that target remains. | Measure post-touch idle work. A later off-target pointerover can clear the gate, so swallowed page taps remain an unverified hypothesis. Preserve mouse hover and disappearing-target behavior. |
| Bound exact-density resize work, both engines | [`match-dom` automatic density](../packages/react/src/primitives/surface/SurfaceMesh.tsx) can bypass tier hysteresis during a CSS scale animation. Exact backing-size changes can incur scratch copies and GPU reallocation. | Count reallocations through a scale transition. Fixed/ranged resolution, sub-texel changes, competing proposals and caps can prevent it. snapDOM carries old pixels through LOD changes; it does not necessarily rerasterize or upload twice per resize. |

The lab has substantial costs outside either capture renderer:

- **Home:** [`homeLampBackdrop`](../apps/lab/src/scenes/home/homeLampBackdrop.ts)
  rebuilds a whole-page copy on scrolling and interaction, outside the capture
  governor. It uploads the lighting canvas into the bulb's separate renderer
  and scans visible canvases each frame. The shadow buffer spans two viewport
  heights at native DPR. Capture the region the bulb needs, separate placement
  from content invalidation, and reuse unchanged images before reducing fidelity.
  The slow 12×3px idle light drift changes shadow inputs continuously. However,
  the headline has its own time-varying shader, ripple and tilt; the cord also
  moves independently. Gate or quantize individual passes by their dependencies.
  Do not stop the entire redraw solely because rounded light position is unchanged.
- **Pinch zoom:** [`lampPixelRatio`](../apps/lab/src/scenes/home/homeLampViewport.ts)
  multiplies DPR by visual-viewport scale while its DOM backdrop still covers the
  layout viewport. Requested area grows quadratically before clamps. Crop to the
  required visible region; measure actual backing sizes during zoom.
- **Marble Hand:** [`reflectionFps`](../apps/lab/src/scenes/marble-hand/marbleHandTuning.ts)
  defaults to 120. Animated background changes can trigger a CPU environment
  raster, upload, six cube faces, and PMREM generation even with a stationary
  hand. Compare 120/60/30 reflection updates while preserving hand motion.
- **Startup:** [`main.tsx`](../apps/lab/src/main.tsx) awaits snapDOM before
  React renders for `capture=auto`, even when native capture will win.
  [`homeOpening`](../apps/lab/src/scenes/home/homeOpening.ts) waits for fonts
  before starting its graphics deadline. Profile cold-cache startup and gate the
  optional import by capability while preserving the stable first composition.

For mobile, prioritize total memory, long synchronous blocks, and idle wakeups.
These also help desktops. High-refresh desktops make the per-frame polling and
geometry costs more frequent. Mozilla recommends budgeting VRAM by pixel area
and avoiding unnecessary uploads in its
[WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
WebKit recommends eliminating unnecessary frame callbacks and hidden work in
its [power guidance](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/).
Neither source establishes Munari's energy consumption.

## Evidence and remaining coverage

New browser observations used Chrome 153.0.8010.54, headless, DPR 2, with serial
runs. The fixture sampled a real SceneSurface texture. An empty demand canvas
was the control for placement work. Instrumentation observed Three.js upload
callbacks, not only `needsUpdate`. No page errors occurred in those cases.

| Check | Result | Limits |
|---|---|---|
| Existing `probe:api-capture-cost` | Exit 0; all four scenarios measured; zero idle copies | Desktop native capture; small fixtures. Controls also recorded a 567 ms maximum frame gap during preparation. The probe does not attribute or gate that gap, so it is not proof of general frame performance. |
| Temporary placement/upload/copy probe | Exit 0; both real engines; results above | Diagnostic fixture, no device energy or GPU-duration measurement |
| Same probe, snapDOM without native flag | Exit 0; repeated 60 idle samples/s and two uploads per changed image | Desktop Chromium fallback, not Safari/Firefox/mobile |
| Runtime dimension reproduction | Exit 0; two initial edge-limit failures and an oversized resize confirmed | Real runtime with stubbed canvas methods; allocation arithmetic only |
| Disposable scheduler/font tests | 2/2 passed; nine concurrent starts; 18 font requests | Fake rasterizer/fetch; no browser timing claim |

The browser probe, its results, the size probe and the disposable tests were
temporary local files and were not retained. None were checked-in acceptance
instruments. Move a useful measurement into its owning instrument when
implementing the fix.

No permanent test, acceptance threshold, or CI rule was added. Full
unit/type/lint checks were not needed for this document-only change; linked
locations and the final diff were checked.

| Area reviewed | Coverage outcome |
|---|---|
| snapDOM | Capture, plugins, fonts, pacing, concurrency, completion, disposal reviewed |
| Shared runtime | Allocation, texture upload, placement, native route, demand, pointer loops reviewed |
| Native element capture | Copy/observer/update path reviewed and scaling measured |
| Consumers and instruments | Home, Marble Hand, representative copy consumers, mobile/startup/idle probe limits reviewed |

The next performance comparison should use physical iPhone/iPad Safari and a
midrange Android Chrome device, with desktop Safari, Firefox, and Chromium as
separate runs. Test snapDOM wherever selected, and HTML-in-canvas only where
capability is actually present. A narrow desktop viewport is not phone evidence.
Existing Safari numbers in decision #62 describe a Mac and its power state.

For each device, record browser/OS, DPR, power mode, and observed refresh cadence.
Compare cold startup, warm input, 1/4/9/16 changing surfaces, scrolling, pinch
zoom, idle/offscreen state, and repeated mount/unmount. Include a sustained run
to expose thermal effects. Measure input-to-visible latency and frame p95/p99
together, plus long tasks, capture-stage CPU, uploaded bytes, and peak backing
pixels. A scheduler that improves average FPS while delaying input has not
necessarily improved the experience.
