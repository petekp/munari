# instruments/ — measurement is maintained infrastructure

The archive's hardest-won lesson about tooling: not one capture recipe
that convicted a bug there was ever committed as code — strip probes,
flight traces, uniform pokes all lived as prose and discarded stdin
scripts (three-ui/docs/seed/instruments.md). Here they are modules with
the same review bar as the kernel.

To port, per the seed inventory: the gl.render-wrapped readPixels strip
probe (readPixels is only valid inside a wrapped render), in-loop
drawImage crops, the per-frame flight-trace recorder (termination =
the trace stopping, never a null poll), position-aware marker/dye
probes (crispness checks are scale-blind), the forced-uniform poke
bisect, the perf harness (`?probe=N` — the idle-zero CI gate's
driver), and the browser-runner wrapper that bakes in the launch flags
and `--session` so a daemon relaunch can't silently drop them.

House rule carried over: a scene that can't be interrogated from the
console isn't done.
