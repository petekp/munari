# Spike: Knobs rendered with snapDOM

Measured September 8, 2026. Munari source: `cd87c95261853a802b955618031a5eb4e2a0b13b`.
snapDOM: `@zumer/snapdom@2.24.16`, published source revision
`7272eac91089bc0f5b589044b368e66d44eb16d5`.

**Verdict: viable with caveats.** The complete Knobs scene worked without
HTML-in-canvas in Chrome, Firefox, and the tested WebKit engine. Frequent
whole-panel captures caused substantial frame gaps and slower visual feedback.
This establishes an interactive cross-browser path worth developing; it does
not establish a performance-equivalent replacement for the current backend.

[Demo video](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/knobs-snapdom-demo.mp4) ·
[All measurements](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/summary.json) ·
[Source comparison](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/chrome-source-comparison.json)


**Update, September 9:** the reviewed follow-up isolated an adapter padding
mistake that largely explains the raster differences below. Correct logical
cropping closely matches native DOM rendering. Performance parity still
failed after a regional-update attempt. See the
[reviewed parity assessment](2026-09-08-snapdom-parity-assessment.md).

**Fixture correction, September 9:** this isolated page omitted the lab's
global font stylesheet. Scene-local DSEG loaded, but other text could fall
back. The [direct-CSS follow-up](2026-09-09-direct-css-capture.md) corrects the
fixture and reports new matched comparisons; its timings should not be mixed
with these older measurements.

## Questions and scope

1. Can snapDOM supply the full scene's HTML textures while preserving its
   geometry, materials, lights, reflections, controls, and physics?
2. Do mouse and keyboard interaction, dragging, and responsive resizing work?
3. What are the visual differences, update costs, and cleanup behavior?

The scope was one complete demo and three test passes: appearance,
interaction, and sustained updates. Missing hardware, broken controls, an
unusable raster, or an update queue that cannot catch up would reject the path.
The source-only texture appearance was not accepted as a complete scene.

## What was implemented

An isolated filesystem copy replaced the binding's DOM texture producer with
an 85-line disposable snapDOM adapter. All files in the Knobs scene remained
byte-identical to the original checkout. The original core laws, geometry,
materials, artwork, reflections, audio code, control handlers, and physics
were reused. Audio was not independently verified by listening.

The adapter keeps the actual control DOM in a regular, transparent host and
captures its child. This avoids putting the source under a canvas that lacks
HTML-in-canvas layout. The existing pointer relay still maps the displayed
panel to that DOM; real keyboard events reach the focused original sliders.
This does not test native trusted-pointer overlays or rich-text editing.

The adapter serializes captures, coalesces pending requests, preserves a
stable output canvas, publishes completed frames, and drops a completion when
its requested layout size has changed. It reuses an SVG for density-only
rerasterization. Requested density is rounded to 0.05 in this apparatus.
Capability checks select the actual snapDOM backend without pretending that
experimental browser methods exist.

Capture settings were `embedFonts: true`, `cache: soft`, `burst: false`,
`outerTransforms: false`, `outerShadows: false`, and `compress: false`.
SVG preparation uses DPR/scale 1; raster output follows the requested density.
A separate pass used `cache: full`.

## What we learned

### The full scene works

Chrome 151.0.7922.176, Firefox 151.0, and Playwright's WebKit 26.5 each rendered
all **55 meshes**, matching the original Chrome backend. Both experimental
capture methods were absent in every snapDOM run, and the original native
paint registry stayed empty.

Each engine passed all 18 checks: backend provenance, full hardware, no idle
recapture, all six keyboard-operated dials, both switches, dial dragging,
panel carrying, responsive resizing, original-control identity, capture
catch-up, the tuning panel, and navigation. The resize changed the panel from
320×720 to 560×462 CSS pixels. The tuning panel exposed 35 inputs; every tuning
combination was not tested. Navigation alone is not cleanup proof; a separate
unmount test below supplies that evidence.

[Chrome](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/chrome-snap.json) ·
[Firefox](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/firefox-snap.json) ·
[WebKit](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/webkit-snap.json)

### Whole-panel capture is expensive during interaction

The controlled comparison used a 1200×820 viewport at DPR 1. These are
descriptive measurements from one interaction run per engine, not a broad
hardware benchmark.

| Renderer | Median completed capture during controls | p95 animation-frame interval during controls |
|---|---:|---:|
| Original Chrome HTML-in-canvas | Not measured by the snapDOM timer | 9.2 ms |
| Chrome + snapDOM | 64.3 ms | 58.3 ms |
| Firefox + snapDOM | 80.0 ms | 74.9 ms |
| WebKit + snapDOM | 99.0 ms | 45.0 ms |

The Chrome snapDOM control run spent a median 53.4 ms preparing the SVG and
10.6 ms rasterizing it. Individual stage medians need not sum to the total
median. Most steady work was upstream of the texture upload.

The scene can animate without recapturing unchanged HTML: all three snapDOM
engines recorded zero captures during the idle interval. The problem appears
when readouts, tick marks, focus/hover, or layout change.

The verified `cache: full` pass did not solve this. Continuous keyboard
updates took a median 93.2 ms per capture versus 52.2 ms with `soft` in the
earlier pass. This single sequence does not establish a universal cache-mode
ranking. [Full-cache run](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/chrome-snap-full.json)

Frame intervals include the scene, capture, and automated interactions. They
are requestAnimationFrame observations, not a claim about physical display
presentation. The video was recorded separately and is not timing evidence.

### Visual feedback is slower at natural display density too

A separate Chrome test used the display's natural DPR 2, a 1200×741 viewport,
and a 640×1440 capture of the 320×720 panel. Eight trusted keypresses per backend
were measured from the key event to an updated readout raster and a
color-writing default-framebuffer mesh draw of a newer uploaded generation.

| Backend | Median | Range |
|---|---:|---:|
| Original HTML-in-canvas | 41.0 ms | 33.8–121.5 ms |
| snapDOM | 96.3 ms | 64.4–187.6 ms |

These small samples include a slower first keypress in both runs. This checks
updated texture pixels and renderer draw completion; it does not measure
display scanout.

[Original](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/validation-native.json) ·
[snapDOM](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/validation-snap.json)

### Appearance is close, with visible differences

The initial 320×720 source images retained the typography, readout values,
ticks, layout, and lamps. Their RGB mean absolute differences were
4.70/4.28/3.75 on an 8-bit channel; alpha difference was 2.29. The snapDOM
image's edge energy was 1.023 times the native capture's.

This is a comparison against the original HTML-in-canvas raster, not an
independent native-DOM screenshot. The edge statistic does not establish
pixel equality. Visual inspection found differences in inset shading,
especially the switch wells.

[Original raster](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/chrome-native-initial-source.png) ·
[snapDOM raster](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/chrome-snap-initial-source.png) ·
[Complete resized scene](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/snapdom-knobs/chrome-snap-resized.png)

### Freshness and cleanup were tested

Deliberately pausing capture allowed a keyboard change to update the real
control while leaving the readout raster frozen. The pixel check detected it;
resuming capture updated the raster. This supplies a negative control rather
than relying only on a capture counter.

During normal sustained updates, some captures completed after the DOM had
advanced. The before/after value records show that timing gap; they do not by
themselves prove mixed pixels. All three engines caught up after input stopped.

A separate component unmount left zero active snapDOM sources, zero source
hosts, and zero canvases. This is a resource-lifecycle check, not a heap-leak
proof.

## What surprised us

- A substantial interactive scene worked with its existing control and
  geometry code. The experiment went beyond decorative reflections.
- The first adapter run displayed the HTML face but omitted the anchored
  hardware. A missing source ID caused the anchor contract to reject it.
  Requiring all 55 meshes caught this false success.
- The isolated server cached package transforms outside its app root. Served
  code was explicitly checked and the server restarted before accepting
  corrected-adapter and cache-mode results.
- Warm capture still spent tens of milliseconds preparing the whole panel.
  A broad caching switch did not remove that cost.

## Still unknown

Actual Safari, iOS Safari, Android devices, and lower-powered hardware were
not tested. WebKit 26.5 here is an automation engine, not proof of shipping
Safari support.

Knobs does not exercise page-to-scene handoff, text caret/selection, IME, media
capture, or arbitrary third-party controls. Those capabilities cannot be
inferred from these results. Transient pixel-to-hardware alignment during a
resize was not proven frame by frame; the final responsive states and
interactions passed. Sustained high-DPR and multi-surface capacity remain open.

## Recommended approach

Treat snapDOM as a credible route for substantial interactive scenes in the
tested engines. Keep the current native backend available where rapid visual
updates matter.

The next discriminating performance experiment would capture static panel
content once and recapture only changing readouts/control regions. That may
avoid walking the entire panel on every dial step, but its benefit and
compositing correctness are unmeasured. It was not implemented in this spike.

## Cost signals and teardown

The experimental integration needed one small source adapter, one factory
replacement, and four capability-check adjustments. The demo itself needed
no rewrite. Test-only draw instrumentation and a standalone bootstrap were
additional apparatus. A production implementation would need an explicit
backend contract, SSR behavior, content restrictions, asynchronous frame and
anchor ownership, and measured update scheduling; the 85-line apparatus is
not a production size estimate.

The isolated server was stopped and the entire disposable copy, adapter,
runner scripts, and downloaded experiment dependencies were removed. The
report, raw measurements, screenshots, and video remain. No production code,
package manifest, lockfile, CI, or deployment configuration was changed.
