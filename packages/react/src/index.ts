// @petepetrash/munari — the public surface.
//
// Live DOM as physical matter in WebGL (Chrome's HTML-in-canvas trial):
// the react/three binding over @munari/core, and the one package that
// is ever published (decisions.md #1). three + @react-three/fiber are
// PEER dependencies — we are three-first, and renderer abstraction is
// banned by the second-system guard.
//
// This entry is CURATED. Everything here is something an ordinary scene
// reaches for: a Surface, the canvas that hosts one, the handle that
// moves it, and the reads a custom material or a DOM-aligned object
// needs. The kernel's own names and the escape hatches that carry a
// caller-owned renderer live behind `@petepetrash/munari/advanced`, so
// the shape a newcomer sees is the shape they should use. A name earns
// its place here by a scene consuming it; the lab imports these two
// entries and nothing else, so a gap shows up as a broken scene rather
// than a relative path quietly reaching around it.

// ── The atom ─────────────────────────────────────────────────────────────
// A `Surface` is one piece of content that the page and WebGL both know
// how to present. `SurfaceCanvas` is the host that arbitrates between
// them for every Surface inside it.
export { Surface } from './primitives/surface/Surface'
export { SurfaceCanvas, type SurfaceCanvasProps } from './primitives/surface/SurfaceCanvas'
export type { SurfaceCanvasId } from './primitives/surface/surfaceHostRegistry'
export type {
  SurfaceContentOptions,
  SurfaceContentProps,
  SurfaceIdentityProps,
  SurfaceProps,
} from './primitives/surface/SurfaceRoot'
export type { SurfaceDOMProps } from './primitives/surface/SurfaceDOM'
export type { SurfacePartProps } from './primitives/surface/SurfacePart'
export type {
  SurfacePointerEvents,
  SurfaceRadius,
  SurfaceWebGLProps,
} from './primitives/surface/SurfaceWebGL'
export type { SurfaceResolution, SurfaceSize } from './primitives/surface/surfaceSourceRuntime'

// ── The handle, and the frames that drive it ─────────────────────────────
// The handle is content identity, independent of the trees presenting it:
// a scene asks for a view and reads the progress it scales motion by.
export {
  createSurface,
  useSurface,
  useSurfaceProgress,
  useSurfaceState,
  type SurfaceHandle,
  type SurfaceProgress,
  type SurfaceState,
  type SurfaceControls,
  type SurfaceIdentityOptions,
  type SurfaceTiming,
  type SurfaceView,
  type UseSurfaceOptions,
} from './primitives/surface/surfaceHandle'
export { useSurfaceDriver } from './primitives/surface/useSurfaceDriver'
export type {
  SurfaceDriverFrame,
  SurfaceDriverStep,
} from './primitives/surface/surfaceHandle'

// ── What a Surface hands its children ────────────────────────────────────
// With `material="none"` a Surface yields its material slot, and these are
// how the custom material reaches the live texture, the measured chrome,
// and the painted box it gates blending on when its own raster's
// generation might lag the live DOM.
export {
  useSurfaceChrome,
  useSurfaceInstance,
  useSurfacePaintedSize,
  useSurfaceSourceRoot,
  useSurfaceTexture,
  type SurfaceInstance,
} from './primitives/surface/surfaceContext'
// The GLSL half of the corner mask (the JS half lives in the kernel). A
// custom material splices this and applies `munariRadiusMask(vUv)` to alpha
// for straight output, or to the full vec4 for premultiplied output.
export { SURFACE_RADIUS_GLSL } from './lib/surfaceRadiusGlsl'

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
// The capability check every consumer runs before mounting a Surface.
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
