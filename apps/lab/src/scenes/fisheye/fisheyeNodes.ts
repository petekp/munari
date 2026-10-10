// The fisheye lens material — glass drawn entirely with light.
//
// The law moves vertices in x and y only; z stays flat so the pixels
// the eye sees are exactly the pixels the 2D law (and the gate's
// arithmetic) places. Depth is faked in shading: the warp loop writes
// each vertex the surface normal a real bulge WOULD have (aSlope, the
// normal's y component) plus its lens weight (aLens, 0 flat → 1 at
// the focus), and the fragment stage spends them on one specular
// sweep, a soft flank shade, and a rim line. Moving z for real would
// re-magnify the content through the perspective camera and shift
// every screen point off the law's prediction.
//
// PREMULTIPLIED (decisions.md #5): the capture arrives with rgb
// already scaled by alpha, so light is added as `k * c.a` and fades
// multiply the whole vec4.

import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { Fn, attribute, dot, mix, normalize, smoothstep, uv, varying, vec3, vec4 } from 'three/tsl'
import { encodedOutput, type SurfaceNodes } from '@petepetrash/munari'

/** Upper-left key light; the sweep lands on the bulge's upper flank. */
const LENS_LIGHT: readonly [number, number, number] = [-0.3, 0.42, 0.86]

// Per-vertex, written by the warp loop beside position.
const slope = varying(attribute<'float'>('aSlope', 'float'))
const lens = varying(attribute<'float'>('aLens', 'float'))

export function createLensMaterial(surface: SurfaceNodes): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
  material.outputNode = Fn(() => {
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const c = surface.map.sample(uv()) as Node<'vec4'>
    const n = normalize(vec3(0, slope, 1))
    const L = normalize(vec3(...LENS_LIGHT))

    // Flanks turn from the light and dim a touch; the band where the
    // normal meets the half-vector catches the sweep. The exponents
    // keep both effects off the flat sheet, where n is (0,0,1).
    const shade = mix(0.94, 1, dot(n, L).max(0))
    const H = normalize(L.add(vec3(0, 0, 1)))
    const spec = dot(n, H).max(0).pow(64)

    // The rim: a thin bright line where the glass meets the page,
    // riding the lens weight so it appears and fades with the lens.
    const rim = smoothstep(0.02, 0.14, lens).mul(smoothstep(0.14, 0.5, lens).oneMinus())

    const lit = c.rgb.mul(shade).add(spec.mul(0.32).add(rim.mul(0.1)).mul(c.a))
    const covered = vec4(lit, c.a).mul(surface.radiusMask())
    // The linear sample reaches the canvas unencoded, the look the lens
    // was tuned on. premultipliedOutput would sRGB-encode it and brighten
    // the midtones (decisions.md #72).
    return encodedOutput(covered)
  })()
  return material
}
