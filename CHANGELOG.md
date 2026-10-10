# Changelog

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
