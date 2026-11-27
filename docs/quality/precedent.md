<!-- review-gate author: claude-opus-5-5 -->
# Precedent

Part of the [quality levels proposal](README.md). Status: proposal, unbuilt, 2026-11-26.

Browsers expose quality as a hint with named levels. Engines expose named
levels over a set of fields, with resolution as its own scale. Automatic
choice exists in engines and 3D viewers. It is either a benchmark or
device table, or a frame-time controller on render resolution.

- Canvas 2D's [`imageSmoothingQuality`](https://developer.mozilla.org/docs/Web/API/CanvasRenderingContext2D/imageSmoothingQuality)
  takes `"low"`, `"medium"` and `"high"`, default `"low"`. Chrome, Edge and
  Safari support it. Firefox does not ([caniuse](https://caniuse.com/mdn-api_canvasrenderingcontext2d_imagesmoothingquality)).
  The levels are hints, and the browser decides what each means.
- CSS [`image-rendering`](https://developer.mozilla.org/docs/Web/CSS/image-rendering)
  defines a `high-quality` value that no browser supports.
- [`prefers-reduced-data`](https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-data)
  would let a user ask for less. It is behind a flag in Chromium, a
  [Firefox bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1681925) is
  open, and the CSS Working Group discussed its privacy cost in
  [October 2025](https://lists.w3.org/Archives/Public/public-css-archive/2025Oct/0559.html).
  It is not Baseline.
- Unreal's [scalability groups](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-reference-for-unreal-engine)
  set a level from 0 (low) to 3 (epic) per group. Resolution is a separate
  screen percentage, `r.ScreenPercentage`, from 10 to 100. Device profiles
  override the user's settings
  ([Lyra's notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-device-profiles-in-lyra-sample-game-for-unreal-engine)).
- Unity's [`QualitySettings`](https://docs.unity3d.com/ScriptReference/QualitySettings.html)
  are named levels that a project defines, over fields such as
  `antiAliasing`, `shadows`, `globalTextureMipmapLimit`, `lodBias` and
  `vSyncCount`.
- Babylon's [SceneOptimizer](https://doc.babylonjs.com/features/featuresDeepDive/scene/sceneOptimizer)
  lowers quality step by step until a target frame rate holds, and an
  improvement mode raises it again. Its presets include
  `LowDegradationAllowed` and `ModerateDegradationAllowed`, and
  `HardwareScalingOptimization` lowers render resolution.
- [model-viewer](https://modelviewer.dev/examples/loading/) scales render
  resolution to keep 38–60 fps and returns to full scale when the scene
  stops moving. It dispatches a `render-scale` event. Its static
  `minimumRenderScale` is in
  [model-viewer-base.ts](https://cdn.jsdelivr.net/npm/@google/model-viewer@4.2.0/src/model-viewer-base.ts).
- R3F's own `Canvas` defaults `dpr` to `[1, 2]`, a cap of 2. `SurfaceCanvas`
  overrides that with the native ratio, per decision #44. R3F's store has
  `performance { current, min, max, debounce }` and `regress()`
  ([scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)).
  drei adds [`PerformanceMonitor`](https://drei.docs.pmnd.rs/performances/performance-monitor)
  and [`AdaptiveDpr`](https://drei.docs.pmnd.rs/performances/adaptive-dpr).
- pmndrs [detect-gpu](https://www.npmjs.com/package/detect-gpu) maps the GPU
  name to tiers 0–3 from GFXBench results, at 15, 30 and 60 fps
  thresholds. It needs a benchmark table and a renderer name.
- WebGPU's [`powerPreference`](https://developer.mozilla.org/docs/Web/API/GPU/requestAdapter)
  is a hint. Munari passes `'high-performance'`.

What this means for Munari:

- Three named levels with a default match canvas 2D's hint. Unity's levels
  are bundles a project defines. Pete has decided Munari's three.
- A level is a bundle of field values. Unreal and Unity both let a
  project set single fields, which is the object form.
- Resolution is the first thing adaptive systems lower, and they express
  it as a fraction: model-viewer's render scale, Unreal's screen
  percentage, Babylon's hardware scaling. The measurements agree that it
  is the lever.
- Device tables need upkeep and a benchmark Munari does not have.
  Frame-time controllers change sharpness while a user reads, and a
  Munari canvas that renders on demand has no steady frame rate to read.
