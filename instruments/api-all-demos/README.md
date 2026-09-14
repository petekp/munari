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
  The holder starts at 240px so neither marker clips during the 180px scroll.
  Lighting overlays are hidden so their tint and halo cannot alter test colors;
  this check measures the postcard canvas's anchoring, not its illumination.
- **Form interaction:** click and type through the scene at 1200 px and 390 px
  widths, add a stamp, return, and assert original-input identity, retained
  value, one stamp, and no horizontal overflow.

`postcard-continuity.mjs` uses browser input in timing mode.
`POSTCARD_TRACE=1` saves a local trace
and CPU profile for diagnosis. Profiling changes timing; use an unprofiled run
for the performance claim. `POSTCARD_CYCLES` changes the standalone cycle count.

`pixels.mjs` decodes PNGs after recording, using the browser's decoder. Pixel comparisons concern the named
strips and states, not every pixel in every animation. A screencast can omit
frames, so its timestamps do not prove a display refresh rate.

Some local aggregate runs have written their measurements and then failed during
screencast acknowledgement or Chrome teardown. A nonzero exit remains a failed
run. Inspect the individual result files to distinguish an observer shutdown
failure from a failed motion or pixel assertion, then rerun the affected command.

Decision [#41](../../docs/decisions.md#41) records these experimental budgets.

## Routes and gestures

`npm run probe:api-routes` loads every current lab route and Candidate study.
It requires the selected route's identity and content, actual capture support,
and no browser errors. This is a load check, not a pixel-quality verdict.
`API_CASES=logo ROUTE_FORCE_HOME=1` must fail the route check.

`npm run probe:api-gestures` checks Gravity, Explode, Selection, Candidates,
and the independent Home starter. It preserves the unique interaction cases
from the earlier drivers. Native Candidate, Selection, and Gravity outcomes
run without capture capability. The postcard's input and visual contracts
remain in `probe:postcard`.

## Composition, controls, and capture

- `npm run probe:api-targets`: native cross-parent focus, input identity,
  local state, missing targets, and unmount.
- `npm run probe:api-composition-check`: grouped parts, different content,
  cancellation, capture attach/resize/replacement, sampled-source pixels,
  and whole-document/native capture. `API_CASES=sampled-parts
  API_INVERT_SAMPLES=1` must reject the deliberately wrong pixel reading.
- `npm run probe:api-contracts`: Controls motion and delayed-preparation
  focus, native Controls, and shared-capture lifecycle.

These runners start and close their own servers and Chrome instances. `API_CASES`
selects documented case IDs; unknown or empty selections fail. Output records
list the selected and completed cases. `API_PROOF_OUTPUT` chooses the evidence
directory. `API_LAB_URL`, `API_COMPOSITION_URL`, or `API_CAPTURE_URL` can
explicitly select an existing server; record its source revision when doing so.

The interactive servers remain available: `probe:api-composition`,
`probe:api-instance`, and `probe:api-capture`. The instance server's `/`
is a browser-platform experiment; `/surface.html` uses the public Surface API.
Automated checks use the latter. `probe:api-lab` serves the real lab for the
standalone preparation and postcard-sharpness checks.

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
  allows a saved revision with the same public API to serve as a negative
  control. To reproduce an older prototype API, use its matching instrument
  from Git rather than adapting old names into this fixture.
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
Start `probe:api-lab` and set `API_PROOF_URL` to its printed URL first.
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

## PR #83 follow-up regressions

`npm run probe:api-regressions` runs 16 capability-enabled cases and four cases in
a separate no-flag Chrome profile. It checks keyed prepend/reorder/removal with
one mounted counter per item, surviving capture-reader updates in a demand canvas,
continuous resize anchors, focus across a handle swap and return, and ordinary
versus inline-handler attributes. Source and DOM identities are part of the checks.

Preparation comparisons cover rectangular, nested, rounded, bordered, transformed
and changing overflow clips, plus explicit clip margins. The native and preparing
screenshots use the same source bounding box and viewport. Box placement follows
the documented device-pixel alignment; displacement controls must be rejected.
Clipping pixels must agree away from native raster edges and excluded form
controls, and a rectangular-clip control must expose missing rounded corners.
Whole-image mean is diagnostic. Visible input must work,
clipped input must not fire, and the preparation clip must be removed at scene
handoff. The resize sweep stays inside the backing-store band and allows at most
1 CSS px of anchor difference from the latest paint while moving, then requires
exact agreement after settling. Decision [#45](../../docs/decisions.md#45) records
the failing measurements and these bounds.

Set `HEADED=1` for visible Chrome at native DPR, `API_CASES` for a comma-separated
subset, and `API_SOURCE_ROOT` for a saved source revision. The runner writes its
observations and screenshots under `API_PROOF_OUTPUT`. These are minimal API
regressions; the maintained Flight, Knobs and postcard gates still verify the
actual demos.
