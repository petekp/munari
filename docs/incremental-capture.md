# Input capture performance

Frame p95 and main-thread task time improved in every pair. Input latency varied across pairs.

The cache retains the public SVG output for an isolated text input and replaces its value for eligible edits. Cache hits skip upstream cloning and SVG normalization. Duplicate style reads, scratch allocation, and unchanged input frames also avoid repeated work. Full fallback captures use the existing capture path.

Baseline: `438d41136528f07e8f9eb9a615eaf01edaf83896`. Chrome 155.0.8059.79 ran on an Apple M4 Max with Metal WebGPU, a 1440 × 1000 viewport and device pixel ratio 2. Profiling and route timing were disabled. Each CPU/GPU storage mode has five paired trials at 4× and 6× CPU slowdown. The lab source tree matches the baseline. Capture pacing, input delivery, density, and complete texture uploads remain unchanged.

Before and after are medians of five trials. Change is the median paired percentage, followed by its minimum and maximum. These are different calculations. p95 is the 95th percentile. Input latency ends at a texture upload acknowledgement, not display presentation. Frame intervals measure animation callbacks.

| Storage | Slowdown | Metric | Before | After | Paired change and range |
|---|---|---|---:|---:|---|
| CPU | 4× | Frame p95, ms | 83.4 | 50.0 | -40.2% [-49.9%, -39.9%] |
| CPU | 4× | Input to upload p95, ms | 487.1 | 404.4 | -14.3% [-18.9%, -12.2%] |
| CPU | 4× | Main-thread tasks, ms | 2445.0 | 2204.1 | -12.8% [-13.5%, -8.5%] |
| CPU | 6× | Frame p95, ms | 150.0 | 83.3 | -44.5% [-55.5%, -44.4%] |
| CPU | 6× | Input to upload p95, ms | 647.2 | 576.8 | -13.3% [-17.7%, +19.9%] |
| CPU | 6× | Main-thread tasks, ms | 3939.7 | 3321.9 | -15.4% [-17.0%, -11.6%] |
| GPU | 4× | Frame p95, ms | 83.3 | 16.8 | -79.8% [-79.8%, -60.1%] |
| GPU | 4× | Input to upload p95, ms | 314.1 | 312.2 | -0.7% [-17.8%, +21.9%] |
| GPU | 4× | Main-thread tasks, ms | 1928.7 | 1559.4 | -19.7% [-24.5%, -15.6%] |
| GPU | 6× | Frame p95, ms | 133.3 | 50.0 | -62.6% [-66.7%, -62.5%] |
| GPU | 6× | Input to upload p95, ms | 506.1 | 415.2 | -19.9% [-22.6%, +7.8%] |
| GPU | 6× | Main-thread tasks, ms | 2942.4 | 2502.5 | -15.0% [-18.5%, -11.0%] |

GPU 4× input p95 was essentially unchanged: median 314.1 to 312.2 ms. Paired changes ranged from -17.8% to +21.9%.

Main-thread task time per elapsed second also fell by paired median: CPU 4× -8.0%; CPU 6× -4.7%; GPU 4× -9.1%; GPU 6× -5.0%. The lower task totals therefore reflect less work per unit of elapsed time as well as shorter input phases. Per-pair ranges remain in the JSON.

| Storage | Slowdown | SVG hits | Unchanged frames | Upstream captures | Completed captures | Input phase, ms |
|---|---|---:|---:|---:|---:|---:|
| CPU | 4× | 6 | 0 | 9 to 4 | 9 to 10 | 3271.7 to 3125.9 |
| CPU | 6× | 6 | 0 | 10 to 4 | 10 to 10 | 4397.2 to 3922.4 |
| GPU | 4× | 6 | 0 | 10 to 4 | 10 to 10 | 3020.7 to 2683.7 |
| GPU | 6× | 6 | 0 | 10 to 4 | 10 to 10 | 3771.2 to 3347.5 |

Input p95 pair regressions: CPU 4×: 0/5 pairs worsened; CPU 6×: 2/5 pairs worsened, largest increase +19.9%; GPU 4×: 2/5 pairs worsened, largest increase +21.9%; GPU 6×: 2/5 pairs worsened, largest increase +7.8%.

Each active source can retain one parsed region SVG in addition to the existing bitmap cache. Resident memory has not been measured.

All 40 trials acknowledged all 37 typed inputs and preserved the original input, value, focus, and one trusted submission. Candidate pixels matched a fresh full snapDOM capture in 151 final RGBA comparisons and 2 intermediate-frame comparisons. Disposal and decode/draw recovery checks passed.

Both capture engines passed the strict capability gate. Native fallback gestures passed in five scenes without enhanced flags. All 1,438 tests, four typecheck programs, lint and the package build passed. React Doctor found no new issues.

Negative controls detected input-version and local-origin pixel faults. Unknown SVG viewport handling passed 3 full-fallback comparisons.

Font guard behavior was exercised by the positive font fixture and capture-count assertions. Missing-face visual sensitivity remains unverified because the existing font selector reads cloned text nodes and omits input value attributes. Both the candidate and fresh oracle can omit the same font face.

Benchmark screenshot byte equality: CPU 20/20 equal, 0 different, 0 unavailable; GPU 20/20 equal, 0 different, 0 unavailable. Screenshot hashes and per-trial input acknowledgements are retained in the JSON.

Profiles located about 411 ms of sampled CPU drawing in region staging and 97 ms in the final source draw. CPU storage moved deferred SVG rasterization into composition before publication. Cloning and SVG normalization remained additional work. The retained SVG avoids those repeated preparation steps. The previous GPU input tail grew mainly before capture admission. Discarded scheduling experiments lowered frame tails but worsened input latency or increased captures. These diagnostic timings are separate from this matrix.

CPU slowdown on this Apple host does not reproduce a physical low-power device. Earlier diagnostic timings showed host contention. One CPU profile completed its rows but stalled during cleanup. Its own process group was terminated, and that run remains diagnostic. The final runner terminates only its own process group on timeout. The older background-only resized screenshot mismatch also remains diagnostic.

Raw timings, paired changes and ranges, cache counts, loaded source hashes, quality cases, negative controls, and diagnostic limits are in [incremental-capture-results.json](incremental-capture-results.json).

## Reproduce

```sh
REGION_STORAGE=cpu node instruments/input-regions/run.mjs
REGION_STORAGE=gpu node instruments/input-regions/run.mjs
PERF_BASELINE_REF=438d41136528f07e8f9eb9a615eaf01edaf83896 \
  PERF_CAPTURE_STORAGE=cpu PERF_CPU_RATES=4,6 PERF_ENGINES=snapdom \
  PERF_TRIALS=5 PERF_ROUTE_TIMING=0 PERF_OUTPUT=/tmp/munari-svg-cpu \
  node instruments/performance/run.mjs
node instruments/performance/summarize.mjs /tmp/munari-svg-cpu
```

Repeat with `PERF_CAPTURE_STORAGE=gpu` and a separate output directory. The
[benchmark guide](../instruments/performance/README.md) defines the measurements.
The [capture guide](../instruments/input-regions/README.md) documents pixel checks
and deliberate faults. Source files stayed fixed across both timing matrices.
