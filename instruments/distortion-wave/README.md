# Distortion wave

Run the lab first, then run `node instruments/distortion-wave/run.mjs`.
`WAVE_URL` selects the lab server and `WAVE_OUTPUT` selects the evidence folder.
Pass `native`, `snapdom` or `disabled` to select one capture mode.
`WAVE_CASES=interrupt` selects one pixel case; omit it to run all cases. `WAVE_PIXELS=0`
runs only timing and `WAVE_TIMING=0` runs only pixels; use the default pixel pass before claiming the effect passed.
This runner does not change CI membership.

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

The pixel pass also checks that button waves stay within their button bounds,
allowing a one-CSS-pixel antialiasing fringe. Like, Follow, Bookmark and filter
chips are separate cases. Before, during, later and native images are retained.

`node instruments/distortion-wave/cadence.mjs` records a native Follow wave
separately from timing. It requires complete stamped page-frame coverage and
changing button pixels in each successive image between 300 and 1500 ms after
the native state commit. A hidden-output control must have no changing pixels.
It records pipeline creation before and during the first click. This observes
a short local Chrome interval; it does not establish cadence in Dia or on a
higher-refresh display. Raw button pixels and timestamps are saved for review.


`node instruments/distortion-wave/burst.mjs` checks additive feedback in native
and no-flag snapDOM modes. It compares one and two same-target pulses at the
same controlled animation time and unchanged native state. It also compares a
page-only theme wave against simultaneous page/button waves in both click orders.
The button region must retain an additional visible pulse.

A separate real-time sequence uses Normal duration and 12 clicks spaced at least
60 ms apart. Every vote value must commit in order. Captures now belong to each
transition; the runner observes source hosts and verifies their eventual cleanup.
Pending capture interruption, page overlap, and reduced motion are also exercised.
Callback gaps and click-to-DOM-commit times describe this local run, not presented
frame rate or end-to-end input latency.

`node instruments/distortion-wave/reveal.mjs` checks which state the wave reveals.
At a controlled animation clock it compares vote-label pixels against native
references for the outgoing, intermediate, and latest values. The outgoing value
must be the closest reference by mean squared RGB error. This permits texture
antialiasing without accepting the wrong numeral. The hidden-overlay control must
expose a different state, and settled output must match native pixels. The cases
cover repeated and separate controls, both theme/button orders, and more actions
than the snapshot capacity. Full-viewport screenshots preserve the page geometry;
scoring selects the label region afterward. These checks do not measure cadence.

The `interrupt` image case requires both target regions to remain lit and moving.
Outgoing state masks draw in click order, oldest on top. Colored pulses draw above
those masks. Capture preparation is serialized; motion continues independently.
Snapshots release only after their entire target has been revealed. If all bounded
slots are occupied, later actions wait in order instead of discarding a visible
state mask. Scrolling, moving targets, reduced motion, and capture failure retain
the native outcome and retire the affected presentation.
