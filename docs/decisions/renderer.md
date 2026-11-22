# Decisions: renderer and materials

Rules for how `SurfaceCanvas` renders: the WebGPU renderer, node materials, the canvas pipeline, and recovery from GPU loss. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="69"></a>

## #69 — `SurfaceCanvas` renders with `WebGPURenderer`, tone mapping off

`SurfaceCanvas` creates Three's `WebGPURenderer`, awaits `init()`, and falls back to WebGL 2 when WebGPU is missing. `gl` takes `WebGPURendererParameters`. It requires `@react-three/fiber` 9.8.1 or later, because earlier versions race the async renderer factory (at 9.7.0, Veil drew nothing in 15 of 48 loads). It catches a factory rejection and shows `fallback`.

Renderer tone mapping stays `NoToneMapping`, because the final pass ignores `toneMapped: false`. A scene tone-maps in its own materials with `material.outputNode = toneMapping(mode, exposure, output)`. `shadows` has no `'soft'` option and maps to `PCFShadowMap`. Presentation receipts need a `SurfaceCanvas` (#72), and a deferred receipt counts as presented only when it reaches `onPresented`.

<a id="71"></a>

## #71 — Surface draws with node materials

`WebGPURenderer` runs no GLSL on either backend, so `Surface` draws with Three Shading Language (TSL) node materials. A `ShaderMaterial` or an `onBeforeCompile` splice draws nothing, and a GLSL material on a `Surface.Mesh` reports once in development.

`useSurfaceNodes()` returns the capture as a texture node, plus the presenter's radii and size as uniform nodes and `radiusMask()`. The nodes keep their identity across a resize. The default material is a `MeshBasicNodeMaterial` with the capture as `map` and the corner mask as opacity. It discards below 0.004 in the opacity node, because `alphaTest` reshapes alpha under `alphaToCoverage`. `Surface.LitMaterial` divides alpha out before lighting (#48).

`@petepetrash/munari` requires `three` 0.186.1 or later, where disposing a replaced geometry no longer deletes the new geometry's buffers.

<a id="72"></a>

## #72 — `SurfaceCanvas` draws through `DirectRenderPipeline`

`SurfaceCanvas` draws every canvas frame through Three's `DirectRenderPipeline`. Blending happens in the sRGB canvas, as on WebGL, and added light survives over transparent pixels. Draws into a render target are unchanged. `getRenderTarget()` is `null` during a canvas draw, so a presenter's canvas draw presents directly; only a color-writing pass into a render target defers to the end of the frame (#25).

A custom material returns color through `premultipliedOutput` (premultiplied linear) or `encodedOutput` (premultiplied sRGB), and added light comes from blend factors. A translucent material sets `premultipliedAlpha: true`. A material that samples the canvas, such as stock transmission, draws too bright: over sRGB (40, 101, 180) it drew (110, 169, 219). Glass renders into its own render target and samples that, as `registry/glass/` does.

<a id="73"></a>

## #73 — `SurfaceCanvas` replaces a lost renderer

A `WebGPURenderer` that loses its GPU never draws again, on WebGPU or the WebGL 2 fallback. After a loss, `SurfaceCanvas` returns every Surface to the page, hides the dead canvas, shows `fallback`, calls `onRendererLost`, and remounts its Canvas with a new renderer. The page HTML is untouched. A replacement lost within 10 s (`REPEATED_LOSS_MS`) is not replaced, so a GPU that fails every frame stops after one retry. `onRendererLost` is the scene's signal, because `SurfaceCanvas` owns `onDeviceLost`.

A lab scene that runs its own `WebGPURenderer` outside `SurfaceCanvas` shows its fallback and restarts through `useRendererReplacement` (`apps/lab/src/lib/rendererReplacement.ts`). Renderers that one scene restarts together share one counter. `probe:api-lifecycle` and `gate:genie-film` check recovery.

<a id="76"></a>

## #76 — A presenter first draws with pipelines already built

A `Surface.Mesh` or `FrameSurface` in a `SurfaceCanvas` stays hidden until `compileAsync` has built every pipeline its material draws with: its own write flags, the same with color on, and all writes off, with each pass of a transparent double-sided material as its own side. The page holds meanwhile. three 0.186.1 builds a missing pipeline at the draw with the blocking `createRenderPipeline`, which Chrome's Dawn runs on the GPU process's main thread. With shaders no cache held, Genie's first flight froze every frame for 183-250 ms (`instruments/genie-first-flight`, 2026-11-22).

A build starts inside the draw of the scene that holds the mesh, so it gets that draw's target and `DirectRenderPipeline`'s output node (#72). three creates the pipeline after its first await and keys it by the renderer's output settings at that moment, so while a build is pending the renderer rests with no tone mapping in the working color space, as the draw sees it, and has its own settings back around each canvas draw. A build that fails is logged in development and the presenter draws anyway. `Surface.Prewarm` builds the same pipelines before any presenter mounts, and `SurfaceCanvas` builds the mipmap pass for both upload formats while the renderer starts. Outside a `SurfaceCanvas` nothing is built ahead, and a presenter draws at once.
