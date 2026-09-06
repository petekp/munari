# API and rendering checks

These probes exercise the current public API and real lab routes. They do not
change CI membership. Run browser/GPU checks serially.

## Postcard

```sh
npm run probe:postcard
```

The command starts its own local servers and Chrome instances, then closes
them. Set `CHROME_PATH` for a Chrome installation outside the default macOS
location. HTML-in-canvas capability is required; an unavailable path fails
rather than reporting a successful skip. `API_PROOF_OUTPUT` selects the
evidence directory; the default is `munari-api/evidence` under the system temp
directory.

The four checks are separate so their observers do not interfere:

- **Timing:** six lift/return cycles using browser-driven pointer clicks,
  without screencast recording. Fail if an animation-frame timestamp gap
  exceeds two observed frame periods plus 2 ms within one second of a handoff.
  Elapsed callback gaps are also reported. They include where the observer ran
  within a frame and are not treated as compositor-frame timestamps.
- **Companion pixels:** hold the light still and record every available
  composited PNG through six cycles. Programmatic button clicks preserve that
  light position. Compare strips outside the card at each observed handoff;
  fail above 0.5 mean absolute error on an 8-bit channel or a 0.5 single-frame
  spike. A positive-motion check prevents empty/background-only samples from
  passing. Recording-run timing is diagnostic because screencasting adds work.
- **Scrolling:** with reduced motion, compare a marker in the actual captured
  postcard against a native marker through fifteen browser wheel events.
  Fail above 1.5 CSS pixels of relative drift. `POSTCARD_CANVAS=fixed` on the
  standalone scroll script is a negative control; it reproduced 12 px drift.
- **Form interaction:** click and type through the scene at 1200 px and 390 px
  widths, add a stamp, return, and assert original-input identity, retained
  value, one stamp, and no horizontal overflow.

`postcard-continuity.mjs` is the maintained replacement for Claude's scratch
`probe.js` and `probe2.js`. The latter dispatched synthetic `PointerEvent`s;
the timing mode here uses browser input. `POSTCARD_TRACE=1` saves a local trace
and CPU profile for diagnosis. Profiling changes timing; use an unprofiled run
for the performance claim. `POSTCARD_CYCLES` changes the standalone cycle count.

`pixels.mjs` decodes PNGs after recording, using the browser's decoder. The
Python pixel scripts are independent cross-checks requiring Pillow and NumPy;
the npm command needs no Python packages. Pixel comparisons concern the named
strips and states, not every pixel in every animation. A screencast can omit
frames, so its timestamps do not prove a display refresh rate.

Decision [#41](../../docs/decisions.md#41) records these experimental budgets.

## Every demo

`npm run probe:api-lab` prints a lab URL. Set `API_LAB_URL` to that exact URL.
The Python drivers use `agent-browser` and accept `API_PROOF_SESSION` and
`API_PROOF_OUTPUT`:

```sh
python3 instruments/api-all-demos/smoke.py
python3 instruments/api-all-demos/gestures.py
python3 instruments/api-all-demos/native.py
```

`smoke.py` loads all 24 routes and seven Candidate studies, checks capability
and page errors, and saves screenshots. It is a load check. `gestures.py`
exercises Gravity, Explode, Selection, all seven Candidates, and Home. The
maintained scene gates cover the other custom rendering/input paths;
[the demo map](../../ALL-DEMO-API.md) names the evidence per route.

Use a separate browser without the capture feature for `native.py`; do not
infer native fallback from a successful enhanced run. `gestures.py` restarts
its own browser between routes to avoid accumulating GPU contexts.

## Composition, identity, and capture

```sh
npm run probe:api-targets
npm run probe:api-composition
```

The first command independently checks six cross-parent moves with a focused
input and child-local state, missing-target hiding, and one unmount. The second
prints the composition server URL. Use it as `API_COMPOSITION_URL` for:

- `api-composition/check.py`: coordinated parts, original-instance counts,
  both-direction landing, cancellation, and capture attach/resize/replacement.
- `api-composition/sampled-check.py`: a missing second source must block;
  the completed draw must contain the expected red and blue pixels.
- `api-composition/frame-check.py`: a later pose writer defeats an independent
  frame follower; the post-pose callback must match before the companion draws.
- `api-composition/whole-page-check.py`: `html`/`body` pixels above and below
  the viewport, original controls, and idle capture revisions.
- `api-composition/native-check.py`: requested handoff and element capture
  with actual capability absent.

The earlier one-instance and raw-capture fixtures remain available through
`probe:api-instance` and `probe:api-capture`. Their drivers in `api-contracts`
accept the printed URLs through `API_PROOF_URL` and `API_CAPTURE_URL`.


## API hardening

All commands below use Google Chrome. Set `HEADED=1` for visible windows. The
enhanced fixtures require actual capability and close their own servers/browsers.
No command changes CI membership. `API_PROOF_OUTPUT` selects evidence output.
Visible checks preserve the display's native pixel density. `TEST_DPR` explicitly
emulates another density; use headless Chrome for those comparisons so an emulated
low-resolution window is not mistaken for the product's default rendering.

- `npm run probe:api-instance-check`: real clicks, four-corner alignment, state,
  resize and scroll across six canvas/camera cases. Add `LAYOUT_MOVE=1` to verify
  a sibling-only move after 300 ms without a renderer draw.
- `npm run probe:api-lifecycle`: Strict Mode, delayed host, context loss/recovery,
  host removal/remount, renderer creation failure, and a separate no-flag profile.
- `npm run probe:api-native-pointer`: two different scene poses share one retained
  HTML source; checks clicked targets and source coordinates, native restoration,
  source swap, disabled/inert input, and ref-replaced geometry. `API_SOURCE_ROOT`
  allows the same fixture to test a saved source revision for a negative control.
- `npm run probe:api-render-passes`: two cameras/two targets, a late pose writer,
  an earlier-drawn companion, teardown and active matrix cost. Add `MATRIX_NODES=256`
  for the larger scene. Budget: p95 <=1 ms and max <=4 ms per matrix traversal.
- `npm run probe:api-preparation`: start `probe:api-lab` first and set `API_PROOF_URL`.
  The Controls input retains its focus/selection pixels throughout sampled delayed
  preparation. The compositor crop budget is mean channel error <=0.5. Native and
  captured pixels use the same display density; this is pixel evidence, not an unrecorded timing
  measurement or a claim that screencast delivers every display refresh.
- `npm run probe:api-capture-cost`: instrument the actual served copy functions in
  Controls, Selection, html and body. The package gets no profiling globals. Pin
  p95 <=5 ms, max <=8 ms, <=26 copies for 24 event bursts, no idle copies and no
  per-paint consumer React renders. Those are the named fixture workloads only.

The retained-content preparation bitmap preserves native caret, selection, focus,
hover and text that an inert DOM clone cannot paint. The clone reserves layout;
page preparation and scene input share one rig owner and do not race over styles.

## Default text clarity

`npm run probe:sharpness` compares original HTML with its stationary Surface mesh
in headed Chrome at native display density. It saves both images, the raw capture,
actual capture/canvas densities, pixel difference, and text edge energy. The gate
requires 0.95–1.05 of native edge energy over the same content and crop. Set
`QUALITY_LAYOUT=inset` or `QUALITY_LAYOUT=scaled` for offset and non-uniformly scaled
canvas containers, and `QUALITY_CAMERA=orthographic` for the second camera model.
`TEST_DPR=2.5` or `TEST_DPR=3` runs explicit density coverage in headless Chrome.
`QUALITY_NEGATIVE=1` disables raster alignment in the served source and requires
the fractional-origin fixture to lose contrast; it checks the measuring apparatus.

`npm run probe:postcard-sharpness` compares the real Home postcard at rest, then
hides the mesh to prove native HTML is not concealing a failed draw. Run
`probe:postcard` separately to check motion, companion pixels, scrolling, and input.
These stationary comparisons do not measure perspective filtering during motion
or every shader. Decision [#44](../../docs/decisions.md#44) records the default
density and pixel-grid policy and its measured limits.

`npm run probe:scene-sharpness` compares a `SceneSurface` label with the same native
HTML at its displayed size. `npm run probe:display-density` uses the running
`probe:api-capture` fixture (`API_CAPTURE_URL`) to emulate DPR from 2 to 3 to 1,
asserting backing dimensions and original capture/content identity throughout.
The viewport also changes by one or two CSS pixels: Chrome 151's CDP override
changes resolution-query matches without sending their change event. This checks
the resize notification path; it does not claim a physical multi-monitor test.
