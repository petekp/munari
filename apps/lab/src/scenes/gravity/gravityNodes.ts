// Gravity's word materials — the two node materials that draw a fallen
// word: one samples the native overlay's painted word canvas, the other a
// Surface capture inside SurfaceCanvas.
//
// The law: both textures are premultiplied (decisions.md #5), so both
// materials blend premultiplied, and each returns the color its WebGL
// predecessor put on the canvas. Before the WebGPU migration, the native
// word drew through a plain MeshBasicMaterial with `premultipliedAlpha`,
// whose shader encodes sRGB and then multiplies rgb by alpha again; the
// native output keeps that. The Surface word lands at the capture's page
// value through premultipliedOutput, as the default Surface.Mesh material
// does (decisions.md #72).
//
// Ownership: Gravity.tsx and gravitySurfaces.tsx own the meshes and the
// textures' lifetimes; this module only builds materials.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { sRGBTransferOETF, texture, uv, vec4 } from 'three/tsl'
import { encodedOutput, premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

function wordMaterial(): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({
    // The CSS-mapped camera (top 0, bottom height) mirrors Y, which reverses
    // on-screen winding — with front-face culling every quad vanishes.
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
}

/** The native overlay's word: a premultiplied sRGB canvas texture. */
export function createNativeWordMaterial(map: THREE.Texture): MeshBasicNodeMaterial {
  const material = wordMaterial()
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const sample = texture(map, uv()) as Node<'vec4'>
  // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const encoded = sRGBTransferOETF(sample.rgb) as Node<'vec3'>
  material.outputNode = encodedOutput(vec4(encoded.mul(sample.a), sample.a))
  return material
}

/** A Surface word: the live capture, premultiplied and linear. */
export function createSurfaceWordMaterial(surface: SurfaceNodes): MeshBasicNodeMaterial {
  const material = wordMaterial()
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const sample = surface.map.sample(uv()) as Node<'vec4'>
  material.outputNode = premultipliedOutput(sample)
  return material
}
