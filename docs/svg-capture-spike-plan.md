# Capture spike investigation plan

Status: evaluation complete. Both clone-removal candidates and both timing
variants were rejected. Runtime source is restored exactly to `63bd91e`.
Only profiling tools, reproducible experiment archives and evidence are retained.
The larger SVG frame stalls remain unresolved.

The investigation preserved visual quality, native input behavior, resolution
and the standard keyboard workload. It used supported APIs and kept each
implementation, diagnostic and benchmark batch separate.

Completed work:

- Added timestamped frame windows and source/read-tagged capture stages to
  identify the work inside long frame intervals.
- Measured the background clone and blank-input clone, then tested both the
  combined candidate and blank-input-only candidate in production at 4×/6×.
- Completed five alternating pairs per CPU/GPU storage condition for each final
  candidate. The interrupted host-contention attempt remains ineligible.
- Used a separate fixed-cadence keyboard diagnostic to test timing feedback.
  Its mixed result did not clear the standard benchmark's regression.
- Verified exact pixels, trusted input, refresh, disposal, failure recovery and
  native behavior. Deliberate faults confirmed the relevant checks detect errors.
- Restored all 144 package source files and validated that the rejected patches
  reproduce the saved candidate bytes. Final repository checks passed.

The combined candidate retained a 6× submission penalty. The isolated candidate
worsened 4× input p95 and completion in all five pairs and 6× submission in four.
A local preparation saving did not establish an acceptable product improvement.
No capture-pacing change was introduced to compensate.

See the [report](svg-splitting-performance.md), [evidence](svg-splitting-performance-results.json),
[rejected runtime patches](spikes/2026-10-15-capture-variant-patches.json), and
[fixed-cadence archive](spikes/2026-10-15-fixed-cadence/README.md).
