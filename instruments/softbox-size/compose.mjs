// Side-by-side images of the softbox comparison's worst case per source:
// three's tables, the source, and their difference scaled ×8, labelled.
// Reads the worst-*.png pairs pixels.mjs wrote into OUT.
//
// Run: OUT=<dir> node instruments/softbox-size/compose.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const OUT = process.env.OUT
if (!OUT) throw new Error('Set OUT to the pixels.mjs output directory')
const LABELS = {
  'three-again': "three's tables, loaded again",
  half64: '64 × 64 half-float tables',
  half32: '32 × 32 half-float tables',
  representative: 'representative point, no tables',
  point: 'point key',
}

const files = readdirSync(OUT)
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage()
  for (const name of files.filter((file) => /^worst-.*-three\.png$/.test(file))) {
    const stem = name.slice(0, -'-three.png'.length)
    const config = Object.keys(LABELS).find((id) => stem.startsWith(`worst-${id}-`))
    const option = files.find((file) => file === `${stem}-${config}.png`)
    if (!config || !option) continue
    const preset = stem.slice(`worst-${config}-`.length)
    const data = await page.evaluate(async ({ today, candidate, title, preset }) => {
      const load = (base64) => createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
      const [a, b] = await Promise.all([load(today), load(candidate)])
      const band = 72
      const canvas = new OffscreenCanvas(a.width * 3, a.height + band)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(a, 0, band)
      context.drawImage(b, a.width, band)
      const read = (image) => {
        const scratch = new OffscreenCanvas(image.width, image.height).getContext('2d')
        scratch.drawImage(image, 0, 0)
        return scratch.getImageData(0, 0, image.width, image.height)
      }
      const pa = read(a)
      const pb = read(b)
      const diff = new ImageData(a.width, a.height)
      for (let i = 0; i < pa.data.length; i += 4) {
        for (let c = 0; c < 3; c++) diff.data[i + c] = Math.min(255, Math.abs(pa.data[i + c] - pb.data[i + c]) * 8)
        diff.data[i + 3] = 255
      }
      context.putImageData(diff, a.width * 2, band)
      context.fillStyle = '#111'
      context.font = '600 34px -apple-system, sans-serif'
      context.fillText(`three's tables (today) · ${preset}`, 24, 48)
      context.fillText(title, a.width + 24, 48)
      context.fillText('difference × 8', a.width * 2 + 24, 48)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(binary)
    }, {
      today: readFileSync(join(OUT, name)).toString('base64'),
      candidate: readFileSync(join(OUT, option)).toString('base64'),
      title: LABELS[config],
      preset,
    })
    const target = join(OUT, `side-by-side-${config}.png`)
    writeFileSync(target, Buffer.from(data, 'base64'))
    console.log(target)
  }
} finally {
  await browser.close()
}
