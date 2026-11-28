// WebGPU SurfaceCanvas — owns the GpuRenderer lifecycle, lighting rig,
// pointer forwarding, device-loss recovery, and clean no-WebGPU fallback.
//
// The law: a single React tree draws DOM content cleanly onto the page until a
// WebGPU pipeline and texture are proven ready; on `device.lost`, every Surface
// returns synchronously to its page presentation and the host attempts at most
// one automatic remount unless losses recur within `REPEATED_LOSS_MS`
// (decisions.md #73). Moving a `createSurfaceLight()` handle invalidates only
// frames, without React re-renders (`decisions.md #79`).
//
// Ownership: this component owns the WebGPU `<canvas>` and `GpuHost`; `Surface`
// owns its retained DOM source and GPU presenter.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cameraDistance } from '@munari/core'
import {
  attachSurfaceLight,
  isSurfaceLight,
  type SurfaceLighting,
} from '../primitives/surface/surfaceLight'
import {
  mat4FromPositionEulerScale,
  mat4Invert,
  mat4Multiply,
  mat4PerspectiveZeroToOne,
} from './math'
import { createGpuRenderer, resolveFrameContext, type GpuDrawItem, type GpuRenderer } from './webgpu'
import { GpuHostContext, getOrCreateGpuHost, hostInternals, installPointerGate } from './host'

// Same 10s guard window as Three SurfaceCanvas (decisions.md #73).
const REPEATED_LOSS_MS = 10_000

export interface SurfaceCanvasProps {
  readonly id?: string
  readonly frameloop?: 'demand' | 'always' | 'manual'
  readonly pointerMode?: 'scene' | 'surfaces'
  readonly fov?: number
  readonly lighting?: SurfaceLighting
  readonly style?: CSSProperties
  readonly children?: ReactNode
  readonly onReady?: (renderer: GpuRenderer) => void
  readonly onRendererLost?: (reason: string) => void
}

export function SurfaceCanvas({
  id = '',
  frameloop = 'demand',
  pointerMode = 'surfaces',
  fov = 42,
  lighting = 'studio',
  style,
  children,
  onReady,
  onRendererLost,
}: SurfaceCanvasProps) {
  const host = useMemo(() => getOrCreateGpuHost(id), [id])
  host.lighting = lighting
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const [mountEpoch, setMountEpoch] = useState(0)
  const [degraded, setDegraded] = useState(false)
  const lastLossMsRef = useRef<number | null>(null)
  const cancelPendingRef = useRef<(() => void) | null>(null)
  const frameloopRef = useRef(frameloop)
  frameloopRef.current = frameloop
  const fovRef = useRef(fov)
  fovRef.current = fov
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onLostRef = useRef(onRendererLost)
  onLostRef.current = onRendererLost

  useEffect(() => {
    if (lighting === 'studio' || lighting === 'none' || !lighting.key || !isSurfaceLight(lighting.key)) {
      host.invalidate()
      return
    }
    const detach = attachSurfaceLight(lighting.key, () => host.invalidate())
    host.invalidate()
    return detach
  }, [host, lighting])

  useLayoutEffect(() => {
    if (!canvasEl || degraded) return
    let disposed = false
    let rafId = 0
    let scheduled = false
    let prevTime = performance.now()
    const frameTail = new Float32Array(24)
    let renderer: GpuRenderer | null = null
    let stopGate = () => {}

    const syncViewport = () => {
      const rect = canvasEl.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const dpr = window.devicePixelRatio || 1
      const camZ = cameraDistance(height, fovRef.current)
      host.viewport.left = rect.left
      host.viewport.top = rect.top
      host.viewport.width = width
      host.viewport.height = height
      host.viewport.dpr = dpr
      host.viewport.fov = fovRef.current
      host.viewport.cameraZ = camZ
      const proj = mat4PerspectiveZeroToOne(fovRef.current, width / height, 1, camZ * 3)
      const view = mat4FromPositionEulerScale(0, 0, -camZ, 0, 0, 0, 1, 1, 1)
      mat4Multiply(proj, view, host.viewport.viewProj)
      mat4Invert(host.viewport.viewProj, host.viewport.invViewProj)
      renderer?.resize(width * dpr, height * dpr)
    }

    const renderFrame = (explicitDtMs?: number): boolean => {
      if (explicitDtMs === undefined) scheduled = false
      if (disposed || !renderer) return false
      const now = performance.now()
      const dtMs =
        explicitDtMs !== undefined
          ? Number.isFinite(explicitDtMs)
            ? Math.max(0, explicitDtMs)
            : 0
          : Math.max(0, Math.min(now - prevTime, 1000 / 30))
      if (explicitDtMs === undefined) prevTime = now
      const elapsedMs = host.elapsedMs + dtMs
      host.elapsedMs = elapsedMs
      syncViewport()

      const internal = hostInternals.get(host)
      const items: GpuDrawItem[] = []
      if (internal) {
        for (const surface of internal.surfaces.values()) {
          const item = surface.tick(dtMs, elapsedMs, host.viewport)
          if (!item) continue
          if ('length' in item) items.push(...item)
          else items.push(item)
        }
      }
      renderer.render(items, resolveFrameContext(host.viewport, host.lighting, elapsedMs, dtMs, frameTail))
      host.renderCount += 1

      if (explicitDtMs === undefined && frameloopRef.current !== 'manual' && (frameloopRef.current === 'always' || host.workClaims() > 0)) {
        schedule()
      }
      return true
    }

    const schedule = () => {
      if (disposed || scheduled || !renderer || frameloopRef.current === 'manual') return
      scheduled = true
      rafId = requestAnimationFrame(() => renderFrame())
    }

    const internal = hostInternals.get(host)
    internal?.setScheduler(schedule, schedule)
    internal?.setManualStepper((dtMs) => (frameloopRef.current === 'manual' ? renderFrame(dtMs) : false))
    cancelPendingRef.current = () => {
      cancelAnimationFrame(rafId)
      scheduled = false
    }

    const ro = new ResizeObserver(() => {
      syncViewport()
      schedule()
    })
    ro.observe(canvasEl)
    const onScroll = () => syncViewport()
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })

    const handleLoss = (reason: string) => {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(rafId)
      internal?.setManualStepper(null)
      stopGate()
      host.renderer = null
      host.canvas = null
      renderer = null
      if (internal) {
        for (const surface of internal.surfaces.values()) surface.onRendererLost()
      }
      onLostRef.current?.(reason)
      const now = performance.now()
      const repeated = lastLossMsRef.current !== null && now - lastLossMsRef.current < REPEATED_LOSS_MS
      lastLossMsRef.current = now
      if (repeated) setDegraded(true)
      else setMountEpoch((e) => e + 1)
    }

    void createGpuRenderer(canvasEl, handleLoss).then(
      (r) => {
        if (disposed) {
          r.dispose()
          return
        }
        renderer = r
        host.renderer = r
        host.canvas = canvasEl
        syncViewport()
        stopGate = installPointerGate(host, canvasEl, pointerMode)
        onReadyRef.current?.(r)
        if (internal) {
          for (const fn of internal.readyListeners) fn()
        }
        schedule()
      },
      (err) => {
        if (disposed) return
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[munari/gpu] WebGPU unavailable; staying on retained page HTML.', err)
        }
        setDegraded(true)
      },
    )

    return () => {
      disposed = true
      cancelPendingRef.current = null
      cancelAnimationFrame(rafId)
      internal?.setManualStepper(null)
      ro.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      stopGate()
      host.renderer = null
      host.canvas = null
      renderer?.dispose()
    }
  }, [canvasEl, degraded, host, mountEpoch, pointerMode])

  useEffect(() => {
    if (frameloop === 'manual') {
      cancelPendingRef.current?.()
      return
    }
    host.invalidate()
  }, [host, frameloop, fov])

  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      position: 'relative',
      ...style,
    }),
    [style],
  )

  return (
    <GpuHostContext value={host}>
      <div style={wrapperStyle}>
        {children}
        <canvas
          key={mountEpoch}
          ref={setCanvasEl}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            zIndex: 10,
            display: degraded ? 'none' : 'block',
            pointerEvents: pointerMode === 'surfaces' ? 'none' : 'auto',
          }}
        />
      </div>
    </GpuHostContext>
  )
}
