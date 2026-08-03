# instruments/ — measurement is maintained infrastructure

A capture recipe that lives as prose gets re-derived by whoever needs
it next, under pressure, usually wrong. Everything here is a module
held to the same review bar as the kernel: the probes that convict
bugs are code, committed, and runnable by anyone.

Shipped: the idle-zero gate (`idle-zero/`) — mounted quiescent
Surfaces must cost 0 paints/s, run in CI against a real browser.

The probes still owed, each earned by a class of bug that was
painful to find without it:

- The `gl.render`-wrapped `readPixels` strip probe. `readPixels` is
  only valid inside a wrapped render; sampling outside one manufactures
  results that indict innocent code.
- In-loop `drawImage` crops, for seeing what a texture actually holds
  at the moment it is used.
- The per-frame flight-trace recorder. Termination is *the trace
  stopping* — never a null poll, because the flight reference outlives
  the flight.
- Position-aware marker and dye probes: crispness checks are otherwise
  scale-blind, and will pass on a texture that is landing in the wrong
  place at the wrong size.
- The forced-uniform poke, for bisecting a dead effect into "the
  shader never ran" versus "the driver never sent anything".
- The perf harness (`?probe=N`), which is the idle-zero gate's driver.
- The browser-runner wrapper that bakes in the launch flags and
  `--session`, so a daemon relaunch can't silently drop them and hand
  back measurements from a browser without the capability.

House rule: a scene that can't be interrogated from the console isn't
done.
