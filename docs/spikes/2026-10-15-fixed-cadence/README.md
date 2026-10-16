# Fixed-cadence diagnostic, 2026-10-15

This archive reproduces a supplemental measurement. No runtime candidate from this investigation was accepted. The standard benchmark and runtime remain unchanged by this archive.

The original keyboard driver waits for each key command’s acknowledgement before delaying and sending the next key. This diagnostic tests whether that feedback changes the observed submit result. Its five paired 6× trials had valid setup, but command-to-upload results remained mixed. It does not resolve the canonical submit regression or establish a performance gain. The [report](../../svg-splitting-performance.md) and [retained evidence](../../svg-splitting-performance-results.json) keep it separate from the canonical results.

`runner.patch` applies to a disposable copy of the canonical runner. `keyboard.mjs` is the exact measured helper. The portable patch changes only imports, root resolution and provenance checks beyond the measured runner; its phase, trial, scheduling and assertion logic is preserved.

Pinned identities:

- Canonical `instruments/performance/run.mjs`: `5aba6978812486f0f93072781a05df9b5e3df3d5fa1459411729d5b2c787ea08`.
- Measured disposable runner: `ca7d0094b946b6924f97786476d49abf49faf29bc8dfb2764f70e62134f0a858`.
- Patched portable runner: `03116fb43d6fa2637fb295f1c1bad8a3be9dc39572422430ada99a075f5c8396`.
- Keyboard helper: `94492681355f36218295d77f2c0ff6068d66a99bc6e99c74db5dbd6b94fc93cb`.
- Observer: `d302ae2322fe5210c25327841cc50d439536cb6e94cf46fbfae10459cdaa5ce3`.

Use a clean, isolated checkout with the pinned diagnostics. Apply the [rejected combined runtime patch](../2026-10-15-capture-split-and-blank.patch) only in that checkout to replay the measured candidate. The diagnostic enforces its recorded adapter, background and InputSvg hashes before building. Install the recorded lockfile through the repository’s normal setup. The measurement used Node 24.22.0, Puppeteer 25.4.0 and Chrome 155.0.8059.80 on macOS. Other hosts produce new measurements, not the historical timing values.

Prepare a new runner directory without modifying the tracked runner:

```sh
cadence_repo="/absolute/path/to/isolated/munari"
cadence_archive="$cadence_repo/docs/spikes/2026-10-15-fixed-cadence"
cadence_copy=$(mktemp -d)
cp "$cadence_repo/instruments/performance/run.mjs" "$cadence_copy/run.mjs"
cp "$cadence_archive/keyboard.mjs" "$cadence_copy/keyboard.mjs"
git -C "$cadence_copy" apply "$cadence_archive/runner.patch"
node --check "$cadence_copy/run.mjs"
node --check "$cadence_copy/keyboard.mjs"
```

Choose a new evidence directory. Run five alternating pairs at 6× CPU slowdown with the same production scene, text and DPR. Preserve the command’s own exit status and full log. Set `CHROME_PATH` if Chrome is installed elsewhere.

```sh
cadence_output="$cadence_repo/.derived-data/fixed-cadence-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$cadence_repo/.derived-data"
test ! -e "$cadence_output" && \
env -u PERF_BASELINE_DIR -u PERF_SOURCE_REF -u PERF_MAX_FRAME_P95_MS \
  MUNARI_DIAGNOSTIC_ROOT="$cadence_repo" \
  PERF_BUILD_MODE=production \
  PERF_BASELINE_REF=a355cc5f2a2743beb213e4fdd3a05e3a4b23d4fd \
  PERF_CAPTURE_STORAGE=cpu PERF_ENGINES=snapdom PERF_CPU_RATES=6 \
  PERF_TRIALS=5 PERF_ROUTE_TIMING=0 PERF_PROFILE=0 \
  PERF_CAPTURE_STAGES=0 PERF_CAPTURE_DIAGNOSTICS=0 \
  PERF_GPU_DIAGNOSTICS=0 PERF_FLUSH_CPU_RASTER=0 \
  PERF_OUTPUT="$cadence_output" \
  node "$cadence_copy/run.mjs" > "$cadence_output.log" 2>&1
```

The schedule begins after the existing focus and End acknowledgements. Each of the 37 characters has a nominal 40 ms hold. At a shared deadline, the previous key goes up before the next goes down. At 1,480 ms, the final character goes up, then Enter goes down and up. All 76 public calls receive rejection handlers immediately. Their promises are awaited only after all commands have been issued, followed by the original submit-upload wait and 250 ms buffer.

Every command must finish its synchronous issue step within 10 ms of its deadline. Any late row invalidates the entire timing setup. Dispatch errors fail without retry. Keep every row, and do not relax the limit or retry selected pairs. Browser checks require the exact trusted key order, no repeat or modifier flags, 37 exact input prefixes, a collapsed caret, one submit, and the original node, focus, source/read, upload and pixel checks.

The existing phase-start browser call bounds the Node/browser clock offset by its round trip. Both scheduled and actual first-key and Enter offsets relative to focus remain visible. Listener time and the browser’s event timestamp are separate fields. Command-issue intervals are not physical-key timestamps or display latency.

This protocol changes capture coalescing. Never pool it with the original acknowledged-press workload or describe cross-protocol timing differences as runtime speedups. Metadata marks every result as diagnostic-only and records the materialized runner and helper hashes.

No private Puppeteer API is imported. The installed implementation was read to verify that public down/up calls update local key state and enqueue messages before their first await. The archived patch rejects a different keyboard implementation or mismatched provenance.
