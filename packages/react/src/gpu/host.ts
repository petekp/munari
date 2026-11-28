// Shared GpuHost coordinator and pointer gate — bridges DOM surface registrations
// with the demand-driven WebGPU canvas loop and `@munari/core` pointer routing.
//
// The law: one host tracks all surfaces registered to a `canvasId`, wakes the
// render loop only when animations, uploads, or lighting ask for work, and
// transforms eye rays cleanly through each rendered surface mesh (decisions.md #33, #39).
//
// Ownership: `SurfaceCanvas.tsx` drives ticks and renderer lifecycle on this
// host; `Surface.tsx` registers/unregisters surfaces; `finishLookup` delegates
// finish rendering to compiled manifests.

import { createContext } from 'react'
import {
  clearPointerState,
  deepestElementAt,
  forwardPointer,
  forwardWheel,
  isRelayed,
  pointerSampleOf,
  releasedSample,
  surfaceCursorAt,
  surfaceRadiusSd,
  trackDrag,
  trackFocusModality,
  trackPointerPlace,
  trackWheel,
} from '@munari/core'
import { rayFromNdc, raycastIndexedMesh, type Mat4, type RayHit } from './math'
import type { GpuDrawItem, GpuGeometry, GpuRenderer } from './webgpu'
import type { SurfaceLighting } from '../primitives/surface/surfaceLight'

export interface ViewportState {
  left: number
  top: number
  width: number
  height: number
  dpr: number
  fov: number
  cameraZ: number
  viewProj: Mat4
  invViewProj: Mat4
}

export interface RegisteredSurface {
  readonly id: string
  readonly pointerEvents: () => 'geometry' | 'content' | 'none'
  readonly hears: () => boolean
  readonly element: () => HTMLElement | null
  readonly size: () => readonly [number, number]
  readonly radii: () => [number, number, number, number]
  readonly geometry: () => GpuGeometry | null
  readonly worldMat: () => Mat4
  readonly invWorldMat: () => Mat4
  readonly onRendererLost: () => void
  readonly tick: (dtMs: number, elapsedMs: number, viewport: ViewportState) => GpuDrawItem | readonly GpuDrawItem[] | null
}

export interface GpuHost {
  readonly id: string
  renderer: GpuRenderer | null
  canvas: HTMLCanvasElement | null
  lighting: SurfaceLighting
  readonly viewport: ViewportState
  renderCount: number
  elapsedMs: number
  registerSurface(surface: RegisteredSurface): () => void
  claimWork(): () => void
  workClaims(): number
  invalidate(): void
  onReady(listener: () => void): () => void
  getRenderCount(): number
}

export interface HostInternal {
  readonly surfaces: Map<string, RegisteredSurface>
  readonly readyListeners: Set<() => void>
  manualStepper: ((dtMs: number) => boolean) | null
  setScheduler(invalidateFn: () => void, claimFn: () => void): void
  setManualStepper(fn: ((dtMs: number) => boolean) | null): void
}

const hosts = new Map<string, GpuHost>()
export const hostInternals = new WeakMap<GpuHost, HostInternal>()

function createIdentityMat4(): Mat4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

function createHost(id: string): GpuHost {
  const surfaces = new Map<string, RegisteredSurface>()
  const readyListeners = new Set<() => void>()
  let claims = 0
  let onClaimChange: (() => void) | null = null
  let onInvalidate: (() => void) | null = null

  const viewport: ViewportState = {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    dpr: 1,
    fov: 42,
    cameraZ: 1000,
    viewProj: createIdentityMat4(),
    invViewProj: createIdentityMat4(),
  }

  const host: GpuHost = {
    id,
    renderer: null,
    canvas: null,
    lighting: 'studio',
    viewport,
    renderCount: 0,
    elapsedMs: 0,
    registerSurface(surface) {
      surfaces.set(surface.id, surface)
      host.invalidate()
      return () => {
        surfaces.delete(surface.id)
        host.invalidate()
      }
    },
    claimWork() {
      claims += 1
      onClaimChange?.()
      host.invalidate()
      let released = false
      return () => {
        if (released) return
        released = true
        claims = Math.max(0, claims - 1)
        onClaimChange?.()
        host.invalidate()
      }
    },
    workClaims: () => claims,
    invalidate() {
      onInvalidate?.()
    },
    onReady(listener) {
      readyListeners.add(listener)
      return () => readyListeners.delete(listener)
    },
    getRenderCount: () => host.renderCount,
  }

  const internal: HostInternal = {
    surfaces,
    readyListeners,
    manualStepper: null,
    setScheduler(invalidateFn, claimFn) {
      onInvalidate = invalidateFn
      onClaimChange = claimFn
    },
    setManualStepper(fn) {
      internal.manualStepper = fn
    },
  }
  hostInternals.set(host, internal)
  return host
}

export function getOrCreateGpuHost(id = ''): GpuHost {
  let host = hosts.get(id)
  if (!host) {
    host = createHost(id)
    hosts.set(id, host)
  }
  return host
}

export interface GpuHostStats {
  readonly renderCount: number
  readonly workClaims: number
  readonly elapsedMs: number
}

export interface GpuStepResult {
  readonly stepped: boolean
  readonly renderCount: number
  readonly elapsedMs: number
  readonly workClaims: number
}

export interface GpuSettleResult {
  readonly steps: number
  readonly settled: boolean
  readonly renderCount: number
  readonly elapsedMs: number
  readonly workClaims: number
}

/** Frame and work counters for a mounted `@petepetrash/munari/gpu` host. */
export function getGpuHostStats(canvasId = ''): GpuHostStats {
  const host = hosts.get(canvasId)
  return {
    renderCount: host?.renderCount ?? 0,
    workClaims: host?.workClaims() ?? 0,
    elapsedMs: host?.elapsedMs ?? 0,
  }
}

/** Triggers a test device loss on a mounted `canvasId` host; returns false if none is active. */
export function simulateGpuDeviceLoss(canvasId = ''): boolean {
  const renderer = hosts.get(canvasId)?.renderer
  if (!renderer) return false
  renderer.simulateDeviceLoss()
  return true
}

/** Schedules a render frame for an idle `demand` host (e.g. when external state wakes `onFrame`). */
export function requestGpuFrame(canvasId = ''): void {
  hosts.get(canvasId)?.invalidate()
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function finiteMaxSteps(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 240
}

function buildSettleResult(steps: number, settled: boolean, host?: GpuHost): GpuSettleResult {
  return {
    steps,
    settled,
    renderCount: host?.renderCount ?? 0,
    elapsedMs: host?.elapsedMs ?? 0,
    workClaims: host?.workClaims() ?? 0,
  }
}

/** Advances a `frameloop="manual"` host synchronously by `dtMs` milliseconds. */
export function stepGpuFrame(canvasId = '', dtMs = 1000 / 60): GpuStepResult {
  const host = hosts.get(canvasId)
  const internal = host ? hostInternals.get(host) : undefined
  const stepped = Boolean(internal?.manualStepper?.(finiteNonNegative(dtMs, 0)))
  return {
    stepped,
    renderCount: host?.renderCount ?? 0,
    elapsedMs: host?.elapsedMs ?? 0,
    workClaims: host?.workClaims() ?? 0,
  }
}

/** Repeatedly steps a `frameloop="manual"` host until all work claims settle or `maxSteps` is hit. */
export function settleGpuFrames(
  canvasId = '',
  options?: { readonly dtMs?: number; readonly maxSteps?: number },
): GpuSettleResult {
  const host = hosts.get(canvasId)
  const stepper = host ? hostInternals.get(host)?.manualStepper : undefined
  if (!host || !stepper) return buildSettleResult(0, false, host)
  const dtMs = finiteNonNegative(options?.dtMs, 16)
  const maxSteps = finiteMaxSteps(options?.maxSteps)
  let steps = 0
  let lastOk = false
  do {
    lastOk = stepper(dtMs)
    if (!lastOk) break
    steps += 1
  } while (steps < maxSteps && host.workClaims() > 0)
  return buildSettleResult(steps, steps > 0 && lastOk && host.workClaims() === 0, host)
}

export const GpuHostContext = createContext<GpuHost | null>(null)

interface SurfaceHitResult {
  readonly surface: RegisteredSurface
  readonly hit: RayHit
}

export function hitPassesSurfaceMask(surface: RegisteredSurface, hit: RayHit): boolean {
  if (hit.u < 0 || hit.u > 1 || hit.v < 0 || hit.v > 1) return false
  const radii = surface.radii()
  if (radii.some((v) => v > 0)) {
    const [w, h] = surface.size()
    if (surfaceRadiusSd(hit.u, hit.v, w, h, radii) > 0) return false
  }
  if (surface.pointerEvents() === 'content') {
    const el = surface.element()
    if (el) {
      const r = el.getBoundingClientRect()
      const dx = r.left + hit.u * r.width
      const dy = r.top + (1 - hit.v) * r.height
      const target = deepestElementAt(el, dx, dy)
      if (!target || getComputedStyle(target).pointerEvents === 'none') return false
    }
  }
  return true
}

function raycastSurfaces(host: GpuHost, clientX: number, clientY: number): SurfaceHitResult | null {
  const canvas = host.canvas
  const internal = hostInternals.get(host)
  if (!canvas || !internal) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null
  }
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1)
  const ray = rayFromNdc({
    ndcX,
    ndcY,
    camPos: [0, 0, host.viewport.cameraZ],
    invViewProj: host.viewport.invViewProj,
  })

  let best: SurfaceHitResult | null = null
  for (const surface of internal.surfaces.values()) {
    if (!surface.hears() || surface.pointerEvents() === 'none') continue
    const geo = surface.geometry()
    if (!geo) continue
    const hit = raycastIndexedMesh(
      ray.origin,
      ray.dir,
      surface.worldMat(),
      surface.invWorldMat(),
      geo.positions,
      geo.uvs,
      geo.indices,
      geo.bounds,
    )
    if (!hit || !hitPassesSurfaceMask(surface, hit)) continue
    if (!best || hit.distance < best.hit.distance) {
      best = { surface, hit }
    }
  }
  return best
}

function updateCanvasCursor(
  canvas: HTMLCanvasElement,
  hitResult: { readonly surface: RegisteredSurface; readonly hit: RayHit } | null,
) {
  const el = hitResult?.surface.element()
  if (!hitResult || !el) {
    canvas.style.cursor = ''
    return
  }
  const r = el.getBoundingClientRect()
  const target = deepestElementAt(
    el,
    r.left + hitResult.hit.u * r.width,
    r.top + (1 - hitResult.hit.v) * r.height,
  )
  canvas.style.cursor = target ? surfaceCursorAt(target) : ''
}

function canvasIsTopmostAt(canvas: HTMLCanvasElement, x: number, y: number): boolean {
  const prev = canvas.style.pointerEvents
  canvas.style.pointerEvents = 'auto'
  const top = document.elementFromPoint(x, y)
  canvas.style.pointerEvents = prev
  return top === canvas || (top instanceof Node && canvas.contains(top))
}

export function installPointerGate(host: GpuHost, canvas: HTMLCanvasElement, pointerMode: 'scene' | 'surfaces'): () => void {
  const stopDrag = trackDrag()
  const stopWheel = trackWheel()
  const stopFocus = trackFocusModality()
  const stopPlace = trackPointerPlace()

  const claims = new Map<number, RegisteredSurface>()
  let hovered: RegisteredSurface | null = null
  let suppressedClick: { readonly x: number; readonly y: number; readonly until: number } | null = null

  const setSolid = (solid: boolean) => {
    if (pointerMode === 'scene') return
    canvas.style.pointerEvents = solid ? 'auto' : 'none'
    if (!solid) canvas.style.cursor = ''
  }
  setSolid(false)

  const deliver = (
    surface: RegisteredSurface,
    u: number,
    v: number,
    kind: 'down' | 'up' | 'move' | 'cancel',
    sample: PointerEvent,
  ) => {
    const el = surface.element()
    if (el) forwardPointer(el, u, v, kind, pointerSampleOf(sample))
  }

  const onMove = (e: PointerEvent) => {
    if (!e.isTrusted) return
    const claimed = claims.get(e.pointerId)
    const hitResult = raycastSurfaces(host, e.clientX, e.clientY)
    if (claimed) {
      setSolid(true)
      if (hitResult && hitResult.surface === claimed) {
        deliver(claimed, hitResult.hit.u, hitResult.hit.v, 'move', e)
        updateCanvasCursor(canvas, hitResult)
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    const topmostHit = hitResult && canvasIsTopmostAt(canvas, e.clientX, e.clientY) ? hitResult : null
    if (hovered && hovered !== topmostHit?.surface) {
      const prevEl = hovered.element()
      if (prevEl) clearPointerState(prevEl)
      hovered = null
    }
    if (topmostHit) {
      setSolid(true)
      hovered = topmostHit.surface
      deliver(topmostHit.surface, topmostHit.hit.u, topmostHit.hit.v, 'move', e)
      updateCanvasCursor(canvas, topmostHit)
    } else {
      setSolid(false)
    }
  }

  const onDown = (e: PointerEvent) => {
    if (!e.isTrusted) return
    const hitResult = raycastSurfaces(host, e.clientX, e.clientY)
    if (!hitResult || !canvasIsTopmostAt(canvas, e.clientX, e.clientY)) return
    claims.set(e.pointerId, hitResult.surface)
    setSolid(true)
    suppressedClick = { x: e.clientX, y: e.clientY, until: performance.now() + 1000 }
    e.preventDefault()
    e.stopImmediatePropagation()
    hovered = hitResult.surface
    deliver(hitResult.surface, hitResult.hit.u, hitResult.hit.v, 'down', e)
    updateCanvasCursor(canvas, hitResult)
  }

  const onUpOrCancel = (e: PointerEvent) => {
    if (!e.isTrusted) return
    const claimed = claims.get(e.pointerId)
    if (!claimed) return
    claims.delete(e.pointerId)
    const kind = e.type === 'pointercancel' ? 'cancel' : 'up'
    const hitResult = raycastSurfaces(host, e.clientX, e.clientY)
    const el = claimed.element()
    if (el && hitResult && hitResult.surface === claimed) {
      forwardPointer(el, hitResult.hit.u, hitResult.hit.v, kind, pointerSampleOf(e))
      forwardPointer(el, hitResult.hit.u, hitResult.hit.v, 'move', releasedSample(pointerSampleOf(e)))
      setSolid(true)
      updateCanvasCursor(canvas, hitResult)
    } else if (el) {
      forwardPointer(el, 0, 0, 'cancel', pointerSampleOf(e))
      clearPointerState(el)
      hovered = null
      setSolid(false)
    }
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  const onClick = (e: MouseEvent) => {
    if (isRelayed(e) || !e.isTrusted || !suppressedClick) return
    if (performance.now() > suppressedClick.until) {
      suppressedClick = null
      return
    }
    if (Math.hypot(e.clientX - suppressedClick.x, e.clientY - suppressedClick.y) <= 8) {
      e.preventDefault()
      e.stopImmediatePropagation()
      suppressedClick = null
    }
  }

  const onWheel = (e: WheelEvent) => {
    if (!e.isTrusted) return
    const hitResult = raycastSurfaces(host, e.clientX, e.clientY)
    const el = hitResult?.surface.element()
    if (!hitResult || !el || !canvasIsTopmostAt(canvas, e.clientX, e.clientY)) return
    const r = el.getBoundingClientRect()
    const x = r.left + hitResult.hit.u * r.width
    const y = r.top + (1 - hitResult.hit.v) * r.height
    if (forwardWheel(el, x, y, { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode })) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  document.addEventListener('pointermove', onMove, { capture: true, passive: false })
  document.addEventListener('pointerdown', onDown, { capture: true, passive: false })
  document.addEventListener('pointerup', onUpOrCancel, { capture: true, passive: false })
  document.addEventListener('pointercancel', onUpOrCancel, { capture: true, passive: false })
  document.addEventListener('click', onClick, true)
  document.addEventListener('wheel', onWheel, { capture: true, passive: false })

  return () => {
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointerup', onUpOrCancel, true)
    document.removeEventListener('pointercancel', onUpOrCancel, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('wheel', onWheel, true)
    stopDrag()
    stopWheel()
    stopFocus()
    stopPlace()
  }
}
