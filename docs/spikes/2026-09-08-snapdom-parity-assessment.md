# snapDOM parity assessment

Updated September 9, 2026 after an independent Fable 5.1 max review and one
bounded follow-up spike.

**Decision:** take the queued request's not-on-par branch. The first
implementation reproduced Knobs' tested functionality, but not its
responsiveness. The retry corrected the appearance problem and improved
update performance, but still did not reach parity. I did not create an
architecture proposal that assumes otherwise.

**Later fixture correction, September 9:** the isolated fixtures used above
omitted the lab's global font stylesheet. Scene-local DSEG still loaded, but
other text could use fallback fonts. The
[direct-CSS follow-up](2026-09-09-direct-css-capture.md) restores that stylesheet
and provides new matched native, direct-CSS, and snapDOM 3 beta measurements.
Do not compare absolute timings across these different fixtures.

[Original spike](2026-09-08-snapdom-knobs.md) ·
[Fable's full review](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/fable-review.md) ·
[Assessment sent for review](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/assessment-before-review.md) ·
[Diagnostic measurements](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/diagnostic-summary.json) ·
[Paired regional runs](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/regional.json)

## Why the first result was not on par

The first port preserved the Knobs scene and all 55 meshes. Dials, switches,
carrying, resizing, and original-control identity passed in Chrome, Firefox,
and an automated WebKit engine. The absence of both experimental capture
methods was verified. Basic functionality was therefore not the problem.

Frequent whole-panel snapshots were the problem. The first Chrome run
measured 64.3 ms median completed capture time and 58.3 ms p95 animation-frame
interval during controls, versus 9.2 ms p95 intervals in the native run.
Its small DPR-2 pixel-and-draw check measured median key-to-update latency of
96.3 ms for snapDOM versus 41.0 ms for HTML-in-canvas.

Those results describe the tested adapter. They do not establish an
irreducible snapDOM limit. The initial preparation timer included the entire
awaited SVG-preparation phase, without identifying its functions. Its
alternating-value tests could reuse decoded images. Its visual comparison
used the native capture backend rather than independently rendered DOM.
Those were material gaps in the original explanation.

## What Claude found, and what I accepted

One read-only request was sent to `claude-fable-5-1` at max effort. It
recommended one further bounded attempt rather than declaring parity
impossible.

The useful findings were:

- Test fresh values, because repeated SVGs can make rasterization look
  cheaper than it is for new content.
- Profile the preparation phase rather than infer a fixed wait or an
  immutable cost from its duration.
- Investigate snapDOM's document-wide style-cache invalidation. A change
  anywhere in the document can invalidate snapshots for unchanged nodes.
- Compare full-panel, row, and readout capture before committing to a
  regional compositor.
- Validate composed pixels, layout fallback, and draw timing independently.
  Smaller offscreen captures do not alone prove an interactive improvement.

I did not accept all of the review's wording. Correlated p95 timings alone
do not prove a function-level CPU cause. Not all original results used
alternating values. Custom properties are already filtered by the reviewed
source, so excluding them again was not a meaningful new experiment. A
published generation does not independently prove current pixels. The
review's numerical tolerances and three-day budget were proposals, not
authority to change contracts or start a broad implementation.

**Judgment:** the findings justified another attempt. I bounded it to a
diagnostic plus one generic clipped-region implementation; no production
rearchitecture or upstream-library changes.

## The retry identified the actual costs

The real Knobs scene ran while captures targeted its existing DOM.
snapDOM remained pinned to 2.24.16. The test used explicit `fast: true`,
font embedding, and the soft cache. It captured five fresh, monotonic values
per size/density case, rather than alternating two images.

| Captured scope | Source elements | Median capture at density 1 | Median capture at density 2 |
|---|---:|---:|---:|
| Full panel | 182 | 67.9 ms | 66.1 ms |
| One dial row | 28 | 15.7 ms | 16.7 ms |
| One readout | 3 | 4.5 ms | 5.7 ms |

The full-panel clone/style phase took about 50 ms; font/asset work about
3 ms; fresh rasterization about 11–12 ms. A readout's clone phase was
1.5–1.6 ms. No requestIdleCallback calls occurred during these captures.

A CPU profile found hot computed-style extraction, getPropertyValue calls,
and style-signature construction. The bundled functions were checked against
their implementation. The profile also contains the test's own pixel
readback and hashing work, which must not be attributed to snapDOM. The
reported phase timers stop before that measurement work.
[Profile attribution](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/profile-attribution.json)

These results support a per-node preparation cost, not a mandatory 50 ms
wait or a large fixed font cost. They also show why the standalone readout
result is promising without proving whole-scene parity.

## Background animation defeats broad style-cache reuse

With the panel unchanged but the SVG artwork still updating, median clone
time was 52.1 ms. When artwork mutations were paused for diagnosis, the first
capture was still cold; subsequent clone times fell to 10.2–10.9 ms.
Median completed capture over the paused-art set was 18.4 ms.

The published source watches document-wide DOM mutations and uses one style
epoch. Knobs writes SVG attributes during animation, including when its
visual values have not changed. This is a concrete coupling between an
uncaptured animation and capture cost.

Pausing the artwork is not an accepted optimization: it changes the demo.
Panel mutations would still invalidate styles themselves. Scoped
invalidation is a possible future approach, but was not implemented or
proven safe for ancestor styles, container queries, or selectors.

## The appearance problem was largely an adapter error

The first adapter scaled the complete SVG image into the source's logical
box. snapDOM's metadata distinguished a 320×721 content box from a 322×723
viewBox with a one-pixel content offset. Scaling the padded viewBox subtly
shrunk and shifted the content.

The corrected path crops the logical content using the supplied metadata.
Both exports were tested from the **same** capture against the **same**
native DOM screenshot, with an opaque white reference background:

| Export mapping | RGB mean absolute error, 8-bit channels |
|---|---|
| Scale padded SVG into content dimensions | 5.70 / 5.36 / 4.90 |
| Crop the logical content box | 0.063 / 0.059 / 0.054 |

This largely explains the earlier shading/position differences. It is not
evidence that snapDOM fundamentally cannot reproduce the panel's appearance.
It establishes close agreement for this state in Chrome, not universal
pixel fidelity for all CSS or browsers.

[Mapping comparison](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/mapping-comparison.json) ·
[Native DOM](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/mapping-native.png) ·
[Corrected capture](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/mapping-cropped.png)

## A regional implementation improved updates, but still missed parity

The retry used snapDOM's public clip option on the original capture root.
Mutations inside existing named anchors selected a conservative union,
expanded by 32 CSS pixels. Unknown mutations, changed layout/anchor boxes,
density changes, or resize requests fell back to full capture. It cleared
and replaced only the corresponding canvas pixels. It did not redraw digits,
change the demo CSS, pause the artwork during accepted runs, or hard-code
Knobs class names into the region-selection algorithm.

Three alternating native/regional pairs ran 30 distinct hue values at
100 ms spacing, with the same 1200×820 viewport and DPR 1. The scene retained
all 55 meshes. All 30 requested values obtained matching draw records in
each accepted run; the final value was 300.

| Backend | Median event-to-matching-draw latency | p95 rAF interval |
|---|---:|---:|
| Native, three runs | 10.4–11.2 ms | 9.5–9.7 ms |
| Clipped regions, three runs | 47.7–51.9 ms | 33.3–34.3 ms |
| Corrected whole-panel capture, one run | 74.5 ms | 58.3 ms |

This protocol uses draw-generation/value observation and separate settled
pixel checks. It does not perform synchronous pixel readback on every
observed frame or measure display scanout. Its DPR and observer differ from
the original 96/41 ms comparison; absolute numbers from the two protocols
should not be mixed.

An initial event observer read the previous value before React's handler ran.
That run was rejected and retained separately as
`regional-observer-error.json`. The accepted runs use the known monotonic
request sequence and include raw event and draw records.

After each run, the composed image was compared with a fresh full capture
of the same DOM state. Mean channel errors were below 0.004/255; the worst
8×8 block channel mean was 0.25/255. This passed the proposed settled-pixel
check. Programmatic resizing changed the panel to 560×463 and correctly
selected full capture. No sources or canvases remained after unmount.
[Composited-pixel checks](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-diagnostic/regional-pixels.json)

The compositor's median captures still took about 42.5 ms. A clipped root
capture is not equivalent to capturing the three-node readout: it preserves
the original root/context and retains nearby nodes during culling. The
reviewed implementation includes a 200-pixel culling margin for bleed.
The conservative context-preserving approach bought correctness, but did
not reduce preparation enough. Resize still required the expensive full
path.

## Final assessment and stopping decision

The retry changed the diagnosis:

1. The appearance gap is largely fixed by correct image mapping.
2. Whole-panel preparation is costly, and background mutations defeat broad
   cache reuse.
3. Small captures are much cheaper, but the generic clipped-region
   implementation does not attain their cost.
4. Settled regional compositing can be accurate without obtaining native
   responsiveness or proving atomic alignment throughout resize.

The tested regional approach still exceeds one additional observed display
frame at the median and has substantially worse frame intervals. I stopped
the bounded attempt rather than declare it on par or start a redesign.

There is **no justified conclusion that snapDOM can never reach parity**.
Explicit small capture parts or safer scoped invalidation remain possible
directions. They would require additional authoring/implementation contracts
and new correctness tests, especially for overlapping effects, layout changes,
and asynchronous freshness. This work does not establish them.

Actual Safari, mobile devices, rich text/IME, media, page-to-scene handoff,
and a general dual-backend library remain unverified. The regional retry
focused on one control sweep and resize fallback; it did not repeat the
first spike's complete cross-engine interaction matrix.

No parity-assuming architecture proposal was produced. Production code,
dependencies, CI, and deployment tooling remain unchanged. The diagnostic server was stopped and the entire second disposable
implementation, downloaded experiment dependencies, and runners were removed.
The reviewed assessment and measurement evidence remain.
