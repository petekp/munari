// Per-frame WebGPU Surface tick helper — builds SurfaceFrameContext, runs
// user `onFrame`, updates pixel-snapped MVP matrices, and emits the draw item.
//
// Ownership: `@petepetrash/munari/gpu` (`Surface.tsx` delegates `tick()` here).

import { crossingProgress, type CrossingState, type DomTextureSource, type SurfaceChrome } from '@munari/core'
import type { SurfaceFinish } from '../primitives/surface/surfaceFinish'
import { createManifestMaterial, unlitSurfaceManifest } from './manifest'
import {
  applyPixelSnap,
  buildWorldAndMvp,
  computeBasePose,
  isFinishMaterial,
  isManifestMaterial,
  snapSurfacePose,
  type FinishModule,
  type ShadowModule,
  type SurfaceFrameContext,
  type SurfacePose,
  type SurfacePresentation,
} from './surfaceDom'
import type { Mat4 } from './math'
import type { ViewportState } from './host'
import type { SurfaceLighting } from '../primitives/surface/surfaceLight'
import type { GpuSurfaceShadowHandle, SurfaceShadowOptions } from './surfaceShadow'
import {
  deformGpuGeometry,
  resolveKeyPos,
  type GpuDrawItem,
  type GpuGeometry,
  type GpuMaterial,
  type GpuMaterialFactory,
  type GpuPassReceipt,
  type GpuRenderer,
  type GpuSurfaceTexture,
} from './webgpu'

export interface ActiveMaterialSlot {
  readonly isFinish: boolean
  readonly factory: GpuMaterialFactory | undefined
}

export interface SyncedMaterialSlot {
  readonly mat: GpuMaterial | null
  readonly active: ActiveMaterialSlot | null
}

/** Builds a finish, custom factory, or default unlit WebGPU material for one Surface. */
export function buildSurfaceMaterial(
  renderer: GpuRenderer,
  finish: SurfaceFinish | undefined,
  finishMod: FinishModule | null,
  factory: GpuMaterialFactory | undefined,
  invalidate: () => void,
): GpuMaterial | null {
  if (finish) {
    return finishMod ? finishMod.createGpuFinishMaterial(renderer, finish, invalidate) : null
  }
  if (factory) return factory.create(renderer)
  return createManifestMaterial(renderer, unlitSurfaceManifest)
}

/** Reconciles a Surface's material slot on prop/finish/uniform changes without leaking pipelines. */
export function syncSurfaceMaterialSlot<TUniforms>(params: {
  readonly renderer: GpuRenderer
  readonly curMat: GpuMaterial | null
  readonly active: ActiveMaterialSlot | null
  readonly finish: SurfaceFinish | undefined
  readonly finishMod: FinishModule | null
  readonly effectiveFactory: GpuMaterialFactory | undefined
  readonly uniforms: TUniforms | undefined
  readonly invalidate: () => void
}): SyncedMaterialSlot {
  const { renderer, curMat, active, finish, finishMod, effectiveFactory, uniforms, invalidate } = params
  const isFin = Boolean(finish)
  const kindChanged =
    !curMat || !active || active.isFinish !== isFin || (!isFin && active.factory !== effectiveFactory)
  if (!kindChanged && curMat) {
    if (finish && isFinishMaterial(curMat)) {
      curMat.updateFinish(finish)
    } else if (!isFin && uniforms !== undefined && isManifestMaterial<TUniforms>(curMat)) {
      curMat.setUniforms(uniforms)
    }
    invalidate()
    return { mat: curMat, active }
  }
  curMat?.dispose()
  const nextMat = buildSurfaceMaterial(renderer, finish, finishMod, effectiveFactory, invalidate)
  const nextActive: ActiveMaterialSlot | null = nextMat
    ? { isFinish: isFin, factory: effectiveFactory }
    : null
  if (nextMat) {
    if (uniforms !== undefined && isManifestMaterial<TUniforms>(nextMat)) nextMat.setUniforms(uniforms)
    void nextMat.ready.then(invalidate, () => {})
  }
  invalidate()
  return { mat: nextMat, active: nextActive }
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

  if (shadow) {
    const keyPos = resolveKeyPos(viewport, lighting)
    const shadowItem = shadow.updateDrawItem({
      size,
      radii: chrome.radii,
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
