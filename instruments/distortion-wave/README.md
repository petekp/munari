# Distortion wave

Run the lab first, then run `node instruments/distortion-wave/run.mjs`.
`WAVE_URL` selects the lab server and `WAVE_OUTPUT` selects the evidence folder.
Pass `native`, `snapdom` or `disabled` to select one capture mode.
`WAVE_CASES=interrupt` selects one pixel case; omit it to run all cases. `WAVE_PIXELS=0`
disables pixels and `WAVE_TIMING=0` disables timing; use the default pixel pass before claiming the effect passed.
The interaction pass exercises all six examples, clipboard readback and denial,
keyboard activation, and undo focus. `WAVE_INTERACTIONS=0` skips that pass when
only pixels or timing are needed. This runner does not change CI membership.

The unit is an animation-frame callback interval or a main-thread long task in a fixed
895×774 CSS-pixel viewport at DPR 2. The selected cases cover idle, first click,
repeat click, pointer movement and a full-page theme change. Every observed
interval is retained. Quantiles and extrema describe those runs, with no claim
about all machines, browsers or windows. A before/after comparison must use the
same runner and conditions. Timing runs without screenshots or a CPU profiler.
The native state mutation is timed from the actual click event. This measures
click-to-native-DOM-commit, not click-to-first-visible-frame or end-to-end input latency.

A separate pixel pass uses Slow duration so screenshot transport can collect
two distinct mid-animation samples. It requires moving wave pixels on first
click, repeated click and theme change, followed by an exact native match at
rest. This confirms those actions can animate; it does not prove presentation
of every frame in the separate Quick-duration timing run. Its
hidden-overlay control must show no wave pixels. Pixels must differ from both
old and new content by more than 20 channel units; over 100 such pixels rejects
small focus and antialiasing changes. This is an effect-presence check, not proof
of every animation frame or precise visual parity with the reference CodePen.

The pixel pass also checks that waves stay within their target bounds,
allowing a one-CSS-pixel antialiasing fringe. the Like pill, file tile, invitation pass, collection,
checklist row, and player body are separate cases. Before, during, later and
native images are retained.

`node instruments/distortion-wave/cadence.mjs` records a native Like wave
separately from timing. It requires complete stamped page-frame coverage and
changing button pixels in each successive image between 300 and 1500 ms after
the native state commit. A hidden-output control must have no changing pixels.
It records pipeline creation before and during the first click. This observes
a short local Chrome interval; it does not establish cadence in Dia or on a
higher-refresh display. Raw button pixels and timestamps are saved for review.


`node instruments/distortion-wave/burst.mjs` checks additive feedback in native
and no-flag snapDOM modes. It compares one and two same-target pulses at the
same controlled animation time and unchanged native state. It also compares a
page-only theme wave against simultaneous page/Color waves in both click orders.
The Color region must retain an additional visible pulse.

A separate real-time sequence uses Normal duration and 12 clicks spaced at least
60 ms apart. Every Like toggle must commit in order. Captures now belong to each
transition; the runner observes source hosts and verifies their eventual cleanup.
Pending capture interruption, page overlap, and reduced motion are also exercised.
Callback gaps and click-to-DOM-commit times describe this local run, not presented
frame rate or end-to-end input latency.

`node instruments/distortion-wave/reveal.mjs` checks which state the wave reveals.
At a controlled animation clock it compares player-body pixels against native
references for successive finishes, and checklist pixels for independent rows.
The outgoing state must be the closest reference by mean squared RGB error. This permits texture
antialiasing without accepting the wrong finish or checkmarks.
The hidden-overlay control must expose a different state, and settled output must match native pixels. The cases
cover repeated and separate controls, both theme/button orders, and more actions
than the snapshot capacity. Full-viewport screenshots preserve the page geometry;
scoring selects the player or checklist region afterward. These checks do not measure cadence.

The `interrupt` image case requires both target regions to remain lit and moving.
Outgoing state masks draw in click order, oldest on top. Colored pulses draw above
those masks. Capture preparation is serialized; motion continues independently.
Snapshots release only after their entire target has been revealed. If all bounded
slots are occupied, later actions wait in order instead of discarding a visible
state mask. Scrolling, moving targets, reduced motion, and capture failure retain
the native outcome and retire the affected presentation.

`node instruments/distortion-wave/overlap.mjs native` records repeated Color
changes and checks the background under every observed wave. Pass `snapdom` for
the no-flag capture path, or set `MUNARI_BACKEND=webgl2` for the renderer fallback.
`WAVE_CLICKS` selects a bounded burst, defaulting to twelve clicks spaced at least
40 ms apart. Every requested color must commit in order. The sampled player
body provides a nonblack baseline in either theme. Every recorded target frame must have fewer than 1% pixels with all RGB channels below
5. Complete stamped page-frame coverage is required; missing frames cannot pass.
The worst frame and per-frame scores are retained. This catches opaque black
snapshot layers during overlap and slot reuse; the reveal and burst checks own
state ordering and effect presence. Recording cost excludes this run from timing
claims.
