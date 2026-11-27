# idle-render

Local probe, not a CI gate. It measures what a `SurfaceCanvas` costs while
nothing on the page changes, and finds lab scenes that stop updating when the
canvas's idle frame loop is `"demand"` instead of `"always"`.
`docs/idle-render.md` reports its results. `run.mjs` is the entry point; each mode lives in its own module beside it.

```bash
OUT=.scratch/out/cost MODE=cost ROUNDS=3 PROFILE=1 node instruments/idle-render/run.mjs
OUT=.scratch/out/activity MODE=activity node instruments/idle-render/run.mjs
OUT=.scratch/out/fixture MODE=fixture node instruments/idle-render/run.mjs
```

- A Vite transform patches `SurfaceCanvas.tsx` in the served copy only. It
  chooses each canvas's frame loop from `__idleRenderMode`: `authored`,
  `default-demand` (only canvases that leave `frameloop` unset),
  `all-demand` or `all-always`. It also turns on three's timestamp queries
  for every `SurfaceCanvas` renderer and for the Light scene's own renderers.
  The run fails if the transform matched nothing.
- `cost` measures a 5 s quiet window after an 8 s settle: frames per
  canvas (`getCurrentTexture` calls), GPU time (sum of pass durations), main
  thread time, and CPU time per Chrome process. `PAGES`, `MODES` and
  `ROUNDS` narrow it. Passes can overlap on Apple GPUs, so GPU time is an
  upper bound on busy time.
- `activity` runs each lab scene with `?bare` in four modes, sweeps the
  pointer and clicks the centre, and compares the settled screenshots with
  `all-always`. A second `all-always` run gives the noise floor. It does not
  drag, type, scroll or focus, and pixel differences mean nothing on scenes
  that animate continuously.
- `fixture` mounts 12 Surfaces and an author's `useFrame` animation
  (`fixture/`) under the default and `"demand"`. It records idle frames, the
  frames an external `invalidate()` draws, a resize, and a renderer loss
  forced with CDP `Browser.crashGpuProcess`.
- It uses the same launch flags as `idle-zero`, plus
  `--enable-webgpu-developer-features` for unquantized timestamps.
