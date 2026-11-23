# Changelog

## Unreleased

- `supportsCapture()` and `useCaptureSupport()` are the new names of the
  capability check. It asks whether an installed capture engine can run in
  this browser, which the old names did not say.
- Deprecated: `supportsSurfaces` and `useSurfaceSupport` remain as aliases
  of the new names and will be removed in the next minor release.
- Breaking: `SurfaceAnchorBox` no longer has `width` and `height`. They were
  the box's share of the source size, which is a local size only on a 1×1
  plane, and during a resize they used the current source size against an
  older painted frame. On the default plane, use `uv.uMax - uv.uMin` and
  `uv.vMax - uv.vMin`. For a size in CSS pixels, use `cssWidth` and
  `cssHeight`.
- `useCaptureTransition` runs an app update behind a capture of the content it
  changes. `start(target, update, options)` waits until an effect has drawn the
  outgoing capture on screen, then runs the update. Each update runs once, in
  request order. With no effect connected, under reduced motion, or for a target
  outside the document, it runs at once. Every wait is bounded at 1 s.
  `CaptureTransition` is exported.
- `@petepetrash/munari/advanced` exports `useCaptureTransitionEffect`, the canvas
  side of a capture transition, with `CaptureTransitionEffect`,
  `CaptureTransitionRun`, `CaptureTransitionSnapshot`, `CaptureTransitionSide`,
  `CaptureTransitionControls` and `CaptureTransitionRequest`. It is provisional:
  its shape may change in any release.
- A `Surface.Mesh`, or a `FrameSurface` given a `presentation` requirement,
  no longer freezes the canvas on its first draw. three built each missing
  render pipeline at the draw with a blocking call. With shaders that no
  browser cache held, every frame froze for 150-270 ms, as on Genie's first
  flight. Such a presenter now builds its pipelines asynchronously and first
  draws once they are ready. Until then the content stays where it was. A
  `FrameSurface` without a requirement still draws at once.
- `Surface.Prewarm` builds pipelines for presenters that mount later, so
  their first draw waits for nothing. It takes meshes that wear those
  presenters' materials, the `alpha` they use, and an `onReady` callback.
  `SurfacePrewarmProps` is exported.
- `SurfaceCanvas` builds three's mipmap pass for both texture formats while
  the renderer starts. It used to be built at a Surface's first mipmapped
  upload, which froze the canvas for 85-114 ms.

- On snapDOM, a Surface ignores `live`. Its content holds still while the
  scene has it, as content without `live` does, and `useFreezeSurface()`
  turns true. HTML-in-canvas still follows a live Surface every frame.
  `useElementCapture` and `CaptureContent` keep `live` on both engines. Call
  the `useSurfaceRefresh()` function when a change must reach the scene on
  snapDOM. The new `CaptureEngine.honorsSurfaceLive` field says which engines
  follow a live Surface, and a custom engine must set it.
- `@zumer/snapdom` is now `^3.8.2` (was `^3.3.3`), both as the optional peer
  dependency and in the lockfile. The `snapdomDefault` entry grows from 96.2
  to 124.2 kB gzip, all of it snapDOM's own bundle (89.1 to 118.2 kB). Clipped
  input-region captures read the wrapper's `zoom: initial` that 3.8.2 writes
  on pages that do not lay out on the device grid.
- The package now ships one module per source module, so an app that imports
  only some exports bundles only the modules they reach. An app importing
  only `encodedOutput` shrinks from 224.7 to 129.8 kB gzip. The minimal
  `<Surface>` app is unchanged at about 533 kB.
- `@petepetrash/munari/snapdom` loads the input-region rasterizer the first
  time `isolatedTextInputs` content is captured, rather than with the entry.
  `enableSnapdomCapture` is still synchronous.
- A scrolled container inside captured content now keeps its scroll
  position. `useElementCapture` and the copy a Surface captures while its
  content is on the page both showed the container scrolled to the top.
- A Surface shown again by `<Activity>` captures its page copy again. It
  used to capture nothing until its content changed.
- Under StrictMode, a Surface's page copy keeps the scroll offsets its
  content had at mount. StrictMode's second mount used to reset them to 0.
- WebGPU no longer logs "CopyExternalImageToTexture(): Browser fails
  extracting valid resource from external image" when a Surface first
  appears. The capture texture copies nothing until the first paint.
- Every development warning now uses one rule: Vite's `import.meta.env.DEV`
  when it is set, otherwise a `NODE_ENV` of `development` or `test`. The
  `SurfaceCanvas` warnings and the preparation-wait warning used to read only
  the Vite flag, so they stayed silent under Node.
- The package reads `process.env.NODE_ENV` as written, so webpack, Next and
  Vite substitute their own value. Development warnings now print in their
  development builds and stay silent in production builds.
- In development, a `Surface.Mesh` outside the camera view no longer logs
  that it is still waiting for a usable source frame and preparation draw.
  A hidden mesh or a mesh with no source still logs it.
- `@petepetrash/munari/advanced` exports `restoreScroll(element, top, left)`.
  It sets scroll offsets whose `scroll` event a capture does not take as user
  input or as a reason to capture.
- `useSurfaceOutput` now counts a draw whose material triggers a nested
  shadow or blur render. It used to reject any draw during which the
  renderer's call count changed, so such an output mesh never closed its
  frame tail. Primitives drawn by nested renders still do not count.
- `@petepetrash/munari/advanced` exports `releasedSample(sample)`, which
  returns a pointer sample with no buttons pressed.
- `@petepetrash/munari/advanced` replaces `passIsWarmUp`, `passPresentsDirectly`
  and `passNeedsHostTail` with `presentationRoute(pass, hasHost)`, which
  returns `'empty'`, `'warm-up'`, `'color-off'`, `'now'`, `'tail'` or
  `'no-host'`. `SurfacePassEvidence` gains a `drawable` field.
- `@petepetrash/munari/advanced` retires six helpers that nothing called (`hostTailPresents`,
  `poseMatrix3d`, `posePoint`, `projectSurfaceAnchor`, `stampSurfaceAnchors`,
  and `planeToScreen`). They have no replacement export. `Surface.Anchor`,
  `useSurfaceAnchorBox` and `useSurfaceAnchorRects` in the root entry cover
  anchoring content to a Surface.
- `@petepetrash/munari` narrows `useSurfaceStatus` to return `SurfaceStatus`
  directly and exports referenced component prop, return, and callback types
  (`CaptureContentProps`, `SurfaceLitMaterialProps`, `SurfaceChromeState`,
  `FocusSceneProps`, `FocusGroupProps`, `Viewport`, `Dir`, `SurfacePartId`,
  and `PointerRouteRequest`).

## 0.4.1 — 2026-10-10

- A browser with no usable capture engine now says so. `useSurfaceStatus()`
  reports `engine: null` and a `reason` that names the CanvasDrawElement flag,
  the origin trial and `enableSnapdomCapture()`. In development, the first
  Surface asked for the scene logs the same text once.
- The entries that use React start with `'use client'`, so a Next.js server
  component can import `Surface` and `SurfaceCanvas` directly.
- `CaptureContent` with children inside a `SurfaceCanvas` throws an error
  that says to render it in the page tree, instead of R3F's "Div is not part
  of the THREE namespace". The `element` form still works there.
- In development, `SurfaceCanvas` names any object on it whose material uses
  GLSL (a `ShaderMaterial` or `onBeforeCompile`), such as drei's `Text`.
  WebGPURenderer draws those black or unpatched, and Three's own log does not
  say which object.
- `useSurfaceNodes()` and `Surface.LitMaterial` outside a `Surface.Mesh`
  material throw an error naming the hook that was called.
- `Surface.Mesh` accepts a material instance as `material`, as well as an
  element. Only an element can call `useSurfaceNodes()`.
- `Surface.Mesh` no longer accepts `onClick`, which never fired. Use
  `onPointerUp`. `onDoubleClick` and `onContextMenu` still fire.
- The README covers custom node materials, reading status from the
  component that owns a Surface, drawing captured content on a plane,
  Next.js, the inert copy a handoff leaves in the DOM, known console output,
  pinning `three`, and bundle size. The agent skill and `llms.txt` carry a
  working starter.

## 0.4.0 — 2026-10-10

### Breaking

- `SurfaceCanvas` renders with Three's `WebGPURenderer`, which falls back to
  WebGL 2 where no WebGPU adapter exists. Neither backend accepts a GLSL
  material (`ShaderMaterial` or `onBeforeCompile`). The `gl` prop takes
  `WebGPURendererParameters`, such as `antialias`, `depth` and `forceWebGL`.
  Renderer tone mapping stays off; tone-map a 3D material with
  `material.outputNode = toneMapping(mode, exposure, output)`. The `flat` prop
  is gone, and `shadows` no longer accepts `'soft'`.
- Surface materials are TSL node materials. `useSurfaceNodes()` (type
  `SurfaceNodes`) and `surfaceRadiusMask()` replace `useSurfaceUniforms()`
  (type `SurfaceUniforms`) and `SURFACE_RADIUS_GLSL`. A custom `outputNode`
  returns its color through `premultipliedOutput` or `encodedOutput`. A
  translucent material on the canvas sets `premultipliedAlpha: true`.
- `Surface` holds retained HTML instead of two declared copies.
  `Surface.DOM`, `Surface.WebGL`, `Surface.Part` and the `view` prop are
  replaced by the `inScene` prop and, for explicit composition,
  `Surface.Root`, `Surface.HTML`, `Surface.Scene` and `Surface.Mesh`.
- Root entry renames and removals:
  - `useSurface` → `useSurfaceHandle`.
  - `supportsDOMSurfaces` → `supportsSurfaces`, and `useSupportsDOMSurfaces`
    → `useSurfaceSupport`.
  - Removed `useSurfaceState`, `useSurfaceView` and `useSurfaceInstance`.
    Read a Surface's status with `useSurfaceStatus`.
  - Removed types: `SurfaceState`, `SurfaceView`, `SurfaceViewControls`,
    `SurfaceInstance`, `SurfaceTiming`, `SurfaceContentOptions`,
    `SurfaceContentProps`, `SurfaceDOMProps`, `SurfacePartProps` and
    `SurfaceWebGLProps`. `SurfaceMeshProps` replaces `SurfaceWebGLProps`.
  - Removed `surfaceFocusKey` and `surfaceFocusTarget`.
- The canvas selector is named `canvasId`. `SurfaceCanvas` keeps its `id`.
- `@petepetrash/munari/advanced` removes `CROSSING_DEFAULTS`,
  `CrossingTiming`, `createStyleChannel`, `StyleChannel`,
  `StyleChannelOptions`, `ensureChannelRegistered`, `filterPolicy`,
  `FilterPolicy`, `endStops`, `stopsField`, `overCenterField`, `flipImpulse`,
  `partSetComplete`, `partSetForget`, `partSetUnregister`, `rectEquals` and
  `resolveFixedScale`.
- `FrameSurface` drops its `width` and `height` props, which had no effect.
  `SurfaceRenderFrame` types its draw target as Three's `RenderTarget`.
- Peers: `three ~0.186.1`, `@react-three/fiber ^9.8.1`, and the optional
  `@types/three ~0.186.0` and `@zumer/snapdom ^3.3.3`. Three r187 changes
  `DirectRenderPipeline` output, so the range stops before it.

### Added

- snapDOM as a second capture engine, for browsers without HTML-in-canvas.
  Import `enableSnapdomCapture` from `@petepetrash/munari/snapdom` and install
  `@zumer/snapdom`.
- A `live` prop on `Surface`, `Surface.HTML`, `SceneSurface`,
  `SceneSurface.HTML` and `CaptureContent`. On snapDOM a Surface follows the
  user's input on its content by default, and follows content that changes on
  its own only when `live`. HTML-in-canvas follows everything and ignores it.
  `useElementCapture` rebuilds its copy by the same rule on either engine, with
  `live` and `refresh()` to request a new copy.
- `SceneSurface`, element capture (`useElementCapture`, `CaptureContent`,
  `useCaptureHandle`), page targets (`createPageTarget`, `usePageTarget`) and
  `useSurfaceBeforeRender`.
- `SurfaceCanvas` replaces a lost renderer. Surfaces return to the page, the
  `fallback` shows, the new `onRendererLost` runs, and the Canvas remounts on
  a new renderer. It does not remount when the lost renderer was itself a
  replacement created less than 10 s earlier.
- `@petepetrash/munari/advanced` adds the capture-engine API
  (`captureEngine`, `setCaptureEngine`, `htmlInCanvasEngine`,
  `captureAvailable`, `inspectCapture`, `createRasterizedSource`), the
  motion-hold primitives (`holdMotion`, `releaseMotion`, `matchMotion`), and
  `passMaterial`.

### Fixed

- The default Surface material no longer multiplies translucent HTML by its
  alpha a second time. A pixel at alpha 0.5 draws at its page value. The
  built-in `FrameSurface` materials blend premultiplied when `transparent`.
- A snapDOM capture costs a third of the main-thread time it did. Fonts are
  encoded once and shared, the clone and the serialize are split across a
  frame, and a `live` Surface re-captures at most about four times a second.
  A hover is captured once the pointer settles, so moving across a Surface no
  longer captures.
- A Surface inside a rotated or skewed element no longer draws off its page
  position during a handoff.
- The scene clock no longer restarts on every capture, so a scene posed from
  `clock.elapsedTime` does not snap back while the user types in a Surface.
- A copy of a Surface's content resumes its CSS animations at the original's
  time when the original also has a running transition.
- `SurfaceCanvas` falls back to WebGL 2 when the browser rejects its GPU
  adapter request, instead of unmounting the page. With `gl={{ device }}` it
  reads the texture limit from that device, so a source the device cannot hold
  issues no receipts.
- A draw that `scene.overrideMaterial` replaces, such as a shadow-map or
  contact-shadow pass, no longer changes a Surface's write flags or issues its
  receipts. Zero-instance geometry issues no receipts either.
- Native text density, form state, focus and input survive a handoff.

## 0.3.0 — 2026-09-01

- Breaking: replace `SurfaceApp`, the markup-string `Surface`, `useLift`,
  `LiftDriver`, and `commitRendererReleaseFrame` with one `<Surface>` that
  declares both copies (`Surface.DOM`, `Surface.WebGL`, `Surface.Part`,
  `Surface.Anchor`) and a `view` prop that says which renderer holds them.
  There is no compatibility layer, alias, or codemod.
- Breaking: the package root is now curated. The renderer-agnostic core and
  `FrameSurface` moved to a second entry, `@petepetrash/munari/advanced`.
- Add `SurfaceCanvas`, the Surface handle (`createSurface`, `useSurface`,
  `useSurfaceProgress`, `useSurfaceState`, `useSurfaceDriver`), and the
  Surface anchor hooks.
- Breaking: remove Flight-only physics, gestures, texture-density rules, and
  shadow geometry from the package API. They now live beside the Flight lab.
- Breaking: remove the unused animation sampling and conductor timing APIs.
- Breaking: `createSurface` and `useSurface` take identity only (an optional
  `name`) and answer with a `SurfaceHandle`. `view`, `timing` and the
  callbacks are props of the `<Surface>` that presents the handle.
- Breaking: `<Surface>`'s props are discriminated unions — `source` or
  `adopt` or neither, and `surface` or `name`. Passing both no longer
  compiles.
- Breaking: `FocusOrbitRig` and `arcLayout` leave the package; they are
  copyable recipes under `registry/focus-orbit/`. `useCarriedMotion` moves
  to `@petepetrash/munari/advanced`, which also gains
  `surfaceManualPresenter` and `surfaceViewRequest` for a scene that draws a
  Surface's pixels itself.
- Fix: a warm-up pass restores the caller's authored `colorWrite`,
  `depthWrite` and `stencilWrite` after every draw instead of leaving them
  off on the shared material.
- Fix: a presenter that drew into a render target keeps its deferred
  presentation until the frame reaches the default framebuffer, so an
  exclusive handoff completes under post-processing.
- Fix: cross-tree source registrations are keyed by the `<Surface>`
  instance, so two unnamed Surfaces in one Canvas keep their own content.
- Fix: two `<SurfaceCanvas>` under one id report the conflict; the first to
  mount keeps the id and the second renders none of the host's
  registrations.
- Fix: a `<SurfaceCanvas fallback>` is taken down when the WebGL context is
  restored, not only when the Canvas is recreated.

## 0.2.0 — 2026-08-16

- Add `useLift` and `LiftDriver` for evidence-gated DOM/WebGL handoffs.
- Add presentation receipts, caller-owned frame sources, and `CanvasPointerGate`.
- Add carried motion and painted Surface anchors.
- Keep Surface pointer releases alive through R3F's event phase.
- Add the Genie, Knobs, Optics, and Logo labs.
- Add a local lab launcher and concise agent guidance.

## 0.1.0 — 2026-08-04

- Publish the first experimental package.
