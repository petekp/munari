// The slider's lens material — fisheyeNodes.ts turned on its side.
//
// Same glass, same rules (light only, geometry never leaves z = 0 —
// the fisheye preamble says why): the one difference is the bulge's
// axis. This lens runs ALONG the track, so the fake normal tilts in x
// and the specular sweep stands vertically on the bulge's left flank.
//
// PREMULTIPLIED (decisions.md #5): light is added as `k * c.a`, fades
// multiply the whole vec4.
//
// The material returns the premultiplied vec4 as its output node, so Three
// applies no second premultiplication. The lens writes the capture's linear
// sample to the canvas as it is, with no sRGB encode; encodedOutput makes
// the renderer's conversion land that raw value.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import { Fn, attribute, dot, float, max, normalize, smoothstep, uniform, uv, varying, vec3, vec4 } from 'three/tsl'
import { encodedOutput, type SurfaceNodes } from '@petepetrash/munari'

/** Upper-left key light, the same vector as the fisheye scene's glass. */
const LENS_LIGHT: readonly [number, number, number] = [-0.3, 0.42, 0.86]

// Both are written per vertex by the warp loop in Slider.tsx.
const slope = varying(attribute<'float'>('aSlope', 'float'))
const lens = varying(attribute<'float'>('aLens', 'float'))

export interface LensLight {
  readonly direction: UniformNode<'vec3', THREE.Vector3>
}

export function createLensLight(): LensLight {
  return { direction: uniform(new THREE.Vector3(...LENS_LIGHT)) }
}

export function createLensMaterial(surface: SurfaceNodes, light: LensLight): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    toneMapped: false,
  })
  material.outputNode = Fn(() => {
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const c = surface.map.sample(uv()) as Node<'vec4'>
    const n = normalize(vec3(slope, 0, 1))
    const L = normalize(light.direction)

    const shade = float(0.94).add(max(dot(n, L), 0).mul(0.06))
    const H = normalize(L.add(vec3(0, 0, 1)))
    const spec = max(dot(n, H), 0).pow(64)
    const rim = smoothstep(0.02, 0.14, lens).mul(float(1).sub(smoothstep(0.14, 0.5, lens)))

    const lit = c.rgb.mul(shade).add(spec.mul(0.32).add(rim.mul(0.1)).mul(c.a))
    const covered = vec4(lit, c.a).mul(surface.radiusMask())
    return encodedOutput(covered)
  })()
  return material
}
