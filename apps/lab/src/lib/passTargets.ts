// Pass targets — render targets a fullscreen pass fills for a later sample
// or a CPU readback.
//
// The law: TSL samples a render target with v = 0 at the top of the image
// drawn into it, on WebGPU and on the WebGL 2 fallback alike. A GL texture
// put v = 0 at the bottom. A pass that writes uv.y = 1 at the top of clip
// space therefore turns its input upside down each time it samples another
// pass's target, and a CPU mirror of that target reads it upside down.
// Measured 2026-10-08, Chrome 155, Three 0.186.1, both backends: a quad drawn
// over the top half of clip space read as clear when sampled at v = 0.75.
// Gallery's routing mirror, reading rows that way, sent every mid-crossing
// point to the arriving item.
//
// So a pass draws with clip y negated: what it computes for uv.y = v lands
// where a later sample at v reads it. `readTargetRows` returns rows in that v
// order. With y negated, WebGPU's readback lists rows from v = 0 and the
// fallback's from v = 1, and WebGPU pads each row to 256 bytes.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { positionGeometry, vec4 } from 'three/tsl'

/**
 * A fullscreen pass material for a 2×2 plane. It ignores the camera. Depth
 * 0.5 is the middle of WebGPU's 0..1 range, so the plane never sits on a
 * clipping boundary.
 */
export function passMaterial(parameters?: THREE.MeshBasicMaterialParameters): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    ...parameters,
    // Negating y reverses the triangles' winding.
    side: THREE.DoubleSide,
  })
  material.vertexNode = vec4(positionGeometry.x, positionGeometry.y.negate(), 0.5, 1)
  return material
}

/** `target`'s RGBA8 pixels as tight rows, from v = 0 to v = 1. */
export async function readTargetRows(renderer: WebGPURenderer, target: THREE.RenderTarget): Promise<Uint8Array<ArrayBuffer>> {
  const { width: w, height: h } = target
  const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h)
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const row = w * 4
  const stride = h > 1 ? (bytes.length - row) / (h - 1) : row
  const fromTop = renderer.coordinateSystem === THREE.WebGLCoordinateSystem
  const out = new Uint8Array(row * h)
  for (let y = 0; y < h; y++) {
    const from = (fromTop ? h - 1 - y : y) * stride
    out.set(bytes.subarray(from, from + row), y * row)
  }
  return out
}
