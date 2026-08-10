// mouth-anchor — does the narrow neck end inside a fixed-centre icon?
//
// The dock button is only a hit target. Its solid SVG mark sits above the
// WebGL overlay, grows from its centre, and hides an 8px neck at that centre.
// This gate checks those contracts in both empty and filled states.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const labRoot = path.join(here, '..', '..', 'apps', 'lab')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!CHROME) throw new Error('mouth-anchor: Chrome was not found; set CHROME_PATH')

let browser
let server
const deadline = setTimeout(() => {
  console.error('mouth-anchor: hard 90s deadline hit')
  process.exit(1)
}, 90_000)

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port

  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=genie`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      document.querySelector('.gen-tile[data-win="scheda"] .gen-icon-base'),
    { timeout: 15_000 },
  )
  await sleep(350)

  const read = () =>
    page.evaluate(() => {
      const tile = document.querySelector('.gen-tile[data-win="scheda"]')
      const mark = tile.querySelector('.gen-icon-base')
      const pane = tile.querySelector('.gen-pane')
      const tileStyle = getComputedStyle(tile)
      const matrix =
        tileStyle.transform === 'none' ? new DOMMatrix() : new DOMMatrix(tileStyle.transform)
      const box = tile.getBoundingClientRect()
      const markBox = mark.getBoundingClientRect()
      const [originX, originY] = tileStyle.transformOrigin.split(' ').map(Number.parseFloat)
      const dockZ = Number.parseInt(getComputedStyle(document.querySelector('.gen-dock')).zIndex)
      const overlayZ = Number.parseInt(
        getComputedStyle(document.querySelector('.gen-overlay')).zIndex,
      )
      const mouthCss = Number.parseFloat(tileStyle.getPropertyValue('--gen-mouth'))
      const themeFills = [...document.querySelectorAll('.gen-tile .gen-pane')].map(
        (element) => getComputedStyle(element).fill,
      )
      return {
        width: box.width,
        offsetWidth: tile.offsetWidth,
        offsetHeight: tile.offsetHeight,
        cx: box.left + box.width / 2,
        cy: box.top + box.height / 2,
        originX,
        originY,
        sx: matrix.a,
        markWidth: markBox.width,
        mouth: mouthCss * matrix.a,
        baseFill: getComputedStyle(mark).fill,
        paneClip: getComputedStyle(pane).clipPath,
        themeFills,
        dockZ,
        overlayZ,
      }
    })

  const rest = await read()
  const lamp = await page.evaluate(() => {
    const box = document
      .querySelector('.gen-sheet[data-win="scheda"] .gen-lamp[data-role="minimize"]')
      .getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })
  await page.mouse.click(lamp.x, lamp.y)
  await page.waitForFunction(
    () => document.querySelector('.gen-tile[data-win="scheda"]').dataset.filled === 'true',
    { timeout: 8000 },
  )
  await sleep(700)
  const docked = await read()

  console.log('\n                             rest      docked')
  for (const [label, a, b] of [
    ['icon centre x', rest.cx, docked.cx],
    ['icon centre y', rest.cy, docked.cy],
    ['icon width', rest.width, docked.width],
    ['icon scale', rest.sx, docked.sx],
    ['visible neck', rest.mouth, docked.mouth],
    ['solid mark width', rest.markWidth, docked.markWidth],
  ]) {
    console.log(
      `  ${label.padEnd(25)} ${a.toFixed(2).padStart(8)}  ${b.toFixed(2).padStart(8)}`,
    )
  }

  const problems = []
  if (Math.abs(rest.cx - docked.cx) > 0.5 || Math.abs(rest.cy - docked.cy) > 0.5)
    problems.push('the icon centre moved while the icon grew')
  if (
    Math.abs(rest.originX - rest.offsetWidth / 2) > 0.1 ||
    Math.abs(rest.originY - rest.offsetHeight / 2) > 0.1
  )
    problems.push(
      `transform origin is ${rest.originX}px ${rest.originY}px, not the icon centre`,
    )
  if (Math.abs(rest.offsetWidth - 58) > 0.5)
    problems.push(`the icon hit target is ${rest.offsetWidth}px, not 58px`)
  if (docked.sx < 1.2) problems.push(`the filled icon barely grew (${docked.sx.toFixed(2)}x)`)
  if (rest.mouth / rest.markWidth > 0.25 || docked.mouth / docked.markWidth > 0.25)
    problems.push('the final neck is not comfortably inside the solid mark')
  if (Math.abs(docked.mouth / rest.mouth - docked.sx / rest.sx) > 0.02)
    problems.push('the neck and icon no longer grow from the same dock pose')
  if (rest.dockZ <= rest.overlayZ)
    problems.push(`dock z-index ${rest.dockZ} does not cover overlay ${rest.overlayZ}`)
  if (rest.baseFill !== 'rgb(255, 255, 255)')
    problems.push(`the empty icon is ${rest.baseFill}, not solid white`)
  if (new Set(rest.themeFills).size !== 4)
    problems.push(`the four icons expose only ${new Set(rest.themeFills).size} theme fills`)
  if (!/100%/.test(rest.paneClip)) problems.push(`the empty icon clip is ${rest.paneClip}`)
  if (/100%/.test(docked.paneClip)) problems.push(`the filled icon clip is ${docked.paneClip}`)

  console.log(`\n  empty clip:  ${rest.paneClip}`)
  console.log(`  filled clip: ${docked.paneClip}`)
  console.log(
    `\nmouth-anchor: ${
      problems.length === 0
        ? 'PASS — the centred icon covers a narrow, scaled neck'
        : 'FAIL'
    }`,
  )
  for (const problem of problems) console.log(`  ${problem}`)
  process.exitCode = problems.length === 0 ? 0 : 1
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
