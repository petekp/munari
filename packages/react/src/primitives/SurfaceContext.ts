import { createContext, use } from 'react'
import type * as THREE from 'three'

// FrameSurface's child context. The retained-HTML Surface API has its own
// context in surface/surfaceContext.ts. The advanced entry exports this
// module's texture hook as useFrameTexture.
//
// Texture availability is React state because child layout effects can run
// before FrameSurface creates its runtime.
export interface SurfaceContextValue {
  texture: THREE.CanvasTexture | null
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
