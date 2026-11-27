// Surface mesh material — the default material a Surface mesh draws its
// capture with, and the compile a slotted material can hold.
//
// The law: the corner mask is uniform-driven, so a radius change is a value
// write and never a rebuild; the output scales the premultiplied capture by
// the mask only (decisions.md #5). A held compile keeps the mesh out of the
// render path until its material is ready, and only before the first draw.
//
// Ownership: SurfaceMesh owns the radius uniforms and writes them in place;
// this module builds the material that reads them and counts the holds.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { MeshBasicNodeMaterial, type UniformNode } from 'three/webgpu'
import { Discard, Fn, diffuseColor, uv, vec4 } from 'three/tsl'
import { premultipliedOutput } from '../../lib/surfaceOutput'
import { surfaceRadiusMask } from '../../lib/surfaceRadius'
import { useSurfaceCompiled } from './surfaceCompile'

/** The corner radii and the mesh size, in CSS px, that the corner mask reads. */
export interface SurfaceRadiusUniforms {
  readonly radii: UniformNode<'vec4', THREE.Vector4>
  readonly size: UniformNode<'vec2', THREE.Vector2>
}

/**
 * The default material. The corner mask is uniform-driven: radii of zero
 * make it a no-op, so a radius change is a value write, never a rebuild.
 * The uniform nodes hold the presenter's own vectors, which are written in
 * place. The discard keeps clear corner fragments out of the depth buffer.
 * It is not `alphaTest`, which makes a node material reshape alpha under
 * the alpha-to-coverage this mesh turns on for rounded opaque corners.
 * The capture is already premultiplied, so the output scales it by the
 * mask only: Three's own premultiply would multiply it by alpha a second
 * time, and a half-transparent white pixel would land at 64 where the
 * page shows 128 (measured 2026-10-08, on main's WebGLRenderer too).
 * `premultipliedAlpha` stays on for the premultiplied blend.
 */
export function useDefaultSurfaceMaterial({ size, radii }: SurfaceRadiusUniforms): MeshBasicNodeMaterial {
  const material = useMemo(() => {
    const created = new MeshBasicNodeMaterial({ color: '#ffffff', premultipliedAlpha: true })
    const mask = surfaceRadiusMask(
      uv(),
      size,
      radii,
    )
    created.opacityNode = Fn(() => {
      Discard(diffuseColor.a.mul(mask).lessThan(0.004))
      return mask
    })()
    created.outputNode = premultipliedOutput(vec4(diffuseColor.rgb.mul(mask), diffuseColor.a))
    return created
  }, [size, radii])
  useEffect(() => () => material.dispose(), [material])
  return material
}

/**
 * The presenter's compile, which a material can hold until it is ready to
 * draw (SurfaceMaterialValue.hold): the finish material holds it for its
 * environment bake. A hold placed after the first draw does not take the
 * mesh out of the render path again.
 */
export function useHeldCompile(mesh: THREE.Mesh | null) {
  const [holds, setHolds] = useState(0)
  const drewOnce = useRef(false)
  const compiled = useSurfaceCompiled(holds > 0 && !drewOnce.current ? null : mesh)
  useEffect(() => {
    if (compiled) drewOnce.current = true
  }, [compiled])
  const hold = useCallback(() => {
    setHolds((count) => count + 1)
    return () => setHolds((count) => count - 1)
  }, [])
  return { compiled, hold }
}
