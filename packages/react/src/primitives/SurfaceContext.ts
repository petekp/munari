import { createContext, use } from 'react'
import type * as THREE from 'three'
import type { SurfaceChrome } from '@munari/core'

// What a Surface exposes to its children (e.g. a custom material): the mesh,
// its pixel source, logical size, and texture. A DOM Surface supplies its live
// root; a frame Surface supplies null because its caller owns only a canvas.
// `source` is React state, not a ref — child effects run BEFORE the parent's,
// so children must re-render when a DOM texture source actually comes up.
// `texture` is state for the same reason: a child that owns the material (see
// Surface's `material="none"`) must re-render when either source arrives, or
// it samples null forever.
// `chrome` likewise: it changes only when a paint actually changes the
// element's measured radii/shadow, and a material that wears them must hear.
// `paintedSize` is the odd one out: a STABLE GETTER, not state. A frame-loop
// consumer (the veil's generation gate) samples it inside useFrame and wants
// the freshest answer at read time, not a re-render on every paint — being
// state would solve a problem this field doesn't have and create one it
// would (a render per paint, on every Surface, whether anyone's watching or
// not).
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
 * The Surface texture, for a child that supplies its own material
 * (`<Surface material="none">`). Null until a DOM source first paints or a
 * frame runtime is ready. The frame mesh stays suppressed during that setup
 * gap, then its child receives the configured texture on a re-render.
 */
export function useSurfaceTexture(): THREE.CanvasTexture | null {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfaceTexture must be used inside a <Surface>')
  return ctx.texture
}

/**
 * The Surface's measured DOM chrome (corner radii, outer box-shadow layers)
 * and logical px size — what a custom material needs to wear the element's own
 * corners (`SURFACE_RADIUS_GLSL`) or render the shadow the rasterizer can't
 * capture. Null until the content's first paint has been measured; a custom
 * material should treat that as "no radii yet" (mask uniforms of zero are a
 * no-op), exactly like the texture being null. A frame source has no DOM
 * chrome and returns null.
 */
export function useSurfaceChrome(): {
  chrome: SurfaceChrome | null
  width: number
  height: number
} {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfaceChrome must be used inside a <Surface>')
  return { chrome: ctx.chrome, width: ctx.width, height: ctx.height }
}

/**
 * A stable GETTER for the Surface's painted box — the CSS size
 * `@munari/core`'s `paintedSize()` reports: the box the last COMPLETED
 * paint actually rasterized, which during a resize can trail the box the
 * Surface currently measures. Returned as a function, not a value, and
 * deliberately NOT React state: a paint landing must not re-render the
 * tree just to report it, and a frame-loop consumer (`useFrame`) wants
 * the freshest answer at the moment it samples, not the one that was
 * true when this component last rendered. A material that blends its own
 * raster against something live (the veil's fade zone) reads this to
 * know whether the two are even the same generation before it blends
 * them.
 */
export function useSurfacePaintedSize(): () => readonly [number, number] {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfacePaintedSize must be used inside a <Surface>')
  return ctx.paintedSize
}
