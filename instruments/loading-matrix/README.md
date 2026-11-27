# loading-matrix

`npm run probe:loading-matrix` loads Bench, Knobs and Light cold and warm,
per browser and capture engine, on a lab build you serve on loopback. It
records stopped frames, time to a complete scene, layout shift, and blank or
bare frames, and `summarize.mjs` compares two runs. The cells and their
history are in [docs/loading/measurements.md](../../docs/loading/measurements.md) and [measurements-after-build.md](../../docs/loading/measurements-after-build.md).
It is a local probe, not a gate: headless Chrome paces frames without a
display, and one machine with three profiles per cell gives wide ranges.
