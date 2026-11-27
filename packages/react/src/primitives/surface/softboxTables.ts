// Softbox tables — the LTC tables a RectAreaLight key needs, from one of the
// sources the softbox-size measurement compares (docs/softbox-size.md).
// Prototype on the softbox-size branch; main loads three's own tables.
//
// The law: RectAreaLightNode reads every channel of its first table and only
// x and y of its second, and it picks the float or half pair by whether the
// device filters float32 textures. A half-float pair in both slots is
// filterable everywhere, so one pair serves both. The binary tables are six
// half-float channels in byte planes (low bytes, then high bytes), base64 in
// a module so every bundler ships them as a plain chunk.
//
// Ownership: this module decodes and loads tables. The rig decides when, and
// the method stays a page-wide setting because three keeps one table set.

import * as THREE from 'three'
import { RectAreaLightNode, type RectAreaLightTexturesLib } from 'three/webgpu'

/**
 * Where a softbox key's specular comes from: three's decimal tables, the same
 * 64 × 64 tables as half floats, a 32 × 32 half-float fit, or no tables, with
 * the finish lighting model's representative-point specular.
 */
export type SoftboxMethod = 'three' | 'half64' | 'half32' | 'representative'

export const SOFTBOX_METHODS: readonly SoftboxMethod[] = ['three', 'half64', 'half32', 'representative']

export function isSoftboxMethod(value: string | null): value is SoftboxMethod {
  return SOFTBOX_METHODS.some((method) => method === value)
}

function decodeBase64(base64: string): Uint8Array {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
  return bytes
}

function halfTexture(data: Uint16Array, size: number, format: THREE.PixelFormat): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
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

/** Two half-float tables, RGBA then RG, from byte planes. */
export function decodeSoftboxTables(base64: string, size: number): RectAreaLightTexturesLib {
  const bytes = decodeBase64(base64)
  const count = bytes.length / 2
  const halves = new Uint16Array(count)
  for (let index = 0; index < count; index++) halves[index] = (bytes[index] ?? 0) | ((bytes[count + index] ?? 0) << 8)
  const texels = size * size
  const first = halfTexture(halves.slice(0, texels * 4), size, THREE.RGBAFormat)
  const second = halfTexture(halves.slice(texels * 4), size, THREE.RGFormat)
  return { LTC_FLOAT_1: first, LTC_FLOAT_2: second, LTC_HALF_1: first, LTC_HALF_2: second }
}

/** The tables for a method that has them. */
export async function loadSoftboxTables(method: Exclude<SoftboxMethod, 'representative'>): Promise<RectAreaLightTexturesLib> {
  switch (method) {
    case 'three': {
      const { RectAreaLightTexturesLib } = await import('three/examples/jsm/lights/RectAreaLightTexturesLib.js')
      return RectAreaLightTexturesLib.init()
    }
    case 'half64':
      return decodeSoftboxTables((await import('./ltc/ltc64Half')).default, 64)
    case 'half32':
      return decodeSoftboxTables((await import('./ltc/ltc32Half')).default, 32)
  }
}

// ── the page's tables ──────────────────────────────────────────────────

// three's RectAreaLight needs its LTC tables before a softbox key compiles.
// Loaded once per page, on the first softbox key. A load that fails leaves
// the key a point light rather than holding a finish that waits for it.
let load: Promise<void> | null = null
let loaded = false
let failed = false
let method: SoftboxMethod = 'three'

/** Which tables, or none, the softbox key uses. Page-wide, like three's one table set; set before the first key. */
export function setSoftboxMethod(next: SoftboxMethod): void {
  method = next
}

export const softboxMethod = (): SoftboxMethod => method
export const ltcLoaded = (): boolean => loaded
export const ltcFailed = (): boolean => failed

export function loadLtc(): Promise<void> {
  const current = method
  if (current === 'representative') return Promise.resolve()
  performance.mark('munari:softbox-tables:start')
  load ??= loadSoftboxTables(current).then(
    (tables) => {
      performance.mark('munari:softbox-tables:decoded')
      RectAreaLightNode.setLTC(tables)
      loaded = true
    },
    (error) => {
      failed = true
      console.error('[munari] the softbox key could not load its LTC tables, so it lights as a point key.', error)
    },
  )
  return load
}
