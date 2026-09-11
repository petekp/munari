# Spike: capture Knobs using its original CSS

Measured September 9, 2026. Munari source: `cd87c95261853a802b955618031a5eb4e2a0b13b`.

**Verdict: viable with caveats.** Reusing authored CSS substantially reduced
whole-panel capture cost and preserved the tested Knobs interactions in three
browser engines. It did not establish native performance or general HTML parity.

This answers the simpler alternative raised after the
[snapDOM assessment](2026-09-08-snapdom-parity-assessment.md). No production
backend or public API was changed.

[Rendered demo](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/css-capture/chrome-css-initial.png) ·
[Resized demo](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/css-capture/chrome-css-resized.png) ·
[Timing evidence](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/css-capture/benchmark-summary.json) ·
[Pixel comparisons](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/css-capture/pixel-comparisons.json)

## Questions and scope

1. Can the browser render the original HTML and CSS into an SVG image without
   reconstructing every element's computed styles?
2. Does that preserve the complete Knobs demo, including responsive layout,
   fonts, focus, controls, and 3D hardware?
3. Does it materially improve fresh capture and displayed-update latency?

The scope was one disposable adapter, the unchanged Knobs scene, and checks of
pixels, interaction, and timing. An unusable raster, broken controls, or a need
to rebuild a general computed-style engine would reject this route for the demo.

## What the experiment did

It read the document's original stylesheet rules once, embedded the fonts
used by the panel, and cached that CSS. Each capture cloned the live HTML,
added that stylesheet inside SVG `foreignObject`, decoded the image, and drew
it into a canvas consumed by the existing Munari texture pipeline.

It still needed a small amount of state handling: inherited properties and
custom properties from the root, current form values, focus attributes,
and computed values for targets with active CSS animations or transitions.
Existing Knobs hover/active twins remained in use. Media queries were evaluated
against the page; container queries remained in the SVG stylesheet. Initial
font discovery visited all 182 source elements; the hot path did not collect
their computed styles.

This was full-panel capture, with one capture in flight and pending work
coalesced. It used no readout-specific patches, effect replacements, or
HTML-in-canvas methods. Completed snapshots carried their captured dimensions
and generation; results with superseded dimensions were discarded. The real
DOM controls remained alive in a regular transparent host.

The copied Knobs folder was byte-identical to the checkout. Geometry,
materials, artwork, lights, physics, and input handlers were reused. A second
mode ran unmodified snapDOM `3.0.0-beta.0` with `engine: 'svg'`, default font
handling, no profiling hooks, and the corrected logical-content crop. A third
mode used Munari's original HTML-in-canvas source.

## What we learned

### The complete tested interaction survives

Chrome 151.0.7922.176, Firefox 151.0, and automated WebKit 26.5 each passed
17 checks: truthful capability detection; all 55 meshes; idle capture;
keyboard adjustment and focus for six dials; both switches; dial dragging;
panel carrying; physical resize from 320 × 721 to 560 × 463; retained control
identity; tuning controls; and cleanup. There were no page or capture errors.
The Chrome native and snapDOM beta modes passed the same checks.

These are headless desktop-engine results. They do not establish released
Safari/iOS support, audio quality, screen-reader behavior, or frame-atomic
alignment during every intermediate resize frame.

### Chrome and Firefox pixels are close; WebKit differs

The source host was temporarily made visible and screenshotted by its browser.
A same-state capture was composited over the same white background and compared
at matching pixel dimensions. This measures source raster fidelity separately
from the scene's lighting and materials.

| Direct CSS capture | Initial RGB mean absolute error, out of 255 | Resized error |
|---|---:|---:|
| Chrome | 0.059 | 0.018 |
| Firefox | 0.0012 | 0.0012 |
| WebKit | 2.978 | 2.966 |

Focused-control comparisons were similar. Chrome snapDOM beta matched the
direct CSS result. In WebKit, approximately 8% of pixels differed by more than
12 in at least one channel. Inspected images show differences in shadows and
dial highlights. The cause was not isolated sufficiently to call it an
unavoidable browser limitation; it remains a fidelity failure of this route.

### Removing style reconstruction makes a large difference in Chrome

Three serial runs per backend used 30 increasing hue values, 10 through 300,
with a 100 ms pause between real keyboard presses. Every value reached a
generation-attributed default-framebuffer draw. All modes used the real fonts,
the same 1200 × 820 viewport, and DPR 1.

| Chrome backend | Median whole capture across runs | Median key-to-draw across runs | Key-to-draw p95 across runs |
|---|---:|---:|---:|
| Native HTML-in-canvas | Not separately timed | 13.3–13.5 ms | 17.0–17.7 ms |
| Original CSS → SVG | 17.3–17.5 ms | 27.0–27.2 ms | 30.5–30.9 ms |
| snapDOM 3 beta → SVG | 46.4–48.6 ms | 59.7–61.0 ms | 65.1–75.0 ms |

Direct CSS preparation took 4.0–4.3 ms and decode/raster took 13.2–13.3 ms.
Beta preparation took 30.4–32.0 ms and raster export 16.1–16.5 ms. The phase
boundaries follow each API and are not identical function-level profiles.
The end-to-end capture totals are the stronger comparison.

At DPR 2, the direct source actually increased to 640 × 1442 pixels. One
matched run measured median key-to-draw times of 13.3 ms native, 27.1 ms direct
CSS, and 59.8 ms beta. This is a desktop result, not a claim that density is
free on other devices.

Other engines remained slower. One direct-CSS run per engine, using the same
30 values at DPR 1, measured:

| Engine | Median capture | Median preparation | Median decode/raster | Median key-to-draw | p95 key-to-draw |
|---|---:|---:|---:|---:|---:|
| Firefox | 43 ms | 3 ms | 39 ms | 55 ms | 69 ms |
| WebKit | 26 ms | 3 ms | 23 ms | 77 ms | 99 ms |

All 30 values reached a draw. WebKit's gap between capture and drawing also
shows why capture duration alone cannot describe responsiveness.

Latency starts at keyboard-event delivery and ends at a draw callback for the
captured generation. CSS and beta values came from their serialized artifacts;
native values were stamped at paint receipt. Pixel reads and screenshots were
outside the timed interval. This is not physical input-to-photon measurement,
and it does not independently prove every transient framebuffer pixel.

A separate Chrome burst scheduled 30 CDP keyboard events independently at
16 ms intervals. Actual mean delivery spacing was 16.0–16.7 ms across the
three modes. This exposed the difference hidden by slower input:

| Backend | Distinct input values observed at a draw | Median latency for those values |
|---|---:|---:|
| Native | 21/30 | 29.4 ms |
| Direct CSS | 14/30 | 41.2 ms |
| snapDOM beta | 6/30 | 107.7 ms |

Every mode reached the final value, 300, without errors. Intermediate values
were coalesced. These conditional medians exclude values never observed at a
draw and must be read with the counts. This single burst is evidence against
native parity, not a general frame-rate benchmark. An earlier burst that
awaited each automation keypress throttled different backends differently;
its data is explicitly marked excluded.

## What surprised us

- A full snapshot can be much cheaper without partial-region composition.
  Original CSS let the browser do the styling work normally reconstructed by
  the snapshot library. The remaining fresh raster cost is substantial.
- Fonts are part of the test fixture. Earlier isolated fixtures omitted the
  lab's global `/fonts/fonts.css`. DSEG was scene-local, but other typography
  could fall back. This experiment restored the global stylesheet and checked
  loaded families in every browser. Its matched results supersede comparisons
  across those earlier fixtures; old timings retain their original scope.
- The first custom font packaging attempt dropped `@font-face` descriptors
  by treating them like element styles. Reconstructing the actual rule fixed
  the fallback. The rejected image is excluded from accepted evidence.
- The cached stylesheet was about 557 KB, including 17 font-face rules from
  the used families. First preparation took about 10 ms in the Chrome check.
  This worked without minimizing the stylesheet or writing a CSS layout engine.

## Still unknown

This is not a general DOM snapshot implementation. It did not establish
correctness for external ancestor selectors or theme changes, stylesheet
replacement, new font families introduced later, viewport-relative units,
cross-origin stylesheet access, non-font URL resources, shadow DOM, adopted
stylesheets, video, embedded canvases, iframes, selection, or native form-control
appearance. Focus handling was deliberately limited. Styles were rebuilt for
window resize and font loading, not every possible environmental change.

Transitions were sampled for active targets, but intermediate pixel fidelity
was not exhaustively checked. Arbitrary CSS animation, rapid layout changes,
and the displayed-frame/input-routing contract still need dedicated evidence.
The tested engines and one development machine do not cover all browsers.

## Recommended approach

Treat direct authored-CSS capture as a credible candidate for Munari's portable
backend. Keep HTML-in-canvas available for lower latency and capabilities that
need the browser's live painter. The current evidence does not justify saying
the two are interchangeable.

Before building production code, use a second consumer whose styles depend on
ancestors, changing themes, and non-font resources. Determine which context can
be preserved cheaply and which constraints authors must accept. Investigate
the WebKit appearance difference in isolation. Those checks are more useful
now than another broad snapshot-library rewrite.

Munari should own scheduling, completed-frame evidence, texture lifetime, and
interaction coordination. A capture implementation should supply pixels and
the state they represent. This is a proposed boundary, not a new public API.

## Cost signals and disposition

The experiment needed roughly 130 lines for its source adapter plus temporary
binding selection and draw instrumentation. That demonstrates the mechanism,
not production size. The expensive work is preserving CSS context, resource
lifetime, invalidation, and behavior when capture fails or falls behind.

No dependency, CI, deployment, release, or production-source changes were made.
The temporary implementation was deleted and its Vite server stopped after
the findings were saved. All verification browsers closed. Existing dirty
production work was preserved; the two earlier reports received the font
fixture correction above. [Cleanup evidence](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/css-capture/cleanup.json).
