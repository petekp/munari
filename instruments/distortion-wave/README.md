# Distortion wave

Run the lab first, then run `node instruments/distortion-wave/run.mjs`.
`WAVE_URL` selects the lab server and `WAVE_OUTPUT` selects the evidence folder.
Pass `native`, `snapdom` or `disabled` to select one capture mode. `WAVE_PIXELS=0`
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
