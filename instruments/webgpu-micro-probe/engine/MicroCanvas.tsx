// Micro-engine root canvas host and WebGPU lifecycle manager.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cameraDistance } from '@munari/core'
import { MicroHostContext, getOrCreateHost, hostInternals, installPointerGate } from './hostState'
import { mat4FromPositionEulerScale, mat4Invert, mat4Multiply, mat4PerspectiveZeroToOne } from './math'
import { createMicroRenderer, type MicroDrawItem, type MicroRenderer } from './webgpu'

const REPEATED_LOSS_MS = 10_000

export interface MicroCanvasProps {
  readonly id?: string
  readonly frameloop?: 'demand' | 'always'
  readonly pointerMode?: 'scene' | 'surfaces'
  readonly fov?: number
  readonly style?: CSSProperties
  readonly children?: ReactNode
  readonly onReady?: (renderer: MicroRenderer) => void
  readonly onRendererLost?: (reason: string) => void
}

export function MicroCanvas({
  id = '',
  frameloop = 'demand',
  pointerMode = 'surfaces',
  fov = 42,
  style,
  children,
  onReady,
  onRendererLost,
}: MicroCanvasProps) {
  const host = useMemo(() => getOrCreateHost(id), [id])
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const [mountEpoch, setMountEpoch] = useState(0)
  const [degraded, setDegraded] = useState(false)
  const lastLossMsRef = useRef<number | null>(null)
  const frameloopRef = useRef(frameloop)
  frameloopRef.current = frameloop
  const fovRef = useRef(fov)
  fovRef.current = fov
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onLostRef = useRef(onRendererLost)
  onLostRef.current = onRendererLost

  useLayoutEffect(() => {
    if (!canvasEl || degraded) return
    let disposed = false
    let rafId = 0
    let scheduled = false
    let prevTime = performance.now()
    const startTime = prevTime
    let renderer: MicroRenderer | null = null
    let stopGate = () => {}

    const syncViewport = () => {
      const rect = canvasEl.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const dpr = window.devicePixelRatio || 1
      const camZ = cameraDistance(height, fovRef.current)
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

    const renderFrame = () => {
      scheduled = false
      if (disposed || !renderer) return
      const now = performance.now()
      const dtMs = Math.min(now - prevTime, 1000 / 30)
      prevTime = now
      syncViewport()

      const internal = hostInternals.get(host)
      const items: MicroDrawItem[] = []
      if (internal) {
        for (const surface of internal.surfaces.values()) {
          const item = surface.tick(dtMs, now - startTime, host.viewport)
          if (item) items.push(item)
        }
      }
      renderer.render(items)
      host.renderCount += 1

      if (frameloopRef.current === 'always' || host.workClaims() > 0) {
        schedule()
      }
    }

    const schedule = () => {
      if (disposed || scheduled || !renderer) return
      scheduled = true
      rafId = requestAnimationFrame(renderFrame)
    }

    const internal = hostInternals.get(host)
    internal?.setScheduler(schedule, schedule)

    const ro = new ResizeObserver(() => {
      syncViewport()
      schedule()
    })
    ro.observe(canvasEl)

    const handleLoss = (reason: string) => {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(rafId)
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
      if (repeated) {
        setDegraded(true)
      } else {
        setMountEpoch((e) => e + 1)
      }
    }

    void createMicroRenderer(canvasEl, handleLoss).then(
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
        console.warn('[MicroCanvas] WebGPU unavailable; staying on page DOM.', err)
        setDegraded(true)
      },
    )

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      ro.disconnect()
      stopGate()
      host.renderer = null
      host.canvas = null
      renderer?.dispose()
    }
  }, [canvasEl, degraded, host, mountEpoch, pointerMode])

  useEffect(() => {
    host.invalidate()
  }, [host, frameloop, fov])

  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      position: 'relative',
      ...style,
      display: degraded ? 'none' : style?.display,
      pointerEvents: pointerMode === 'surfaces' ? 'none' : 'auto',
    }),
    [degraded, style, pointerMode],
  )

  return (
    <MicroHostContext value={host}>
      <div style={wrapperStyle}>
        <canvas
          key={mountEpoch}
          ref={setCanvasEl}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: degraded ? 'none' : 'block',
            pointerEvents: pointerMode === 'surfaces' ? 'none' : 'auto',
          }}
        />
        {children}
      </div>
    </MicroHostContext>
  )
}
