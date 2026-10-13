# Controls performance results

Status: verified, October 12, 2026.

Controls editing uses less main-thread time and reaches texture upload
acknowledgement sooner. Animation frame intervals also improve. The 6× CPU
case still has long frame gaps.

Three changes remove repeated work:

- The retained form owns its values. Typing updates the form without
  rerendering the canvas and scene.
- Equal anchor rectangles retain their React state identity. New capture
  generations update provenance without rerendering unchanged hardware.
- The font plugin supplies embedded fonts through snapDOM's renderer font
  stylesheet. The clone's style-interning pass no longer parses that payload
  as a separate style element.

Main's `drawTrailsPaint` upload policy and native-route source-swap cleanup
remain intact. The renderer, dependencies, capture density and visual quality
settings are unchanged.

The benchmark compares this implementation against main:

`57783c199a4c5d313dd34b2fe53c4bf922d32587`

It loads the baseline's library and lab sources from Git. Both versions use
Three 0.186.1, React Three Fiber 9.8.1 and snapDOM 3.3.3. The observed renderer
was WebGPURenderer using WebGPU on Apple Metal. Chrome was 155.0.8059.40 on an
Apple M4 Max.

Three alternating pairs ran at each CPU rate. The viewport was 1440 × 1000
CSS pixels at DPR 2, then 1320 × 920 at the same density. Each trial typed the
same string with a 40 ms keyboard delay, submitted the form, resized the
viewport and returned the form to the page. Profiling, capture-stage observers
and route timing were disabled.

The table shows each input-phase metric's median across three trials. Brackets
show the minimum and maximum trial values. Frame and latency values are rounded
to 0.1 ms. Task durations are rounded to 0.001 ms.

| CPU rate | Metric | Baseline, ms | Updated, ms |
| --- | --- | --- | --- |
| 4× | Animation frame interval p95 | 83.3 [83.2–83.3] | 66.7 [66.6–83.3] |
| 6× | Animation frame interval p95 | 150.0 [133.4–166.7] | 133.3 [116.7–133.4] |
| 4× | Input to upload acknowledgement p95 | 450.9 [360.8–462.2] | 301.4 [299.2–311.4] |
| 6× | Input to upload acknowledgement p95 | 648.4 [644.8–692.3] | 494.3 [400.4–525.1] |
| 4× | Main-thread task duration | 3171.867 [3141.163–3238.396] | 1824.329 [1816.152–1839.122] |
| 6× | Main-thread task duration | 4796.551 [4757.923–4841.850] | 2688.936 [2671.047–2963.728] |

All 12 trials completed. Every input reached an acknowledged capture read.
The original input node, value and focus survived the handoff. Each trial
submitted the real form once. All 12 matched scene screenshot pairs were
byte-identical, including the resized scene. Idle captures and uploads were
zero in both versions.

[The result summary](performance-results.json) preserves exact values, ranges,
source hashes, backend metadata and screenshot hashes. Raw records and images
are in `/tmp/munari-main-final`. The [benchmark guide](../instruments/performance/README.md)
provides the repeatable command.

Validation passed: 1,435 tests across 124 files, all four typechecks, lint and
the package build. The capture-engine gate passed for both engines, including
mixed animation. Native pointer checks passed with seven checks and no errors.
The Knobs resize gate passed its 14 steps with 12.6 px maximum marker drift.
Focused browser checks passed retained Controls state, reset, input and focus,
and equal, missing, restored and resized anchors. React Doctor found no issues.

CPU throttling leaves the GPU unchanged. Input latency ends at Three's upload
acknowledgement, before GPU completion or display presentation. Animation frame
intervals measure main-thread callback cadence. These results cover one desktop
Controls workload on this host, rather than a portable device speed budget.
