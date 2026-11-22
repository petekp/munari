// Frontier prototype stage — 1:1 CSS-pixel perspective camera, reduced-motion hook,
// paper placeholder texture, and demand-driven GPU telemetry.
//
// The law: z = 0 matches the canvas's CSS pixel plane (`cameraDistance(height, FOV)`),
// with `camera.near = 0.1` so `placement="match-dom"` (distance 1.0) never clips.

import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cameraDistance } from '@petepetrash/munari/advanced'

export const FRONTIER_FOV = 42

export type FrontierVariantId = 'cmdk' | 'letterpress' | 'peel' | 'patchbay' | 'bounce'

export interface StageBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly localLeft: number
  readonly localTop: number
  readonly stageW: number
  readonly stageH: number
}

export function stageBoxOf(el: HTMLElement | null, canvasEl: HTMLElement | null): StageBox | null {
  if (!el || !canvasEl) return null
  const r = el.getBoundingClientRect()
  const c = canvasEl.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0 || c.width <= 0 || c.height <= 0) return null
  const localLeft = r.left - c.left
  const localTop = r.top - c.top
  return {
    x: localLeft + r.width * 0.5 - c.width * 0.5,
    y: c.height * 0.5 - (localTop + r.height * 0.5),
    w: r.width,
    h: r.height,
    localLeft,
    localTop,
    stageW: c.width,
    stageH: c.height,
  }
}

export function createPaperPlaceholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([248, 246, 241, 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => 'matchMedia' in globalThis && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export interface FrontierTelemetry {
  rendersTotal: number
  rendersLastSecond: number
  lastFrameMs: number
  activeSurfaces: number
  dpr: number
}

export const frontierTelemetry: FrontierTelemetry = {
  rendersTotal: 0,
  rendersLastSecond: 0,
  lastFrameMs: 0,
  activeSurfaces: 0,
  dpr: 1,
}

type HudListener = () => void
const hudListeners = new Set<HudListener>()

export function subscribeFrontierHud(fn: HudListener): () => void {
  hudListeners.add(fn)
  return () => {
    hudListeners.delete(fn)
  }
}

export function notifyFrontierHud(): void {
  for (const fn of hudListeners) fn()
}

export function retainActiveSurface(): () => void {
  frontierTelemetry.activeSurfaces += 1
  notifyFrontierHud()
  let released = false
  return () => {
    if (released) return
    released = true
    frontierTelemetry.activeSurfaces = Math.max(0, frontierTelemetry.activeSurfaces - 1)
    notifyFrontierHud()
  }
}

export function resetFrontierFrameCounters(): void {
  frontierTelemetry.rendersTotal = 0
  frontierTelemetry.rendersLastSecond = 0
  frontierTelemetry.lastFrameMs = 0
  notifyFrontierHud()
}

export function FrontierPixelCamera({ maxDpr = 2 }: { readonly maxDpr?: number }) {
  // SAFETY: SurfaceCanvas creates a PerspectiveCamera unless `orthographic` is requested.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const setDpr = useThree((s) => s.setDpr)
  const dpr = useThree((s) => s.viewport.dpr)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    if (size.height <= 0) return
    camera.fov = FRONTIER_FOV
    camera.position.set(0, 0, cameraDistance(size.height, FRONTIER_FOV))
    camera.near = 0.1
    camera.far = Math.max(2000, camera.position.z * 4)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size.height, size.width, invalidate])

  useEffect(() => {
    const updateDpr = () => {
      const want = Math.min(maxDpr, Math.max(1, window.devicePixelRatio || 1))
      if (Math.abs(want - dpr) > 1e-3) {
        setDpr(want)
        invalidate()
      }
    }
    updateDpr()
    window.addEventListener('resize', updateDpr, { passive: true })
    return () => window.removeEventListener('resize', updateDpr)
  }, [dpr, maxDpr, setDpr, invalidate])

  return null
}

export function FrontierCanvasTelemetry() {
  const gl = useThree((s) => s.gl)
  const stampsRef = useRef<number[]>([])
  const idleTimerRef = useRef<number | null>(null)
  const lastHudNotifyRef = useRef(0)
  const wasActiveRef = useRef(false)

  useEffect(() => {
    Object.assign(window, { __frontierPerf: frontierTelemetry })
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    }
  }, [])

  useFrame(() => {
    const now = performance.now()
    frontierTelemetry.rendersTotal += 1
    frontierTelemetry.dpr = gl.getPixelRatio()
    const stamps = stampsRef.current
    const prev = stamps.at(-1)
    if (prev !== undefined && now - prev < 65) {
      frontierTelemetry.lastFrameMs = now - prev
    }
    stamps.push(now)
    while (stamps.length > 0 && now - (stamps[0] ?? now) > 1000) {
      stamps.shift()
    }
    frontierTelemetry.rendersLastSecond = stamps.length

    if (!wasActiveRef.current || now - lastHudNotifyRef.current > 200) {
      wasActiveRef.current = true
      lastHudNotifyRef.current = now
      notifyFrontierHud()
    }
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      wasActiveRef.current = false
      frontierTelemetry.rendersLastSecond = 0
      notifyFrontierHud()
    }, 380)
  })

  return null
}
