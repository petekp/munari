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

A custom material returns color through `premultipliedOutput` (premultiplied linear) or `encodedOutput` (premultiplied sRGB), and added light comes from blend factors. A translucent material sets `premultipliedAlpha: true`. The canvas holds premultiplied sRGB, so a material that samples it divides out the alpha and decodes each sample before using it. Stock transmission reads the canvas as linear and draws too bright: over sRGB (40, 101, 180) it drew (110, 169, 219), one extra encode. The glass finish decodes its samples (#80). `registry/glass/` renders the scene into its own render target and samples that.

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

A finish material blends premultiplied (#5) and follows the mesh's `transparent`. On a transparent mesh it blends and writes no depth. On an opaque mesh it writes depth and blends nothing, as the default material does. Drawn transparent on Optics' opaque meshes, it lightened the specimens' 1 px outlines by about 33/255 (m2, 2026-11-26).

The canvas owns the lights. `lighting` on `SurfaceCanvas` places one key, one rim and one environment. They reach finish materials only, through `material.lightsNode`, so the scene's own materials and lights are untouched. Under `lighting="none"` a finish is lit by the scene's own lights. three's WebGPU renderer reads a light's uniforms once per frame, so every finish on a canvas sees the same lights. On one shared set of lights, cards whose rigs differed all drew under the rig that placed the lights last (m2, 2026-11-26). A finish that wants more or less light scales it in its own shader with `lightGain`. The default key is a point light. A key given a `size` is a softbox, which loads its LTC tables on first use: three's tables as 64 × 64 half floats, 37 kB gzip against three's 102 kB, with a largest screen difference of 5/255 ([softbox size](../softbox-size.md)).

`createSurfaceLight()` holds the key's position in client CSS px. Each canvas converts that position with its own camera when it draws. So one handle lights several canvases, and moving it needs no React render. A move cost 0.9 ms of main-thread time above idle, against 3.8 ms for a React state update at the page root (m2, three Surfaces, `docs/materials-api/light-control.md`).

A finish with a `color` paints the body in the scene. Munari writes the color as `--munari-body` on the page element, which renders on the server. It writes `transparent` on the capture root. Content whose background reads the property shows the color on the page and the lit body in the scene. One state is different. While the page holds and the capture root stands in for the page copy, as it does for a focused field before a crossing, the capture root holds the color. The crossing switches it to `transparent` and repaints. With `transparent` in that state, a lift with a focused field showed the page behind the card for 4 frames (m2, native path, 2026-11-26).

`probe:finish-body` records five cases on the native path and on snapDOM: the page taking over, a color change in the scene, a lift, a lift with a focused field, and a return followed by renderer loss. No recorded frame showed the page behind a card (m2, 2026-11-26).

A page downloads finish code only for the finishes it shows. The base material, the lights and the bakes load as one chunk when the first finish mounts. Film, sheen, scatter, crackle and each relief kind are a chunk each, loaded when a finish first uses that layer. Coat and anisotropy switch on lobes three already ships, so they stay in the base. Loaded with the page, the finish code put the surface payload entry 7.2 kB gzip over its limit (CI run 45931452698, 2026-11-26). Deferred, that entry measured 535,749 bytes against a limit of 537,833 (m2, 2026-11-26).

A finish's first frame waits for its code and for what it reflects. Its material is held until every chunk its layers need has loaded and the rig has baked the environment it uses, so the card keeps its page look meanwhile. A finish that gains a layer keeps drawing its current material until that layer's chunk loads. Its environment map and side are written at commit, so the build #76 starts sees them and the material compiles once. Before its first frame, a finish pays for loading its code, the node build, the held compile, one PMREM bake per environment kind the canvas uses, and for a softbox key, the LTC load.

<a id="80"></a>

## #80 — A glass finish samples the canvas once per render, decoded

Glass is the `transmission` layer of a finish: `{ amount, thickness, dispersion }`. `amount` of the body's light passes through, showing what the canvas drew behind the Surface. The face's normal bends it, `roughness` frosts it, and `dispersion` (20 / Abbe number, as in KHR_materials_dispersion) splits it by color. `color` is the tint: the share of white that passes through the flat face of a slab `thickness` CSS px deep. A longer path through the bevel deepens it (Beer–Lambert, as in KHR_materials_volume). The tint is the body color because glass's color is the light its body absorbs. A separate tint field would leave `color` with no meaning on glass. `--munari-body` is written as for any finish.

The backdrop is one copy of the canvas per render. Every glass material on a canvas samples the same `viewportTexture()`, and three copies it at the first glass draw. So it holds what drew before that draw. A glass sees only what draws before it: the lab draws its backdrop Surface first and gives the glass cards `renderOrder={1}`. A glass that draws later than another glass is not in the copy. A glass finish blends and writes no depth on any mesh, opaque or transparent, because where the canvas behind it is empty the page shows through it (#79). Over an empty canvas the page behind the canvas shows through unbent, dimmed by the tint's luminance. The page's share passes through the blend, which also passes the canvas directly under the glass, unbent. Where a bent ray lands on empty canvas over a drawn pixel, that pixel shows unbent. Partly covered pixels pass about (1 − coverage)² of the page instead of (1 − coverage). The lab's opaque backdrop shows neither.

Each sample divides out its alpha and decodes from sRGB (#72). With `thickness: 0`, `ior: 1.0001`, white and no lights, the glass drew the backdrop exactly: 0/255 difference over 4 × 6,600 px. With the decode removed it differed by up to 72/255 on every pixel (m2, 2026-11-26).

The copy has no mipmaps. three builds the mipmap pass for the canvas format, `bgra8unorm` on macOS, with the blocking `createRenderPipeline` at first use. That is the freeze #76 removed. A blur drawn in its own render would run before the copy it reads, because three submits a nested render's commands first. So frost is 8 taps on the full-resolution copy, on a golden-angle spiral that each pixel turns by its own angle. Eight sharp copies of the backdrop become grain. Dispersion spreads the taps' IORs over a spectral ramp. A finish draws one tap when its blur is under 0.35 CSS px and it has no dispersion.

`registry/glass/` stays separate. It is a compositor that owns its render targets and pass order, so overlapping panels see each other and merge. The finish is one draw in a mesh's material slot. It takes the compositor's approach, not its code: the eye ray refracted through the bevel normal, and the spectral tap loop.

Transmission loads as its own layer chunk (#79) the first time a finish with the layer mounts. The built module in `packages/react/dist` is 1,821 bytes gzip. With it, the gate's eager `surface` entry grew by 62 bytes, from 535,775 to 535,837 (limit 537,833), and its deferred code by 1,601 bytes (m2, 2026-11-27).

Cost on m2 at 1440 × 900, DPR 2, with a full-screen backdrop Surface. The frame time is wall-clock: 30 back-to-back renders, each awaited to `onSubmittedWorkDone`, so it counts CPU encoding and GPU work together. Each page load takes the median of 6 such batches. The table gives the median of 3 page loads, with the lowest and highest load, in ms per frame:

| Cards | `polymer-charcoal` | `glass-clear` | `glass-cobalt` | `glass-frosted` | `glass-crystal` |
|---|---|---|---|---|---|
| 1 | 0.39 (0.39–0.43) | 0.62 (0.62–2.32) | 0.71 (0.67–0.73) | 0.68 (0.68–0.69) | 0.73 (0.70–0.76) |
| 4 | 0.71 (0.59–0.73) | 0.87 (0.87–0.92) | 0.91 (0.86–0.93) | 1.10 (1.09–2.26) | 1.07 (1.06–1.10) |
| 12 | 1.19 (1.18–1.21) | 1.57 (1.54–1.64) | 1.60 (1.54–2.12) | 2.19 (2.19–2.19) | 2.15 (2.10–3.65) |

Differences under about 0.1 ms are within the spread between loads, and a single load can run far slower than the others. `glass-clear` and `glass-cobalt` draw the same one-tap shader. The eight-tap presets, `glass-frosted` and `glass-crystal`, cost about 1 ms more than `polymer-charcoal` at 12 cards. The glass presets use the `gradient` environment and `polymer-charcoal` the `even` one, so the gap also holds the environment's cost.

The copy is one `bgra8unorm` texture the size of the drawing buffer, 2880 × 1800 here (20.7 MB), counted from the WebGPU device's `createTexture` calls. three's `info.memory` counts it at 4 bytes, the size it had when created.

A glass page made one more `createRenderPipeline` call than a `polymer-charcoal` page, for `MeshBasicMaterial`. A `lacquer-crimson` page, which also uses the `gradient` environment, makes the same call, so it belongs to that environment (#79), not to transmission. Timing the call cannot show how long it blocks, because Dawn compiles on the GPU process. The slowest asynchronous pipeline build per page load took 39.8–73 ms for glass and 20.2–81.5 ms for `polymer-charcoal`. From navigation to a card's first frame, which now includes loading the finish chunks, took 1.38–1.73 s for glass and 1.45–1.65 s for `polymer-charcoal` (3 cold browsers each).

The page copy cannot bend what is behind it. The lab paints it with `color-mix(in srgb, var(--munari-body) 55%, transparent)`, so it reads as tinted glass. Content painted with the opaque `var(--munari-body)` shows a solid slab on the page and glass in the scene.
