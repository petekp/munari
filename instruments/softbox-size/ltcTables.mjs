// Softbox table encodings — three's LTC tables for RectAreaLight, written as
// the binary forms the softbox-size measurement compares (docs/softbox-size.md).
//
// three r186 ships the tables as 32,768 decimal numbers in
// RectAreaLightTexturesLib.js. RectAreaLightNode reads all four channels of
// the first table and only x and y of the second
// (PhysicalLightingModel.directRectArea), so the binary forms keep six
// channels. The 32 × 32 form is a least-squares fit: three's LTC_Uv still
// addresses the table as 64 × 64 texel centers, and bilinear sampling of the
// fit at those points is as close as a 32 × 32 table gets to the original.
//
// Run: node instruments/softbox-size/ltcTables.mjs <out dir>
// Writes the table modules the prototype imports and prints encoded sizes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { DataUtils } from 'three'
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js'

const out = process.argv[2]
if (!out) throw new Error('usage: ltcTables.mjs <out dir>')
mkdirSync(out, { recursive: true })

RectAreaLightTexturesLib.init()
const ltc1 = RectAreaLightTexturesLib.LTC_FLOAT_1.image.data
const ltc2 = RectAreaLightTexturesLib.LTC_FLOAT_2.image.data
const SIZE = 64

/** Channels [c0, c1) of a size×size RGBA table, as a size×size×n array. */
function channels(table, size, from, to) {
  const n = to - from
  const result = new Float64Array(size * size * n)
  for (let texel = 0; texel < size * size; texel++) {
    for (let c = 0; c < n; c++) result[texel * n + c] = table[texel * 4 + from + c]
  }
  return result
}

// ── 32 × 32 least-squares fit ─────────────────────────────────────────

/** A[g][j]: weight of 32-texel j when three samples 64-texel center g. */
function samplingMatrix(big, small) {
  const a = Array.from({ length: big }, () => new Float64Array(small))
  for (let g = 0; g < big; g++) {
    const c = ((g + 0.5) / big) * small - 0.5
    const i0 = Math.floor(c)
    const f = c - i0
    const clampIndex = (i) => Math.min(Math.max(i, 0), small - 1)
    a[g][clampIndex(i0)] += 1 - f
    a[g][clampIndex(i0 + 1)] += f
  }
  return a
}

function invert(m) {
  const n = m.length
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const p = a[col][col]
    for (let k = 0; k < 2 * n; k++) a[col][k] /= p
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = a[row][col]
      if (f !== 0) for (let k = 0; k < 2 * n; k++) a[row][k] -= f * a[col][k]
    }
  }
  return a.map((row) => row.slice(n))
}

/** P = (AᵀA)⁻¹Aᵀ, small × big. */
function pseudoInverse(a) {
  const big = a.length
  const small = a[0].length
  const ata = Array.from({ length: small }, (_, i) => Array.from({ length: small }, (_, j) => {
    let s = 0
    for (let g = 0; g < big; g++) s += a[g][i] * a[g][j]
    return s
  }))
  const inv = invert(ata)
  return Array.from({ length: small }, (_, i) => Float64Array.from({ length: big }, (_, g) => {
    let s = 0
    for (let k = 0; k < small; k++) s += inv[i][k] * a[g][k]
    return s
  }))
}

/** Fit one channel plane (64×64, row = v, column = u) to 32×32: X = P M Pᵀ. */
function fitPlane(plane, p) {
  const small = p.length
  const big = p[0].length
  const half = Array.from({ length: big }, () => new Float64Array(small))
  for (let v = 0; v < big; v++) for (let j = 0; j < small; j++) {
    let s = 0
    for (let u = 0; u < big; u++) s += plane[v * big + u] * p[j][u]
    half[v][j] = s
  }
  const fit = new Float64Array(small * small)
  for (let i = 0; i < small; i++) for (let j = 0; j < small; j++) {
    let s = 0
    for (let v = 0; v < big; v++) s += p[i][v] * half[v][j]
    fit[i * small + j] = s
  }
  return fit
}

/** Bilinear reconstruction of a 32×32 plane at the 64×64 centers: A X Aᵀ. */
function reconstruct(fit, a) {
  const big = a.length
  const small = a[0].length
  const result = new Float64Array(big * big)
  for (let v = 0; v < big; v++) for (let u = 0; u < big; u++) {
    let s = 0
    for (let i = 0; i < small; i++) {
      const wv = a[v][i]
      if (wv === 0) continue
      for (let j = 0; j < small; j++) if (a[u][j] !== 0) s += wv * a[u][j] * fit[i * small + j]
    }
    result[v * big + u] = s
  }
  return result
}

function fitTable(values, size, n, small) {
  const a = samplingMatrix(size, small)
  const p = pseudoInverse(a)
  const fitted = new Float64Array(small * small * n)
  const rebuilt = new Float64Array(size * size * n)
  for (let c = 0; c < n; c++) {
    const plane = Float64Array.from({ length: size * size }, (_, t) => values[t * n + c])
    const fit = fitPlane(plane, p)
    const back = reconstruct(fit, a)
    for (let t = 0; t < small * small; t++) fitted[t * n + c] = fit[t]
    for (let t = 0; t < size * size; t++) rebuilt[t * n + c] = back[t]
  }
  return { fitted, rebuilt }
}

// ── encodings ─────────────────────────────────────────────────────────

const toHalf = (values) => Uint16Array.from(values, (x) => DataUtils.toHalfFloat(x))
const fromHalf = (halves) => Float64Array.from(halves, (h) => DataUtils.fromHalfFloat(h))
/** Low bytes, then high bytes: gzip finds more runs in the exponent bytes alone. */
function bytePlanes(halves) {
  const bytes = new Uint8Array(halves.buffer, halves.byteOffset, halves.byteLength)
  const planes = new Uint8Array(bytes.length)
  const count = halves.length
  for (let i = 0; i < count; i++) {
    planes[i] = bytes[2 * i]
    planes[count + i] = bytes[2 * i + 1]
  }
  return planes
}

function errors(reference, test) {
  let maxAbs = 0
  let maxRel = 0
  for (let i = 0; i < reference.length; i++) {
    const d = Math.abs(reference[i] - test[i])
    maxAbs = Math.max(maxAbs, d)
    if (Math.abs(reference[i]) > 1e-3) maxRel = Math.max(maxRel, d / Math.abs(reference[i]))
  }
  return { maxAbs, maxRel }
}

const used1 = channels(ltc1, SIZE, 0, 4)
const used2 = channels(ltc2, SIZE, 0, 2)
const used = Float64Array.from([...used1, ...used2])
const unused2 = channels(ltc2, SIZE, 2, 4)
const unusedRange = [Math.min(...unused2), Math.max(...unused2)]

const half64 = toHalf(used)
const fit1 = fitTable(used1, SIZE, 4, 32)
const fit2 = fitTable(used2, SIZE, 2, 32)
const half32 = toHalf(Float64Array.from([...fit1.fitted, ...fit2.fitted]))
const rebuilt32 = Float64Array.from([...fit1.rebuilt, ...fit2.rebuilt])
const half32Rebuilt = Float64Array.from([
  ...reconstructHalf(half32.subarray(0, 32 * 32 * 4), 4),
  ...reconstructHalf(half32.subarray(32 * 32 * 4), 2),
])
function reconstructHalf(halves, n) {
  const values = fromHalf(halves)
  const a = samplingMatrix(SIZE, 32)
  const result = new Float64Array(SIZE * SIZE * n)
  for (let c = 0; c < n; c++) {
    const plane = Float64Array.from({ length: 32 * 32 }, (_, t) => values[t * n + c])
    const back = reconstruct(plane, a)
    for (let t = 0; t < SIZE * SIZE; t++) result[t * n + c] = back[t]
  }
  return result
}

const all8 = Float32Array.from([...ltc1, ...ltc2])
const raw = {
  'f32-64-8ch': new Uint8Array(all8.buffer),
  'f32-64-6ch': new Uint8Array(Float32Array.from(used).buffer),
  'f16-64-8ch': new Uint8Array(toHalf(all8).buffer),
  'f16-64-6ch': new Uint8Array(half64.buffer),
  'f16-64-6ch-planes': bytePlanes(half64),
  'f16-32-6ch': new Uint8Array(half32.buffer),
  'f16-32-6ch-planes': bytePlanes(half32),
}

const gzip = (bytes) => gzipSync(bytes, { level: 9 }).length
const brotli = (bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const sizes = Object.fromEntries(Object.entries(raw).map(([name, bytes]) => {
  const base64 = Buffer.from(bytes).toString('base64')
  return [name, { raw: bytes.length, gzip: gzip(bytes), brotli: brotli(bytes), base64Gzip: gzip(Buffer.from(base64)), base64Brotli: brotli(Buffer.from(base64)) }]
}))

// The modules the prototype imports: byte planes, base64, one string each.
function writeModule(name, bytes, size) {
  const base64 = Buffer.from(bytes).toString('base64')
  writeFileSync(join(out, `${name}.ts`), `// Generated by instruments/softbox-size/ltcTables.mjs. ${size} × ${size} texels, six half-float channels in byte planes.\nexport default '${base64}'\n`)
}
writeModule('ltc64Half', raw['f16-64-6ch-planes'], 64)
writeModule('ltc32Half', raw['f16-32-6ch-planes'], 32)

console.log(JSON.stringify({
  unusedChannelsOfTable2: unusedRange,
  usedRange: [Math.min(...used), Math.max(...used)],
  half64VsFloat: errors(used, fromHalf(half64)),
  fit32VsFloat: errors(used, rebuilt32),
  half32VsFloat: errors(used, half32Rebuilt),
  sizes,
}, null, 2))
