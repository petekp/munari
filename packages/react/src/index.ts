// @petepetrash/munari — the public surface.
//
// Live DOM as physical matter in WebGL (Chrome's HTML-in-canvas trial):
// the react/three binding over @munari/core, and the one package that
// is ever published (decisions.md #1). three + @react-three/fiber are
// PEER dependencies — we are three-first, and renderer abstraction is
// banned by the second-system guard.
//
// The kernel is re-exported WHOLE, not curated: every name in
// @munari/core is contract-covered (tests/conformance), so there is
// nothing to hide and no drift for a second doorway to accumulate. The
// binding's own exports below are sized to their consumers — a
// primitive earns its place here by a scene consuming it, and the lab
// imports from this file and nowhere else, so a gap shows up as a
// broken scene rather than a relative path quietly reaching around it.

export * from '@munari/core'

// ── The atom, and the two ways to fill it ────────────────────────────────
// A `Surface` is one mesh whose material is a live DOM subtree. Give it
// markup for something static, or use `SurfaceApp` to hand it a React tree.
export { Surface, type SurfaceProps } from './primitives/Surface'
export { SurfaceApp, type SurfaceAppProps } from './primitives/SurfaceApp'
// The shader seam: with `material="none"` a Surface yields its material slot
// to its children, and this is how the custom material reaches the live DOM
// texture it should sample, the measured chrome it should wear, and the
// painted box it should gate blending on when its own raster's generation
// might lag the live DOM (the veil's fade zone).
export { useSurfaceTexture, useSurfaceChrome, useSurfacePaintedSize } from './primitives/SurfaceContext'
// The GLSL half of the corner mask (the JS half lives in the kernel).
// A custom material sampling `useSurfaceTexture` splices this and
// multiplies its alpha by `munariRadiusMask(vUv)`.
export { SURFACE_RADIUS_GLSL } from './lib/surfaceRadiusGlsl'

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
export {
  FocusOrbitRig,
  type FocusOrbitRigProps,
  type FocusRigApi,
  type MotionMode,
} from './primitives/FocusOrbitRig'

// ── Physical controls ────────────────────────────────────────────────────
export { Dial, type DialProps } from './primitives/controls/Dial'

// ── Layout ───────────────────────────────────────────────────────────────
export { arcLayout, type ArcSlot, type ArcLayoutOptions } from './lib/arcLayout'
