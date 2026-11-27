# Decisions: renderer and materials

Rules for how `SurfaceCanvas` renders: the WebGPU renderer, node materials, the canvas pipeline, and recovery from GPU loss. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="69"></a>

## #69 — `SurfaceCanvas` renders with `WebGPURenderer`, tone mapping off

`SurfaceCanvas` creates Three's `WebGPURenderer`, awaits `init()`, and falls back to WebGL 2 when WebGPU is missing. `gl` takes `WebGPURendererParameters`. It requires `@react-three/fiber` 9.8.1 or later, because earlier versions race the async renderer factory (at 9.7.0, Veil drew nothing in 15 of 48 loads). It catches a factory rejection and shows `fallback`.

Renderer tone mapping stays `NoToneMapping`, because the final pass ignores `toneMapped: false`. A scene tone-maps in its own materials with `material.outputNode = toneMapping(mode, exposure, output)`. `shadows` has no `'soft'` option and maps to `PCFShadowMap`. Presentation receipts need a `SurfaceCanvas` (#72), and a deferred receipt counts as presented only when it reaches `onPresented`.

<a id="71"></a>

## #71 — Surface draws with node materials

`WebGPURenderer` runs no GLSL on either backend, so `Surface` draws with Three Shading Language (TSL) node materials. A `ShaderMaterial` or an `onBeforeCompile` splice draws nothing, and a GLSL material on a `Surface.Mesh` reports once in development.

`useSurfaceNodes()` returns the capture as a texture node, plus the presenter's radii and size as uniform nodes and `radiusMask()`. The nodes keep their identity across a resize. The default material is a `MeshBasicNodeMaterial` with the capture as `map` and the corner mask as opacity. It discards below 0.004 in the opacity node, because `alphaTest` reshapes alpha under `alphaToCoverage`. A finish material divides alpha out before lighting (#48, #79).

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

A `Surface.Mesh` in a `SurfaceCanvas`, and a `FrameSurface` given a `presentation` requirement, stays hidden until `compileAsync` has built every pipeline its material draws with: its own write flags, the same with color on, and all writes off, with each pass of a transparent double-sided material as its own side. The page, or the presenter it replaces, holds meanwhile. A `FrameSurface` without a requirement draws at once and lets three build at the draw: nothing else shows its content, so hiding it would draw a blank frame (`gate:frame-surface`). three 0.186.1 builds a missing pipeline at the draw with the blocking `createRenderPipeline`, which Chrome's Dawn runs on the GPU process's main thread. With shaders no cache held, Genie's first flight froze every frame for 183-250 ms (`instruments/genie-first-flight`, 2026-11-22).

A build starts inside the draw of the scene that holds the mesh, so it gets that draw's target and `DirectRenderPipeline`'s output node (#72). three creates the pipeline after its first await and keys it by the renderer's output settings at that moment, so while a build is pending the renderer rests with no tone mapping in the working color space, as the draw sees it, and has its own settings back around each canvas draw. A build that fails is logged in development and the presenter draws anyway. `Surface.Prewarm` builds the same pipelines before any presenter mounts, and `SurfaceCanvas` builds the mipmap pass for both upload formats while the renderer starts. Outside a `SurfaceCanvas` nothing is built ahead. A presenter there first renders after Munari's scene module loads: that render suspends, and R3F's `Canvas` passes the suspension to the page tree, so the caller puts a `Suspense` boundary above its `Canvas`. A load that fails reaches the nearest error boundary, and a later mount loads again.

## #79 — A finish is data on the Surface, and the canvas lights it

A Surface's physical look is `finish`, plain data on `Surface.Root`, `<Surface>`, `SceneSurface.Root` and `<SceneSurface>`. Page code builds it on the server, and the page bundle stays free of three. A field a finish leaves out takes the neutral default, a plain dielectric with no layers. A layer is present while its object is present. Its amount is a uniform, so changing a value rebuilds nothing. Adding or removing a layer, or changing the relief kind, rebuilds only that Surface's material. A `Surface.Mesh` given a `material` wears that material instead of the finish. `Surface.LitMaterial` is removed with no alias, because a finish with `color: null` lights the whole capture as it did.

A finish material blends premultiplied (#5) and writes no depth, whatever the mesh's `transparent` says. On Optics this lightened the specimens' 1 px outlines by about 33/255 compared with the opaque `LitMaterial` (m2, 2026-11-26).

The canvas owns the lights. `lighting` on `SurfaceCanvas` places one key, one rim and one environment. They reach finish materials only, through `material.lightsNode`, so the scene's own materials and lights are untouched. Under `lighting="none"` a finish is lit by the scene's own lights. three's WebGPU renderer reads a light's uniforms once per frame, so every finish on a canvas sees the same lights. On one shared set of lights, cards whose rigs differed all drew under the rig that placed the lights last (m2, 2026-11-26). A finish that wants more or less light scales it in its own shader with `lightGain`. The default key is a point light. A key given a `size` is a softbox, which loads three's LTC tables (103 kB gzip) on first use.

`createSurfaceLight()` holds the key's position in client CSS px. Each canvas converts that position with its own camera when it draws. So one handle lights several canvases, and moving it needs no React render. A move cost 0.9 ms of main-thread time above idle, against 3.8 ms for a React state update at the page root (m2, three Surfaces, `docs/materials-api/light-control.md`).

A finish with a `color` paints the body in the scene. Munari writes the color as `--munari-body` on the page element, which renders on the server. It writes `transparent` on the capture root. Content whose background reads the property shows the color on the page and the lit body in the scene. One state is different. While the page holds and the capture root stands in for the page copy, as it does for a focused field before a crossing, the capture root holds the color. The crossing switches it to `transparent` and repaints. With `transparent` in that state, a lift with a focused field showed the page behind the card for 4 frames (m2, native path, 2026-11-26).

Five cases were read frame by frame on the native path and on snapDOM: the page, a color change in the scene, a lift, a lift with a focused field, and a return followed by renderer loss. No frame showed the page behind a card.

A page downloads finish code only for the finishes it shows. The base material, the lights and the bakes load as one chunk when the first finish mounts. Film, sheen, scatter, crackle and each relief kind are a chunk each, loaded when a finish first uses that layer. Coat and anisotropy switch on lobes three already ships, so they stay in the base. Loaded with the page, the finish code put the surface payload entry 7.2 kB gzip over its limit (CI run 45931452698, 2026-11-26). Deferred, that entry measured 535,749 bytes against a limit of 537,833 (m2, 2026-11-26).

A finish's first frame waits for its code and for what it reflects. Its material is held until every chunk its layers need has loaded and the rig has baked the environment it uses, so the card keeps its page look meanwhile. A finish that gains a layer keeps drawing its current material until that layer's chunk loads. Its environment map and side are written at commit, so the build #76 starts sees them and the material compiles once. Before its first frame, a finish pays for loading its code, the node build, the held compile, one PMREM bake per environment kind the canvas uses, and for a softbox key, the LTC load.
