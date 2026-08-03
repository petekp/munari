// The kernel's public surface. It grows one custody layer at a time —
// mapping → paint → door → transfer → chrome → physics — and only after
// the layer's conformance contract has landed (CLAUDE.md: contracts
// first).

// mapping — coordinate custody (archive#44, #6, #52/#53)
export {
  cameraDistance,
  planeScale,
  texelDemand,
  screenToPlane,
  carryToPlane,
  planeToScreen,
} from './mapping/camera'
export {
  UVAnchor,
  sampleSurfaceAtUV,
  type AttributeLike,
  type GeometryLike,
  type SurfaceSample,
  type SurfaceSampleLike,
} from './mapping/uvAnchor'
export { Vec3, type Vec3Like, type Vec3Readonly, type SampleVec } from './math/vec3'

// paint — custody + paint (archive#3, #8–#12, #22, #28, #35–#37;
// texture contract = decisions.md #5)
export {
  DEFAULT_TIERS,
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
  type DomTextureSource,
  type DomTextureSourceOptions,
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

// door — provenance + the pointer-exit protocol (archive#19, #20, #24, #26, #27, #29, #31, #32, #50, #51)
export { forge, isForgedEvent } from './door/forge'
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
  type ForwardResult,
} from './door/forwardEvents'
export {
  convexHull,
  createGraceTracker,
  observeGrace,
  pointInConvex,
  type GraceTracker,
  type GraceTrackerOptions,
  type Pt,
} from './door/hoverGrace'
