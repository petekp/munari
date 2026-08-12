// no-duplicate-drag — can a restored window leave its last WebGL image
// behind when the live DOM window moves?
//
// The overlay normally runs continuously only while a sheet or dock ring is
// active. The dangerous edge is the final restore frame: if the loop enters
// demand mode before it draws the scene without that Flight, the transparent
// canvas keeps its last full-window framebuffer. A later title-bar move then
// exposes two windows. State and DOM counts cannot see this; it is retained
// compositor output, so this gate records the real page.
import { existsSync } from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const labRoot = path.join('/Users/petepetrash/Code/munari', 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate))
const HEADED = process.env.HEADED === '1'
const SLOWCPU = Number(process.env.SLOWCPU ?? 6)
const DSF = Number(process.env.DSF ?? 2)
const MOVE_X = 400
const BLUE_FLOOR = 80
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let server
let browser
const problems = []
const deadline = setTimeout(() => {
  console.error('no-duplicate-drag: hard 90s deadline hit')
  process.exit(1)
}, 90_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !HEADED,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: DSF })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(700)

  const client = await page.createCDPSession()
  if (SLOWCPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: SLOWCPU })

  const restRect = await page.evaluate(() => {
    for (const slot of document.querySelectorAll('.gen-slot:not([data-win="quadrato"])'))
      slot.style.visibility = 'hidden'
    return document
      .querySelector('.gen-slot[data-win="quadrato"] .gen-window')
      .getBoundingClientRect()
      .toJSON()
  })

  await page.evaluate(() =>
    document
      .querySelector('.gen-slot[data-win="quadrato"] .gen-lamp[data-role="minimize"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="quadrato"]').dataset.filled === 'true',
    { timeout: 15_000 },
  )

  const frames = []
  client.on('Page.screencastFrame', async (frame) => {
    frames.push(frame.data)
    try {
      await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
    } catch {
      // The cast can stop between delivery and acknowledgement.
    }
  })
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 94,
    everyNthFrame: 1,
    maxWidth: 1100,
    maxHeight: 800,
  })
  await page.evaluate(() =>
    document
      .querySelector('.gen-tile[data-win="quadrato"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  await page.waitForFunction(
    () => document.querySelector('.gen-slot[data-win="quadrato"]').dataset.away !== 'true',
    { timeout: 15_000 },
  )
  const grip = await page.evaluate(() => {
    const bar = document
      .querySelector('.gen-slot[data-win="quadrato"] .gen-titlebar')
      .getBoundingClientRect()
    return { x: bar.right - 38, y: bar.top + bar.height / 2 }
  })
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(grip.x + (MOVE_X * step) / 8, grip.y)
    await sleep(8)
  }
  await page.mouse.up()
  await sleep(500)
  await client.send('Page.stopScreencast')
  const movedRect = await page.evaluate(() =>
    document
      .querySelector('.gen-slot[data-win="quadrato"] .gen-window')
      .getBoundingClientRect()
      .toJSON(),
  )

  const scores = await page.evaluate(
    async (encoded, rect, movedLeft) => {
      const score = async (data) => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0)
        const sx = image.width / window.innerWidth
        const sy = image.height / window.innerHeight
        const blue = (left) => {
          const pixels = context.getImageData(
            Math.round(left * sx),
            Math.round(rect.top * sy),
            Math.round(rect.width * sx),
            Math.round(rect.height * sy),
          ).data
          let count = 0
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i]
            const g = pixels[i + 1]
            const b = pixels[i + 2]
            if (b > 135 && b > r + 18 && b > g + 8) count++
          }
          return count
        }
        return { old: blue(rect.left), moved: blue(movedLeft) }
      }
      const result = []
      for (const data of encoded) result.push(await score(data))
      return result
    },
    frames,
    restRect,
    movedRect.left,
  )
  const movedFrames = scores.filter((score) => score.moved >= BLUE_FLOOR)
  const duplicateFrames = movedFrames.filter((score) => score.old >= BLUE_FLOOR)
  const finalScore = scores.at(-1) ?? { old: 0, moved: 0 }

  console.log(
    `\n  released framebuffer · dSF ${DSF} · cpu /${SLOWCPU || 1} · ${frames.length} compositor frames`,
  )
  console.log(`    frames with moved window     ${movedFrames.length}`)
  console.log(`    frames with both copies      ${duplicateFrames.length}`)
  console.log(`    final blue pixels            old ${finalScore.old}, moved ${finalScore.moved}`)

  if (!movedFrames.length) problems.push('the moved DOM window was never visible in the capture')
  if (duplicateFrames.length)
    problems.push(`${duplicateFrames.length} compositor frame(s) showed both window copies`)
  if (finalScore.old >= BLUE_FLOOR)
    problems.push('the released WebGL window remained in the final compositor frame')

  // A second transfer can begin before r3f has processed the first Flight's
  // unmount. Its key and callbacks must carry the transfer lifetime, not only
  // the window name, or the new component inherits `landed=true` and stalls.
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('.gen-slot[data-win="quadrato"]') && document.fonts.status === 'loaded',
    { timeout: 15_000 },
  )
  await sleep(500)
  await page.evaluate(() =>
    document
      .querySelector('.gen-slot[data-win="quadrato"] .gen-lamp[data-role="minimize"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  )
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="quadrato"]').dataset.filled === 'true',
    { timeout: 15_000 },
  )
  await page.evaluate(() => {
    const slot = document.querySelector('.gen-slot[data-win="quadrato"]')
    const observer = new MutationObserver(() => {
      if (slot.dataset.away === 'true') return
      document
        .querySelector('.gen-slot[data-win="quadrato"] .gen-lamp[data-role="minimize"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.__duplicateReacquired = true
      observer.disconnect()
    })
    observer.observe(slot, { attributes: true, attributeFilter: ['data-away'] })
    document
      .querySelector('.gen-tile[data-win="quadrato"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(() => window.__duplicateReacquired, { timeout: 15_000 })
  let reacquired = true
  try {
    await page.waitForFunction(
      () =>
        document.querySelector('.gen-tile[data-win="quadrato"]').dataset.filled === 'true' &&
        document.querySelectorAll('.gen-sheet').length === 4,
      { timeout: 15_000 },
    )
  } catch {
    reacquired = false
    problems.push('an immediate same-window reacquisition reused the landed Flight and stalled')
  }
  console.log(`    immediate reacquisition      ${reacquired ? 'landed' : 'stalled'}`)

  if (pageErrors.length) problems.push(...pageErrors.map((error) => `page error: ${error}`))
} catch (error) {
  problems.push(error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}

if (problems.length) {
  console.error('\nno-duplicate-drag: FAIL')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log('\nno-duplicate-drag: PASS')
