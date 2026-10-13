# Incremental input capture

Status: implemented and verified, October 13, 2026.
Baseline: `507e6dcabd0b4e93efdcc2031e36e65c0d85ce3b`.

CPU-backed canvases now support region capture for opted-in text fields. The
adapter preserves the HTML layout viewport and origin, then crops through the
SVG viewBox. Controls' Project field produces a 342 × 50 CSS-pixel image instead
of a full 760 × 540 image. Its original input node, focus and submission behavior
stay intact. Capture density, pacing and full-size texture uploads are unchanged.
The [usage guide](../README.md#capture-engines) and [decision #62](decisions.md)
define the opt-in contract and fallback conditions.

CPU region capture reduced the slowest input responses and frame intervals at
both tested slowdowns. The 4× run used more total main-thread time and had a
slightly higher median input latency. This improves responsiveness under load,
but does not establish lower total CPU use.

## Measurements

Five alternating baseline/candidate pairs per slowdown, using the actual Controls
scene. The baseline uses full CPU captures; every candidate trial must use region
captures. Chrome 155.0.8059.79 ran on an Apple M4 Max with the Metal WebGPU backend,
a 1440 × 1000 viewport and device pixel ratio 2. Profiling and route timing were
disabled. Each trial typed 37 characters, submitted with Enter, resized the
viewport and returned the original form to the page.

Values are medians of per-trial statistics. Input latency runs from the observed
input event to a texture upload acknowledgement. It does not measure display
presentation. Frame intervals measure animation callbacks. CPU throttling leaves
the GPU unchanged; forced CPU canvas storage does not emulate a software GPU or
a physical low-powered device.

| Slowdown | Measure | Baseline | CPU regions | Change |
|---|---|---:|---:|---:|
| 4× | p95 frame interval | 100.0 ms | 83.4 ms | -16.6% |
| 4× | p95 input to upload | 496.3 ms | 433.2 ms | -12.7% |
| 4× | p50 input to upload | 311.9 ms | 320.7 ms | +2.8% |
| 4× | Main-thread task duration | 2424.3 ms | 2650.3 ms | +9.3% |
| 6× | p95 frame interval | 183.3 ms | 150.1 ms | -18.1% |
| 6× | p95 input to upload | 718.4 ms | 663.9 ms | -7.6% |
| 6× | p50 input to upload | 556.5 ms | 420.1 ms | -24.5% |
| 6× | Main-thread task duration | 4167.2 ms | 3854.4 ms | -7.5% |

Requested raster pixel area fell by 90.2% at 4× and 92.2% at 6×. This counts
image dimensions, not the browser's internal pixel work. At 6×, input p95
improved in all five pairs. At 4×, total task time increased in four of five.

The GPU control uses three alternating pairs per slowdown to compare the existing GPU region path with
the updated code. Both versions use region capture. These are controls for
regressions, not a claim that the CPU fix speeds up GPU capture.

| Slowdown | Measure | Baseline | Updated | Change |
|---|---|---:|---:|---:|
| 4× | p95 frame interval | 83.3 ms | 83.3 ms | +0.0% |
| 4× | p95 input to upload | 362.9 ms | 376.0 ms | +3.6% |
| 4× | p50 input to upload | 239.9 ms | 251.3 ms | +4.8% |
| 4× | Main-thread task duration | 1930.2 ms | 2084.2 ms | +8.0% |
| 6× | p95 frame interval | 150.0 ms | 133.4 ms | -11.1% |
| 6× | p95 input to upload | 506.0 ms | 545.1 ms | +7.7% |
| 6× | p50 input to upload | 353.3 ms | 337.6 ms | -4.4% |
| 6× | Main-thread task duration | 3556.3 ms | 3263.2 ms | -8.2% |

GPU input p95 increased by 3.6% at 4× and 7.7% at 6×. Frame p95 stayed flat
at 4× and improved at 6×; main-thread duration moved in opposite directions
at the two rates. The three-pair control is mixed and does not establish
that GPU performance is unchanged. The CPU-only normalization and scratch
bitmap are bypassed on GPU-backed captures.

Trial ranges, source hashes, storage settings and matched screenshot hashes are
in [incremental-capture-results.json](incremental-capture-results.json). All
comparisons within these matrices use the same browser version. Earlier runs
used Chrome 155.0.8059.40; their numbers are not pooled into this comparison.

## Quality and cost

The [pixel probe](../instruments/input-regions/README.md) covers typing, deletion,
horizontal scrolling, placeholders, fractional and shifted fields, normal-flow
positions, density changes, transparency, CSS refresh, failures and disposal.
The normal-flow edit checks every published frame, because a later full capture
can repair a bad region frame before a final screenshot sees it. All 69 CPU
cases, 54 GPU cases and three unsupported-SVG cases had zero pixel differences
from full capture. Restoring the old viewport produces a three-pixel error in the first published frame; the next
full frame matches. Drawing the SVG at a tile's local origin changes 42 pixels.
Neither fault passes the proof.

Of 32 matched benchmark scene screenshots, 31 were byte-identical. One resized
CPU screenshot differed outside the form by up to three RGB levels. Its form
interior was identical, both captured source hashes matched, and neither resize
phase performed a capture or upload. A separate 6× pair matched both screenshots
exactly; its timings are excluded from the matrix. Background compositing is the
suspected cause, but its exact mechanism remains unverified. The original
mismatch remains in the evidence.

Unrecognized SVG structure triggers a full recapture, releases private bitmaps,
and disables further region attempts for that source. The adapter consumes
snapDOM's public raw SVG and render metadata. No dependency patch or opaque
capture cache is used. CPU fields with outer shadows, outlines beyond five CSS
pixels, or captures extending outside the root use full images.

Every benchmark preserves the input node, edited value and focus, acknowledges
all 37 input events, delivers one trusted submit, and completes both presentation
handoffs. Both capture engines passed `gate:capture-engines` with
`STRICT_CAPABILITY=1`; unflagged fallback gestures passed in five scenes. The
required 1,438 tests, four typecheck programs, lint and package build passed.
React Doctor reported no new issues.

The complete cache adds about 6.3 MiB for Controls at 1520 × 1080 RGBA pixels.
The CPU scratch bitmap adds about 1.2 MiB at the default field position, or up
to another source-sized bitmap. These are dimension-based calculations; resident
memory was not measured. The existing warning about four unplaced field
pseudo-elements also appears on the baseline. Equality with full captures does
not establish that this warning is harmless.

An isolated Chrome runner stalled during verification and was restarted. The
final runs used a process timeout and cleaned up only their own processes.

## Reproduce

```sh
REGION_STORAGE=cpu node instruments/input-regions/run.mjs
REGION_STORAGE=gpu node instruments/input-regions/run.mjs
PERF_BASELINE_REF=507e6dcabd0b4e93efdcc2031e36e65c0d85ce3b \
  PERF_CAPTURE_STORAGE=cpu PERF_CPU_RATES=4,6 PERF_ENGINES=snapdom \
  PERF_TRIALS=5 PERF_ROUTE_TIMING=0 PERF_OUTPUT=/tmp/munari-cpu-regions \
  node instruments/performance/run.mjs
node instruments/performance/summarize.mjs /tmp/munari-cpu-regions
```

Repeat with `PERF_CAPTURE_STORAGE=gpu` and `PERF_TRIALS=3` for the GPU control.
`CHROME_PATH` can select a fixed browser executable. The
[benchmark guide](../instruments/performance/README.md) defines the measurements
and their limits. The final source stayed unchanged during timing.
