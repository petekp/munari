// WebGPU Surface DOM helpers & shared types — lazy finish loader, capture
// reparenting, `--munari-body` mirroring, pose mapping, and upload sync.
//
// The law: HTML stays alive in React's tree (native inputs, focus, selection,
// ARIA). Finish shading (`./finishLookup`) loads dynamically on first finish
// mount so non-finish pages pay zero shader weight (`decisions.md #79`).
//
// Ownership: pure DOM/pose helpers & public Surface prop types live here;
// `Surface.tsx` owns React state, lifecycles, and host registration.

import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import {
  DEFAULT_TIERS,
  chromeEquals,
  clampScale,
  clampTiers,
  holdMotion,
  maxTier,
  measureSurfaceChrome,
  pixelGridSnap,
  presentationRoute,
  readinessProve,
  releaseMotion,
  seedTier,
  surfaceEpochCurrent,
  type CrossingPhase,
  type CrossingState,
  type DomTextureSource,
  type PixelGridSnap,
  type SurfaceChrome,
  type SurfaceIdentity,
  type SurfaceReadiness,
} from '@munari/core'
import type { SurfaceFinish } from '../primitives/surface/surfaceFinish'
import type { GpuFinishHandle } from './finishLookup'
import type { ManifestMaterial, MaterialManifest } from './manifest'
import type { SurfaceShadowOptions } from './surfaceShadow'
import {
  mat4FromPositionEulerScale,
  mat4Invert,
  mat4Multiply,
  type Mat4,
} from './math'
import type {
  DeformedPoint,
  GpuGeometry,
  GpuMaterial,
  GpuMaterialFactory,
  GpuPassReceipt,
  GpuSurfaceTexture,
} from './webgpu'
import type { ViewportState } from './host'

// ── lazy finish module loader ─────────────────────────────────────────────

export type FinishModule = typeof import('./finishLookup')

let finishModule: FinishModule | null = null
let finishLoadPromise: Promise<void> | null = null
const finishListeners = new Set<() => void>()

function loadFinishModule(): void {
  finishLoadPromise ??= import('./finishLookup').then(
    (mod) => {
      finishModule = mod
      for (const listener of [...finishListeners]) listener()
    },
    (error) => {
      finishLoadPromise = null
      if (process.env.NODE_ENV !== 'production') {
        console.error('[munari/gpu] failed to load finish shader module.', error)
      }
    },
  )
}

function subscribeFinishModule(listener: () => void): () => void {
  finishListeners.add(listener)
  return () => finishListeners.delete(listener)
}

export function useFinishModule(needed: boolean): FinishModule | null {
  useEffect(() => {
    if (needed && !finishModule) loadFinishModule()
  }, [needed])
  const mod = useSyncExternalStore(subscribeFinishModule, () => finishModule, () => null)
  return needed ? mod : null
}

// ── lazy shadow module loader ─────────────────────────────────────────────

export type ShadowModule = typeof import('./surfaceShadow')

let shadowModule: ShadowModule | null = null
let shadowLoadPromise: Promise<void> | null = null
const shadowListeners = new Set<() => void>()

function loadShadowModule(): void {
  shadowLoadPromise ??= import('./surfaceShadow').then(
    (mod) => {
      shadowModule = mod
      for (const listener of [...shadowListeners]) listener()
    },
    (error) => {
      shadowLoadPromise = null
      if (process.env.NODE_ENV !== 'production') {
        console.error('[munari/gpu] failed to load shadow module.', error)
      }
    },
  )
}

function subscribeShadowModule(listener: () => void): () => void {
  shadowListeners.add(listener)
  return () => shadowListeners.delete(listener)
}

export function useShadowModule(needed: boolean): ShadowModule | null {
  useEffect(() => {
    if (needed && !shadowModule) loadShadowModule()
  }, [needed])
  const mod = useSyncExternalStore(subscribeShadowModule, () => shadowModule, () => null)
  return needed ? mod : null
}

function isBleedPair(bleed: number | readonly [number, number]): bleed is readonly [number, number] {
  return Array.isArray(bleed)
}

export function resolveBleed(bleed?: number | readonly [number, number]): readonly [number, number] {
  if (bleed === undefined) return [0, 0]
  if (isBleedPair(bleed)) return [Math.max(0, bleed[0]), Math.max(0, bleed[1])]
  const clamped = Math.max(0, bleed)
  return [clamped, clamped]
}

export function computeBleedUvRect(
  size: readonly [number, number],
  bleed: readonly [number, number],
): readonly [number, number, number, number] {
  if (bleed[0] === 0 && bleed[1] === 0) return [0, 0, 1, 1]
  const safeW = Math.max(1, size[0])
  const safeH = Math.max(1, size[1])
  return [bleed[0] / safeW, bleed[1] / safeH, (safeW + 2 * bleed[0]) / safeW, (safeH + 2 * bleed[1]) / safeH]
}

// ── public types ──────────────────────────────────────────────────────────

export interface SurfacePose {
  x: number
  y: number
  z: number
  rx?: number
  ry?: number
  rz?: number
  sx?: number
  sy?: number
  sz?: number
}

export interface GpuViewport {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly dpr: number
  readonly cameraZ: number
}

export interface SurfaceFrameContext<TUniforms = never> {
  readonly dtMs: number
  readonly elapsedMs: number
  readonly progress: number
  readonly easedProgress: number
  readonly phase: CrossingPhase
  readonly presentation: 'page' | 'scene' | 'none'
  readonly size: readonly [number, number]
  readonly chrome: SurfaceChrome
  readonly geometry: GpuGeometry
  readonly material: GpuMaterial
  readonly viewport: GpuViewport
  readonly pageRect: DOMRect | null
  readonly basePose: SurfacePose
  readonly pose: SurfacePose
  setPose(pose: SurfacePose): void
  snapPose(x: number, y: number, mag?: number): PixelGridSnap
  deform(place: (x: number, y: number, index: number) => DeformedPoint): void
  setExtraAttribute(slot: number, data: Float32Array<ArrayBuffer>): void
  setUniforms(values: TUniforms): void
  setCustomUniforms(data: Float32Array<ArrayBuffer>): void
}

export type SurfacePresentation = 'page' | 'scene' | 'none'

export interface SurfaceProps<TUniforms = Record<string, never>> {
  readonly canvasId?: string
  readonly inScene?: boolean
  readonly exclusive?: boolean
  readonly size?: readonly [number, number]
  readonly resolution?: 'auto' | 'max' | number
  readonly live?: boolean
  readonly pointerEvents?: 'geometry' | 'content' | 'none'
  readonly placement?: 'match-dom' | 'manual'
  readonly segments?: readonly [number, number]
  readonly pixelSnap?: boolean
  readonly bleed?: number | readonly [number, number]
  readonly shadow?: boolean | SurfaceShadowOptions
  readonly finish?: SurfaceFinish
  readonly material?: MaterialManifest<TUniforms>
  readonly uniforms?: NoInfer<TUniforms>
  readonly materialFactory?: GpuMaterialFactory
  readonly onFrame?: (ctx: SurfaceFrameContext<NoInfer<TUniforms>>) => boolean | void
  readonly onPresentationChange?: (presentation: SurfacePresentation) => void
  readonly children?: ReactNode
}

// ── helpers ───────────────────────────────────────────────────────────────

export function insertClean(node: HTMLElement, parent: HTMLElement): void {
  if (node.parentElement === parent) return
  if ('moveBefore' in parent) {
    try {
      // SAFETY: Chrome 133+ exposes Element.prototype.moveBefore to keep focus & animations intact across reparents.
      const movedParent = parent as HTMLElement & { moveBefore: (n: Node, ref: Node | null) => void }
      movedParent.moveBefore(node, null)
      return
    } catch {
      // Fall back to standard append when cross-tree moveBefore throws.
    }
  }
  parent.append(node)
}

export function resolveInitialScale(resolution: 'auto' | 'max' | number, size: readonly [number, number]): number {
  const ladder = clampTiers(DEFAULT_TIERS, size[0], size[1])
  if (resolution === 'max') return maxTier(DEFAULT_TIERS, size[0], size[1])
  if (resolution === 'auto') return seedTier(ladder, window.devicePixelRatio || 1)
  return clampScale(resolution, size[0], size[1])
}

export function updatePageVisibility(pageEl: HTMLElement | null, hidePage: boolean): void {
  if (!pageEl) return
  pageEl.style.visibility = hidePage ? 'hidden' : ''
  pageEl.inert = hidePage
  if (hidePage) pageEl.setAttribute('aria-hidden', 'true')
  else pageEl.removeAttribute('aria-hidden')
}

export function writeCaptureBodyColor(
  captureRoot: HTMLElement,
  color: string | null,
  shownAsPage: boolean,
  source: { repaint(): void } | null,
): void {
  const next = color === null ? '' : shownAsPage ? color : 'transparent'
  if (captureRoot.style.getPropertyValue('--munari-body') === next) return
  if (next === '') captureRoot.style.removeProperty('--munari-body')
  else captureRoot.style.setProperty('--munari-body', next)
  source?.repaint()
}

export const IDENTITY_POSE: SurfacePose = {
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  sx: 1,
  sy: 1,
  sz: 1,
}

export function matchDomPose(rect: DOMRect, viewport: ViewportState, size: readonly [number, number]): SurfacePose {
  return {
    x: rect.left - viewport.left + rect.width / 2 - viewport.width / 2,
    y: viewport.height / 2 - (rect.top - viewport.top + rect.height / 2),
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: rect.width / Math.max(1, size[0]),
    sy: rect.height / Math.max(1, size[1]),
    sz: 1,
  }
}

export function computeBasePose(
  placement: 'match-dom' | 'manual',
  pageRect: DOMRect | null,
  viewport: ViewportState,
  size: readonly [number, number],
): SurfacePose {
  if (placement === 'match-dom' && pageRect && pageRect.width > 0 && pageRect.height > 0) {
    return matchDomPose(pageRect, viewport, size)
  }
  return { ...IDENTITY_POSE }
}

export function clonePlaceholder(liveRoot: HTMLElement, pageEl: HTMLElement): HTMLElement | null {
  const copy = liveRoot.cloneNode(true)
  if (!(copy instanceof HTMLElement)) return null
  copy.inert = true
  copy.setAttribute('aria-hidden', 'true')
  pageEl.append(copy)
  return copy
}

export function buildWorldAndMvp(p: SurfacePose, viewProj: Mat4, worldMat: Mat4, invWorldMat: Mat4): Mat4 {
  mat4FromPositionEulerScale(
    p.x,
    p.y,
    p.z,
    p.rx ?? 0,
    p.ry ?? 0,
    p.rz ?? 0,
    p.sx ?? 1,
    p.sy ?? 1,
    p.sz ?? 1,
    worldMat,
  )
  mat4Invert(worldMat, invWorldMat)
  return mat4Multiply(viewProj, worldMat)
}

export function dockSourceHost(source: DomTextureSource | null, dock: HTMLElement | null): void {
  if (source && dock && source.host.parentElement !== dock) {
    dock.append(source.host)
  }
}

export interface SurfaceGpuSlots {
  mat: GpuMaterial | null
  activeMat: unknown
  geo: GpuGeometry | null
  geoMeta: unknown
  tex: GpuSurfaceTexture | null
  lastPaint: number
}

export function disposeSurfaceGpuSlots(slots: SurfaceGpuSlots): void {
  slots.mat?.dispose()
  slots.mat = null
  slots.activeMat = null
  slots.geo?.dispose()
  slots.geo = null
  slots.geoMeta = null
  slots.tex?.dispose()
  slots.tex = null
  slots.lastPaint = -1
}

export function observeElementSize(
  el: HTMLElement,
  onResize: (w: number, h: number) => void,
): () => void {
  const measure = () => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) onResize(r.width, r.height)
  }
  measure()
  const ro = new ResizeObserver(measure)
  ro.observe(el)
  return () => ro.disconnect()
}

export function snapSurfacePose(
  x: number,
  y: number,
  size: readonly [number, number],
  viewport: ViewportState,
  source: DomTextureSource,
  mag = 1,
): PixelGridSnap {
  const texelsX = source.canvas.width > 0 ? source.canvas.width : Math.round(Math.round(size[0]) * source.scale())
  const texelsY = source.canvas.height > 0 ? source.canvas.height : Math.round(Math.round(size[1]) * source.scale())
  return pixelGridSnap({
    x,
    y,
    width: size[0],
    height: size[1],
    mag,
    viewW: viewport.width,
    viewH: viewport.height,
    dpr: viewport.dpr || 1,
    density: source.scale(),
    texelsX,
    texelsY,
  })
}

export function syncUploadIfNeeded(
  src: DomTextureSource,
  tex: GpuSurfaceTexture,
  resolution: 'auto' | 'max' | number,
  liveRoot: HTMLElement | null,
  refs: { lastPaint: number; extraUploads: number; chrome: SurfaceChrome },
): void {
  const count = src.paintCount()
  if (src.painted() && count !== refs.lastPaint) {
    refs.lastPaint = count
    refs.extraUploads = src.drawTrailsPaint ? 1 : 0
    const paint = src.currentPaint()
    if (paint) tex.syncUpload(src, paint.frame.generation, paint.read, resolution !== 'auto' || src.scale() <= 0.5)
    const nextChrome = measureSurfaceChrome(liveRoot ?? src.element)
    if (!chromeEquals(refs.chrome, nextChrome)) refs.chrome = nextChrome
  } else if (refs.extraUploads > 0) {
    refs.extraUploads -= 1
    const paint = src.currentPaint()
    if (paint) tex.syncUpload(src, paint.frame.generation, paint.read, resolution !== 'auto' || src.scale() <= 0.5)
  }
}

export function isFinishMaterial(mat: GpuMaterial | null): mat is GpuFinishHandle {
  return Boolean(mat && 'updateFinish' in mat)
}

export function isManifestMaterial<T>(mat: GpuMaterial | null): mat is ManifestMaterial<T> {
  return Boolean(mat && 'setUniforms' in mat)
}

let hoverBridge: ((pageNode: HTMLElement) => void) | null = null

export function registerHoverBridge(fn: (pageNode: HTMLElement) => void): void {
  hoverBridge = fn
}

export function reparentLiveDom(
  liveNode: HTMLElement | null,
  pageNode: HTMLElement | null,
  captureRoot: HTMLElement,
  exclusive: boolean,
  draws: { readonly page: boolean; readonly gl: boolean },
  state: { placeholder: HTMLElement | null; heldMotion: Animation[] },
  source: DomTextureSource | null,
): void {
  if (!liveNode || !pageNode) return
  const useCapture = !exclusive || draws.gl
  const targetParent = useCapture ? captureRoot : pageNode
  if (liveNode.parentElement !== targetParent) {
    if (!useCapture) {
      state.placeholder?.remove()
      state.placeholder = null
      hoverBridge?.(pageNode)
      releaseMotion(state.heldMotion)
      state.heldMotion = []
    } else {
      if (exclusive && draws.page && !state.placeholder) {
        state.placeholder = clonePlaceholder(liveNode, pageNode)
      }
      state.heldMotion = holdMotion(liveNode)
    }
    insertClean(liveNode, targetParent)
    source?.repaint({ immediate: true })
  } else if (!draws.page && state.placeholder) {
    state.placeholder.remove()
    state.placeholder = null
  }
}

export function applyPixelSnap(
  pose: SurfacePose,
  enabled: boolean,
  size: readonly [number, number],
  viewport: ViewportState,
  src: DomTextureSource,
): SurfacePose {
  const flat = (pose.rx ?? 0) === 0 && (pose.ry ?? 0) === 0 && (pose.rz ?? 0) === 0
  if (!enabled || !flat) return pose
  const snap = snapSurfacePose(pose.x, pose.y, size, viewport, src)
  return {
    ...pose,
    x: pose.x + snap.dx,
    y: pose.y + snap.dy,
    sx: (pose.sx ?? 1) * snap.sx,
    sy: (pose.sy ?? 1) * snap.sy,
  }
}

export function makeCaptureRoot(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'ui-root'
  el.style.display = 'block'
  el.style.backgroundColor = 'transparent'
  el.addEventListener(
    'gotpointercapture',
    (e) => {
      if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
    },
    true,
  )
  return el
}

export function buildSurfaceSlotStyle(
  size: readonly [number, number] | undefined,
  bodyColor: string | null,
): CSSProperties & Record<string, string | number | undefined> {
  const base: CSSProperties & Record<string, string | number | undefined> = {
    width: size ? size[0] : undefined,
    height: size ? size[1] : undefined,
    position: 'relative',
  }
  if (bodyColor !== null) base['--munari-body'] = bodyColor
  return base
}

export function resolvePageSlotSize(
  size: readonly [number, number] | undefined,
  slotPinned: boolean,
  hasMeasured: boolean,
  measured: readonly [number, number],
): readonly [number, number] | undefined {
  return size ?? (slotPinned && hasMeasured ? measured : undefined)
}

export function liveRootStyle(size: readonly [number, number] | undefined) {
  return { width: size ? size[0] : undefined, height: size ? size[1] : undefined }
}

export function resolveSurfaceViewFormat<TUniforms>(
  finish: SurfaceFinish | undefined,
  factory: GpuMaterialFactory | undefined,
  material?: MaterialManifest<TUniforms>,
): 'rgba8unorm' | 'rgba8unorm-srgb' {
  if (finish) return 'rgba8unorm'
  return factory?.sampleViewFormat ?? material?.sampleViewFormat ?? 'rgba8unorm'
}

export function advanceSurfacePass(params: {
  readonly receipt: GpuPassReceipt
  readonly tex: GpuSurfaceTexture
  readonly identity: SurfaceIdentity
  readonly acquiredEpoch: number
  readonly presenterKey: string
  readonly askRead: number
  readonly dtMs: number
  readonly crossing: CrossingState
  readonly readiness: SurfaceReadiness
  readonly crossingFrameFn: (
    state: CrossingState,
    signal: { readonly presented: number; readonly required: number; readonly contentCurrent: boolean },
    dtMs: number,
  ) => CrossingState
}): { readonly crossing: CrossingState; readonly readiness: SurfaceReadiness } | null {
  if (!params.tex.uploaded()) return null
  const route = presentationRoute(
    {
      defaultFramebuffer: true,
      colorWrite: params.receipt.colorWritten,
      depthWrite: false,
      stencilWrite: false,
      drawable: params.receipt.triangles > 0,
    },
    true,
  )
  if (route === 'empty') return null
  if (!surfaceEpochCurrent(params.identity, params.acquiredEpoch)) return null
  const nextReadiness = readinessProve(params.readiness, params.presenterKey, params.readiness.lifetime)
  const contentCurrent = params.crossing.heldMs >= 200 || params.tex.uploadedRead() >= params.askRead
  const nextCrossing = params.crossingFrameFn(
    params.crossing,
    { presented: route === 'now' ? 1 : 0, required: 1, contentCurrent },
    params.dtMs,
  )
  return { crossing: nextCrossing, readiness: nextReadiness }
}
