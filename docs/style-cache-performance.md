# Serialized computed-style cache

Implemented and measured on 2026-10-14 against `a1a0456`. The cache reduces
repeated style work and improves typical input acknowledgement in the Controls
lab demo. Large SVG capture spikes remain.

Each inspected element now retains its ordered property names, primitive
values and serialized CSS string. Every lookup reads and compares the current
names and values. Only an exact match reuses the string. This catches media,
pseudo-class, CSSOM and paused-animation changes without depending on events.
A renamed empty custom property also causes a miss.

A `WeakMap` holds the snapshots without retaining their elements. Cache release
and disposal clear them. This adds retained arrays and strings per inspected
element. Geometry, font eligibility, input ownership and capture pacing keep
their existing checks. There are no API or dependency changes.

## Production results

Negative percentages mean less time or work. Values are the median of changes
within matched baseline/candidate pairs, not ratios of pooled medians.

| Capture canvas | CPU slowdown | Pairs | Input p50 | Input p95 | Main-thread work |
|---|---:|---:|---:|---:|---:|
| CPU | 4× | 5 | −18.4% | −5.7% | −10.2% |
| CPU | 6× | 10 | −3.6% | −4.5% | −2.9% |
| GPU | 4× | 10 | −3.3% | −2.0% | −5.0% |
| GPU | 6× | 5 | −3.0% | 0.0% | −3.2% |

The clearest result is CPU capture at 4×: typical acknowledgement and task work
improved in every pair. At 6×, typical CPU acknowledgement improved in eight
of ten pairs. Animation-frame p95 showed no consistent improvement.

Tail results vary. The first five CPU 6× pairs had an 11.8% median p95 increase;
the next five had a 5.5% reduction. All ten remain in the table. CPU 6× paired
p95 changes range from −7.6% to +15.0%; GPU 6× ranges from −26.5% to +21.3%.
These measurements do not establish a general tail-latency improvement.

Earlier captures sometimes assign a late keystroke to the final full capture
instead of the preceding region capture. In two initial CPU 6× pairs, that
raised p95 even though the final upload arrived 88–164 ms sooner. A diagnostic
pair confirmed horizontal scrolling rejects SVG reuse. Submission then requires
a full capture. The existing capture gap and SVG work still govern these tails.

The diagnostic pair measured median style-declaration work at 6× falling from
2.4 ms to 1.4 ms. Median complete snapshot inspection fell from 18.9 ms to
12.0 ms. Diagnostic timing is separate from the unprofiled table. Every
candidate input phase reused its style strings with zero new serializations.

## Verification and scope

The matrix contains 60 production trials. It began with five alternating pairs
per configuration, then repeated CPU 6× and GPU 4× once to check their initial
tail increases. Both runs are retained. Source hashes match across runs. Each
build verifies production React and React DOM, the baseline's source bytes,
and identical dependencies, Vite configuration, lab sources and assets.

All 2,220 trusted input events were acknowledged. Every trial retained the
original input, value and focus, submitted once, and completed the scene/page
handoff. The strengthened source proof passed 253 exact RGBA comparisons,
including visible media, inherited-style and paused-animation changes.
Forcing stale style reuse failed at the intended media change with 1,567,195
incorrect pixels. No pixel tolerance changed.

Of 120 paired screenshots, 116 matched byte for byte. Three differences
preserved the board interior exactly and varied the surrounding scene by at
most 3/255 per channel. One baseline returned-page image contained a caret
blink and small native-content differences; its candidate matched 18 other
shots. All paired before/edited captured-source hashes matched. Full image
differences and their limits are retained in the evidence.

Tests passed: 1,442 tests in 126 files, typecheck, lint and package build.
React Doctor found no new issues. The runtime and measurement changes received
independent review.

Measurements use Chrome 155.0.8059.80 on an Apple M4 Max, DPR 2, with 4×/6×
CPU slowdown and the same host GPU. Input timing ends at an upload
acknowledgement. It does not measure display presentation. These are warm
interaction measurements; cache memory and startup cost were not quantified.

See the [recorded results](style-cache-performance-results.json),
[production benchmark commands](../instruments/performance/README.md), and
[exact-pixel proof commands](../instruments/input-regions/README.md).
