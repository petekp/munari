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
and snapDOM modes. It compares one and two same-target pulses at the same
controlled animation time and unchanged native state. A separate real-time
12-click sequence checks every update, observes parked source hosts across the
whole burst, and verifies cleanup. The initial source must be observed; no
later gesture may create one. Development-mode remounts can create more than
one host for the first gesture. Page overlap, pending capture interruption and
reduced motion are also exercised. Recorded callback gaps are diagnostic;
they do not establish presented frame rate.

The `interrupt` image case now requires both target regions to remain lit and
moving. Isolated transitions still refract the outgoing snapshot. Overlapping
pulses use light only, so no old snapshot can cover a more recent native state.
