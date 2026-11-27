// Screenshot difference — a PNG decoder and the share of pixels that differ,
// for comparing a scene's settled frames across idle modes.

import { writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export function decodePng(buffer) {
  let offset = 8
  let width = 0, height = 0, colorType = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]
      if (data[8] !== 8 || data[12] !== 0) throw new Error('decodePng: only 8-bit non-interlaced PNG')
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error('decodePng: colour type ' + colorType)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0
      const upLeft = x >= channels ? previous[x - channels] : 0
      line[x] = (source[x] + pngPredictor(filter, left, previous[x], upLeft)) & 255
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) pixels[(y * width + x) * 4 + c] = line[x * channels + c]
      pixels[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255
    }
    previous.set(line)
  }
  return { width, height, pixels }
}

export function pngPredictor(filter, left, up, upLeft) {
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  if (filter !== 4) return 0
  const p = left + up - upLeft
  const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft)
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
}

/** Share of pixels whose largest channel difference exceeds 8/255, and the largest difference. */
export function difference(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { share: 1, max: 255 }
  let over = 0, max = 0
  for (let i = 0; i < a.pixels.length; i += 4) {
    const d = Math.max(Math.abs(a.pixels[i] - b.pixels[i]), Math.abs(a.pixels[i + 1] - b.pixels[i + 1]), Math.abs(a.pixels[i + 2] - b.pixels[i + 2]))
    if (d > 8) over++
    if (d > max) max = d
  }
  return { share: over / (a.pixels.length / 4), max }
}

export async function shot(page, file) {
  const buffer = Buffer.from(await page.screenshot({ type: 'png' }))
  writeFileSync(file, buffer)
  return decodePng(buffer)
}
