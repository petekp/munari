// @petepetrash/munari — the public surface.
//
// Live HTML in Three.js scenes through Chrome's HTML-in-canvas capability:
// the react/three binding over @munari/core, and the one package that
// is ever published (decisions.md #1). three + @react-three/fiber are
// PEER dependencies — we are three-first, and renderer abstraction is
// banned (decisions.md #1).
//
// This entry is CURATED. Everything here is something an ordinary scene
// reaches for: a Surface, the canvas that hosts one, the handle that
// moves it, and the reads a custom material or a DOM-aligned object
// needs. The kernel's own names and the escape hatches that carry a
// caller-owned renderer live behind `@petepetrash/munari/advanced`, so
// the shape a newcomer sees is the shape they should use. The lab imports these two
// entries and nothing else, so a gap shows up as a broken scene rather
// than a relative path quietly reaching around it.

// ── HTML, scene, and captured elements ───────────────────────────────────
export { Surface, SceneSurface, useSurfaceStatus, useSurfaceMotion, useSurfaceDriver } from './primitives/Surface'
export type { SurfaceProps, SurfaceRootProps, SurfaceHTMLProps, SceneSurfaceHTMLProps, SceneSurfaceRootProps, SceneSurfaceProps, SurfaceSceneProps, SurfaceControls, SurfaceDriverFrame, SurfaceDriverStep, SurfaceMotionFrame } from './primitives/Surface'
export { useElementCapture, CaptureContent } from './primitives/elementCapture'
export type { ElementCapture, ElementCaptureOptions } from './primitives/elementCapture'
export { createCapture, useCaptureHandle, useCaptureFrame, useCaptureStatus } from './primitives/capture'
export type { CaptureHandle, CaptureFrame, CaptureStatus } from './primitives/capture'
export { SurfaceCanvas, type SurfaceCanvasProps } from './primitives/surface/SurfaceCanvas'
export type { SurfaceCanvasId } from './primitives/surface/surfaceHostRegistry'
export type { SurfaceIdentityProps } from './primitives/surface/SurfaceRoot'
export type { SurfacePointerEvents, SurfaceRadius, SurfaceMeshProps } from './primitives/surface/SurfaceMesh'
export type { SurfaceResolution, SurfaceSize } from './primitives/surface/surfaceSourceRuntime'

// ── Identity and frame reads ─────────────────────────────────────────────
export { createSurface, useSurfaceHandle, useSurfaceProgress, type SurfaceHandle, type SurfaceProgress, type SurfaceTiming } from './primitives/surface/surfaceHandle'

// ── What a Surface hands its children ────────────────────────────────────
// A Surface.Mesh can supply its own material. These hooks read its live texture,
// measured chrome,
// and the painted box it gates blending on when its own raster's
// generation might lag the live DOM.
//
// `useSurfaceTextureOf` is the one that reaches OUTSIDE the slot: a handle
// names content, and a source paints and uploads with no presenter at all,
// so a material can mix a second live capture the page shows nowhere.
export {
  useSurfaceChrome,
  useSurfacePaintedSize,
  useSurfaceSourceRoot,
  useSurfaceTexture,
  useSurfaceTextureOf,
} from './primitives/surface/surfaceContext'
export {
  useSurfaceUniforms,
  type SurfaceUniforms,
} from './primitives/surface/surfaceMaterials'
// The GLSL half of the corner mask (the JS half lives in the kernel). A
// custom material splices this and applies `munariRadiusMask(vUv)` to alpha
// for straight output, or to the full vec4 for premultiplied output.
export { SURFACE_RADIUS_GLSL } from './lib/surfaceRadiusGlsl'
// The one sanctioned way to bend a presented Surface. Vertices move, so the
// raycast hits the shape the eye sees and relayed input stays correct on any
// deformation; a vertex-shader warp bends only pixels and silently gets
// flat-pose hit testing (decisions.md #35).
export {
  deformSurfaceGeometry,
  type SurfaceDeformPoint,
} from './primitives/surface/surfaceDeform'

// ── DOM-aligned objects ──────────────────────────────────────────────────
// A named box inside the source, read in the geometry's own coordinates,
// so a scene object can stand where an element stands.
export {
  useSurfaceAnchorBox,
  useSurfaceAnchorRects,
  type SurfaceAnchorBox,
  type SurfaceAnchorProps,
} from './primitives/surface/SurfaceAnchor'
export {
  SURFACE_ANCHOR_ATTRIBUTE,
  type SourceUvRect,
  type SurfaceChrome,
} from '@munari/core'
export {
  SURFACE_FOCUS_ATTRIBUTE,
  surfaceFocusKey,
  surfaceFocusTarget,
} from './primitives/surface/surfaceFocus'

// The receipts a Surface hands its own callbacks. A consumer that stores
// one — a probe, a HUD, a replay log — needs to be able to name it.
export type { DomPaintReceipt, PresentationReceipt } from '@munari/core'
// The capability check every consumer runs before deciding which tree to
// render. `useSurfaceSupport` is the one to reach for: it is
// hydration-safe, and the branch it answers is decided above the Surface,
// where a handle's state is not yet the obvious place to look.
// `detectHtmlInCanvas` remains for diagnostics — it reports both trial
// entry points, and a Surface only needs `drawElementImage`.
export {
  supportsSurfaces,
  useSurfaceSupport,
} from './primitives/surface/surfaceSupport'
export { detectHtmlInCanvas } from '@munari/core'

// ── Focus, and the camera that follows it ────────────────────────────────
export { FocusScene, FocusGroup } from './primitives/FocusScene'
export {
  useFocusScene,
  useFocusSceneEvents,
  useFocusReframe,
  useFocusNavPolicy,
} from './primitives/useFocusScene'
export type {
  FocusLevel,
  GroupFocusState,
  FocusCause,
  FocusSceneEvent,
  ReframeRequest,
  ReframeFulfiller,
  NudgeRequest,
  NavPolicy,
} from './primitives/focusContext'
// The camera rig that follows a FocusScene is NOT here. It is one scene's
// answer to how a camera should move, tuned against one layout, and a
// published component would make that answer the library's — so it ships as
// a copyable recipe under `registry/focus-orbit` instead (decisions.md #6,
// amended 2026-08-17), with its arc layout and camera poses beside it.

// ── Physical controls ────────────────────────────────────────────────────
export { Dial, type DialProps } from './primitives/controls/Dial'

export { createPageTarget, usePageTarget, type PageTarget } from './primitives/pageTarget'
export { useSurfaceBeforeRender, type SurfaceRenderFrame } from './primitives/surface/surfaceFrame'
export type { SurfaceStatus, SurfaceViewPresentation as SurfacePresentation, SurfaceViewDestination as SurfaceDestination } from './primitives/surface/surfaceStatus'
