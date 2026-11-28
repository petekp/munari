// Shared GpuHost coordinator — bridges DOM surface registrations with the
// demand/manual WebGPU canvas loop.
//
// The law: one host tracks all surfaces registered to a `canvasId` and wakes
// the render loop only when animations, uploads, or lighting ask for work
// (decisions.md #33, #39).
//
// Ownership: `SurfaceCanvas.tsx` drives ticks and renderer lifecycle on this
// host; `Surface.tsx` registers/unregisters surfaces; `gpuPointerGate.ts`
// handles lazy raycasting and DOM pointer routing.

import { createContext } from 'react'
import type { Mat4 } from './math'
import type { GpuEngine } from './gpuEngine'
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
  engine: GpuEngine | null
  manualStepper: ((dtMs: number) => boolean) | null
  setScheduler(invalidateFn: () => void, claimFn: () => void): void
  setEngine(engine: GpuEngine | null): void
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
    engine: null,
    manualStepper: null,
    setScheduler(invalidateFn, claimFn) {
      onInvalidate = invalidateFn
      onClaimChange = claimFn
    },
    setEngine(engine) {
      internal.engine = engine
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
