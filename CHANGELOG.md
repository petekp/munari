# Changelog

## Unreleased

- Replace the duplicated-content Surface API with retained HTML: `Surface`
  accepts `inScene`; explicit composition uses Root/HTML/Scene/Mesh. Add
  SceneSurface, element capture, page targets, and before-render companions.
- Name the canvas selector `canvasId`; SurfaceCanvas keeps its `id`.
- Preserve native text density, state, focus and input through handoffs, and
  correct texture allocation, alpha filtering, interrupted gestures and demo
  control behavior.
- Consolidate the current guides and remove superseded plans, duplicate anchor
  recipes, unused helpers, and obsolete probe adapters.
- Add snapDOM as a second capture engine behind `@petepetrash/munari/snapdom`,
  and a `live` prop on `Surface`, `Surface.HTML`, `SceneSurface`,
  `SceneSurface.HTML` and `CaptureContent`: on snapDOM a Surface follows the
  user's input on its content by default and follows content that changes on
  its own only when `live`; HTML-in-canvas follows everything and ignores it.
  `useElementCapture` rebuilds its copy by the same rule on either engine, with
  `live` and `refresh()` as the ways back in.
- Make a snapDOM capture cost a third of the main thread it did, with no
  option to set: the faces a capture needs are read from every stylesheet the
  document has, from any origin, encoded once and supplied to every clone; the
  clone and the serialize are split across a frame; and a `live` Surface
  re-captures at most about four times a second, so the cheaper capture is not
  spent on more captures. A hover is captured
  once the pointer settles on it, so crossing a Surface no longer captures.
- Stop restarting the scene clock on every capture: `SurfaceCanvas` asks R3F
  for a frameloop mode only when the mode changes, so a scene posed from
  `clock.elapsedTime` no longer snaps back while the user types in a Surface.

Versioned entries below describe their released interfaces, not the current
development API. Use the README and exported types for this checkout.

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
