# Controls performance benchmark

This diagnostic runs the actual Controls lab demo at a desktop viewport and
device pixel ratio of 2. The example compares Chrome's 4× and 6× CPU
throttling. Each trial opens a fresh headless Chrome session. Browser sessions
run serially.

```sh
PERF_BUILD_MODE=production \
PERF_BASELINE_REF=e0e921e989760be8d26221261724c056c9882959 \
PERF_CAPTURE_STORAGE=cpu PERF_ENGINES=snapdom \
PERF_CPU_RATES=4,6 PERF_ROUTE_TIMING=0 PERF_TRIALS=5 \
PERF_OUTPUT=/tmp/munari-performance \
node instruments/performance/run.mjs
```

`PERF_BASELINE_REF` alternates the baseline and working tree within each
engine, CPU rate, and trial. A Vite plugin serves the baseline's tracked
`packages/core/src`, `packages/react/src`, and `apps/lab/src` files directly
from Git. Both versions use the current dependencies, configuration, workload,
and observer. Development comparisons can include changes to the library and
the demo. Paired production builds require identical loaded lab sources and
CSS, so the workload stays fixed. The ref must support the same public API
and measurement points.
`PERF_BASELINE_DIR` instead reads a saved package source tree. Its root must
contain `packages/core/src` and `packages/react/src`. Copy the current package
sources there before changing them when comparing a second optimization
against the first. The result records the directory and loaded source hashes.
When the directory also contains `apps/lab/src`, the baseline uses that saved
lab source. This supports comparisons that change the demo. The result records
whether the baseline includes lab sources and lists their hash differences.
Choose one of `PERF_BASELINE_REF`, `PERF_BASELINE_DIR`, or `PERF_SOURCE_REF`.

For one version, omit `PERF_BASELINE_REF`. `PERF_SOURCE_REF` selects a single
Git revision's library and lab source. `PERF_TRIALS` accepts 1–10 trials. `PERF_ENGINES` accepts
`html-in-canvas`, `snapdom`, or both separated by a comma. `PERF_CPU_RATES`
accepts comma-separated integer rates from 1–20. `CHROME_PATH` selects Chrome.
`PERF_ROUTE_TIMING=0` disables the route observer. Use this mode to compare
task duration without its per-call timing overhead. Capture and upload
observations remain enabled. The default enables route timing.
`PERF_MAX_FRAME_P95_MS` optionally bounds the input phase's 95th-percentile
animation frame interval. Each trial records its verdict. An exceeded bound
produces a nonzero exit after the measured results and screenshots are saved.
The workload and timing defaults stay the same when the bound is enabled.

The default matrix runs both engines at CPU rates 1 and 4, with two trials.
A quick smoke run uses `PERF_TRIALS=1 PERF_ENGINES=snapdom PERF_CPU_RATES=1`.
HTML-in-canvas requires Chrome's `CanvasDrawElement` capability. Unavailable
capability fails the run.

`PERF_CAPTURE_STORAGE=cpu` or `gpu` forces the capture canvas storage policy
for both versions. Each trial checks the observed context attributes before
and after input. Omit it to use the adapter's normal choice. This selects
canvas storage on the current host; it does not emulate a software GPU.

The `enter-scene` phase measures the scene request until the physical controls
settle. Initial mount and font loading precede this phase. The workload then
measures idle frames. The input phase includes focusing the original field,
pressing End, typing a fixed string through browser keyboard events, and
submitting with Enter. It then resizes the viewport and returns
the form to the page. Assertions check the same input node, edited value,
focus, one trusted submit, both presentation holds, capture activity,
upload callbacks, populated capture pixels, and changed captured pixels.
An input listener records the next unread source identity before capture
handles each input event. The final input must reach a completed read.
The submit listener also records the next unread source identity. The phase
waits until both capture and upload reach that submit read. This depends on
the Controls form's synchronous submit handler. Each trial requires one
trusted focus event, 37 trusted inputs and one trusted submit inside the phase.
`inputPhaseIncludesFocusAndSubmit` identifies this protocol. Do not pool these
results with older runs that focused the field outside the measured phase.

Each phase retains `phaseStartedAt`. Interaction completion is the first submit
acknowledgement's upload time minus that start. `focusToLastUploadMs` instead
starts at the focus event and includes any later upload during the final buffer.
Neither metric measures display presentation.

`results.json` records the browser version, source commit, dirty files,
lockfile dependency versions, viewport, CPU rate, workload, and SHA-256 hashes
of loaded executable library and lab modules. Each trial saves its raw events and four
screenshots. Failures save a screenshot and observer state.
Each trial identifies the renderer's actual WebGPU or WebGL 2 backend.
WebGPU records the device's adapter info. WebGL 2 records its debug vendor
and renderer when available. The launch uses the shared WebGPU Chrome flags.
`MUNARI_BACKEND=webgl2` requests Three's fallback backend. The result records
the requested mode and actual backend.
Keep source files unchanged during a run. A changed hash for an already
loaded module fails the measurement. The servers disable file watching.

Each measured phase reports:

- Route step durations and route verdict counts.
- `hostSpace` durations and call counts from the route controller only.
- Completed capture receipts and distinct DOM reads.
- Started full and region captures, with their summed CSS pixel area.
- Successful direct text draws, reused region SVGs, and unchanged input frames.
- Serialized-style cache hits and new serialized declarations.
- Successful full-background reuse and newly prepared background composites.
- Cumulative background preparation attempts and composites, plus the largest
  composed background in bytes. This size excludes JavaScript objects and the
  temporary overlap of old and replacement buffers.
- Prepared text painters and blank-image decodes, counted cumulatively per trial.
- Decoded images' requested width × height, summed as raster pixel area.
- Upload callbacks, source read and generation, texture version, and store size.
- Repeated upload identities and summed uploaded texel area.
- Animation frame intervals and Chrome's main-thread task, script, and layout durations.
- Per-input latency to the first upload acknowledgement of the required DOM read.
- EventTiming and long animation frame entries when Chrome supports them.

Input latency starts when the document's capture listener observes a real
input event. It ends at the first texture upload callback acknowledging that
event's required DOM read or a newer read. Several inputs may share one upload.
This measures an upload acknowledgement. It does not prove display presentation.
EventTiming uses a 16 ms duration threshold. Long animation frame entries
describe frames longer than 50 ms. Browser entries may arrive after a phase
ends; the report includes entries delivered during collection and queued at
the end whose start times fall within that phase. Each long animation frame
serializes its script attribution. Unsupported entry types are recorded as
unavailable.

Requested raster pixel area counts the image dimensions Munari will draw. It
separates the selected DOM region from the SVG raster size. It does not measure
how many pixels the browser processed internally. Reused SVG decodes count
toward raster area but do not start an upstream snapDOM capture. An unchanged
input frame reuses the accepted bitmap and performs no SVG decode. Direct text
draws also perform no SVG decode. A blank-image decode counts toward raster area
when it completes during the measured phase.

`styleCacheHits` and `styleSerializations` count element declarations inspected
during the active phase. A hit still reads and compares every current property
name and value; it reuses only the serialized string. A miss records one new
serialization. Raw events include the declaration's property count. These
counters are enabled with capture observations, independently of stage profiling.

`directInputTexts` and `reusedInputSvgs` count successful work in the active phase.
`preparedInputTexts` and `inputBlankDecodes` are cumulative trial totals at phase
end, including work completed between phases. Do not add those cumulative counts
across phases. Task durations cover recorded phases; mount and gaps between
phases are not timed. Preparation can overlap other asynchronous capture work.

Uploaded texel area sums the canvas width × height at each upload callback.
It excludes mipmaps, format, and driver behavior. Callback counts describe
Three's texture update notifications. On WebGPU this acknowledges the backend
update path, without waiting for GPU work to complete. These counts measure
neither GPU execution time nor display presentation.
Captures and callbacks retain their identities in the raw event records.
One DOM read can receive a new generation after its stored pixels are resized.

Measurements exclude startup, font loading, pixel hashing, and screenshots.
The route observer adds timing overhead to both versions. CPU throttling
emulates CPU delay on this host; it leaves the GPU unchanged. Frame intervals
and task duration are local diagnostics. WebGPU queue execution is outside
Chrome's main-thread task duration. Repeat trials and inspect their
spread before attributing small timing changes to an optimization.

Capture hashes show that the source pixels changed. The screenshots preserve
the rendered scene before and after editing at the same viewport, after
resizing, and after returning to the page. Existing visual and pointer gates
own fidelity and native pointer acceptance. This benchmark adds no CI or
portable speed budget.

Create a compact summary after the run:

```sh
node instruments/performance/summarize.mjs /tmp/munari-performance \
  > docs/performance-results.json
```

The summary groups idle and input samples by engine, CPU rate, and version.
It includes capture counts, frame p95 and maximum, input acknowledgement
latency p50 and p95, and main-thread task duration. It reports medians and
ranges, compares loaded lab source hashes, and lists
changed package sources. Matching trial screenshots receive SHA-256 hashes
and a byte-equality result. Screenshot differences are reported for review.
The raw records and images stay in the evidence directory.

Measure a screenshot mismatch through Chrome's PNG decoder:

```sh
node instruments/performance/compare-images.mjs \
  /tmp/munari-response-final/baseline-snapdom-cpu6-trial1/scene-edited-resized.png \
  /tmp/munari-response-final/working-tree-snapdom-cpu6-trial1/scene-edited-resized.png
```

The command reports dimensions, mean and maximum absolute RGB channel
differences on a 0–255 scale, changed pixels, and alpha differences.
Different image dimensions fail the command. Pixel differences are reported
as measurements; this command applies no acceptance tolerance.

For a diagnosis, profile only the input phase:

```sh
PERF_PROFILE=1 PERF_ROUTE_TIMING=0 PERF_TRIALS=1 \
PERF_ENGINES=snapdom PERF_CPU_RATES=4 \
PERF_OUTPUT=/tmp/munari-response-profile \
node instruments/performance/run.mjs
```

Each trial writes `scene-input.cpuprofile` and `scene-input.trace.json`.
Profiling is disabled by default. Use runs with profiling disabled for timing
comparisons because collecting a profile and trace adds work.
Add `PERF_CAPTURE_STAGES=1` to attribute capture stages and count renders of
ControlsHardware and PhysicalPiece. This option is also disabled by default.
It adds stable, pure snapDOM plugins through the supported hook API.
Each capture has an element-keyed record and a capture ID.

Stage records include call-to-first-afterClone preparation wall time,
existing afterClone hooks and their animation-frame yield, time before
beforeRender, beforeRender-to-afterRender wall time, SVG payload inspection,
image decoding, the intermediate canvas draw when present, and the retained
source canvas draw. The observer supports canvas and decoded-image rasterizer
returns and rejects an unknown return shape. Output records identify the shape
and target dimensions. A direct decoded image has no intermediate draw sample.
Wall times include asynchronous waits. Draw times measure synchronous calls.
Payload records contain lengths, font-face counts, and family labels.
They contain no font bytes. Payload inspection overhead is recorded separately.
Region stages also measure synchronous state inspection, SVG viewport
normalization, CPU SVG rasterization and bitmap copying, GPU region drawing,
and full-cache composition. Input SVG serialization and decode wall time,
direct text drawing, and preparation wall time are recorded separately. The
input SVG decoder serves both value updates and the one-time blank image.
Use stage profiling to attribute work and keep it disabled for comparisons.

```sh
node instruments/performance/profile-summary.mjs \
  /tmp/munari-response-profile/working-tree-snapdom-cpu4-trial1/scene-input.cpuprofile
```

The profile summary ranks sampled leaf functions, inclusive functions, and
stacks. It also lists project functions whose URLs contain `/src/`.
The summary accumulates CDP deltas into timestamps, sorts those timestamps,
and assigns each sample the interval until the next sample. It reports
negative deltas, reordered samples, discarded timestamps outside the profile,
and time without a sample. Sample counts remain separate from estimated time.
Profile locations refer to Chrome's served code. A trace can show browser
rendering work outside JavaScript samples.


Summarize capture callbacks and their native rendering work:

```sh
node instruments/performance/trace-summary.mjs \
  /tmp/munari-response-profile/working-tree-snapdom-cpu4-trial1/scene-input.trace.json
```

The trace summary finds renderer-main animation frame and timer callbacks
from `packages/react/src/snapdom.ts`. It binds timer fires to their installation
using the thread, frame and timer ID. A timer without a source function can
use its installation stack. When that stack is absent, a timer installed
within a known snapDOM frame callback is attributed to that scheduling
callback. A directly attributed timer needs no animation-frame callback.
The output labels the attribution and callback kind. It groups
served-code locations and reports median, p95 and maximum durations. Callback durations
include their continuations. Layout and style-update durations use interval
unions to avoid counting nested work twice. Containing task durations include
other work that ran in the same task. Profiler startup is reported separately
and excluded from workload tasks. The benchmark also samples its task-duration
baseline after profiler setup. Trace attribution covers these callbacks; it
does not measure GPU execution or every task in the capture pipeline.

For direct text drawing, compare against `597eae53e92d1bc83818155794f1c46eb2fbeb80`
at CPU rates `4,6` with `PERF_ENGINES=snapdom`. Run both
`PERF_CAPTURE_STORAGE=cpu` and `PERF_CAPTURE_STORAGE=gpu`. The Controls Project
field opts into region capture. Require `directInputTexts` to be positive in
every CPU candidate input phase. GPU candidates must keep SVG reuse with zero
`directInputTexts`, `preparedInputTexts` and `inputBlankDecodes`. Compare
`reusedInputSvgs`, blank-image decodes and
fresh capture counts as well as timing. These operations need not equal the
receipts completed in the phase. Keep
capture-stage profiling disabled for the paired timing comparison.


## Capture diagnosis and production builds

`PERF_CAPTURE_DIAGNOSTICS=1` requires `PERF_CAPTURE_STAGES=1`. It records
capture admission, coalesced requests, invalidation causes, the first rejected
reuse condition, and geometry/style/control-state inspection. Events retain
source and DOM-read identities. The package source is unchanged; a Vite plugin
instruments only the served modules.

```sh
PERF_BUILD_MODE=production PERF_CAPTURE_STORAGE=cpu \
  PERF_CPU_RATES=6 PERF_TRIALS=1 PERF_ENGINES=snapdom PERF_ROUTE_TIMING=0 \
  PERF_PROFILE=1 PERF_CAPTURE_STAGES=1 PERF_CAPTURE_DIAGNOSTICS=1 \
  PERF_GPU_DIAGNOSTICS=1 PERF_OUTPUT=/tmp/munari-capture-diagnosis \
  node instruments/performance/run.mjs
node instruments/performance/diagnose.mjs \
  /tmp/munari-capture-diagnosis/results.json \
  /tmp/munari-capture-diagnosis/analysis.json
```

`PERF_BUILD_MODE` defaults to `development`. Production mode uses the existing
lab Vite configuration, normal minification and source maps. Build output and
caches stay beneath `PERF_OUTPUT`. The result verifies that production React
and React DOM reached the generated chunks and that development runtimes did
not. Production mode supports the same baseline and source-ref options as
development mode. Each version gets a separate build and preview server.

The runner verifies loaded package and lab code against the selected source.
It records hashes for shared build inputs, source CSS and transformed CSS.
Selected CSS must match the current workload. Paired production builds also
require identical loaded lab code and CSS in both versions. Build mode and
verification evidence are saved with the results.

For full-background caching, use the paired production command above and
repeat it with `PERF_CAPTURE_STORAGE=gpu` and a separate output directory.
Require positive `fullBackgroundReuses` in each CPU candidate input phase.
GPU and baseline trials must report zero background preparation and composition.
Compare input latency, frame gaps and task work, including `enter-scene` cost.
Controls uses one 6,566,400-byte background at DPR 2. The cache accepts at most
8 MiB per background; replacement can briefly retain two. Keep profiling and
diagnostic timing disabled for these comparisons.

For serialized-style caching, use baseline `a1a0456` and require positive
`styleCacheHits`. The [style-cache report](../../docs/style-cache-performance.md)
records that comparison separately.

`PERF_GPU_DIAGNOSTICS=1` measures the synchronous native canvas-copy submission
and starts an asynchronous queue checkpoint at each texture update. Rendering
does not wait for the checkpoint. The phase snapshot preserves pending work;
a final trial snapshot includes callbacks that arrive after the phase stops.
Missing native copies, unsupported contexts, queue mismatches and rejected
checkpoints remain explicit. These observations do not isolate GPU upload
execution. Queue-prefix callback latency includes earlier submitted work and
main-thread callback scheduling, and does not establish display presentation.

`PERF_FLUSH_CPU_RASTER=1` is a counterfactual requiring CPU storage and capture
stage timing. It adds a complete pixel readback after each full cache draw.
The recorded `diagnosticFlushReadbackSync` stage reveals deferred canvas paint
work before the normal source draw. It adds work and is not an optimization.
Compare it with an otherwise matching run without the flag.

The diagnosis reader exposes unmatched stage events. A missing source/read
join is unmeasured attribution, not zero work. `regionSnapshotSync` includes
its substages; `snapshotKeyBuildSync` includes root-style enumeration and
control-state collection. Do not sum nested timers. Async preparation and
rasterization can overlap. Profiling and diagnostic observers add overhead;
use the ordinary unprofiled runner for performance comparisons.

`fullCapturePreparationWall` includes full SVG splitting, key creation, image
decoding and background preparation. `imagePreparationWall` includes image URL
assignment and decoding on the candidate's other path. Older revisions report
`decodeWall` around `image.decode()` alone. These spans have different scopes;
compare the complete capture and main-thread costs across revisions. Decoded
raster area includes the extra background image when preparation succeeds.

`fullBackgroundSplitSync` measures the synchronous parsing, eligibility checks,
SVG splitting and key construction. It includes attempts that later decline
reuse. The timer runs only with capture-stage diagnostics enabled.

Each trial samples host load averages and per-core CPU times before browser
launch and after the workload, outside measured phases. These observations
help identify competing work; they do not turn CPU throttling into a device
simulation or remove host contention from the measurements.
