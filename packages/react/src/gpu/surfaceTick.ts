// Per-frame WebGPU Surface tick helper — builds SurfaceFrameContext, runs
// user `onFrame`, updates pixel-snapped MVP matrices, and emits the draw item.
//
// Ownership: `@petepetrash/munari/gpu` (`Surface.tsx` delegates `tick()` here).

import {
  crossingDraws,
  crossingProgress,
  type CrossingState,
  type DomTextureSource,
  type SurfaceChrome,
} from '@munari/core'
import {
  applyPixelSnap,
  buildWorldAndMvp,
  computeBasePose,
  isManifestMaterial,
  snapSurfacePose,
  type ShadowModule,
  type SurfaceFrameContext,
  type SurfacePose,
  type SurfacePresentation,
} from './surfaceDom'
import type { Mat4 } from './math'
import type { ViewportState } from './host'
import type { ManifestDriver, MaterialManifest } from './manifest'
import type { GpuEngine } from './gpuEngine'
import type { SurfaceLighting } from '../primitives/surface/surfaceLight'
import type { GpuSurfaceShadowHandle, SurfaceShadowOptions } from './surfaceShadow'
import type {
  GpuDrawItem,
  GpuGeometry,
  GpuMaterial,
  GpuMaterialFactory,
  GpuPassReceipt,
  GpuRenderer,
  GpuSurfaceTexture,
} from './webgpu'

export interface GeoMeta {
  readonly w: number
  readonly h: number
  readonly sx: number
  readonly sy: number
  readonly bx: number
  readonly by: number
}

export function syncSurfaceGeometrySize(
  engine: Pick<GpuEngine, 'createPlaneGeometry'>,
  renderer: GpuRenderer,
  geoRef: { current: GpuGeometry | null },
  geoMetaRef: { current: GeoMeta | null },
  next: GeoMeta,
): boolean {
  const curGeo = geoRef.current
  const prev = geoMetaRef.current
  if (!curGeo) return false
  if (prev && prev.w === next.w && prev.h === next.h && prev.sx === next.sx && prev.sy === next.sy && prev.bx === next.bx && prev.by === next.by) {
    return false
  }
  curGeo.dispose()
  geoRef.current = engine.createPlaneGeometry(renderer.device, next.w, next.h, next.sx, next.sy, next.bx, next.by)
  geoMetaRef.current = next
  return true
}

export interface ManifestDriverCache<TUniforms> {
  material: MaterialManifest<TUniforms>
  driver: ManifestDriver<TUniforms>
}

export function resolveSurfaceFactory<TUniforms>(
  engine: GpuEngine,
  factoryProp: GpuMaterialFactory | undefined,
  materialProp: MaterialManifest<TUniforms> | undefined,
  cacheRef: { current: ManifestDriverCache<TUniforms> | null },
): GpuMaterialFactory | undefined {
  if (factoryProp) return factoryProp
  if (!materialProp) return undefined
  if (cacheRef.current?.material !== materialProp) {
    cacheRef.current = { material: materialProp, driver: engine.createManifestDriver(materialProp) }
  }
  return cacheRef.current.driver.factory
}

/** Synchronizes a Surface's lazy grounded shadow handle against current options. */
export function syncSurfaceShadowHandle(
  current: GpuSurfaceShadowHandle | null,
  renderer: GpuRenderer,
  shadow: boolean | SurfaceShadowOptions | undefined,
  shadowMod: ShadowModule | null,
  invalidate: () => void,
): GpuSurfaceShadowHandle | null {
  if (!shadow || !shadowMod) {
    current?.dispose()
    invalidate()
    return null
  }
  if (current) {
    current.updateOptions(shadow)
    invalidate()
    return current
  }
  const nextShadow = shadowMod.createGpuSurfaceShadow(renderer, shadow)
  void nextShadow.ready.then(invalidate, () => {})
  return nextShadow
}

export interface SurfaceTickInput<TUniforms> {
  readonly dtMs: number
  readonly elapsedMs: number
  readonly viewport: ViewportState
  readonly src: DomTextureSource
  readonly tex: GpuSurfaceTexture
  readonly geo: GpuGeometry
  readonly mat: GpuMaterial
  readonly placement: 'match-dom' | 'manual'
  readonly pageEl: HTMLElement | null
  readonly size: readonly [number, number]
  readonly pixelSnap: boolean
  readonly bleedUvRect: readonly [number, number, number, number]
  readonly shadow: GpuSurfaceShadowHandle | null
  readonly lighting: SurfaceLighting
  readonly viewFmt: 'rgba8unorm' | 'rgba8unorm-srgb'
  readonly chrome: SurfaceChrome
  readonly crossing: CrossingState
  readonly presentation: SurfacePresentation
  readonly ready: boolean
  readonly pose: SurfacePose
  readonly setPose: (pose: SurfacePose) => void
  readonly worldMat: Mat4
  readonly invWorldMat: Mat4
  readonly engine: Pick<GpuEngine, 'deformGpuGeometry' | 'resolveKeyPos'>
  readonly onFrame?: (ctx: SurfaceFrameContext<TUniforms>) => boolean | void
  readonly setFrameClaim: (active: boolean) => void
  readonly onPassComplete: (receipt: GpuPassReceipt) => void
}

/** Runs one WebGPU Surface tick and returns one or two draw items (optional grounded shadow + card). */
export function runSurfaceTick<TUniforms>(
  input: SurfaceTickInput<TUniforms>,
): GpuDrawItem | readonly GpuDrawItem[] {
  const {
    dtMs,
    elapsedMs,
    viewport,
    src,
    tex,
    geo,
    mat,
    placement,
    pageEl,
    size,
    pixelSnap,
    bleedUvRect,
    shadow,
    lighting,
    viewFmt,
    chrome,
    crossing,
    presentation,
    ready,
    pose,
    setPose,
    worldMat,
    invWorldMat,
    onFrame,
    setFrameClaim,
    onPassComplete,
  } = input

  const pageRect = pageEl ? pageEl.getBoundingClientRect() : null
  const basePose = computeBasePose(placement, pageRect, viewport, size)
  let nextPose = placement === 'match-dom' ? basePose : pose
  if (placement === 'match-dom') setPose(nextPose)
  let wrotePoseThisFrame = false

  const progress = crossing.ramp
  const easedProgress = crossingProgress(progress)
  const keepGoing = onFrame?.({
    dtMs,
    elapsedMs,
    progress,
    easedProgress,
    phase: crossing.phase,
    presentation,
    size,
    chrome,
    geometry: geo,
    material: mat,
    viewport,
    pageRect,
    basePose,
    get pose() {
      return wrotePoseThisFrame ? nextPose : basePose
    },
    setPose: (p) => {
      nextPose = p
      wrotePoseThisFrame = true
      setPose(p)
    },
    snapPose: (x, y, mag) => snapSurfacePose(x, y, size, viewport, src, mag),
    deform: (place) => input.engine.deformGpuGeometry(geo, size, place),
    setExtraAttribute: (slot, data) => geo.setExtraAttribute(slot, data),
    setUniforms: (values) => {
      if (isManifestMaterial<TUniforms>(mat)) mat.setUniforms(values)
    },
    setCustomUniforms: (data) => mat.writeCustomUniforms(data),
  })
  setFrameClaim(keepGoing === true)

  const poseToDraw = applyPixelSnap(nextPose, pixelSnap, size, viewport, src)
  const mvp = buildWorldAndMvp(poseToDraw, viewport.viewProj, worldMat, invWorldMat)
  const colorWrite = ready && (crossing.phase !== 'lifting' || mat.isReady())
  const view = tex.view(viewFmt)

  const cardItem: GpuDrawItem = {
    geometry: geo,
    material: mat,
    view,
    sampler: tex.sampler,
    modelWorld: worldMat,
    mvp,
    size,
    radii: chrome.radii,
    uvRect: bleedUvRect,
    colorWrite,
    onPassComplete,
  }

  if (shadow && !crossingDraws(crossing.phase).page) {
    const keyPos = input.engine.resolveKeyPos(viewport, lighting)
    const shadowItem = shadow.updateDrawItem({
      size,
      radii: chrome.radii,
      shadowLayers: chrome.shadow,
      pose: poseToDraw,
      keyPos,
      viewProj: viewport.viewProj,
      view,
      sampler: tex.sampler,
      colorWrite,
    })
    if (shadowItem) return [shadowItem, cardItem]
  }
  return cardItem
}
