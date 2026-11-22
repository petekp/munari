# genie-first-flight

Measures what Genie's first flights after a page load spend, and where.
`npm run probe:genie-first-flight`. It is a diagnostic with no pass
threshold. It fails only when a flight does not land, the page loads a
different capture engine or prewarm state than asked for, or a traced flight
has no CPU samples.

Each load flies four windows in order: two sheets, the film window, and a
restore. Per flight it records frame gaps against the gap before the press,
`pressToHandoffMs` (the wait from the press until the page copy hands
off), three's node, pipeline and texture time, every WebGPU and WebGL
compile call, and, in traced browsers, a Chrome trace split by owner.
`trace.gpu.syncCompile` counts blocking `createRenderPipeline` calls in
the GPU process, including ones a cache answers. After the flights, each
distinct pipeline is compiled again from unique source, so its own cold
compile time is known.

Before the first press, each load prints its `pageLoad`, counted from the
scene's mount: `prewarmBuildingMs` (how long `data-genie-prewarm` stays
`building`), every frame gap over 50 ms, and each blocking pipeline build
with its three label. three's mipmap pass is `mipmap-<format>-<view>`, such as
`mipmap-rgba8unorm-srgb-2d-array`.

The environment selects what runs:

- `ENGINES` (`html-in-canvas,snapdom`) and `SHADERS` (`cached,fresh`).
  `fresh` makes every shader unique to its load, as on a first visit.
- `PREWARM` (`on,off`). `on` loads the scene as it ships and waits for
  `Surface.Prewarm` to finish before the first press. `off` adds
  `prewarm=off`, so each presenter builds its pipelines at its flight, and
  the build time shows as `pressToHandoffMs`.
- `BROWSERS` (2) fresh profiles of `LOADS` (2) loads each. Even-numbered
  browsers are traced.
- `KEEP_TRACES=1` saves each flight's trace, `COMPILE_CHECK=1` adds a load
  that runs `compileCheck.mjs`, and `FIRST_FLIGHT_OUTPUT` names the output
  folder.

Limits: headless Chrome at 60 Hz, a 1280x860 viewport at DPR 2, the Vite
development build, and a lamp press rather than a titlebar drag. Compile
times belong to the machine's GPU and driver, and the adapter is recorded.
There is one film flight per load, so a first-film cost and an every-film
cost cannot be told apart.

It exists because the first Genie flight after load froze frames for
183-250 ms on blocking pipeline builds while the page's main thread never ran
a task over 43 ms (2026-11-21). Presenters now build their pipelines
asynchronously before their first draw (decisions.md #76).
