// Interaction acceptance for a Surface: keyboard, focus, and the pointer
// modes.
//
// A Surface renders its content twice and shows one copy at a time, so
// everything a user does to it goes through a redirection: keystrokes reach
// whichever copy is reachable, pointer events reach the mesh and are
// relayed into the parked copy, and focus has to move between the copies
// when the hold does. None of that is visible in a screenshot and none of
// it is reachable from a unit test, because the whole mechanism is the real
// browser's focus and hit testing.
//
// What it pins:
//
// - At rest the page copy is the reachable one: Tab lands on it and Enter
//   activates it.
// - After the handoff the parked copy is the reachable one, the focus moved
//   there rather than to <body>, and the caret came with it.
// - A pointer landing on the mesh is relayed to the DOM underneath it: the
//   button presses, which also proves the mesh is standing on the page box.
// - `pointerEvents="content"` declines a pointer over clear pixels, and
//   `pointerEvents="none"` declines every pointer.
// - A touch tap relays like a mouse click.
// - The renderer surviving context loss does not lose the relay.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const labRoot = path.join(repoRoot, 'apps', 'lab')
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find(existsSync)
const strict = process.env.STRICT_CAPABILITY === '1'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function skip(reason) {
  const message = `surface-dom gate SKIPPED: ${reason}`
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
  process.exit(strict ? 1 : 0)
}

if (!chromePath) skip('no Chrome executable found (set CHROME_PATH)')

let browser
let server
const deadline = setTimeout(() => {
  console.error('surface-dom gate: hard 180s deadline hit')
  process.exit(1)
}, 180_000)

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--enable-features=CanvasDrawElement',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  })
  const capabilityProbe = await browser.newPage()
  const capable = await capabilityProbe.evaluate(
    () => 'drawElementImage' in document.createElement('canvas').getContext('2d'),
  )
  await capabilityProbe.close()
  if (!capable) skip(`Chrome at ${chromePath} has no drawElementImage`)

  server = await createServer({ root: labRoot, logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text())
    }
  })

  // Which copy the focused element is in, and what it is. `data-munari-part`
  // marks the parked container the source copy is rendered into.
  const focus = () =>
    page.evaluate(() => {
      const active = document.activeElement
      if (!active || active === document.body) return { copy: 'body', tag: null, value: null }
      const parked = active.closest('[data-munari-source-host]') !== null
      return {
        copy: parked ? 'source' : 'page',
        tag: active.tagName.toLowerCase(),
        mark: active.hasAttribute('data-gold-button')
          ? 'gold'
          : active.hasAttribute('data-silver-field')
            ? 'field'
            : null,
        value: 'value' in active ? active.value : null,
        caret: 'selectionStart' in active ? active.selectionStart : null,
      }
    })

  const events = () => page.evaluate(() => (window.__gold?.log ?? []).map((e) => `${e.surface}:${e.event}`))
  const pressed = () => page.evaluate(() => document.querySelectorAll('[data-gold-button][data-gold-pressed]').length > 0)
  const box = (selector) =>
    page.evaluate((sel) => {
      const element = document.querySelector(sel)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }, selector)
  const activate = async (selector) => {
    await page.$eval(selector, (element) => element.click())
    await sleep(60)
  }

  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?scene=gold&bare`, { waitUntil: 'load' })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-munari-source-host]').length >= 3 &&
      Boolean(window.__r3f?.scene),
    { timeout: 20_000 },
  )
  await sleep(800)

  // ── at rest the page copy is the reachable one ─────────────────────────
  // The parked copies are in the document too. If they were reachable, Tab
  // would visit every control twice and a screen reader would read the
  // content twice.
  await page.evaluate(() => document.querySelector('[data-gold-button]')?.focus())
  const atRest = await focus()
  if (atRest.copy !== 'page' || atRest.mark !== 'gold') {
    errors.push(`at rest focus should be the page copy of the button: ${JSON.stringify(atRest)}`)
  }
  await page.keyboard.press('Enter')
  await sleep(60)
  if (!(await pressed())) errors.push('Enter on the focused page copy did not activate it')
  await page.keyboard.press('Enter')
  await sleep(60)

  // ── typing, then the handoff carries focus and caret across ────────────
  await page.evaluate(() => {
    const field = document.querySelector('[data-silver-field]')
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  })
  await page.keyboard.type(' ok')
  await sleep(80)
  const typed = await focus()
  if (typed.value !== 'munari ok') {
    errors.push(`typing did not reach the page copy of the field: ${JSON.stringify(typed)}`)
  }

  await activate('[data-silver-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-silver-presented') === 'webgl',
    { timeout: 10_000 },
  )
  await sleep(120)
  const afterLift = await focus()
  if (afterLift.copy !== 'source') {
    errors.push(`the handoff dropped focus instead of moving it: ${JSON.stringify(afterLift)}`)
  }
  if (afterLift.mark !== 'field') {
    errors.push(`focus landed somewhere other than the same field: ${JSON.stringify(afterLift)}`)
  }
  if (afterLift.value !== 'munari ok') {
    errors.push(`the parked copy shows different text than the page copy did: ${afterLift.value}`)
  }
  if (afterLift.caret !== 'munari ok'.length) {
    errors.push(`the caret did not come across: ${afterLift.caret}`)
  }

  // ── and back again ─────────────────────────────────────────────────────
  await activate('[data-silver-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-silver-presented') === 'dom',
    { timeout: 10_000 },
  )
  await sleep(120)
  const afterLanding = await focus()
  if (afterLanding.copy !== 'page' || afterLanding.mark !== 'field') {
    errors.push(`landing did not bring focus home: ${JSON.stringify(afterLanding)}`)
  }

  // ── the pointer relay, which is also a match-DOM check ─────────────────
  // The click is aimed at the page box. It can only reach the button if the
  // mesh is standing exactly where the DOM copy was.
  const goldBox = await box('[data-gold-button]')
  await activate('[data-gold-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-gold-presented') === 'webgl',
    { timeout: 10_000 },
  )
  await sleep(200)
  await page.mouse.click(goldBox.x + goldBox.width / 2, goldBox.y + goldBox.height / 2)
  await sleep(120)
  if (!(await pressed())) {
    errors.push('a click on the mesh standing over the page box was not relayed to the button')
  }
  if (!(await events()).includes('gold:hit')) {
    errors.push('the caller pointer handler never ran for a relayed click')
  }

  // A touch tap is the same event grammar through a different device, and
  // it is the one that has to CLAIM the gesture — an unclaimed touch scrolls
  // the page instead of pressing the button.
  await page.touchscreen.tap(goldBox.x + goldBox.width / 2, goldBox.y + goldBox.height / 2)
  await sleep(120)
  if (await pressed()) errors.push('a touch tap on the mesh was not relayed to the button')

  // ── pointer modes ──────────────────────────────────────────────────────
  const silverBox = await box('[data-silver-card]')
  await activate('[data-silver-lift]')
  await page.waitForFunction(
    () => document.querySelector('[data-gold-state]')?.getAttribute('data-silver-presented') === 'webgl',
    { timeout: 10_000 },
  )
  await sleep(200)
  const beforeModes = (await events()).length

  // `content`: the card's own padding is clear, so a pointer there is
  // declined and never becomes a mesh event at all.
  await page.mouse.click(silverBox.x + 4, silverBox.y + 4)
  await sleep(120)
  if ((await events()).slice(beforeModes).includes('silver:hit')) {
    errors.push('a pointer over clear pixels was taken by pointerEvents="content"')
  }
  // The field inside it is opaque, so a pointer there is taken.
  const fieldBox = await box('[data-silver-field]')
  await page.mouse.click(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2)
  await sleep(120)
  if (!(await events()).slice(beforeModes).includes('silver:hit')) {
    errors.push('a pointer over opaque content was declined by pointerEvents="content"')
  }

  // `none`: the twin declines everything, whatever is under the pointer.
  const bronzeBox = await box('[data-bronze-card]')
  await page.mouse.click(bronzeBox.x + bronzeBox.width / 2, bronzeBox.y + bronzeBox.height / 2)
  await sleep(120)
  if ((await events()).some((entry) => entry.startsWith('bronze:hit'))) {
    errors.push('pointerEvents="none" took a pointer event')
  }

  // ── context loss does not cost the relay ───────────────────────────────
  const lost = await page.evaluate(() => {
    const canvas = window.__r3f?.gl?.domElement
    const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
    const extension = context?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    extension.loseContext()
    setTimeout(() => extension.restoreContext(), 100)
    return true
  })
  if (lost) {
    await sleep(1_500)
    const beforeRecovery = (await events()).length
    await page.mouse.click(goldBox.x + goldBox.width / 2, goldBox.y + goldBox.height / 2)
    await sleep(200)
    if (!(await events()).slice(beforeRecovery).includes('gold:hit')) {
      errors.push('the relay did not come back after context loss')
    }
  }

  if (errors.length) {
    console.error(`surface-dom gate FAILED (${errors.length})`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
  } else {
    console.log(
      'surface-dom gate PASSED: keyboard, focus transfer, the pointer relay, and the ' +
        'three pointer modes all survive the handoff',
    )
  }
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server?.close()
}
