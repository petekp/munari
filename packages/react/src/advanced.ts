// @petepetrash/munari/advanced — the kernel, and the escape hatches.
//
// The root entry is curated to what a scene ordinarily reaches for. This
// entry is the deliberate second doorway for the two things that fall
// outside it: the whole of @munari/core, and the React primitives that
// carry pixels another system already renders.
//
// The kernel is re-exported WHOLE, not curated: every name in
// @munari/core is contract-covered (tests/conformance), so there is
// nothing to hide and no drift for a partial re-export to accumulate.
// The import path is the warning — a consumer who lands here has asked
// for the layer under the Surface, and its names move with the kernel
// rather than with the component API.

export * from '@munari/core'

// A caller-owned canvas worn as scene matter, for content another system
// already renders. Inside a <SurfaceCanvas> its presentation receipts go
// through the host's frame tail, so a post-processed frame can present.
export {
  FrameSurface,
  type FrameDrawReceipt,
  type FrameSurfaceProps,
} from './primitives/FrameSurface'
// The canvas texture a FrameSurface owns, for a child material under
// `material="none"`. A different source from the root's
// `useSurfaceTexture`, which answers with the DOM capture the enclosing
// Surface holds — a composite that wears both samples both, and the two
// must be nameable apart.
export { useSurfaceTexture as useFrameTexture } from './primitives/SurfaceContext'

// Idle motion whose source of truth is a JS carrier rather than the
// compositor's clock. The page writes the sample, the mesh reads the same
// sample, and motion crosses the threshold mid-flight (decisions.md #30).
// Here rather than at the root: it is a mechanism for content that must
// keep moving THROUGH a handoff, which is a scene deliberately reaching
// under the Surface, not an ordinary Surface's business.
export { useCarriedMotion, type CarriedMotion } from './primitives/useCarriedMotion'

// A scene that draws a Surface's pixels itself — a composite over the live
// capture, a frozen film — still owes the readiness ledger a presenter.
// This is that seam, and only that: register, prove, present, and the two
// reads a manual draw is gated on.
export {
  surfaceManualPresenter,
  type SurfaceManualPresenter,
} from './primitives/surface/surfaceManualPresenter'
