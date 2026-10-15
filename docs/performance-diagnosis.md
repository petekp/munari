# Capture and rendering performance diagnosis

Measured 2026-10-14 against runtime `62e67d2`.
The [serialized-style cache](style-cache-performance.md) is now implemented
and benchmarked. [CPU background reuse](full-capture-performance.md) is
implemented and benchmarked, with its entry and latency tradeoffs recorded.
The other runtime remedies below remain unimplemented.

Repeated serialization of computed styles was the strongest small optimization
identified by this diagnosis. These profiles identified full SVG rasterization as the largest input spike
after style inspection. Native GPU copy submission was small on this host. Glass has a
separate cost that grows with rendered pixel area, but the experiments did not
establish a reliable whole-frame gain from changing antialiasing.

## Controls

The existing unprofiled runner reproduced an input-frame p95 of 83.3 ms and a
200 ms maximum at 6× CPU slowdown. Its diagnostic 50 ms ceiling correctly
returned nonzero. This ceiling is a reproduction trigger, not a new portable
performance budget.

Subsequent profiles recorded capture admission, reuse decisions, invalidation,
state-inspection substages, canvas draws and native GPU copy submission. The
final instrumentation also preserves source/read identity through SVG decoding
and preparation. Unmatched events remain visible in the diagnosis output.

| Finding | Measured evidence | Consequence |
|---|---|---|
| Serializing computed styles dominates reuse inspection | Development 4×: 265.2 of 288.6 ms; development 6×: 235.4 of 264.7 ms. The retained production 6× run spent 165.5 of 183.3 ms here. Every read enumerated seven full style declarations. | About 90% of inspection time is in building CSS strings. Geometry and form-state checks were small. |
| Full capture remains expensive in production | The first production profile still had an 83.3 ms frame p95. Its final capture took 364.5 ms, including 149.4 ms charged to the source canvas draw. | React development overhead is real, but does not explain away the capture spike. |
| Most apparent source-copy cost is deferred rasterization | The retained production baseline's maximum source draw was 145.8 ms. An earlier forced readback took 154.7 ms and left the source draw at most 1.5 ms. A second run measured 150.0 ms readback and a 1.3 ms maximum source draw. | Moving the draw or adding a readback moves work rather than removing it. Optimize the SVG work being materialized. |
| Native GPU copy submission is small | Production 6×: 13 native copies totaled 11.6 ms, median 1.0 ms and maximum 1.4 ms. | This CPU call was not the principal source of the hundreds-of-milliseconds input tail on this host. |

The forced-readback experiment changed no canvas pixels. All four screenshots
matched the baseline byte for byte in each of its two runs. It deliberately
adds a complete CPU readback and is not a proposed optimization. Canvas draw
durations can include deferred raster work; they are not pure memory-bandwidth
measurements.

The exact fallback sequence is now observed. Horizontal input scrolling fails
the saved SVG's `scroll-position` check. Submission then changes content outside
the input, invalidating the full capture cache. The large tail follows these
region and full captures, not the cheap direct text draw.

In one development 6× profile, the slowest acknowledgement took 813.1 ms:
420.8 ms before capture started, 381.5 ms from capture start to receipt, and
10.8 ms from receipt to upload callback. Of the pre-capture interval, 266.5 ms
overlapped the preceding capture. The remaining interval includes scheduling
and the intentional 150 ms post-capture gap. These intervals are attributed
observations, not a recommendation to remove pacing.

`PERF_BUILD_MODE=production` now builds the real lab through its existing Vite
configuration. It verifies production React and React DOM in the output and
rejects rendered development runtimes. The earlier incremental-capture matrix
used development builds. These single profiled production runs establish that
the expensive path persists; they do not establish a controlled production
speedup percentage.

## GPU measurement boundary

The new observer matches native canvas copies, texture callbacks and queue
checkpoints by source, read, generation and queue. The initial development
profiles matched and resolved all 29 checkpoints. The first production profile
matched and resolved all 13.

A queue checkpoint follows [WebGPU's submitted-work completion contract](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone).
Its callback latency includes earlier queue work and main-thread scheduling.
It is neither isolated upload execution time nor visible presentation. The
largest observed development checkpoint delay overlapped expensive main-thread
preparation, so attributing it to GPU execution would be incorrect. The context's
[configuration](https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext/getConfiguration)
provides the device without a dependency patch or private renderer field.

## Glass

The real scene was measured with both HTML captures present. Each frame has a
world pass, a card pass, a pill pass and a final screen pass. The panel passes
cover the full render target, including the small pill. Measurements use actual
per-pass GPU timestamps, with complete sample coverage required.

| Raster density | Render-pass GPU median across the three CPU-rate cases | GPU p95 range |
|---|---:|---:|
| DPR 1 | 1.51–1.74 ms | 2.17–2.42 ms |
| DPR 2 | 5.83–7.24 ms | 7.15–7.68 ms |

These were three-second windows at CPU rates 1×, 4× and 6×. All six cases had
180 complete GPU-timed frames and maintained roughly 16.7 ms animation-frame
intervals on this M4 Max. The density sweep changes pixel workload for diagnosis;
it is not a proposal to lower text quality. CPU slowdown does not emulate a
weaker GPU.

Two experiments narrowed the next work:

- **Final-pass antialiasing:** three alternating pairs kept four-sample world
  MSAA and changed only final-target samples from four to zero. Repeated fixed
  images and cross-mode images matched exactly. Whole-frame timing gains were
  inconsistent, and unchanged pass timings also varied. Keep current settings.
- **Omitted pill:** three alternating pairs removed only its compositing pass.
  GPU p95 fell from 7.73–8.43 ms to 5.29–5.57 ms. The pill pass itself averaged
  1.40–1.61 ms. Mean whole-frame changes ranged from -0.5% to -28.7%, while
  medians worsened in two pairs. Every omitted-pill snapshot changed exactly
  82,597 pixels. This proves pixel sensitivity and a material pass cost, not
  a shippable optimization.

A useful next Glass investigation is bounded pixel coverage with correct
background preservation. Removing the panel or lowering density would change
the product. The fixed-state pixel checks do not establish animated, input or
cross-browser equivalence for a future renderer change.

## Next changes to evaluate

1. Serialized-style caching is implemented and verified in the
   [style-cache report](style-cache-performance.md). Every current property
   name and value is still compared before reusing its serialized string.
2. [CPU background reuse](full-capture-performance.md) reduces full-capture
   materialization stalls. Full SVG construction, splitting, foreground decoding
   and GPU-backed captures remain candidates for further profiling.
3. Bound Glass's full-screen work without losing pixels outside each panel.
   Repeat GPU measurements under controlled load before accepting a gain.

## Reproduction and validation

The [Controls guide](../instruments/performance/README.md#capture-diagnosis-and-production-builds)
contains commands for production builds, stage attribution and GPU checkpoints.
Use `PERF_FLUSH_CPU_RASTER=1` only for the readback counterfactual. The
[Glass guide](../instruments/glass-performance/README.md) documents density,
CPU-rate, antialiasing and missing-panel cases. These remain local diagnostics;
CI membership is unchanged.

The retained instruments passed their final browser runs. All 1,442 tests in
126 files passed; the four new measurement tests also passed after their fixture
type cleanup. Typecheck, lint and the package build passed. The new tests protect
late queue completion, source/read attribution, mismatched queues and failure
classification. The deliberate frame-budget failure remains separate from
these verification results.

[Recorded evidence](performance-diagnosis-results.json) contains 10 Controls
rows and 20 Glass rows, build/runtime metadata, source and artifact hashes,
per-read attribution, pixel comparisons and measurement limits. Raw traces and
images remain in their named local evidence directories. Some early prototype
SVG stages lack per-read identity; their phase totals remain usable, and the
final observer fixes their attribution.

All results are local Chrome 155.0.8059.80 observations on an Apple M4 Max with
Metal WebGPU. Profilers and observers add overhead. Nested timers must not be
summed, and async stages can overlap. Peak resident memory, physical-device
thermals, energy use and input-to-visible presentation remain unmeasured.
