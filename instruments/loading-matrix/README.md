# loading-matrix

`npm run probe:loading-matrix` loads Bench, Knobs and Light cold and warm,
per browser and capture engine, on a lab build you serve on loopback. It
records stopped frames, time to a complete scene, layout shift, and blank or
bare frames, and `summarize.mjs` compares two runs. The cells and their
history are in [docs/loading/measurements.md](../../docs/loading/measurements.md) and [measurements-after-build.md](../../docs/loading/measurements-after-build.md).
It is a local probe, not a gate: headless Chrome paces frames without a
display, and one machine with three profiles per cell gives wide ranges.
To size a difference, run the two builds one profile at a time, alternating
(`PROFILES=1`, one scene per run), and read them with
`summarize.mjs --paired before.jsonl after.jsonl`, which gives each cell's
mean paired difference with its 95% interval.
