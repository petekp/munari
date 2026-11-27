# Changelog

## Unreleased

Upgrading from 0.5.x: a visible scene mesh in front of a Surface now takes the
pointer, so a click on a prop no longer reaches the HTML behind it. Give a
prop that should let the pointer through, such as a shadow plane, a no-op
`raycast`.

### Added

- `finish` on `Surface`, `Surface.Root`, `SceneSurface` and
  `SceneSurface.Root` gives the Surface's mesh a lit physical material: a
  body color, roughness, metalness, and optional coat, sheen, anisotropy,
  thin film, scatter, surface relief and crackle layers. A finish is plain
  data, so page code builds it before any canvas mounts. Adding or removing a
  layer rebuilds that Surface's material; changing a value does not.
- `lighting` on `SurfaceCanvas` sets the key light, rim light and
  environment that light every finish on the canvas. The default,
  `"studio"`, has a point key. `"none"` turns the lights off. These lights
  light finishes only, so your scene's own lights and materials are
  unaffected.
- `createSurfaceLight()` returns a handle that moves the key light without a
  React render, from code with `set()` or by following the pointer.
- A finish with a `color` sets `--munari-body` on the page copy and
  `transparent` in the capture. Content that styles its background with
  `var(--munari-body)` shows the color on the page and the lit body in the
  scene.
- `registry/finishes` holds 17 finish presets and a suggested text color
  for each, to copy into a project.

### Breaking

- `Surface.LitMaterial`, `SceneSurface.LitMaterial` and
  `SurfaceLitMaterialProps` are removed. Give the Surface a `finish` instead.
  `finish={{ color: null }}` lights the whole capture as `LitMaterial` did.
  To light it with your scene's own lights, as `LitMaterial` was, pass
  `lighting="none"` to the `SurfaceCanvas`.
- In your own R3F `Canvas`, outside a `SurfaceCanvas`, `Surface.Mesh`,
  `Surface.Prewarm` and `Surface.Anchor` now suspend
  the first time they render, while Munari loads its scene code. Wrap that
  `Canvas` in a `Suspense` boundary. A failed load reaches the nearest error
  boundary. Inside a `SurfaceCanvas`, nothing changes.
- A Surface no longer hears the pointer where a nearer visible mesh that is
  not a Surface covers it. This applies with `pointerMode="scene"` and
  `pointerMode="surfaces"`, and on the native route with
  `pointerRoute="auto"`. On the native route the binding checks the pointer
  each frame and on every move and press, and parks the lifted canvas before
  the press so the browser's click goes to the scene. A touch or pen tap with
  no move before it goes to the scene too, and its click is dropped. Only
  meshes on the R3F raycaster's layers block. Hidden meshes, hits on a
  material or material group with `visible: false`, the Surface's own
  descendants, exactly coplanar meshes, meshes with a no-op `raycast`, and
  `Points`, `Line` and `Sprite` objects never block (decisions.md #78). A
  transparent mesh still blocks. The R3F handlers that stopped propagation are
  no longer needed to block.
- While the pointer is over a Surface, the scene is raycast out to the
  Surface's distance once per pointer event. It is also raycast once per
  frame in `pointerMode="surfaces"`, on the native route, and for a Surface
  that deforms. In review notes the 36,864-triangle teapot costs 4.3 to 5.3
  ms per raycast, an estimated 9 to 11 ms per frame while the pointer moves. A heavy mesh
  that never needs to block can take a no-op `raycast`.

### Documentation

- The page layouts guide describes which meshes block a Surface and how a
  prop opts out.
- The authoring rules say that `window` pointer listeners need
  `capture: true` to hear the browser's own events while the canvas is armed.

## 0.5.0 — 2026-11-23

Upgrading from 0.4.x: a `Surface.Mesh` no longer freezes the canvas on its
first draw. If you use snapDOM, install `@zumer/snapdom` ^3.8.2. On snapDOM a
Surface now ignores `live`; call `useSurfaceRefresh()` to send a change to
the scene. `supportsSurfaces` and `useSurfaceSupport` are renamed
`supportsCapture` and `useCaptureSupport`, and the old names still work in
this release.

### Breaking

- `@zumer/snapdom` is now `^3.8.2` (was `^3.3.3`), both as the optional peer
  dependency and in the lockfile. The `snapdomDefault` entry grows from 96.2
  to 124.2 kB gzip. Clipped
  input-region captures read the wrapper's `zoom: initial` that 3.8.2 writes
  on pages that do not lay out on the device grid.
- On snapDOM, a Surface ignores `live`. Its content holds still while the
  scene has it, as content without `live` does, and `useFreezeSurface()`
  turns true. HTML-in-canvas still follows a live Surface every frame.
  `useElementCapture` and `CaptureContent` keep `live` on both engines. Call
  the `useSurfaceRefresh()` function when a change must reach the scene on
  snapDOM. The new `CaptureEngine.honorsSurfaceLive` field says which engines
  follow a live Surface, and a custom engine must set it.
- `SurfaceAnchorBox` no longer has `width` and `height`. They were
  the box's share of the source size, which is a local size only on a 1×1
  plane, and during a resize they used the current source size against an
  older painted frame. On the default plane, use `uv.uMax - uv.uMin` and
  `uv.vMax - uv.vMin`. For a size in CSS pixels, use `cssWidth` and
  `cssHeight`.
- `CaptureFrame.anchors` can be `null`, which means the anchors could
  not be matched to the captured snapshot. An empty map still means the
  snapshot has no named anchors. No engine publishes `null` yet, but code that
  reads `frame.anchors` must now handle it.
- `detectHtmlInCanvas()` reports `texElementSubImage2D` instead of
  `texElementImage2D`. Chrome 158 has only the 5-argument
  `texElementSubImage2D`, so the old field was always `false` there. Munari's
  capture path uses neither.
- `@petepetrash/munari/advanced` replaces `passIsWarmUp`, `passPresentsDirectly`
  and `passNeedsHostTail` with `presentationRoute(pass, hasHost)`, which
  returns `'empty'`, `'warm-up'`, `'color-off'`, `'now'`, `'tail'` or
  `'no-host'`. `SurfacePassEvidence` gains a `drawable` field.
- `@petepetrash/munari/advanced` retires six helpers that nothing called
  (`hostTailPresents`, `poseMatrix3d`, `posePoint`, `projectSurfaceAnchor`,
  `stampSurfaceAnchors` and `planeToScreen`) and the types `SurfaceHostTail`,
  `SurfaceAnchorProjection` and `PosePoint`. They have no replacement export.
  `Surface.Anchor`, `useSurfaceAnchorBox` and `useSurfaceAnchorRects` in the
  root entry cover anchoring content to a Surface.

### Added

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
  its shape may change in any release. In development it warns once when its
  canvas does not render with `WebGPURenderer`. Under another renderer every
  transition waits 1 s and then applies its update with no effect.
- `supportsCapture()` and `useCaptureSupport()` are the new names of the
  capability check. It asks whether an installed capture engine can run in
  this browser, which the old names did not say.
- `useSurfaceRefresh()` returns a function that requests fresh captures from
  the enclosing Surface, or from a given handle. Call it when content changes
  in a way the capture engine cannot see, such as drawing on a `<canvas>`.
- `Surface.Prewarm` builds pipelines for presenters that mount later, so
  their first draw waits for nothing. It takes meshes that wear those
  presenters' materials, the `alpha` they use, and an `onReady` callback.
  `SurfacePrewarmProps` is exported.
- `enableSnapdomCapture` accepts `isolatedTextInputs`, a selector for text
  fields whose edits change only pixels inside their own border box. snapDOM
  then replaces just that field's region in the cached capture when its value
  changes. The capture engines guide lists the rules such a field must follow.
- `@petepetrash/munari/advanced` exports `useSurfaceOutput(targets)` and
  `SurfaceOutputHandlers`. A compositor that draws Surfaces into render targets
  attaches the handlers to its final mesh, so the page HTML stays until that
  draw reaches the screen. A draw whose material triggers a nested shadow or
  blur render counts; primitives drawn by the nested render do not.
- `@petepetrash/munari/advanced` exports `restoreScroll(element, top, left)`.
  It sets scroll offsets whose `scroll` event a capture does not take as user
  input or as a reason to capture.
- `@petepetrash/munari/advanced` exports `releasedSample(sample)`, which
  returns a pointer sample with no buttons pressed. It also exports
  `listenForRepaintSignals`, `captureContext`, `captureMemoryChosen`,
  `hasRunningMotion` and the `PresentationRoute` type.
- `@petepetrash/munari` narrows `useSurfaceStatus` to return `SurfaceStatus`
  directly and exports referenced component prop, return, and callback types
  (`CaptureContentProps`, `SurfaceLitMaterialProps`, `SurfaceChromeState`,
  `FocusSceneProps`, `FocusGroupProps`, `Viewport`, `Dir`, `SurfacePartId`,
  and `PointerRouteRequest`).
- The page layouts guide explains that a mesh in front of a Surface does not
  block the pointer by default, and shows the handlers that stop propagation
  on the relay route.

### Deprecated

- `supportsSurfaces` and `useSurfaceSupport` remain as aliases of
  `supportsCapture` and `useCaptureSupport`. They will be removed in the next
  minor release.

### Fixed

- A `Surface.Mesh`, or a `FrameSurface` given a `presentation` requirement,
  no longer freezes the canvas on its first draw. three built each missing
  render pipeline at the draw with a blocking call. With shaders that no
  browser cache held, every frame froze for 183-250 ms, as on Genie's first
  flight. Such a presenter now builds its pipelines asynchronously and first
  draws once they are ready. Until then the content stays where it was. A
  `FrameSurface` without a requirement still draws at once.
- `SurfaceCanvas` builds three's mipmap pass for both texture formats while
  the renderer starts. It used to be built at a Surface's first mipmapped
  upload, which froze the canvas for 85-114 ms.
- Chrome 155 to 157 no longer crash the tab when a Surface sits inside an
  absolutely positioned element with `container-type` and a font face loads
  in the same task. Capture canvases now move with an insert, not
  `moveBefore`, which triggered the crash.
- With snapDOM capture, a text field could show no text after typing a
  character from a font file the page had loaded but no earlier capture had
  used, such as "ł" in a Latin Extended subset. The field stayed blank until
  the next capture. A capture that uses such a font file now first decodes a
  small image carrying it, once per font face per page.
- With snapDOM capture, content whose only text is in form fields embeds the
  fonts those fields use. It used to draw the fields in a fallback font.
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
- A canvas that switches from `pointerMode="surfaces"` back to the scene
  receives pointer input again.
- Input forwarded to a Surface in the scene skips disabled controls. Focus no
  longer lands on a disabled field, and a forwarded `<select>` change skips
  disabled options.
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

Releases 0.4.1 and earlier are in [docs/changelog-0.4-and-earlier.md](https://github.com/petekp/munari/blob/main/docs/changelog-0.4-and-earlier.md).