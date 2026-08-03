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
