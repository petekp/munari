// Lazy LTC softbox table decoder for Manifest v2 materials (`rgba16float`),
// using dynamic import so non-LTC pages pay zero bytes in eager bundles.
//
// The law: the packed asset stores 64x64x6 float16 channels as byte planes
// (`ltc64Half.ts`); table 1 is RGBA (matrix inverse M^-1) and table 2 expands
// RG (Fresnel & magnitude LUT) into `rgba16float` with B=0, A=1.0 (`0x3c00`) so
// both tables upload to WebGPU's universally filterable `rgba16float` format.
//
// Ownership: `@petepetrash/munari/gpu`.

import type { ManifestStaticTextureData } from './manifest'

const LTC_SIZE = 64
const HALF_ONE = 0x3c00

let decodedPair: Promise<readonly [ManifestStaticTextureData, ManifestStaticTextureData]> | null = null

async function decodeLtcPair(): Promise<readonly [ManifestStaticTextureData, ManifestStaticTextureData]> {
  const { default: encoded } = await import('../primitives/surface/ltc/ltc64Half')
  const text = atob(encoded)
  const count = text.length / 2
  const halves = new Uint16Array(count)
  for (let i = 0; i < count; i++) {
    halves[i] = text.charCodeAt(i) | (text.charCodeAt(count + i) << 8)
  }

  const texels = LTC_SIZE * LTC_SIZE
  const table1 = halves.slice(0, texels * 4)
  const table2 = new Uint16Array(texels * 4)
  const src2Offset = texels * 4
  for (let i = 0; i < texels; i++) {
    table2[i * 4] = halves[src2Offset + i * 2] ?? 0
    table2[i * 4 + 1] = halves[src2Offset + i * 2 + 1] ?? 0
    table2[i * 4 + 2] = 0
    table2[i * 4 + 3] = HALF_ONE
  }

  const bytesPerRow = LTC_SIZE * 4 * 2
  return [
    { width: LTC_SIZE, height: LTC_SIZE, format: 'rgba16float', data: table1, bytesPerRow },
    { width: LTC_SIZE, height: LTC_SIZE, format: 'rgba16float', data: table2, bytesPerRow },
  ]
}

/** Lazily loads and decodes Heitz 2016 64x64 half-float LTC table `1` or `2`. */
export async function loadLtcTable(slot: 1 | 2): Promise<ManifestStaticTextureData> {
  if (!decodedPair) {
    decodedPair = decodeLtcPair().catch((err) => {
      decodedPair = null
      throw err
    })
  }
  const pair = await decodedPair
  return slot === 1 ? pair[0] : pair[1]
}
