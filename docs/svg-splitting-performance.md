# SVG capture performance investigation

Status: both clone-removal candidates were rejected. Runtime source has been
restored exactly to `63bd91e`. The accepted performance improvements already on
main remain intact. This investigation adds profiling tools and evidence; it
ships no new runtime speedup.

The candidates removed real work, but neither met the requirement to preserve
responsiveness at both CPU slowdown rates. Independent review supported
rejection. Changing capture pacing to compensate would expand this change's
scope, so the existing policy remains in place.

## Final production comparisons

Each comparison used five alternating baseline/candidate pairs for CPU and GPU
capture storage at 4× and 6× slowdown. Each matrix contains 40 production trials.
The baseline is `a355cc5`, whose runtime matches `63bd91e`. Lab code, CSS,
assets, dependencies, resolution and the original 37-character keyboard workload
were identical. Profiling and diagnostic timers were disabled.

The table reports median percentage changes within matched CPU-storage pairs.
Negative values mean less time. These are not ratios of pooled medians.

| Candidate | Slowdown | Input p50 | Input p95 | Submit acknowledgement | Complete interaction | Input task work |
|---|---:|---:|---:|---:|---:|---:|
| Background and blank-input clones removed | 4× | −16.1% | −3.8% | −44.3% | −4.4% | −5.9% |
| Background and blank-input clones removed | 6× | −2.2% | −1.6% | +16.0% | −1.9% | −3.9% |
| Blank-input clone removed only | 4× | +0.7% | +2.3% | +6.6% | +0.9% | +6.0% |
| Blank-input clone removed only | 6× | −5.2% | −4.6% | +5.0% | +1.0% | +1.7% |

The combined candidate improved CPU 4× typical input, complete interaction and
task work in all five pairs. At CPU 6×, submission worsened in three pairs by
92, 65 and 206 ms. Its submitted full capture was faster in every pair; the
extra delay occurred before capture entry, while a preceding capture and the
admission gap were still outstanding.

Restoring the background splitter isolated the smaller input-only change.
That candidate worsened CPU 4× input p95 and complete interaction in all five
pairs. CPU 6× submission worsened in four pairs. Better typical typing and a
cheaper local operation were insufficient to accept either candidate. Neither
established a consistent reduction in maximum frame gaps.

GPU trials execute neither changed path. Their timing varied too, which limits
causal certainty but does not make the CPU acceptance failures pass. All pairs
remain recorded. The completed repeat's CPU host busy range was 20.8–34.1%; the
input-only confirmation's was 20.1–30.6%. GPU ranges were wider.

An earlier requested quiet attempt reached 97.3% host CPU use and was interrupted
after 16 completed rows. Only benchmark-owned processes were stopped. The host
remained about 99% busy afterward while unrelated filesystem jobs ran. Once those
jobs ended, a new comparison used fresh output directories. The interrupted
attempt is preserved separately and is ineligible for acceptance.

## What the profiles established

Large gaps overlap fresh clipped SVG captures. One initial trace recorded a
95.1 ms animation-frame callback interval, including promise microtasks and
native style/layout. The callback itself took 3 μs. Work continued after the
rAF promise resolved, blocking the frame through rendering, normalization and
serialization. Both baseline and candidate showed this pattern.

The background candidate avoided a full XML document clone by serializing the
foreground before pruning the same document into its background. That clone
cost 9.8–10.1 ms in its diagnostic. The blank-input candidate copied only the
input subtree, serialized its blank state and restored the original node before
decoding awaited. Its pre-decode preparation fell from 5.6–6.4 ms to 0–0.1 ms.
Both candidate timer events were present. Restoration was outside that timer
and remained included in total task measurements.

None of the four maximum frame windows in the isolated blank-clone profile
contained that preparation. The largest remaining stalls still overlapped
upstream clipped capture. The local saving therefore did not prove the
frame-spike problem fixed.

Two scheduling variants were also rejected. An extra task yield after the SVG
snapshot shortened maximum gaps but increased CPU 4× typical input latency by
about 28 ms in both screening pairs. Replacing the existing clipped-capture rAF
wait also worsened typing, submission and task work. Both changed which capture
was still in progress when Enter arrived.

A separate five-pair CPU 6× diagnostic issued trusted keys at fixed Node
deadlines instead of waiting for each browser acknowledgement before scheduling
the next key. All 760 key events and 370 input prefixes passed; issue lateness
was at most 2.02 ms. Listener-to-submit-upload improved in four pairs, while
command-issue-to-upload improved in three and worsened in two. The latter
regressions exceeded clock uncertainty. Capture grouping and focus-relative
arrival times differed from the original workload. This demonstrates typing-loop
feedback, but does not clear the original regression or replace its results.

## Quality, reproducibility and limits

Each final candidate passed 305 exact RGBA integration comparisons, including
CPU/GPU storage, fallback, refresh, interrupted preparation, density changes and
disposal. Origin, stale-input-version and stale-background faults failed at the
intended assertions. No pixel tolerance changed. The input helper also passed
10 differential cases, 18 exact pixel comparisons and 16 exact serialized-URL
comparisons. Immediate node restoration, text/comment children, concurrent
rendering and failure recovery were checked with deliberate faults.

Each final 40-trial matrix acknowledged all 1,480 trusted inputs, 40 focus events
and 40 submissions. Captured-source hashes matched and all 80 paired screenshots
were byte-identical. The five-scene native gate passed without a capability skip.
Repository tests, typechecks, lint, build and React Doctor passed for the tested
candidates. Runtime restoration was independently verified across all 144 package
source files.

The [evidence file](svg-splitting-performance-results.json) retains the earlier
matrices, final comparisons, every contrary result, source/build identities,
quality cases and aligned profile observations. No matrices are pooled.
The [archived patches](spikes/2026-10-15-capture-variant-patches.json) reproduce
all four rejected runtime variants from `63bd91e`; they are alternatives, not
cumulative changes. The [benchmark guide](../instruments/performance/README.md)
and [pixel proof](../instruments/input-regions/README.md) describe the standard
commands. The [fixed-cadence archive](spikes/2026-10-15-fixed-cadence/README.md) remains a
separately labeled experiment.

Measurements use Chrome 155 on an Apple M4 Max at DPR 2. CPU slowdown leaves
the GPU unchanged. Upload acknowledgement is not visible presentation, and the
original typing cadence depends on browser response time. Physical lower-powered
devices, energy use and peak resident memory remain unmeasured. Production
source maps are empty after served-source instrumentation, so sampled bundle
positions do not establish original TypeScript lines. Fresh output directories
and command exit statuses avoid the existing runner's stale-success-file hazard.
