import { createContext, use } from 'react'
import type * as THREE from 'three'
import type { SurfaceChrome } from '@munari/core'

// FrameSurface's child context. The retained-HTML Surface API has its own
// context in surface/surfaceContext.ts. The advanced entry exports this
// module's texture hook as useFrameTexture.
//
// A frame source supplies no DOM root or measured chrome: its caller owns
// a canvas. The remaining metadata here belongs to that frame source.
// Texture availability is React state because child layout effects can run
// before FrameSurface creates its runtime. Size fields describe the caller's
// logical frame dimensions; they are not DOM paint-generation measurements.
export interface SurfaceContextValue {
  mesh: React.RefObject<THREE.Mesh | null>
  source: HTMLElement | null
  width: number
  height: number
  mirrorU: boolean
  texture: THREE.CanvasTexture | null
  chrome: SurfaceChrome | null
  paintedSize: () => readonly [number, number]
}

export const SurfaceContext = createContext<SurfaceContextValue | null>(null)

/**
 * The FrameSurface texture, exported as useFrameTexture from `/advanced`.
 * A child of `<FrameSurface material="none">` reads null until the frame
 * runtime is ready. The frame mesh stays suppressed during that setup
 * gap, then its child receives the configured texture on a re-render.
 */
export function useSurfaceTexture(): THREE.CanvasTexture | null {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useFrameTexture must be used inside a <FrameSurface>')
  return ctx.texture
}

/**
 * Internal frame metadata. FrameSurface supplies logical dimensions and null
 * chrome; it does not measure DOM borders or shadows. This accessor is not
 * the useSurfaceChrome hook exported by the package's root entry.
 */
/** Logical frame dimensions; frame sources have no measured DOM chrome. */
export interface SurfaceChromeState {
  chrome: SurfaceChrome | null
  width: number
  height: number
}

export function useSurfaceChrome(): SurfaceChromeState {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfaceChrome must be used inside a <Surface>')
  return { chrome: ctx.chrome, width: ctx.width, height: ctx.height }
}

/**
 * Internal getter for FrameSurface's logical dimensions. These dimensions
 * do not certify a DOM paint or upload generation. The root entry's
 * useSurfacePaintedSize reads the separate DOM source runtime.
 */
export function useSurfacePaintedSize(): () => readonly [number, number] {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfacePaintedSize must be used inside a <Surface>')
  return ctx.paintedSize
}
