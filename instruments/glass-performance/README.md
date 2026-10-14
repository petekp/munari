# Glass rendering diagnosis

This runs the real Glass demo with both retained HTML captures. It records
world, card, pill and final-screen passes through Three's exported inspector
and timestamp APIs. Every measured frame must have complete GPU timestamps
and distinct render identifiers. Missing capability or samples fail the run.

```sh
GLASS_OUTPUT=/tmp/munari-glass-performance GLASS_DPRS=1,2 \
  GLASS_CPU_RATES=1,4,6 GLASS_DURATION_MS=3000 \
  node instruments/glass-performance/run.mjs
```

GPU durations cover render passes. They exclude upload copies, earlier queue
work, presentation and idle time. CPU compositor timing excludes other frame
callbacks; Chrome task duration covers the measured page interval. CPU
slowdown leaves GPU execution unchanged. Results include browser, host, source
revision, instrument hash/copy, target sizes, sample counts and raw timestamps.

Three trials alternate mode order. Use these counterfactuals only for diagnosis:

```sh
GLASS_OUTPUT=/tmp/munari-glass-antialias GLASS_DPRS=2 GLASS_CPU_RATES=1 \
  GLASS_MODES=baseline,final-aa-off GLASS_TRIALS=3 \
  GLASS_DURATION_MS=3000 GLASS_SNAPSHOTS=1 \
  node instruments/glass-performance/run.mjs
```

`final-aa-off` disables only final-target MSAA. The world target must still use
four samples; the final target must report four or zero as requested. MSAA is
multisample antialiasing. The production scene settings remain unchanged.

Use `GLASS_MODES=baseline,card-only` for an omitted-pill control. It must render
three passes while keeping both HTML captures present. Its fixed-frame pixels
must differ from the complete scene. This is a deliberate visual fault, not a
proposed optimization.

With `GLASS_SNAPSHOTS=1`, pixel comparisons run after timing. Camera, panel
transforms, effect parameters and time are copied into a fixed configuration
and replayed across cases. Repeated frames must match exactly before a
cross-mode result is reported. This proves only the sampled fixed state;
it does not replace animation, input or cross-browser acceptance.

`GLASS_TRIALS` defaults to one, `GLASS_DURATION_MS` to 6000, densities to `1,2`
and CPU rates to `1`. `GLASS_OUTPUT` defaults to a directory in the system
temporary folder. `CHROME_PATH` selects Chrome; `HEADED=1` shows its window.
Run all GPU probes serially.
