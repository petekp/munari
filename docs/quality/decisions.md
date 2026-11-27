<!-- review-gate author: claude-opus-5-5 -->
# Decisions

Part of the [quality levels proposal](README.md). Status: proposal, unbuilt, 2026-11-26.

## Q1. What `high` draws

| Option | Effect | Cost |
|---|---|---|
| A. The native ratio, as today | Decision #44 holds. Text matches the page at any zoom | DPR-3 screens draw 2.25× the pixels of ratio 2. On m2 that took 2.0–2.3× the frame time and 1.9–2.0× the texture memory |
| B. A cap of 2 | DPR-3 screens draw 44% of the native pixels | Revises #44 and its sharpness probes. On a DPR-3 screen, 7–14% of each card's pixels soften (32% on aluminum). A DPR-2 laptop zoomed past 100% softens too |
| C. Medium as the default | Every DPR-2 screen draws 56% of the pixels | Text softer than the page on most laptop screens |

Recommendation A. Text that matches the page is Munari's default promise
(#44), and B breaks it on zoomed laptops as well as phones. An app that
needs the saving picks `medium` or sets `dpr`.

## Q2. Fields beyond `renderScale`

| Option | Effect | Cost |
|---|---|---|
| A. `renderScale` only | One field. Every level keeps the author's material | A page heavy in glass or short of memory can save only by resolution. On a DPR-1 screen no level saves anything |
| B. Add `glassSamples` (8, 8, 4) | Low saves glass work. Measured: 0.38–0.51 ms on 12 cards at ratio 2 | Frost becomes grain at low. The saving at ratio 1 was not measured. Glass has not merged |
| C. Add `environmentSize` (256, 256, 128) | Low saves 7 MB per environment kind, over half of a small page's textures | Glossy finishes shift by up to 30/255. No time saved |
| D. Add a drawing-buffer pixel budget | Bounds cost on very large screens, such as 14.7 million pixels on a 5K display at ratio 2, which `dpr` cannot bound | A second control over the ratio. No measured page needed it |

Recommendation A. B and C change the picture, and D answers a need no
measurement has shown. C is the strongest candidate if a
device runs short of memory. Add B when glass ships and a page shows the
need.

## Q3. R3F's `dpr` prop on `SurfaceCanvas`

| Option | Cost |
|---|---|
| A. Keep it as an absolute bound applied after the level | Two props touch the ratio, with one rule: the level scales the native ratio, then `dpr` clamps it |
| B. Remove it | No hard cap for large screens, and no ratio above native for apps that supersample. Each app that sets `dpr` changes |

Recommendation A. The two answer different questions: the level is a
share of the screen, and `dpr` is an absolute limit.

## Q4. Automatic level

| Option | Cost |
|---|---|
| A. None. Document the `PerformanceMonitor` recipe | Apps that want it write a few lines. The recipe needs one measured level change before it ships |
| B. Built-in frame-time control of `renderScale`, like model-viewer | Sharpness changes while content is read, and captures rasterize again. Needs a rule for canvases that render on demand |
| C. A device table, like detect-gpu | Upkeep, a download, and a GPU name |

Recommendation A, and revisit B if a measured device misses its frame
budget at its level.

## Q5. MSAA

MSAA stays outside `quality`, because three fixes the sample count when
the renderer starts. Changing it would need a new renderer, which returns
every Surface to the page.

| Option | Cost |
|---|---|
| A. Keep R3F's default of `true`, 4 samples | 83 MB at ratio 2, more with a depth buffer, and 0–0.3 ms per frame on m2 |
| B. Default to `false` | Tilted cards and the app's 3D meshes show stepped edges. 18 lab canvases pass `antialias: true`, and others, such as the Postcard stage, rely on the default |
| C. Default to 2 samples | three accepts `samples: 2`. Its memory and edge quality were not measured |

Recommendation A. MSAA smooths the edges of tilted cards, which are a
normal Surface pose. C could halve the memory and is worth one
measurement.
