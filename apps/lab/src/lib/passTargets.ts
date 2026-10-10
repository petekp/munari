// Pass target readback — a render target's pixels on the CPU, in the order a
// TSL sample reads them.
//
// The law: passes draw with clip y negated (passMaterial in
// @petepetrash/munari/advanced), so a later sample at v reads what a pass
// computed for uv.y = v. `readTargetRows` returns rows in that v order. With
// y negated, WebGPU's readback lists rows from v = 0 and the fallback's from
// v = 1, and WebGPU pads each row to 256 bytes.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

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
