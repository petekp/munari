<!-- review-gate author: claude-opus-5-5 -->
# Costs a level could trade

Part of the [quality levels proposal](README.md). Status: proposal, unbuilt, 2026-11-26.

"Paid" says when a page pays the cost: on every frame, once while
loading, or in download. "Kept" says whether the proposal makes it a
quality field. The list covers the costs found in the renderer, finish and
capture code. It is not proven complete.

| Cost | Code | Paid | Kept |
|---|---|---|---|
| Canvas pixel ratio | `SurfaceCanvas.tsx:522`, `surfacePixelDensity.ts:8`. The native ratio by default, times a display-scale correction | Every frame, and GPU memory for each canvas-sized buffer | Yes, as `renderScale` |
| Capture density | `Surface.HTML resolution`, default `'auto'`. Tiers 0.25–6 and a 4096 px edge limit in `packages/core/src/paint/lodTier.ts` | Once per capture (raster and upload), and memory | No. `'auto'` follows the canvas ratio |
| MSAA | `antialias` in `SurfaceCanvas.tsx:169-175`. R3F 9.8.1 defaults it to `true`, so three uses 4 samples | Every frame (resolve), and memory | No. three sets the sample count in the renderer's constructor and exposes only a getter (`Renderer.js:275, 2624`) |
| Depth buffer | three's `depth` parameter, on by default | Memory | No. 3D scenes need it |
| Shadows | `SurfaceCanvas`'s `shadows` prop, off by default | Every frame, when on | No. The app turns it on for its own meshes |
| Capture anisotropic filtering | `texture.anisotropy = 8` at `surfaceSourceRuntime.ts:159` | Every frame, in texture sampling | No. Not measured |
| Environment bake size | `generator.fromScene(scene, STUDIO_BLUR)` at `finishRig.tsx:267`, three's default 256 px per face | Once while loading, and memory | No (decision Q2) |
| Glass taps | `TAPS = 8` and `ONE_TAP_BLUR_PX = 0.35` in `finishTransmission.ts`, on the unmerged `glass-finish` branch (`cdf9501`) | Every frame, for frosted and crystal glass | No (decision Q2) |
| Glass canvas copy | One `viewportTexture()` copy per render, same branch | Every frame, and memory | No. It follows the pixel ratio |
| Finish layers | Coat, sheen, anisotropy, film, scatter, detail relief and crackle, each in `SurfaceFinish` | Every frame, a pipeline build while loading, and a 0.2–1.5 kB chunk each | No. They are the material the author chose |
| Softbox key | `RectAreaLightTexturesLib`, loaded at `finishRig.tsx:142` when the key is a softbox | Download (102 kB gzip), one load, and per-frame shading that was not benched | No. Lighting chooses it, and `docs/softbox-size.md` on the `softbox-size` branch sizes its tables |
| Specular anti-aliasing filter | `finishNodes.ts` | Every frame, a few shader instructions | No. It fixes sparkle on curved normals |
| Idle frame loop | `idleMode = frameloop ?? 'always'` at `SurfaceCanvas.tsx:280` | Every display refresh while nothing changes | No. It is a pacing choice ([Findings](README.md#findings)) |
| `live` capture period | `LIVE_PERIOD_MS = 250` at `rasterizedSource.ts:101` | Per capture, on the snapDOM path | No. It decides how fresh content is |
| GPU choice | `powerPreference ?? 'high-performance'` at `SurfaceCanvas.tsx:171` | Power, on machines with two GPUs | No. It picks the adapter, not the picture |
