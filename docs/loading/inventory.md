<!-- review-gate author: claude-opus-5-5 -->
# Loading inventory

Status: measured on 2026-11-26 at `f844db5`. This page lists the steps found in the code
between a page request and a Munari effect drawn in full, as it runs
today. [Measurements](measurements.md) gives each step's cost.

Each row names its owner. "Library" is `@petepetrash/munari` and its
kernel, `@munari/core`. "Lab" is `apps/lab`, which stands in for an app.
Under the finish API proposal, which is unbuilt, the finish rows would
move from the lab into the library ([materials API](https://github.com/petekp/munari/blob/materials-api/docs/materials-api/relationships.md)).

## Page

| Step | Owner | What waits on it | Code |
|---|---|---|---|
| The opening cover. A white cover with the logo shows before the bundle runs, unless the URL has `framed` or `bare`. After 10 s it offers a reload | Lab | Everything the visitor sees | `apps/lab/index.html:20-31`, `:71-78` |
| The app bundle, and a top-level `await` of the snapDOM engine when the capture mode asks for it | Lab | The first React render | `apps/lab/src/main.tsx:19-20` |
| The scene's code chunk, loaded by `React.lazy` | Lab | The scene's first render | `apps/lab/src/App.tsx:21-40`, `demoPages.ts` |
| Web fonts: six `<link rel=preload>` faces with `font-display: block` | Lab | Text paint, and every capture of text | `apps/lab/index.html:62-67`, `public/fonts/fonts.css` |
| The scene components chunk. `SurfaceCanvas` imports `surfaceSceneComponents` on first use; a declaration outside a canvas suspends until it loads | Library | The canvas's first render | `surfaceSceneLookup.tsx:65` |

## Renderer

| Step | Owner | What waits on it | Code |
|---|---|---|---|
| `requestAdapter` to read the adapter's texture limit | Library | Creating the renderer | `SurfaceCanvas.tsx:132-140` |
| `new WebGPURenderer` and `renderer.init()`, which requests an adapter and a device again | Library, three | Every draw | `SurfaceCanvas.tsx:199-201` |
| Prebuilding the two mipmap pipelines (decision #76), with the blocking call | Library | The canvas's first render | `SurfaceCanvas.tsx:209`, `surfaceMipmapPrebuild.ts` |
| A start failure | Library | `RendererStartBoundary` reports it; the canvas renders nothing and its `fallback` shows | `SurfaceCanvas.tsx:160-192` |

## Capture

| Step | Owner | What waits on it | Code |
|---|---|---|---|
| Choosing capture memory: one more `requestAdapter`, capped at 3 s, to detect a software adapter | Kernel | The first paint of every source, with either engine | `domTextureSource.ts:458-490`, `htmlInCanvas.ts:175`, `rasterizedSource.ts:349` |
| html-in-canvas: `drawElementImage` inside the canvas's `onpaint` | Kernel | The first texture | `htmlInCanvas.ts:205` |
| snapDOM: fetching and encoding each font face as a data URL | Library | The first capture that uses the face | `snapdomFontEncoding.ts` |
| snapDOM: a warm-up decode that paints each new face before the capture image decodes | Library | The same capture | `snapdomFontWarmup.ts` |
| snapDOM: serializing the subtree, then decoding it as an image | Library | Every capture | `snapdom.ts` |
| snapDOM: fetching a stylesheet to find its font faces | Library | Font encoding | `snapdomFonts.ts:153` |
| snapDOM: the input-region chunk, imported when the subtree holds a form field | Library | That Surface's captures | `snapdom.ts:358` |
| Uploading the capture: `copyExternalImageToTexture` or `writeTexture`, then mipmaps | Library, three | The first draw that samples it | `domTextureSource.ts` |

## Scene build

| Step | Owner | What waits on it | Code |
|---|---|---|---|
| A node build: three turns each material into shader code. Per Surface, because each material has its own capture texture and uniforms | three | The material's first draw | three `Nodes.getForRender` |
| Holding a presenter's first material hidden until `compileAsync` on stand-in clones has built its pipelines | Library | The presenter's first visible draw | `surfaceCompile.ts:123`, `:286`; `SurfaceMesh.tsx:312`, `:1237` |
| `Surface.Prewarm`: building pipelines before any presenter mounts | Library, opt-in | Nothing; it fills three's cache | `SurfacePrewarm.tsx:89-95` |
| A pipeline three meets at a draw with none cached. three r186 calls the blocking `createRenderPipeline`; Dawn compiles it on the GPU process's main thread | three, Dawn | That frame, and every GPU task queued behind it | decision #76 |
| Light's own renderers: three `WebGPURenderer`s, each with its own adapter and device requests | Lab | Light's lamp and shadows | `light/LightLamp.tsx:320`, `:491`, `light/lightHeadlineTreatments.ts:36` |
| Light's relief worker, a module worker | Lab | The relief texture | `light/LightLamp.tsx:147` |
| The shell logo's WebGL scene, imported lazily. When it loads relative to the scene was not measured | Lab | The animated logo | `components/MunariLogo.tsx:32` |
| A material replaced after its first draw. `useSurfaceCompiled` holds only the first material, so a later one builds at the draw | Library | That frame | `surfaceCompile.ts:277-285` |

## Finishes and lighting

These are lab code at `f844db5`. The finish API proposal would move them
into the library.

| Step | Owner | What waits on it | Code |
|---|---|---|---|
| Softbox lookup tables. A static import, filled at module evaluation; 103 kB gzip | Lab, later library | The finish module's evaluation | `materialFinishesStudio.ts:39-43` |
| Environment bake: `PMREMGenerator.fromScene` once per environment kind, after `gl.init()`. Its pipelines build with the blocking call | Lab, later library | Reflections | `MaterialFinishes.tsx:112-145` |
| Assigning the baked environment, in the card's before-draw callback, with `needsUpdate` on the same material, after the stand-ins were cloned. Its first visible draw builds again | Lab | The finished look | `MaterialFinishesSurface.tsx:172-174` |
| Changing a finish: a new material, so a node build and possibly a new pipeline | Lab, later library | The next frame | `MaterialFinishesSurface.tsx` |
| Knobs: an equirectangular environment baked from a 2D canvas, again whenever its tuning changes | Lab | Knob reflections | `knobs/Knobs.tsx:310`, `:475` |
| Light: a `RoomEnvironment` bake | Lab | The lamp's reflections | `light/LightLamp.tsx:522-523` |

## Handoff and reveal

| Step | Owner | What waits on it | Code |
|---|---|---|---|
| The lift: the page presentation hands the Surface to the scene once a qualified draw of the current capture exists (decisions #65, #68) | Library | The scene presentation | `surfaceHandle.ts` |
| Bench's reveal: `onReady` after `document.fonts.ready` and one frame, before the scene has drawn | Lab | Removing the cover | `FinishDemoStage.tsx:133-136`, `App.tsx:271` |
| Catalog demos, such as Knobs and Light, load in an iframe. The shell removes its cover on the iframe's `load` event | Lab | Removing the cover | `App.tsx:399-405`, `components/siteOpening.ts` |
| Light's own opening: fonts, then graphics, with a 4 s deadline before it settles on native controls (decision #57) | Lab | Light's `data-page-ready` | `light/lightOpening.ts:8` |

## What the inventory shows

- A page with one `SurfaceCanvas` requests the adapter three times: for the texture
  limit, inside `renderer.init()`, and once per page for capture memory.
  Each request is answered by the GPU process, behind whatever it is doing.
- Nothing waits for an environment bake. A finish card's async
  stand-ins are cloned before its before-draw callback sets the finish
  values and environment map. So the card's first visible draw builds its
  pipelines again with the blocking call (see
  [measurements](measurements.md#why-the-cards-arrive-late)).
- The reveal is the app's choice, and the lab makes three different ones.
  None of them waits for the scene presentation.
- Pipelines built after a presenter's first draw block the GPU process.
  The library holds only first materials hidden, so later builds show as
  stopped frames.
