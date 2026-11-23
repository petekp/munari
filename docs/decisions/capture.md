# Decisions: capture and paint

Rules for turning DOM content into textures: capture engines, alpha, density, storage and pacing. Code cites each rule as `decisions.md #N`; the [index](../decisions.md) maps every number to its file.

<a id="5"></a>

## #5 — Every DOM-sourced texture is premultiplied

Every texture made from a DOM source uploads with `premultiplyAlpha = true`, and every material that samples one blends premultiplied. Built-in materials use their premultiplied output flag. Custom node materials treat sampled rgb as already multiplied by alpha and blend `One / OneMinusSrcAlpha`. The binding sets the flag, and the kernel's contract requires it.

A 2D canvas backing store is already premultiplied, so this path needs no conversion and filters linearly. A straight-alpha upload bleeds white into edges. Lit standard materials on partly transparent Surfaces are unsupported. Opaque Surfaces are unaffected, because both alpha forms are identical at alpha 1.

<a id="12"></a>

## #12 — The capability check runs before a source is built

`createDomTextureSource` asks the installed capture engine whether it can run before building anything, and throws `UnsupportedPlatformError` when it cannot. A refused source owns no DOM, so no parked canvas is left in `document.body`. An app shows its unsupported-browser message before it mounts a Canvas, because an error thrown inside the React tree unmounts the whole tree. `detectHtmlInCanvas()` reports the two-part support check, and test harnesses stub both the canvas and the context half of the trial.

<a id="13"></a>

## #13 — A source adopts an unparented element and returns it on dispose

`createDomTextureSource` takes `string | HTMLElement`. Markup is parsed. An element is adopted only if it has no parent. A parented element is refused with a message naming `cloneNode(true)`, because `appendChild` would silently tear it from the consumer's page. Refusal happens before construction (#12), so the consumer's tree is untouched. `dispose()` returns the node unparented, exactly as it arrived, so React StrictMode can adopt the same node twice and no canvas leaks.

<a id="14"></a>

## #14 — GPU storage is reallocated by comparing sizes at upload

A Surface decides at upload time whether its GPU texture needs new storage. `uploadNeedsRealloc` in `packages/core/src/paint/textureStorage.ts` compares the canvas about to upload with the size the storage was allocated for. Nothing schedules a reallocation after a resize. Three allocates immutable storage once, so a shrink lands in one corner of the stale texture and a grow is rejected by the driver, with no JavaScript error either way. A comparison has nothing to re-arm, so a continuous resize cannot outrun it.

<a id="15"></a>

## #15 — The backing store floats inside a density band and is cut exact at rest

A capture canvas is not re-cut on every resize. `storeForBox` keeps the current store while its density (store size over box size, per axis) stays within a factor of 1.4 of the requested density. It cuts a new store only when an axis leaves that band. The CSS box always follows the layout exactly.

Writing `canvas.width` clears the canvas, and the refill lands after the frame that asked (platform.md #12). A store cut every frame would upload a blank canvas every frame. After eight quiet frames, `resettle()` cuts the store exact so a resting Surface stays crisp. A re-cut copies the old raster into the new store before the repaint, so no blank frame shows.

<a id="21"></a>

## #21 — The kernel owns the density laws, and no store exceeds the texture limit

Scenes compute texel demand with the kernel's `texelDemand` instead of copying it. Flight's schedule and supply laws (`densityScheduleStep`, `densitySupply`) live beside Flight (#32) and map its gesture modes onto two flags, `returning` and `frozen`.

`MAX_TEXTURE_EDGE` (4096) is the one texture edge limit. Callers cut a requested density with `clampScale` over both axes. `createCaptureCanvas` grants each density request against the current box, so no store edge exceeds the limit, and grants again when the box or request changes. `scale()` and `rasterScale()` report the granted density.

<a id="22"></a>

## #22 — The kernel owns the pixel-grid phase law

A Surface texture is a capture of its own box, so its texel grid is the Surface's pixel grid. A Surface origin off the display's pixel grid blurs all of its text: an offset of 0.16 px cut edge energy to 0.841 of the native HTML. `pixelGridSnap` in `packages/core/src/mapping/pixelGrid.ts` pins the top-left corner to a whole device pixel and the projected footprint to the texture's exact texel count.

Consumers apply the snap where they use the pose, never to the source trajectory. The consumer decides when the Surface is at rest, and tilt stays with the consumer. `npm run probe:sharpness` checks sharpness against native HTML.

<a id="36"></a>

## #36 — Another material can sample a Surface that has only a source

`useSurfaceTextureOf(handle, part?)` returns another Surface's `THREE.Texture`, or null before that Surface's runtime exists. It never throws, so a material can mount first and bind later. The sampled Surface needs only content and a size. With no presenter it still captures, uploads and versions its texture, and its `ready` stays false, because readiness describes registered presenters. The runtime keeps one texture for its life, so the result is reference-stable and safe for `useSyncExternalStore`. A sampled Surface has no mesh, so it gets no pointer routing. `surfaceContext.test.ts` and `gate:refraction-arriving` pin this.

<a id="44"></a>

## #44 — Native text clarity is the default

The renderer follows the native device pixel ratio unless the caller sets a limit. Captures start at native density and follow display and browser-zoom changes. Each source tracks density per axis: `scale()` reports the larger axis and `rasterScale()` reports both. Presenter demands combine by the maximum on each axis. The source runtime allocates mipmaps only for a pinned resolution or a capture at half scale or less. A density change cuts the requested backing size exactly; the band in #15 applies only to layout changes.

Flat, stationary, directly mapped Surfaces get the pixel-grid correction (#22) in their render matrix only. Physics poses stay exact, and moving or warped geometry stays unsnapped. Stationary text keeps 0.95 to 1.05 of native edge energy over the same content and crop (`probe:sharpness`, `probe:postcard-sharpness`, `probe:scene-sharpness`).

<a id="48"></a>

## #48 — Resize invalidation, lit sampling and release velocity

A capture resize invalidates immutable GPU storage when the size changes, never at the next frame. The source keeps its texture identity and the last complete raster.

Lit materials filter premultiplied sRGB channels before they remove alpha and decode for lighting. A lit-only texture view reads the capture canvas in encoded form, with its own GPU storage.

Pointer release velocity applies the 0.35 sampling filter once per missing sample, using the preceding event interval as the period. A pause drains momentum, and an immediate flick keeps it.

<a id="60"></a>

## #60 — Capture is an engine, and the binding never asks which one

One capture engine is installed per document. HTML-in-canvas is the default. `@petepetrash/munari/snapdom` is opt-in: `enableSnapdomCapture()` installs snapDOM only where HTML-in-canvas is missing, and `{ always: true }` forces it. `SurfaceStatus.engine` names the active engine.

The binding talks only to `DomTextureSource`. `host` is the node that holds the parked subtree, and `setHostPainted` shows or hides the host's pixels in the engine's own way. A source starts hidden. A rasterizer takes a per-axis scale and blits at natural size. `DomPaintReceipt.changesDuringPaint` counts changes that landed during an asynchronous raster. Only a source whose draw can trail its paint (`drawTrailsPaint`, true for HTML-in-canvas) gets a second upload.

A rasterizing engine captures once per request, at most every 150 ms (`CAPTURE_GAP_MS`, measured from the end of the last capture). A draw that fails throws, and the last good receipt stays current. Captures do not share one global first-in, first-out queue, which froze dragging in 26 of 33 screenshots.

<a id="62"></a>

## #62 — snapDOM pays for fonts once and paces a live source by a period

snapDOM's own font pass is off (`embedFonts: false`). `snapdomFonts.ts` supplies the faces a subtree uses, from `@font-face` text encoded once per document. It reads each stylesheet, including `@import` and cross-origin text, and warns `munari-font-sheet-unreadable` once for a sheet it cannot read.

The plugin yields one animation frame between clone and serialize. Encoding fonts once, the frame split and the live period ship together. Encoding fonts once by itself raised blocked time in Safari Low Power Mode from 163 ms to 396 ms per 4 s. All three together cut it to 115 ms.

A live source starts a capture at most every 250 ms (`LIVE_PERIOD_MS`, measured from the start), and the longer of this period and the gap in #60 applies. A hover is captured after the pointer rests for 100 ms (`HOVER_SETTLE_MS`), and only if the hover chain changed.

`isolatedTextInputs` opts declared text fields into region capture, which redraws only the field's border box. Focus, layout, density, effect and resource changes take a full capture, and so do unrelated content, fractional density or origin, transformed or filtered ancestors, and `live` sources. A region keeps the HTML viewport at full size and zero origin, and crops only through the SVG `viewBox`. The CPU clip extends 1 CSS px beyond the focus ring.

On CPU-backed canvases, a field's text is drawn with Canvas 2D only after a test canvas reproduces the accepted field's pixels exactly. GPU-backed canvases keep the SVG path, because the readback raised input latency. A complete bitmap is reused only when the input event version also matches. Each retained background bitmap is capped at 8 MiB of RGBA pixels, or 16 MiB while a replacement is pending. The region adapters (`snapdomInputRegions.ts`, `snapdomFullBackground.ts`) always return a complete image to core and fall back to a full capture on output they do not recognize.

<a id="64"></a>

## #64 — What a texture follows, and where `live` applies

Without `live`, a texture keeps its picture until a reason to repaint arrives, on every engine. Engines differ in cost and pacing (#60, #62), not in what they follow without `live`.

`PAINT_EVENTS` in `inputWindow.ts` lists the reasons that count whatever `live` says: user input on the content, scroll, a font or image loading, a transition or animation starting or ending, a resize, and an explicit `repaint()`. The middle of an animation is not a reason. A painted host outranks `live` (#63). A scroll that `restoreScroll` caused is not a reason. A failed native paint keeps pending explicit requests for the next compositor callback.

A Surface part's `live` takes effect only on an engine whose `CaptureEngine.honorsSurfaceLive` is true. HTML-in-canvas sets it, because following content costs one compositor paint per change. snapDOM does not, because each of its captures is a full raster that a live part would repeat at the #62 period. On snapDOM a live part is built and published as not live, so a canvas holding it holds its motion (#66) and `useFreezeSurface()` turns true (#67). Content that must change in the scene on every engine calls `useSurfaceRefresh()`.

The source host reads the field from the engine that built the part's source. A later `setCaptureEngine` leaves existing parts on their engine's answer, and a part built afterwards publishes the new engine's answer. A custom engine must set the field. `useElementCapture` and `CaptureContent` keep `live` on every engine, because their texture is their only display.

On snapDOM, the lab scenes that declare `live` on a Surface hold still in the scene: Refraction, Gallery, Optics, Workspace and the analyze candidate. Genie declares `live` on quadrato, cerchio and scheda, drops it while a window rests in the dock, and takes it back when a restore flight starts.

`captureEngines.test.ts` runs the law over both engines. An untouched Surface with a CSS keyframe costs 1 capture in 3 s, against 361 when the native engine followed every frame. `SurfaceRoot.test.tsx` checks that a live part is built and published live only on HTML-in-canvas. Measured 2026-11-21 in headless Chrome 157 at 60 Hz: a live Genie window on HTML-in-canvas moved on every frame the canvas held it, and on snapDOM it was frozen on every held frame and took 3 to 5 captures. At each swap the capture is one frame behind the content, about 0.5 CSS px of a mark's motion. Three live Genie windows added 12 to 16 ms of main-thread work a second at 1x CPU, with the frame rate unchanged at 60. Docked, they painted as often and showed nothing, which is why Genie drops `live` there.

<a id="74"></a>

## #74 — Capture canvases use CPU storage on a software GPU

On a fallback adapter (`adapter.info.isFallbackAdapter`, as SwiftShader reports), capture canvases take CPU storage (`willReadFrequently`). Chrome copies a GPU-backed 2D canvas into a WebGPU texture by reading it back, which waits for every queued GPU frame: 299–564 ms per upload on a hosted SwiftShader runner, against 0–6 ms with CPU storage. Real GPUs keep GPU storage.

A context's storage is fixed at creation, so the kernel asks for the adapter at the first capture, before any capture canvas takes its context. An HTML-in-canvas paint that arrives first is skipped and repainted, and a snapDOM raster waits. After 3 s (`ADAPTER_WAIT_MS`) without an answer, captures take GPU storage.
