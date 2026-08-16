// The kernel's public surface. It grows one layer of hold at a time —
// mapping → paint → pointer → transfer → chrome → physics — and only after
// the layer's conformance contract has landed.

// mapping — who owns the coordinates
export {
  cameraDistance,
  planeScale,
  texelDemand,
  screenToPlane,
  carryToPlane,
  planeToScreen,
} from './mapping/camera'
export {
  pixelGridSnap,
  type PixelGridInput,
  type PixelGridSnap,
} from './mapping/pixelGrid'
export {
  UVAnchor,
  sampleSurfaceAtUV,
  type AttributeLike,
  type GeometryLike,
  type SurfaceSample,
  type SurfaceSampleLike,
} from './mapping/uvAnchor'
export { Vec3, type Vec3Like, type Vec3Readonly, type SampleVec } from './math/vec3'

// paint — who owns the pixels + paint (texture contract = decisions.md #5)
export {
  createCanvasFrameSource,
  type CanvasFrameSource,
  type CanvasFrameSourceOptions,
  type FrameFormat,
  type FrameId,
  type FrameSource,
  type FrameSourceSubscriber,
} from './paint/frameSource'
export {
  DEFAULT_TIERS,
  MAX_TEXTURE_EDGE,
  selectLodTier,
  seedTier,
  tiersInRange,
  maxTier,
  clampScale,
  clampTiers,
  resolveFixedScale,
} from './paint/lodTier'
export {
  createDomTextureSource,
  detectHtmlInCanvas,
  UnsupportedPlatformError,
  paintStats,
  type DomPaintReceipt,
  type DomTextureSource,
  type DomTextureSourceOptions,
  type HtmlInCanvasSupport,
  type PaintStats,
} from './paint/htmlInCanvas'
export {
  ensureChannelRegistered,
  createStyleChannel,
  type StyleChannel,
  type StyleChannelOptions,
} from './paint/styleChannel'
export {
  filterPolicy,
  filterPolicyTransition,
  type FilterPolicy,
  type PolicyState,
} from './paint/filterPolicy'
export {
  DENSITY_BAND,
  storeForBox,
  uploadNeedsRealloc,
  type TextureStore,
} from './paint/textureStorage'

// pointer — provenance + the pointer-exit protocol
export { relay, isRelayed } from './pointer/relay'
export {
  clearPointerState,
  deepestElementAt,
  forwardPointer,
  forwardWheel,
  guardPointerCapture,
  nudgeSelect,
  silenceHoverMove,
  trackDrag,
  trackFocusModality,
  trackWheel,
  type ForwardPointerSample,
  type ForwardResult,
} from './pointer/forwardEvents'
export {
  convexHull,
  createGraceTracker,
  observeGrace,
  pointInConvex,
  type GraceTracker,
  type GraceTrackerOptions,
  type Pt,
} from './pointer/hoverGrace'

// transfer — the handoff
export {
  presentationReceiptSatisfies,
  type PresentationReceipt,
  type PresentationRequirement,
} from './transfer/presentation'
export {
  CROSSING_DEFAULTS,
  crossingAtRest,
  crossingRequest,
  crossingFrame,
  crossingDraws,
  crossingPresentation,
  crossingProgress,
  crossingRange,
  crossingCurve,
  type CrossingPhase,
  type CrossingTiming,
  type CrossingEvidence,
  type CrossingState,
} from './transfer/crossing'
export { createMotionCarrier, type MotionCarrier } from './transfer/motionCarrier'

// chrome — measurement
export {
  parseBoxShadow,
  resolveRadii,
  surfaceRadiusSd,
  measureSurfaceChrome,
  chromeEquals,
  EMPTY_CHROME,
  type SurfaceShadowLayer,
  type SurfaceChrome,
} from './chrome/surfaceChrome'
// physics — physical controls
export {
  type Body1D,
  type Field,
  composeFields,
  damping,
  detentField,
  stopsField,
  overCenterField,
  endStops,
  step,
  flipImpulse,
  hopImpulse,
} from './physics/physics1D'
