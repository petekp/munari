# Spike: Gallery with direct CSS capture

Measured September 9, 2026, against Munari
`cd87c95261853a802b955618031a5eb4e2a0b13b`.

**Verdict: viable with caveats in Chrome and Firefox; the full Gallery handoff
is unsupported in the tested WebKit engine.** Original-CSS capture survives
a second, substantially different demo after bounded image and context fixes.
It remains slower than HTML-in-canvas. WebKit exposed a separate dependency:
Munari's retained-HTML handoff requires `Element.moveBefore`.

[Rendered transition](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/chrome-css-1-dpr1-mid.png) ·
[Timing measurements](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/benchmark-summary.json) ·
[Pixel comparisons](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/pixel-comparisons.json) ·
[Pointer gate](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/pointer-css.log)

## Questions and scope

1. Can the [Knobs capture approach](2026-09-09-direct-css-capture.md) reproduce
   Gallery's photographs, two live full-screen sources, and refraction transition?
2. Do ancestor-theme changes and image replacement invalidate captured pixels?
3. Do handoffs, pointer routing, focus, resizing, and source lifetime survive?
4. What happens to responsiveness at full-screen sizes and DPR 2?

The budget was one disposable adapter, the unchanged Gallery scene, and three
experiments: the full demo, ancestor themes, and resource replacement. Bounded
resource/context fixes were allowed; a general computed-style reconstruction
engine or a production handoff redesign was outside this spike.

Gallery's source folder remained byte-identical to the checkout. The isolated
page loaded the actual lab styles and global fonts. Only the temporary binding
selected the alternate producer and recorded source generations at shader draws.
There were no production-code, dependency, CI, or deployment changes.

## What we learned

### The first approach needed image and document context handling

The initial mode reused the Knobs mechanism: clone HTML, add cached authored
CSS and embedded fonts, decode SVG, and publish a canvas texture. Gallery's
photographs disappeared from that capture. Loading an image in the original
page did not make its external URL usable inside the serialized SVG image.
The ancestor-theme probe also failed because its ancestor was absent.

The corrected mode embedded each image's selected URL, cached the resource by
URL, and removed `srcset`, `sizes`, and lazy-loading attributes from the snapshot.
It included shallow copies of the document's HTML/body attributes, with layout
and visibility neutralized. It watched document theme attributes and stylesheet
changes, rebuilding cached styles when that context changed. This did not
reconstruct computed styles for every descendant.

The theme probe used a body class selecting descendant titles and card
backgrounds. The image probe replaced an already prepared image with another
local Gallery resource. These are deliberate test mutations, not new Gallery
features.

Source screenshots were compared with their browser-rendered DOM references
at matching dimensions, over white. Clock text was hidden for these comparisons
to avoid comparing different instants.

| Source capture | Initial RGB MAE, out of 255 | After theme change | After image replacement | After resize |
|---|---:|---:|---:|---:|
| Chrome, initial mode | 34.328 | 41.158 | 33.436 | 34.148 |
| Chrome, corrected | 0.087 | 0.090 | 0.090 | 0.113 |
| Firefox, corrected | 0.088 | 0.091 | 0.091 | 1.198 |
| WebKit, corrected source only | 0.662 | 0.666 | 0.666 | Not tested |

The Firefox resized result is a real difference, not an exact match. These
figures measure source images, not every pixel of an animated transition.

A separate quiet-content test stopped both clocks. Capture count stayed at
14 during the idle observation. Changing only the body's theme class advanced
it to 16 and changed a diagnostic source pixel from red to green. Replacing an
image then changed the published bitmap; that bitmap matched a fresh capture
with **zero pixel error**. No explicit repaint or manual stylesheet reset was
used to trigger those automatic updates. [Quiet invalidation evidence](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/quiet-invalidation.json).

### The complete tested interaction works in Chrome and Firefox

Chrome 151.0.7922.176 and Firefox 151.0 passed the corrected sequence: two live
sources, scene handoff, outgoing/incoming hover, resizing from 1200 × 820 to
900 × 700, return to page, retained source-root identity, native link focus,
correct link destination, further automatic crossings to Knobs/Selection/Logo,
and cleanup. Chrome's native baseline passed the same interaction sequence.
The alternate runs verified both HTML-in-canvas capture methods were absent.

Gallery's existing pointer gate was adapted only to connect to the temporary
server and select the capture backend. Its grid and thresholds were retained.
It passed: all 85 reachable points routed to the outgoing item near the start
and the incoming item near the end. Mid-transition, 32/34 judgeable points
agreed with the rendered pixels: **94%, above the existing 90% floor**. Both
items received input in the middle.

The first single-point hover probe read too soon after entering the pointer
path. Moving through multiple points and waiting for delivery corrected it;
the independent grid test supplied the stronger evidence. Native reference
testing also needed a role-based link selector to exclude its canvas copy.

### Full-screen capture is noticeably slower

At a fixed midpoint, each card's real clock continued updating every 100 ms.
Observers recorded when a new value reached each source DOM. Draw records
identified both source generations sampled by the color-writing shader.
Captured values were matched to those generations. No pixel reads or
screenshots ran during timing.

| Chrome configuration | Median source-change-to-draw | p95 source-change-to-draw | Median capture per source |
|---|---:|---:|---:|
| Native, DPR 1, two runs | 9.7–15.4 ms | 10.5–16.9 ms | Not separately timed |
| Direct CSS, DPR 1, two runs | 53.4–56.9 ms | 56.9–60.7 ms | 45.1–45.6 ms |
| Native, DPR 2, one run | 15.4 ms | 16.5 ms | Not separately timed |
| Direct CSS, DPR 2, one run | 59.0 ms | 65.4 ms | 43.3 ms |

Every run delivered all **80 measured clock changes** across both sources.
Each measured window was four seconds, followed by a short drain period. DPR 1
sources were 1200 × 820; DPR 2 sources were genuinely 2400 × 1640.

Direct preparation took about 6 ms; the remaining elapsed decode/raster stage
took roughly 38–40 ms. Captures were serial per source but could overlap across
the two sources, so these elapsed phases cannot be added as a CPU profile.
The initial cached stylesheet was about 728 KB with 20 font-face rules.

The cost also affected the animation loop. Its p95 interval was about 9 ms
with native capture and 33 ms with direct capture on this machine. The actual
interaction run in Firefox measured median capture time of 55.5 ms; it did not
receive the dedicated source-change-to-draw benchmark.

These are headless desktop measurements, not physical input-to-photon latency
or universal device budgets. Source-value metadata plus draw evidence does not
independently verify every transient framebuffer pixel or an atomic resize.

### WebKit's failure is a different browser dependency

In automated WebKit 26.5, `typeof Element.prototype.moveBefore` was
`"undefined"`. After Gallery requested the scene, Munari reported:

> This browser cannot preserve DOM state while moving the content.

The public status had `requestedInScene: true`, `presentation: 'page'`, and
`supported: false`. The scrub state reached 0.50, so this was not a failed
range-input event. Both sources continued producing captures without errors,
but no scene meshes mounted. Separate source-only tests passed through theme
and image changes, with the pixel differences listed above; cleanup removed
all owned sources, hosts, and canvases. [WebKit evidence](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/webkit-source-only.json).

The relevant existing checks are in
[Surface.tsx](../../packages/react/src/primitives/Surface.tsx): the handoff
requires `moveBefore` and reports an unsupported reason without it. The spike
did not polyfill that method with `insertBefore`, which would evade the
state-preservation requirement rather than establish it. This explains why
Knobs could work in WebKit while Gallery could not: Knobs' scene-only use did
not exercise this page-to-scene handoff.

## What surprised us

The narrow resource/context repair was sufficient for this second source.
However, removing HTML-in-canvas does not by itself remove Munari's browser
dependencies. Capture support, DOM-state preservation, and presentation/input
coordination require separate evidence.

The first automation browser also failed to create a WebGL context. Its
screenshots were excluded; accepted Chrome runs used installed Chrome and
required actual scene draws.

## Still unknown

Arbitrary authored ancestor chains are not preserved by the shallow document
wrappers. Cross-origin resources, CSS background URLs, same-URL resource changes,
shadow DOM, video, selection/caret preservation through an alternative handoff,
and released Safari/iOS remain unproven. General resource cache eviction and
failure recovery were not implemented. No claim of native parity is justified.

## Recommended approach

Continue treating authored-CSS capture as a credible portable producer.
Gallery supplies a second real consumer with images, live content, two sources,
and custom shader input routing. Preserve the native producer for its lower
latency.

Before a production rearchitecture, resolve the retained-HTML policy on
browsers without state-preserving DOM moves. A native page fallback is already
honest behavior; matching the enhanced interaction needs an explicit design
that preserves the promised state. More capture optimization alone cannot
solve that dependency.

Separately, set a capture budget for large live sources. The current full-screen
clock experiment meets eventual freshness but causes visible frame gaps. Do
not silently remove live content from a demo to call the backend equivalent.

## Cost signals and disposition

The additional mechanism was image embedding, document-context preservation,
and context invalidation. The unresolved costs are resource lifecycle, broader
CSS context, capture scheduling, and a handoff design compatible with the
target browsers. These are distinct from the shader effects themselves.

The temporary implementation was deleted, its Vite server stopped, and its
verification browsers closed. Existing dirty files were preserved. Only this
report and browser evidence remain. [Cleanup record](/Users/petepetrash/.codex/visualizations/2026/09/09/01a0849b-f31a-7182-bb6e-e472df4490b5/gallery-css/cleanup.json).
