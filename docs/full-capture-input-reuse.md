# Full capture input reuse experiment

Rejected on 2026-10-15. The active runtime remains at `a355cc5`.
The experiment improved CPU typing latency, but it did not pass the GPU
regression check. Neither runtime variant was kept.

The first text edit repeated a clone already made by the focused full capture.
A retained 6× profile measured that first region capture at 252 ms. The candidate
reused the complete parsed SVG to prepare the existing certified text painter.
It could then draw the first edit without another upstream capture.

Preparation was limited to CPU-backed canvases at 2× density. It required a
capture lasting at least 250 ms and a changed input value arriving during that
capture. Preparation ran after a frame callback and a task. A template became
reusable only after its pixels passed certification. Cancellation, rejection
and unsupported content kept the existing capture path.

## Results

The main comparison used 40 production Controls trials: five alternating pairs
at each slowdown and canvas storage mode. Both versions used production React,
identical lab sources, CSS, assets and dependencies. Profiling and stage timing
were off. Negative values below mean less time or work. Values are medians of
percentage changes within matched pairs.

| Canvas | Slowdown | Input p50 | Input p95 | Complete interaction | Input-thread work |
|---|---:|---:|---:|---:|---:|
| CPU | 4× | −5.2% | −6.1% | −4.0% | −11.0% |
| CPU | 6× | −10.2% | −16.0% | −6.3% | −11.3% |
| GPU | 4× | −1.6% | +3.4% | +0.4% | +0.7% |
| GPU | 6× | +0.4% | +5.6% | −0.7% | −3.0% |

All five CPU 6× pairs improved typing latency. Each used direct text drawing
before any upstream first-edit capture. Warmup stayed off at CPU 4× and in both
GPU groups, so the CPU 4× timing shifts cannot be credited to warming.

CPU 6× completion improved in three pairs and worsened in two. Its per-version
completion medians were 2763.9 and 2792.9 ms; those medians answer a different
question from the paired percentage above. Focus and submit acknowledgement
also worsened in three pairs, with paired median increases of 4.6% and 14.8%.
These mixed results remain part of the evidence.

GPU input p95 worsened in all five 4× pairs and four of five 6× pairs. That failed
the acceptance rule. The cause was not resolved by removing unused GPU layout
reads, retained SVG data and warmup helper calls. A direct three-pair comparison
of that repair against the rejected candidate produced these results:

| Pair | Input p95 before / after | Late region capture before / after |
|---|---:|---:|
| 1 | 280.4 / 309.3 ms | 91.0 / 117.3 ms |
| 2 | 284.6 / 267.9 ms | 104.2 / 85.2 ms |
| 3 | 275.1 / 287.2 ms | 88.0 / 105.8 ms |

The repair improved each measure in only one pair. Its predeclared screen
required p95 to improve in all three and late capture time in at least two.
No further variant or acceptance batch followed.

The metric has a limit that matters here. Puppeteer waits for each key press
response before sending the next. Faster page work can therefore change the
input schedule. The latency metric starts at the input listener and excludes
earlier keyboard processing. Three large GPU 6× listener-latency increases
shrank substantially when observed pre-listener key processing was included.
Those conditional event joins do not replace the benchmark metric or establish
physical-key latency. GPU 4× also showed longer late captures in all five pairs.
The timing evidence did not justify shipping the change.

## Evidence and reproduction

The [results](full-capture-input-reuse-results.json) retain every paired result,
source identities, first-use checks, timing limits and pixel evidence.
CPU slowdown leaves the GPU unchanged. Upload acknowledgement is not display
presentation. These are local Chrome 155 measurements, not a hardware baseline.

The slow-capture candidate passed 339 exact source-canvas comparisons across CPU,
GPU and timer-fallback runs. Both capture engines, idle-zero and the no-flag
native fallback passed their gates. The final repair passed 52 focused pixel
checks. Corrupt snapshots fell back with exact pixels; bypassing certification
caused the expected 16-pixel error. All 1,442 tests, type checks, lint and package
builds passed. Performance acceptance remained separate from correctness.

All 1,480 input, 40 focus and 40 submit acknowledgements passed in the main
matrix. Of 80 screenshot comparisons, 79 matched exactly. The remaining image
differed by at most three channel levels. The inspected panel, heading and field
interiors matched exactly. The same image variation was found in unchanged
baseline runs. The repair screen passed
all 222 input acknowledgements and all 12 screenshot comparisons.

The patches reproduce the rejected source at `a355cc5`:

- [Slow-capture candidate](spikes/2026-10-15-input-warmup-slow-capture.patch).
- [Inactive-path repair](spikes/2026-10-15-input-warmup-inactive-path.patch).
- [Patch hashes and application checks](spikes/2026-10-15-input-warmup-patches.json).

Apply each patch separately to a clean checkout of that baseline. Both patches
were applied to baseline source copies and their resulting file hashes checked.
The existing [input-region proof](../instruments/input-regions/README.md) and
[production runner](../instruments/performance/README.md) supply the commands.
Use `PERF_BASELINE_REF=a355cc5`, `PERF_CPU_RATES=4,6`, `PERF_TRIALS=5`, production
mode and each storage policy for the first comparison. To reproduce the repair
screen, save the first candidate's package sources, use them as
`PERF_BASELINE_DIR`, and run the second candidate at GPU 4× for three pairs.
The full configuration and source hashes are in the results file.

The earlier [capture-pacing experiments](input-capture-pacing.md) were also
rejected because faster acknowledgements increased total work.

The retained code change closes the exited browser child's stderr reader after
normal browser shutdown in the input-region runner. An orphaned Chrome crash
reporter had kept that pipe open. Fresh proof runs then exited naturally.
