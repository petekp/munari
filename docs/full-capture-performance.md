# Full SVG capture performance

Implemented and measured on 2026-10-14 against `e0e921e`.
CPU background reuse reduces input-frame stalls in Controls. A quieter production
repeat cleared the earlier consistent 6× input-latency regression. The accepted
change has small entry and latency costs at 4×, recorded below.

CPU-backed snapDOM captures can reuse the root's background, border and shadow.
The private input-region adapter derives a background image and foreground SVG
from the same captured snapshot. It draws the foreground over the retained
background, then publishes the complete image through the existing source.
The original form retains input ownership.

Full captures still construct and serialize the current SVG and decode its
foreground. GPU-backed captures use the complete SVG. Reuse requires matching
paint, geometry and output dimensions. Unsupported CSS, paint effects and
geometry use the original path. A browser task yield separates SVG splitting
from the preceding snapDOM work. Abort and generation checks protect publication.

The extra background has an RGBA pixel-capacity limit of 8 MiB per source.
Controls uses 6,566,400 bytes at 1520×1080, about 6.3 MiB. Replacement can briefly
retain two backgrounds, up to 16 MiB. These bounds exclude SVG strings, decoded
images and browser overhead. Disposal clears retained and pending buffers.
[Decision #62](decisions.md#62--a-capture-is-paid-for-once-and-a-live-one-is-paced-by-a-period-2026-09-12)
defines the eligibility and lifecycle rules.

## Production results

The quiet-window comparison contains 40 production trials: five alternating
baseline/candidate pairs per storage mode at 4× and 6× CPU slowdown. Both
versions use production React and identical lab sources, dependencies and
configuration. Profiling, stage timing and route timing are disabled.

Values are medians of percentage changes within matched pairs. Negative values
mean less time or work. They are not ratios of pooled medians.

| Canvas | Slowdown | Complete interaction | Input p50 | Input p95 | Input-frame p95 | Input-phase task work |
|---|---:|---:|---:|---:|---:|---:|
| CPU | 4× | −1.0% | +2.5% | −4.3% | −40.0% | −4.0% |
| CPU | 6× | −4.2% | −3.3% | −7.4% | −28.6% | −5.6% |
| GPU | 4× | −0.4% | −1.5% | −0.8% | 0.0% | −4.2% |
| GPU | 6× | −0.2% | +0.4% | +1.7% | 0.0% | −0.4% |

CPU frame p95 fell clearly in four pairs at each rate; the fifth differed by
about 0.1 ms. At 6×, input p50, input p95 and complete-interaction time improved
in four of five pairs. Maximum frame gaps did not consistently improve.

The 4× tradeoffs are real enough to retain. Paired median input p50 rose
3.3 ms, with two pairs rising 24–26 ms. Scene entry added 32.9 ms of task work
and 67.8 ms elapsed, each worse in four of five pairs. At 6×, one pair's input
p50 rose 38 ms despite the aggregate improvement. Capture grouping and partial
capture counts vary across pairs; no pair was removed for that reason.

Across all recorded phases, task work was roughly flat: −0.6% at CPU 4× and
−0.1% at CPU 6×. Entry cost offsets much of the input-phase saving. GPU complete
interaction and frame p95 were near neutral; its smaller timing changes do not
establish a GPU speedup.

The earlier 40-trial batch remains separately recorded. It showed a consistent
6× input-p50 increase under heavy contention, with CPU 6× host busy fractions
of 73.6–98.7%. The repeat used identical source and protocol hashes. Its CPU
trials recorded 21.5–35.3% busy time; GPU trials recorded 25.6–59.6%. These
whole-trial counters include the measured browser and other processes. They
provide context, not a correction factor. The two batches are not pooled for
the accepted percentages.

A separate 6× profile attributes the gain to full-capture materialization:

| Full capture | Source draw, baseline / candidate | Capture start to receipt, baseline / candidate |
|---|---:|---:|
| Focus | 130.0 / 17.7 ms | 379.2 / 352.2 ms |
| Submit | 130.5 / 16.9 ms | 325.6 / 264.5 ms |

Each comparison matches its source and read. Candidate SVG splitting takes
61–67 ms and remains a substantial synchronous cost. These profiled observations
are separate from the unprofiled matrix; nested timers must not be summed.

## Correctness and measurement scope

All 305 source-canvas comparisons matched exactly: 164 CPU, 138 GPU and three
timer-fallback cases. The reference decodes a fresh full SVG through the original
image path. Cases cover real reuse, submission, wrapped roots, transparency,
paint changes, unsupported effects, density changes and the memory limit.
Held preparations exercise input, refresh and disposal. Failed composition
preserves the published source. GPU cases require zero background reuse.

A deliberately stale background caused 1,563,166 differing pixels at the root
paint change. The fixture confirms that the reference changes while the input
value stays constant. No pixel tolerance changed.

All 1,480 trusted inputs in the quiet matrix were acknowledged. Each trial
retained the original input, value and focus, submitted once and completed the
scene/page handoff. Focus and submit reached their required source reads and
uploads. Each CPU candidate input phase reused its background twice with no
new preparation. The 40 paired before/edited source snapshots have matching
hashes, dimensions and populated-pixel counts. These hash comparisons are
separate from the 305 exact-pixel cases.

All 80 quiet-window screenshot pairs match byte for byte. In the earlier batch,
77 of 80 matched. Its three differences leave the opaque board interiors exact
and affect the surrounding page and antialiased boundary. Each candidate image
matches other baseline trials at that phase. Both batches remain in the results.

The interaction phase starts before focus and includes End, 37 typed inputs at
a 40 ms delay, Enter and the submitted frame. Complete-interaction time ends
at the first upload acknowledging submission. Per-input latency starts at the
input listener. These metrics end at upload acknowledgement, not visible
presentation. Scene entry includes the request and settling work; initial mount
and font loading precede it. Older runs with different focus or submit boundaries
remain diagnostic evidence only.

All 1,442 tests in 126 files, typecheck, lint and package build passed.
React Doctor reported no new issues. The no-flag browser gate passed native
gestures in five scenes. Earlier checks passed both capture engines and twelve
untainted captures on the unchanged plain capture path. Runtime, proof,
measurement and result interpretation received independent review.

Measurements use Chrome 155.0.8059.80 on an Apple M4 Max at DPR 2. CPU slowdown
leaves the host GPU unchanged. Peak resident memory, physical-device behavior,
other browsers and input-to-visible latency remain unmeasured.

See the [recorded results](full-capture-performance-results.json),
[production benchmark commands](../instruments/performance/README.md) and
[exact-pixel proof commands](../instruments/input-regions/README.md).
