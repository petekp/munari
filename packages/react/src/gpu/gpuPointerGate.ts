// Lazy WebGPU pointer gate — eye-ray projection, rounded-corner & content
// pointer masks, wheel forwarding, and hover bridging for Surface DOM copies.
//
// The law: only loads once WebGPU initialization begins (`import('./gpuEngine')`),
// keeping the `@munari/core` pointer forwarder out of initial SSR/fallback and
// eager surface bundles.
//
// Ownership: `@petepetrash/munari/gpu`.

import {
  bridgeHover,
  clearPointerState,
  deepestElementAt,
  forwardPointer,
  forwardWheel,
  isRelayed,
  lastPointerPlace,
  pointerSampleOf,
  releasedSample,
  surfaceCursorAt,
  surfaceRadiusSd,
  trackDrag,
  trackFocusModality,
  trackPointerPlace,
  trackWheel,
  type ForwardPointerSample,
} from '@munari/core'
import { rayFromNdc, raycastIndexedMesh, type RayHit } from './math'
import { hostInternals, type GpuHost, type RegisteredSurface } from './host'

interface SurfaceHitResult {
  readonly surface: RegisteredSurface
  readonly hit: RayHit
}

export interface GpuPointerGateHandle {
  readonly dispose: () => void
  readonly syncHover: () => void
}

export function bridgeHoverAtLastPointer(pageNode: HTMLElement): void {
  const place = lastPointerPlace()
  if (place) bridgeHover(pageNode, place.x, place.y)
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

export function installPointerGate(
  host: GpuHost,
  canvas: HTMLCanvasElement,
  pointerMode: 'scene' | 'surfaces',
): GpuPointerGateHandle {
  const stopDrag = trackDrag()
  const stopWheel = trackWheel()
  const stopFocus = trackFocusModality()
  const stopPlace = trackPointerPlace()

  const claims = new Map<number, RegisteredSurface>()
  let hovered: RegisteredSurface | null = null
  let lastHover: { readonly surface: RegisteredSurface; readonly u: number; readonly v: number } | null = null
  let suppressedClick: { readonly x: number; readonly y: number; readonly until: number } | null = null

  const setSolid = (solid: boolean) => {
    if (pointerMode === 'scene') return
    canvas.style.pointerEvents = solid ? 'auto' : 'none'
    if (!solid) canvas.style.cursor = ''
  }
  setSolid(false)

  const deliverSample = (
    surface: RegisteredSurface,
    u: number,
    v: number,
    kind: 'down' | 'up' | 'move' | 'cancel',
    sample: ForwardPointerSample,
  ) => {
    const el = surface.element()
    if (el) forwardPointer(el, u, v, kind, sample)
  }

  const applyHoverHit = (
    topmostHit: SurfaceHitResult | null,
    sample: ForwardPointerSample,
    force: boolean,
  ) => {
    if (!force) {
      if (!topmostHit && !hovered) return
      if (
        topmostHit &&
        hovered === topmostHit.surface &&
        lastHover &&
        Math.abs(lastHover.u - topmostHit.hit.u) < 1e-4 &&
        Math.abs(lastHover.v - topmostHit.hit.v) < 1e-4
      ) {
        return
      }
    }
    if (hovered && hovered !== topmostHit?.surface) {
      const prevEl = hovered.element()
      if (prevEl) clearPointerState(prevEl)
      hovered = null
    }
    if (topmostHit) {
      setSolid(true)
      hovered = topmostHit.surface
      lastHover = { surface: topmostHit.surface, u: topmostHit.hit.u, v: topmostHit.hit.v }
      deliverSample(topmostHit.surface, topmostHit.hit.u, topmostHit.hit.v, 'move', sample)
      updateCanvasCursor(canvas, topmostHit)
    } else {
      lastHover = null
      setSolid(false)
    }
  }

  const onMove = (e: PointerEvent) => {
    if (!e.isTrusted) return
    const claimed = claims.get(e.pointerId)
    const hitResult = raycastSurfaces(host, e.clientX, e.clientY)
    if (claimed) {
      setSolid(true)
      if (hitResult && hitResult.surface === claimed) {
        deliverSample(claimed, hitResult.hit.u, hitResult.hit.v, 'move', pointerSampleOf(e))
        updateCanvasCursor(canvas, hitResult)
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    const topmostHit = hitResult && canvasIsTopmostAt(canvas, e.clientX, e.clientY) ? hitResult : null
    applyHoverHit(topmostHit, pointerSampleOf(e), true)
  }

  const syncHover = () => {
    if (claims.size > 0) return
    const place = lastPointerPlace()
    if (!place) return
    const rect = canvas.getBoundingClientRect()
    if (place.x < rect.left || place.x > rect.right || place.y < rect.top || place.y > rect.bottom) {
      applyHoverHit(null, place.sample, false)
      return
    }
    const hitResult = raycastSurfaces(host, place.x, place.y)
    const topmostHit = hitResult && canvasIsTopmostAt(canvas, place.x, place.y) ? hitResult : null
    applyHoverHit(topmostHit, place.sample, false)
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
    deliverSample(hitResult.surface, hitResult.hit.u, hitResult.hit.v, 'down', pointerSampleOf(e))
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
      lastHover = null
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

  return {
    syncHover,
    dispose() {
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
    },
  }
}
