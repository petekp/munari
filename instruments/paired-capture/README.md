# Paired state captures

Run `node instruments/paired-capture/run.mjs` against the lab's Vite dev
server on port 5188, or set `HANDOFF_URL`. Pass `native` or `snapdom` to
run one engine. This lab check pauses the outgoing screen draw and compares
painted pixels before the draw, over the committed DOM, and after the
overlay ends. It repeats with the update moved to the outgoing texture copy
and requires the same assertion to reject that early commit. Postcard uses a
scaled card, verifies the incoming stamp with the live card hidden, and
checks that typing releases the cover while focus stays on the same input.
The clock is frozen for pixel comparisons, so this does not measure latency.
