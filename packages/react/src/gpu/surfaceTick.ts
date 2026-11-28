// Per-frame WebGPU Surface tick helper — builds SurfaceFrameContext, runs
// user `onFrame`, updates pixel-snapped MVP matrices, and emits the draw item.
//
// Ownership: `@petepetrash/munari/gpu` (`Surface.tsx` delegates `tick()` here).

import { crossingProgress, type CrossingState, type DomTextureSource, type SurfaceChrome } from '@munari/core'
import {
  applyPixelSnap,
  buildWorldAndMvp,
  computeBasePose,
  isManifestMaterial,
  snapSurfacePose,
  type SurfaceFrameContext,
  type SurfacePose,
  type SurfacePresentation,
} from './surfaceDom'
import type { Mat4 } from './math'
import type { ViewportState } from './host'
import { deformGpuGeometry, type GpuDrawItem, type GpuGeometry, type GpuMaterial, type GpuPassReceipt, type GpuSurfaceTexture } from './webgpu'

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
  readonly viewFmt: 'rgba8unorm' | 'rgba8unorm-srgb'
  readonly chrome: SurfaceChrome
  readonly crossing: CrossingState
  readonly presentation: SurfacePresentation
  readonly ready: boolean
  readonly pose: SurfacePose
  readonly setPose: (pose: SurfacePose) => void
  readonly worldMat: Mat4
  readonly invWorldMat: Mat4
  readonly onFrame?: (ctx: SurfaceFrameContext<TUniforms>) => boolean | void
  readonly setFrameClaim: (active: boolean) => void
  readonly onPassComplete: (receipt: GpuPassReceipt) => void
}

/** Runs one WebGPU Surface tick and returns the draw item to encode. */
export function runSurfaceTick<TUniforms>(input: SurfaceTickInput<TUniforms>): GpuDrawItem {
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
    setPose: (p) => {
      nextPose = p
      setPose(p)
    },
    snapPose: (x, y, mag) => snapSurfacePose(x, y, size, viewport, src, mag),
    deform: (place) => deformGpuGeometry(geo, size, place),
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

  return {
    geometry: geo,
    material: mat,
    view: tex.view(viewFmt),
    sampler: tex.sampler,
    modelWorld: worldMat,
    mvp,
    size,
    radii: chrome.radii,
    colorWrite,
    onPassComplete,
  }
}
