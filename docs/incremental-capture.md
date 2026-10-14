# Direct input text results

CPU input-to-upload p50 medians: 4× 255.7 to 141.3 ms; 6× 428.1 to 179.0 ms. CPU input-phase task time changed by paired median: 4× -12.2%; 6× -13.0%. GPU capture retains the SVG path.

Eligible CPU edits restore a blank input bitmap and paint Canvas text. They skip value SVG serialization and decoding. Preparation decodes the blank bitmap and checks its seed text against the accepted capture. Rejected settings use SVG.

Baseline: `597eae53e92d1bc83818155794f1c46eb2fbeb80`. The matrix has five paired trials per rate and storage mode on Apple M4 Max, Chrome/155.0.8059.80, DPR 2. CPU/GPU name the 2D capture storage modes. CPU slowdown simulates 4× and 6× rates on this host, not physical low-power devices.

Input timing starts when the observer receives a DOM input event and ends at its texture-upload acknowledgement. It excludes input dispatch delay and visible presentation. Frame timing measures requestAnimationFrame intervals, not presentation time.

Before/after values are medians of five trials. Changes are median paired percentages and their minimum-to-maximum ranges. p50 is the median; p95 is the 95th percentile.

| Storage | Slowdown | Metric | Before | After | Paired change and range |
|---|---|---|---:|---:|---|
| CPU | 4× | RAF interval p95, ms | 50.0 | 50.0 | +0.0% [-50.0%, +0.2%] |
| CPU | 4× | Input to upload p50, ms | 255.7 | 141.3 | -45.0% [-49.3%, -43.9%] |
| CPU | 4× | Input to upload p95, ms | 418.4 | 421.2 | +5.3% [-14.2%, +13.1%] |
| CPU | 4× | Input-phase tasks, ms | 2230.2 | 2003.2 | -12.2% [-28.1%, -4.5%] |
| CPU | 6× | RAF interval p95, ms | 100.0 | 100.0 | -0.1% [-40.0%, +66.5%] |
| CPU | 6× | Input to upload p50, ms | 428.1 | 179.0 | -55.5% [-60.2%, -50.7%] |
| CPU | 6× | Input to upload p95, ms | 704.1 | 634.2 | -9.9% [-14.0%, -1.8%] |
| CPU | 6× | Input-phase tasks, ms | 4474.2 | 3892.7 | -13.0% [-20.7%, +9.9%] |
| GPU | 4× | RAF interval p95, ms | 33.3 | 33.3 | +0.0% [-0.3%, +50.2%] |
| GPU | 4× | Input to upload p50, ms | 215.7 | 232.0 | -2.0% [-6.3%, +12.8%] |
| GPU | 4× | Input to upload p95, ms | 366.0 | 387.2 | -2.6% [-13.4%, +11.9%] |
| GPU | 4× | Input-phase tasks, ms | 2181.4 | 2254.1 | +3.0% [-16.7%, +14.3%] |
| GPU | 6× | RAF interval p95, ms | 49.9 | 50.0 | +0.2% [-0.2%, +49.7%] |
| GPU | 6× | Input to upload p50, ms | 257.2 | 261.3 | +1.6% [-3.0%, +14.3%] |
| GPU | 6× | Input to upload p95, ms | 452.9 | 455.7 | +2.6% [-1.2%, +9.9%] |
| GPU | 6× | Input-phase tasks, ms | 2593.9 | 2659.7 | +2.9% [-2.3%, +12.9%] |

CPU 4× frame p95 was essentially unchanged. Sub-millisecond differences do not establish a frame-time gain.

GPU continues the existing SVG path. These runs establish no GPU speedup. Slight regressions and full paired ranges are retained above.

Task time per elapsed input-phase second: CPU 4× -7.2% [-12.0%, +1.6%]; CPU 6× -1.5% [-4.7%, +1.1%]; GPU 4× +2.5% [-8.1%, +6.7%]; GPU 6× +2.8% [-4.5%, +5.7%].

Input p95 regressions: CPU 4×: 3/5 pairs worsened, largest increase +13.1%; CPU 6×: 0/5 pairs worsened; GPU 4×: 2/5 pairs worsened, largest increase +11.9%; GPU 6×: 4/5 pairs worsened, largest increase +9.9%.

Direct text improves typical latency but leaves fallback tails. In CPU 4×, reads 7–15 painted directly; reads 16/17 used clipped/full captures. The maximum latency in all five trials acknowledged read 17, whose full capture followed submission. P95 belonged to initial preparation/read 6 in trials 1/2 and read 17 in trials 3/4/5. The exact eligibility failure at read 16 was not recorded. These observations do not isolate upload cost.

| Storage | Slowdown | Direct paints | Value SVG decodes | Blank decodes at stop | Prepared painters at stop | Upstream captures | Receipts | Uploads |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CPU | 4× | 9.0 | 6.0 to 0.0 | 1.0 | 1.0 | 4.0 to 3.0 | 10.0 to 13.0 | 10.0 to 13.0 |
| CPU | 6× | 9.0 | 6.0 to 0.0 | 1.0 | 1.0 | 4.0 to 4.0 | 10.0 to 13.0 | 10.0 to 13.0 |
| GPU | 4× | 0.0 | 6.0 to 6.0 | 0.0 | 0.0 | 4.0 to 4.0 | 10.0 to 10.0 | 11.0 to 11.0 |
| GPU | 6× | 0.0 | 6.0 to 6.0 | 0.0 | 0.0 | 4.0 to 4.0 | 10.0 to 10.0 | 10.0 to 11.0 |

Direct paints and value SVG decodes count active input-phase events. Blank decodes and prepared painters are cumulative at phase stop, including earlier preparation. Raster-area counts include blank decoding during an active phase. Direct paints can increase receipts and complete uploads.

The blank bitmap and decoded blank SVG persist with the painter/template alongside the existing complete private canvas. Certification uses a temporary canvas. Memory use was not measured. Recorded-phase task totals exclude mount, setup and gaps; initialization outside those phases remains untimed.

CPU 6× task time increased in 1/5 pairs, by up to +9.9%, despite its lower paired median.

All 40 trials acknowledged each of 37 inputs and preserved the original input, value, focus and trusted submission. Candidate pixels matched fresh full snapDOM captures in 215 final RGBA comparisons and 2 intermediate comparisons. CPU direct preparation/disposal and GPU SVG fallback passed. Kerning fault: 491 changed pixels. Unknown viewport: 3 fallback comparisons.

Benchmark screenshots: CPU 20/20 byte-equal, 0 different, 0 unavailable; GPU 20/20 byte-equal, 0 different, 0 unavailable.

The font guard has positive behavior evidence. Missing-face visual sensitivity remains unverified because the font selector ignores input value attributes. The fresh capture oracle can omit the same face.

GPU certification was rejected after all ten diagnostic input-p95 pairs worsened. Median paired increases were 54.7% and 68.3%. The worker pilot increased task time 9.3% and was not integrated. Earlier cleanup stalls and background-only screenshot differences remain diagnostic.

Required checks passed: npm test, typecheck, lint and build. Vitest passed 1,438 tests in 125 files. React Doctor scored 85/100 with no issues across eight files.

Reproduce the matrix serially at the candidate source recorded in the JSON:

```sh
for storage in cpu gpu; do
  PERF_BASELINE_REF=597eae53e92d1bc83818155794f1c46eb2fbeb80 PERF_CAPTURE_STORAGE=$storage \
    PERF_CPU_RATES=4,6 PERF_ENGINES=snapdom PERF_TRIALS=5 PERF_ROUTE_TIMING=0 \
    PERF_OUTPUT=/tmp/munari-direct-text-recheck-$storage node instruments/performance/run.mjs
done
npm test
npm run typecheck
npm run lint
npm run build
```

Quality commands and negative-control expectations, per-trial acknowledgements, source hashes, initialization counters, all recorded-phase work and diagnostic limits are in [incremental-capture-results.json](incremental-capture-results.json).
