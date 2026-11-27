<!-- review-gate author: claude-opus-5-5 -->
# Quality levels

Status: proposal, unbuilt, 2026-11-26. Nothing here describes current
behavior unless it cites code or a measurement.

The canvas pixel ratio is the cost a quality level should trade. Frame
time scales with the number of pixels the canvas draws. Every other
per-frame cost measured saves less, changes the material the author
chose, or is fixed when the renderer starts. The proposal makes each level
a fraction of the screen's native ratio: `high` draws at the native ratio,
`medium` at 0.75 of it and `low` at 0.5, never below 1. `high` is the
default, so decision #44 (native text clarity) keeps holding. The
configuration object exposes the fraction as `renderScale`. Munari does
not pick a level from the device in the first version.

| Part | What it holds |
|---|---|
| [Costs](costs.md) | The costs found in code, and when a page pays each |
| [Measurements](measurements.md) | Frame time, first frame, memory, download and pixel differences on m2, and their limits |
| [Precedent](precedent.md) | How browsers and engines expose quality, and whether they choose it |
| [Proposal](proposal.md) | What each level sets, the API, defaults, runtime changes and loading |
| [Decisions](decisions.md) | The choices for Pete, with options and costs |
| [Review](REVIEW-quality.md) | The independent review of these files |

Terms used below:

- The native ratio is `window.devicePixelRatio`, which includes browser
  zoom. A DPR-2 laptop at 125% zoom reports 2.5.
- The pixel ratio is the number of canvas pixels per CSS pixel. A canvas
  1440 CSS pixels wide at ratio 2 has a drawing buffer 2880 pixels wide.
- A capture is the texture Munari makes from a Surface's HTML.
- The environment bake is the prefiltered environment map (PMREM) that
  lights finishes. `finishRig.tsx` bakes one per environment kind.
- A glass tap is one sample of the canvas copy that a glass finish blurs
  or splits by wavelength.

## Findings

- A `SurfaceCanvas` renders on every display refresh while idle, because
  `frameloop` defaults to `'always'` (`SurfaceCanvas.tsx:280`). On m2, a
  frame of 12 cards takes 1.2–2.3 ms of GPU time at ratio 2, so an idle
  page spends that 120 times a second. Changing the default to
  `'demand'` is a separate decision. It would also stop
  `PerformanceMonitor` from seeing frames.
- Lab canvases differ from a default `SurfaceCanvas`. 17 lab canvases set
  `dpr`, most of them to `[1, 2]`, and the rest draw at the native ratio.
  The finishes pages also turn off MSAA and the depth buffer. Measurements on those pages do
  not show what an outside app gets by default.
