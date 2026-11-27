// @petepetrash/munari/gpu — zero-Three, zero-TypeGPU WebGPU runtime entry.
//
// Everything needed to put live HTML into WebGPU surfaces and run compiled
// Material Manifests or physical SurfaceFinishes without bundling `three`,
// `@react-three/fiber`, or TypeGPU runtime code.

export { Surface, type GpuViewport, type SurfaceFrameContext, type SurfacePose, type SurfacePresentation, type SurfaceProps } from './gpu/Surface'
export { SurfaceCanvas, type SurfaceCanvasProps } from './gpu/SurfaceCanvas'
export { createManifestDriver, unlitSurfaceManifest, type ManifestAttribute, type ManifestDriver, type ManifestMaterial, type ManifestStaticTexture, type ManifestStaticTextureData, type ManifestUniformSpec, type MaterialManifest } from './gpu/manifest'
export { loadLtcTable } from './gpu/ltc'
export { getGpuHostStats, requestGpuFrame, simulateGpuDeviceLoss, type GpuHostStats } from './gpu/host'
export { supportsCapture } from './primitives/surface/surfaceSupport'
export type { DeformedPoint, GpuGeometry, GpuMaterial, GpuMaterialFactory, GpuRenderer } from './gpu/webgpu'
export { createSurfaceLight, type KeyLight, type LightPosition, type PointerKind, type SurfaceLight, type SurfaceLightOptions, type SurfaceLighting } from './primitives/surface/surfaceLight'
export type { FinishValues, SurfaceDetailKind, SurfaceFinish } from './primitives/surface/surfaceFinish'
export { detectHtmlInCanvas, paintStats, pixelGridSnap, type PixelGridInput, type PixelGridSnap } from '@munari/core'
