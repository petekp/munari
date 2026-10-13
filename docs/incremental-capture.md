# Incremental input capture

Status: implemented and locally verified, October 13, 2026.
Baseline: `6c825565407d062f9c63a9daf6fd2741a1035827`.

Small edits to Controls' Project field now capture a region and reuse the
unchanged pixels in a private bitmap. The form keeps its original nodes,
focus, selection and submission behavior. Capture density and scheduling
are unchanged. The opt-in contract is in the [usage guide](../README.md#capture-engines)
and [decision #62](decisions.md#62).

## Measurements

Three alternating baseline/candidate pairs per slowdown, using the actual
Controls scene. Chrome 155.0.8059.40 ran on an Apple M4 Max with the Metal WebGPU
backend, a 1440 × 1000 viewport and device pixel ratio 2. Profiling and route
timing were disabled. Each trial typed the same 37 characters, submitted with
Enter, resized the viewport and returned the original form to the page.

Values are medians of the three per-trial statistics. Input latency ends at a
texture upload acknowledgement, not at display presentation. Frame intervals
measure the page's animation callbacks. CPU throttling leaves the GPU unchanged.
These are local measurements, not physical-device or cross-browser budgets.

| Slowdown | Measure | Full capture | Region capture | Change |
|---|---|---:|---:|---:|
| 4× | p95 frame interval | 100.0 ms | 83.3 ms | -16.7% |
| 4× | p95 input to upload | 401.0 ms | 379.4 ms | -5.4% |
| 4× | p50 input to upload | 262.8 ms | 247.0 ms | -6.0% |
| 4× | Main-thread task duration | 2089.1 ms | 2156.3 ms | +3.2% |
| 6× | p95 frame interval | 200.0 ms | 166.7 ms | -16.7% |
| 6× | p95 input to upload | 650.5 ms | 547.6 ms | -15.8% |
| 6× | p50 input to upload | 414.2 ms | 365.6 ms | -11.7% |
| 6× | Main-thread task duration | 3923.6 ms | 3823.1 ms | -2.6% |

Candidate input phases started nine or ten region captures and one full capture.
The full capture records submission, which changes the header. Each region
covers 340 × 48 CSS pixels instead of the full 760 × 540 form. The total area
requested during the input phase fell from roughly 4.1 million to
557,280–573,600 CSS pixels. A separate exact-pixel capture probe reduced the SVG payload from
about 393 kB to 183 kB by excluding fonts outside the region. The retained
layout structure still has 62 cloned nodes versus 72 in the full capture;
clipping does not eliminate cloning or SVG decoding.

The 4× task-duration median increased 3.2%. Its upload count increased from
10 to 11; the measurements do not establish a reduction in total CPU work at
that rate. Faster input echo and shorter frame tails are the observed gains.
Only type annotations, comments and documentation changed after timing.
Per-trial ranges and loaded source hashes are in
[incremental-capture-results.json](incremental-capture-results.json).

## Quality and limits

The [browser proof](../instruments/input-regions/README.md) passed 41 states with
exact full-capture RGBA equality. It covers typing, deletion, placeholders,
horizontal scrolling, layout and density changes, stylesheet changes, filters,
transformed ancestors, refresh during decoding, decode and cache-draw failures,
and disposal. Moving a patch by one pixel failed on 20,554 pixels. Reusing a
failed cache failed on 1,573,776 pixels. Both controls confirm that the pixel
comparison rejects broken composition.

All twelve matched scene screenshots were byte-identical. Every performance
trial retained the input node, preserved the edited value and focus, observed
all 37 input events, acknowledged their capture reads, delivered one trusted
submit and completed both presentation handoffs. Both capture engines passed
`gate:capture-engines` with `STRICT_CAPABILITY=1`. Unflagged fallback gestures
passed in five scenes.

Region capture is explicit because input-dependent CSS can affect the rest of
a form. The adapter observes changes and uses full captures when its guards
cannot establish eligibility. It does not infer paint independence from CSS.
The default engine behavior and the native HTML-in-canvas path are unchanged.

The cache adds about 6.3 MiB for Controls' 1520 × 1080 RGBA bitmap, by arithmetic.
Resident memory was not measured. Upload dimensions remain full-size. The
existing full-capture warning about four unplaced field pseudo-elements also
appears on the baseline; this change preserves full-capture pixels and does
not establish that the warning is harmless.

## Reproduce

```sh
node instruments/input-regions/run.mjs
PERF_BASELINE_REF=6c825565407d062f9c63a9daf6fd2741a1035827 \
  PERF_CPU_RATES=4,6 PERF_ENGINES=snapdom PERF_TRIALS=3 \
  PERF_ROUTE_TIMING=0 PERF_OUTPUT=/tmp/munari-regions \
  node instruments/performance/run.mjs
node instruments/performance/summarize.mjs /tmp/munari-regions
```

The [benchmark guide](../instruments/performance/README.md) defines the workload,
observations and source comparison. The implementation uses the installed
snapDOM public clipping and invalidation APIs. No dependency patch, fork or
capture-scheduling change is required.
