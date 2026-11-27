// Micro-engine host registry, types, and pointer-gate arbiter.

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
  type CrossingPhase,
  type SurfaceChrome,
} from '@munari/core'
import { mat4Identity, rayFromNdc, raycastIndexedMesh, type Mat4, type RayHit } from './math'
import type { DeformedPoint, MicroDrawItem, MicroGeometry, MicroMaterial, MicroRenderer } from './webgpu'

export interface MicroPose {
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

export interface MicroViewport {
  readonly width: number
  readonly height: number
  readonly dpr: number
  readonly cameraZ: number
}

export interface MicroSurfaceFrameCtx {
  readonly dtMs: number
  readonly elapsedMs: number
  readonly progress: number
  readonly easedProgress: number
  readonly phase: CrossingPhase
  readonly presentation: 'page' | 'scene' | 'none'
  readonly size: readonly [number, number]
  readonly chrome: SurfaceChrome
  readonly geometry: MicroGeometry
  readonly material: MicroMaterial
  readonly viewport: MicroViewport
  readonly pageRect: DOMRect | null
  setPose(pose: MicroPose): void
  deform(place: (x: number, y: number, index: number) => DeformedPoint): void
  setExtraAttribute(slot: number, data: Float32Array<ArrayBuffer>): void
  setCustomUniforms(data: Float32Array<ArrayBuffer>): void
}

export interface RegisteredSurface {
  readonly id: string
  readonly pointerEvents: () => 'geometry' | 'content' | 'none'
  readonly hears: () => boolean
  readonly element: () => HTMLElement | null
  readonly size: () => readonly [number, number]
  readonly radii: () => [number, number, number, number]
  readonly geometry: () => MicroGeometry | null
  readonly worldMat: () => Mat4
  readonly invWorldMat: () => Mat4
  readonly onRendererLost: () => void
  readonly tick: (dtMs: number, elapsedMs: number, viewport: ViewportState) => MicroDrawItem | null
}

export interface ViewportState {
  width: number
  height: number
  dpr: number
  fov: number
  cameraZ: number
  viewProj: Mat4
  invViewProj: Mat4
}

export interface MicroHost {
  readonly id: string
  renderer: MicroRenderer | null
  canvas: HTMLCanvasElement | null
  readonly viewport: ViewportState
  renderCount: number
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
  setScheduler(invalidateFn: () => void, claimFn: () => void): void
}

const hosts = new Map<string, MicroHost>()
export const hostInternals = new WeakMap<MicroHost, HostInternal>()

function createHost(id: string): MicroHost {
  const surfaces = new Map<string, RegisteredSurface>()
  const readyListeners = new Set<() => void>()
  let claims = 0
  let onClaimChange: (() => void) | null = null
  let onInvalidate: (() => void) | null = null

  const viewport: ViewportState = {
    width: 1,
    height: 1,
    dpr: 1,
    fov: 42,
    cameraZ: 1000,
    viewProj: mat4Identity(),
    invViewProj: mat4Identity(),
  }

  const host: MicroHost = {
    id,
    renderer: null,
    canvas: null,
    viewport,
    renderCount: 0,
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

  hostInternals.set(host, {
    surfaces,
    readyListeners,
    setScheduler(invalidateFn, claimFn) {
      onInvalidate = invalidateFn
      onClaimChange = claimFn
    },
  })
  return host
}

export function getOrCreateHost(id = ''): MicroHost {
  let host = hosts.get(id)
  if (!host) {
    host = createHost(id)
    hosts.set(id, host)
  }
  return host
}

export interface MicroHostStats {
  readonly renderCount: number
  readonly workClaims: number
}

export function getMicroHostStats(canvasId = ''): MicroHostStats {
  const host = hosts.get(canvasId)
  return { renderCount: host?.renderCount ?? 0, workClaims: host?.workClaims() ?? 0 }
}

export function simulateMicroDeviceLoss(canvasId = ''): boolean {
  const renderer = hosts.get(canvasId)?.renderer
  if (!renderer) return false
  renderer.simulateDeviceLoss()
  return true
}

export const MicroHostContext = createContext<MicroHost | null>(null)

interface SurfaceHitResult {
  readonly surface: RegisteredSurface
  readonly hit: RayHit
}

function hitPassesMask(surface: RegisteredSurface, hit: RayHit): boolean {
  const mode = surface.pointerEvents()
  const el = surface.element()
  if (mode === 'content' && el) {
    const r = el.getBoundingClientRect()
    return deepestElementAt(el, r.left + hit.u * r.width, r.top + (1 - hit.v) * r.height) !== null
  }
  const radii = surface.radii()
  if (radii.some((v) => v > 0)) {
    const [w, h] = surface.size()
    return surfaceRadiusSd(hit.u, hit.v, w, h, radii) <= 0
  }
  return true
}

function raycastSurfaces(host: MicroHost, clientX: number, clientY: number): SurfaceHitResult | null {
  const canvas = host.canvas
  const internal = hostInternals.get(host)
  if (!canvas || !internal) return null
  const rect = canvas.getBoundingClientRect()
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null
  }
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
  const { origin, dir } = rayFromNdc({
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
      origin,
      dir,
      surface.worldMat(),
      surface.invWorldMat(),
      geo.positions,
      geo.uvs,
      geo.indices,
      geo.bounds,
    )
    if (!hit || !hitPassesMask(surface, hit)) continue
    if (!best || hit.distance < best.hit.distance) best = { surface, hit }
  }
  return best
}

function updateCanvasCursor(canvas: HTMLCanvasElement, hitResult: SurfaceHitResult | null) {
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

export function installPointerGate(host: MicroHost, canvas: HTMLCanvasElement, pointerMode: 'scene' | 'surfaces'): () => void {
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

  const deliver = (surface: RegisteredSurface, u: number, v: number, kind: 'down' | 'up' | 'move' | 'cancel', sample: PointerEvent) => {
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
    if (hovered && hovered !== hitResult?.surface) {
      const prevEl = hovered.element()
      if (prevEl) clearPointerState(prevEl)
      hovered = null
    }
    if (hitResult) {
      setSolid(true)
      hovered = hitResult.surface
      deliver(hitResult.surface, hitResult.hit.u, hitResult.hit.v, 'move', e)
      updateCanvasCursor(canvas, hitResult)
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
    if (!hitResult || !el) return
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
