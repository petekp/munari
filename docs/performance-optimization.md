# snapDOM performance results

Status: verified, October 13, 2026.

snapDOM now avoids an intermediate bitmap allocation and copy. Input latency
and main-thread task medians improve modestly. Frame p95 is unchanged at 4×
CPU slowdown and lower at 6×. The diagnostic 50 ms frame ceiling remains unmet.

The rasterizer returns its decoded `HTMLImageElement`, with width and height
set to the requested capture dimensions. The existing core `RasterImage`
contract accepts it. The source draws it into the retained capture canvas,
replacing the intermediate canvas and its full-size draw.

At the observed 1520 × 1080 capture size, one RGBA8 plane is 6,566,400 bytes,
about 6.3 MiB. This is allocation arithmetic, not measured resident memory.
The retained source canvas and decoded SVG still exist. Capture cadence,
fonts, resolution, renderer, input workload and the afterClone frame yield
are unchanged. All 68 loaded lab source hashes match the baseline.

The paired diagnostic profiles located the remaining main-thread work.
Baseline snapDOM animation-frame continuations had a 104.7 ms median. Clone
preparation had a 61.5 ms median. SVG decoding includes synchronous native
layout; its 87.1 ms wall time also includes waiting.

The updated profile still measured a 106.1 ms continuation median, 63.4 ms
clone preparation and 90.2 ms decode wall time. It removed the intermediate
canvas draw, whose baseline median was 4.9 ms. The final source draw had a
5.0 ms median, down from 7.0 ms. Every completed capture had a recorded output:
10 canvases in the baseline, 10 decoded images in the updated version.
These profiles identify work; the timing comparison below disables profiling.
Native SVG decoding and clone preparation remain the largest bottlenecks.

The unprofiled benchmark compares against:

`7b0f8a181fede4739aa18245113c37773fcc640e`

Three alternating pairs ran at each CPU rate, for 12 trials. Chrome
155.0.8059.40 ran on an Apple M4 Max. The actual backend was WebGPU through
WebGPURenderer, with Apple Metal adapter metadata. Dependencies were Three
0.186.1, React Three Fiber 9.8.1 and snapDOM 3.3.3.

The viewport was 1440 × 1000 CSS pixels at DPR 2, then 1320 × 920 at the same
density. Each trial typed the same string with a 40 ms keyboard delay,
submitted the form, resized and returned to the page. Profiling, capture-stage
observers and route timing were disabled.

Each table entry is the median across three trials. Brackets show their
minimum and maximum values. Frame and latency values are rounded to 0.1 ms;
task durations to 0.001 ms.

| CPU rate | Input-phase metric | Baseline, ms | Updated, ms |
| --- | --- | --- | --- |
| 4× | Animation frame interval p95 | 83.3 [83.3–83.4] | 83.3 [83.3–83.3] |
| 6× | Animation frame interval p95 | 149.9 [149.9–150.0] | 133.3 [133.3–133.3] |
| 4× | Maximum animation frame interval | 100.1 [100.0–100.1] | 100.1 [100.0–100.1] |
| 6× | Maximum animation frame interval | 166.7 [166.6–166.7] | 166.6 [150.1–166.7] |
| 4× | Input to upload acknowledgement p50 | 258.3 [252.4–260.9] | 244.7 [237.7–247.5] |
| 6× | Input to upload acknowledgement p50 | 345.3 [341.3–350.0] | 332.6 [330.1–345.7] |
| 4× | Input to upload acknowledgement p95 | 400.4 [389.4–402.8] | 367.2 [325.7–377.1] |
| 6× | Input to upload acknowledgement p95 | 525.1 [495.6–535.0] | 506.1 [449.9–525.6] |
| 4× | Main-thread task duration | 1871.161 [1852.808–2055.595] | 1799.479 [1781.635–1946.431] |
| 6× | Main-thread task duration | 3152.682 [3109.673–3223.576] | 2971.804 [2907.895–3083.439] |

Every input reached an acknowledged capture read. The original input node,
value and focus survived the handoff, and each trial submitted the real form
once. All 12 matched scene screenshot pairs were byte-identical, including
resize. Neither rate showed worse median input latency in these trials.
Overlapping trial ranges limit the strength of the timing conclusion.

The capture-engine gate passed for both engines, including fidelity, pacing,
carried pixels and mixed animation. A separate snapDOM comparison had identical
resting RGBA pixels, including translucent edges. Held-capture checks passed
edits, resize, disposal and handoff. The origin probe passed all 12 cases
without tainting a canvas. Validation passed 1,438 tests across 125 files,
four typechecks, lint and the package build.

[The result summary](performance-results.json) preserves exact values, ranges,
source hashes and screenshot hashes. [Profile evidence](performance-profile-results.json)
records the diagnostic stages and native callbacks. Raw comparison evidence is in
`/tmp/munari-spikes-direct-final`. Diagnostic profiles are in
`/tmp/munari-spikes-final-profile`.
The [benchmark guide](../instruments/performance/README.md) includes commands
for the comparison and profile/trace summaries.

CPU throttling leaves the GPU unchanged. Input latency ends at Three's upload
acknowledgement, before GPU completion or display presentation. Animation frame
intervals measure main-thread callback cadence. These are local Controls
measurements; they provide no portable device speed guarantee.
