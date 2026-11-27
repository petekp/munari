// Softbox tables — the LTC lookup tables three's RectAreaLight needs before a
// softbox key compiles, decoded from 64 × 64 half floats.
//
// The law: RectAreaLightNode reads every channel of its first table and only
// x and y of its second, and it samples the float pair or the half pair by
// whether the device filters float32 textures. A half-float pair filters
// everywhere, so one pair fills both slots. The values are three's own
// half-float tables, bit for bit, in six channels stored as byte planes (low
// bytes, then high bytes) and base64, so every bundler ships them as a plain
// JavaScript chunk. three's RectAreaLightTexturesLib ships the same tables as
// decimal literals: 102,355 bytes gzip against 37,063 here, and the largest
// screen difference across the 17 finish presets was 5/255 (m2, 2026-11-26,
// docs/softbox-size.md).
//
// Ownership: this module decodes. The rig decides when to load it, and it
// imports nothing but three so it stays its own chunk.

import * as THREE from 'three'
import type { RectAreaLightTexturesLib } from 'three/webgpu'
import encoded from './ltc/ltc64Half'

const SIZE = 64

function halfTexture(data: Uint16Array, format: THREE.PixelFormat): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    SIZE,
    SIZE,
    format,
    THREE.HalfFloatType,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.LinearFilter,
    THREE.NearestFilter,
    1,
  )
  texture.needsUpdate = true
  return texture
}

/** The two tables, RGBA then RG, in both of RectAreaLightNode's slots. */
export function softboxTables(): RectAreaLightTexturesLib {
  const text = atob(encoded)
  const count = text.length / 2
  const halves = new Uint16Array(count)
  for (let index = 0; index < count; index++) halves[index] = text.charCodeAt(index) | (text.charCodeAt(count + index) << 8)
  const texels = SIZE * SIZE
  const first = halfTexture(halves.slice(0, texels * 4), THREE.RGBAFormat)
  const second = halfTexture(halves.slice(texels * 4), THREE.RGFormat)
  return { LTC_FLOAT_1: first, LTC_FLOAT_2: second, LTC_HALF_1: first, LTC_HALF_2: second }
}
