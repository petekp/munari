---
name: munari
description: Build and review React interactions that combine retained HTML, Three.js scenes, and shaders with Munari.
---

# Munari

Use the smallest public API that owns the requested renderer relationship.
Munari's tagline is "HTML, 3D, and Shaders, Unified."

## Establish the source revision

Read the consumer's installed README/types or this checkout's README and
`docs/agent-workflow.md`. Historical proposals describe earlier designs; they
are not the current API. The development checkout may be newer than a released
package. Read `docs/authoring.md` before writing captured markup.

Import only `@petepetrash/munari`, its `style.css`, and `/advanced`. A missing
export is a package concern, not a reason to reach into private source files.

## Choose the relationship

- `<Surface inScene={boolean}>` contains one existing HTML/React component.
  Its local state, uncontrolled values, focus, and selection stay on that instance.
  The supplied flat mesh matches the page; motion and visual effects remain
  application code.
- For custom scenes, use `Surface.Root`, `Surface.HTML`, `Surface.Scene`, and
  `Surface.Mesh`. HTML parts have distinct names. Meshes select a part and can
  use named `Surface.Anchor` boxes from its painted generation.
- `SceneSurface` draws HTML that belongs in the scene. Its explicit `size` is
  CSS pixels; the convenience mesh is one world unit high with the same aspect
  ratio. Use its `.Root`, `.HTML`, and `.Mesh` form for custom scene geometry.
- `useElementCapture()` returns a callback ref and frame identity for native HTML
  that stays in place. It can capture an element, body, or html with appropriate
  exclusions. `CaptureContent` supplies separate React children or a detached
  element to a capture handle. It requires explicit dimensions.
- `SurfaceCanvas` owns the renderer, camera, lights and surrounding R3F scene.
  Keep it mounted while needed. Use `pointerMode="surfaces"` for overlays and
  demand rendering when the application has no ongoing animation. Flight must
  keep frames through its own physics even after the handoff settles.

One unnamed canvas is the default. Several hosts need distinct IDs and explicit
page associations. Reusable client components can use `useId`; independent SSR
roots require distinct matching `identifierPrefix` values or document-unique IDs.
A scene-side Surface belongs to its enclosing canvas and rejects conflicting IDs.

Use `usePageTarget` or `createPageTarget` when a retained component returns to
changing React layout parents. Keep its Root at a stable React position; attach
the target ref to the current page slot. A normal fixed-slot handoff needs none.

## Read intent, hold and motion separately

`useSurfaceStatus(handle?)` reports author `requestedInScene`, accepted
`presentation` (`page`, `scene`, or null), `sceneReady`, `isTransitioning`, and
`supported`/`reason`. Callbacks use the same presentation vocabulary; motion
completion and string driver targets use page or scene.

`useSurfaceProgress().get()` and driver inputs are raw 0..1 motion. `.eased()`
is explicitly curved. `useSurfaceDriver(step, handle?)` returns the wanted raw
progress; `useSurfaceMotion(step, handle?)` uses position and a numeric 0/1 target.
The protocol still owns preparation, the actual presentation draw, and release.
Hooks without a handle read the nearest Surface identity across the renderer trees.

`useSurfaceBeforeRender` belongs inside a Mesh. After frame pose writers and
world-matrix updates, it reports the actual draw camera and render target. It
can run several times in one animation frame. Advance physics in the frame step;
update companions in this callback. `canvasMayDraw` is permission for that pass,
not an accepted presentation receipt. Put shared cameras/lights at canvas scope.

An always-declared `Surface.Scene` retains its children through preparation,
reversal, return and cleanup. It does not retain a caller-owned host. A missing
host or preparation input waits without perpetual renderer claims; development
warns once after ten seconds without changing state or calling onError. A
scene declared before its first request is valid and stays quiet.

## Input and paint contracts

- Ordinary handoff HTML stays native when capture is unavailable. Branch inside
  scene-dependent actions with `supportsSurfaces()` so their native outcomes
  still finish. A SceneSurface needs its own native fallback when necessary.
- Page-owned preparation displays the current capture bitmap and serves the
  original HTML through a native rig; its inert clone reserves layout only.
- Native scene input is opt-in with `pointerRoute="auto"`. Multiple interactive
  poses of one source all use relay. Unknown/replaced/deformed geometry and
  authored raycasts use relay. Disabled or inert scene sources take no input.
- Keep the content root sized by its layout; animate inner wrappers, not root
  opacity/transform. Do not use CSS mask-image inside captured content. Provide
  hover/active attribute twins. Read the full authoring constraints.
- Frame dimensions, texture and anchors belong to the same paint generation.
  Captured textures are borrowed; their owner disposes them after all usage ends.
- Canvas and capture resolution follow native display density by default, including
  display and zoom changes. Explicit resolution limits trade quality for cost.
  Stationary flat meshes use the pixel-grid correction at draw time; read their
  rendered matrix in companion callbacks and leave physics transforms continuous.
- A manual mesh supplies a proxy. `/advanced` manual presentation must register
  required parts and report actual eligible draws. `sampledParts` belongs on
  the mesh that samples and draws those sources, never on an invisible proxy.

## Verify the behavior

Run tests in their four homes, four typechecks, lint and package build. Browser
checks are serial. Use the relevant maintained gate plus the new API fixtures;
require actual enhanced capability and test a separate no-flag profile.
A zero-exit skip is not a pass. Inspect real pixels and input alongside status.
Use native display density in visible Chrome checks. Run explicit lower/higher DPR
comparisons headlessly, and use `probe:sharpness` for a measured native-HTML reference.

`instruments/api-all-demos/README.md` lists the hardening probes and their bounded
cost/pixel budgets. Measurements belong in runnable instruments and decisions;
changing a law changes its contract in the same commit. Preserve unrelated work
and the repository's explicit CI/deployment/scope approval rules.
