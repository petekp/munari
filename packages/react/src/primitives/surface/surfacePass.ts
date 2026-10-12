// Surface pass — what one draw of a presenter mesh was, read from the renderer.
//
// The law: both presenters (`FrameSurface` and `Surface.Mesh`) describe a
// draw with the same `SurfacePassEvidence` and ask core's `presentationRoute`
// what it can prove. Neither computes the answer from the flags itself.
// Three runs a mesh's callbacks for draws that cannot reach the screen —
// a color-disabled material, an off-screen target — and for geometry with
// nothing to draw, so the callbacks alone are never evidence (decisions.md
// #25, #70).
//
// The fault, 2026-10-08 (decisions.md #70): a draw of empty geometry issued
// receipts, so a transfer released the page over a canvas that kept its old
// pixels.
//
// Ownership: this module reads the renderer and the material and decides
// nothing. The route law belongs to core; what to do with a route belongs to
// each presenter.

import * as THREE from 'three'
import type { SurfacePassEvidence } from '@munari/core'

/**
 * Whether a draw of this geometry can produce any primitive. Three runs the
 * mesh callbacks for an empty draw too, zero instances included, and the
 * canvas keeps its old pixels. It reads `drawRange`, the index or position
 * count, and `instanceCount`, and does not consult geometry groups.
 */
export function geometryDraws(geometry: THREE.BufferGeometry): boolean {
  if (geometry instanceof THREE.InstancedBufferGeometry && geometry.instanceCount <= 0) return false
  const elements = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  const end = Math.min(elements, geometry.drawRange.start + geometry.drawRange.count)
  return end > geometry.drawRange.start
}

/**
 * Whether this draw is `scene.overrideMaterial`'s, which never samples the
 * HTML and so proves nothing. WebGPURenderer passes the mesh's own material
 * to `onBeforeRender` and the override to `onAfterRender`. A shadow map can
 * render inside a lit mesh's own draw, so both callbacks of an override draw
 * leave the outer draw's state alone. A WebGLRenderer root that is not a
 * Scene has no override.
 */
export function drawnByOverride(scene: THREE.Scene, material: THREE.Material): boolean {
  const override = scene.isScene === true ? scene.overrideMaterial : null
  return override !== null && (material === override || material.allowOverride)
}

/**
 * Read one pass from the renderer, the material's write flags as they stand
 * now, and the geometry. A presenter that borrows the material's flags for
 * the pass must read after the borrow, so the evidence is what the renderer
 * will draw with.
 */
export function readPassEvidence(
  renderer: { getRenderTarget(): THREE.RenderTarget | null },
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): SurfacePassEvidence {
  return {
    defaultFramebuffer: renderer.getRenderTarget() === null,
    colorWrite: material.colorWrite,
    depthWrite: material.depthWrite,
    stencilWrite: material.stencilWrite,
    drawable: geometryDraws(geometry),
  }
}

export interface SurfaceOutputRenderer {
  getRenderTarget(): THREE.RenderTarget | null
  readonly info: { readonly render: { readonly calls: number; readonly triangles: number; readonly lines: number; readonly points: number } }
}

export interface SurfaceOutputDraw {
  readonly renderCall: number
  readonly primitives: number
  readonly drawable: boolean
}

const primitiveCount = (renderer: SurfaceOutputRenderer) => {
  const { triangles, lines, points } = renderer.info.render
  return triangles + lines + points
}

/** Object callbacks also surround attempts with no geometry or zero instances. */
export function beginSurfaceOutputDraw(renderer: SurfaceOutputRenderer, mesh: THREE.Mesh, geometry: THREE.BufferGeometry): SurfaceOutputDraw {
  const elements = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  const start = Math.max(0, geometry.drawRange.start)
  const end = Math.min(elements, geometry.drawRange.start + geometry.drawRange.count)
  return {
    renderCall: renderer.info.render.calls,
    primitives: primitiveCount(renderer),
    drawable: geometryDraws(geometry) && end - start >= 3 && (!(mesh instanceof THREE.InstancedMesh) || mesh.count > 0),
  }
}

/** Nested renderer calls cannot supply another mesh's missing draw evidence. */
export function surfaceOutputDrawCompleted(renderer: SurfaceOutputRenderer, draw: SurfaceOutputDraw): boolean {
  return draw.drawable && renderer.info.render.calls === draw.renderCall && primitiveCount(renderer) > draw.primitives
}
