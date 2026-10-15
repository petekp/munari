# Input capture pacing

Status: rejected. The runtime keeps the existing capture pace. Baseline: `a355cc5`.

Shorter capture gaps made typing acknowledgements faster but increased total work.
The runtime keeps its existing 150 ms gap. A retained 6× Controls profile showed
why the idea was worth testing: direct-text captures took 8.6–11.1 ms, followed
by 149.6–169.7 ms of waiting.

The comparisons used production Controls, CPU-backed capture canvases, and 6× CPU
slowdown. Each pair alternated the baseline and candidate. The unchanged workload
included trusted typing and submission. Latency ended at the texture upload
acknowledgement, not display presentation.

The zero-gap experiment failed the performance guardrails in all three paired
6× runs. Median typing acknowledgement fell 83%, but main-thread input work rose
55% and complete interaction took 27% longer. Captures rose from 12 to 59–60.

A 75 ms gap for all input-correlated captures also increased work. Across two paired
6× runs, typing acknowledgement fell 48% at the median and 21% at p95. Input work
rose 14%, and complete interaction took 3% longer. Both pairs had identical source
pixels and screenshots. This policy is not accepted.

A narrower policy advanced only the first value edit in a burst and eligible
submissions after they had waited through their input window. Both paired runs
still performed an extra region capture. Input work rose 8.3% and 9.4%; complete
interaction took 0.9% and 3.8% longer. The scheduler and its tests were restored to
the baseline. No pacing change was committed.

The full-capture reuse experiment was also rejected. See
[full capture input reuse](full-capture-input-reuse.md).

The [recorded results](input-capture-pacing-results.json) retain the paired values,
validation and source hashes. The earlier runtime policy variants are not retained
as executable patches. Their original local artifacts were:

- `/tmp/munari-pacing-controls-gap0-summary.json`
- `/tmp/munari-pacing-input75-analysis.json`
- `/tmp/munari-pacing-boundary75-summary.json`

These rejected candidates did not proceed to the final 4×/6× matrix.
