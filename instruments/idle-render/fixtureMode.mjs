// Fixture mode — an author's useFrame animation, a resize and a renderer loss
// on a canvas of 12 Surfaces, under the default and "demand".

import path from 'node:path'
import { here, repoRoot, HEADLESS, sleep } from './probeConfig.mjs'
import { transformed, startServer } from './idleModeTransform.mjs'
import { readAll, totalFrames, launch, openPage } from './pageProbe.mjs'

export async function fixtureMode() {
  const { server, url } = await startServer(path.join(here, 'fixture'), {
    resolve: {
      alias: {
        '@munari/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
        '@petepetrash/munari/style.css': path.join(repoRoot, 'packages', 'react', 'src', 'style.css'),
        '@petepetrash/munari': path.join(repoRoot, 'packages', 'react', 'src', 'index.ts'),
      },
    },
  })
  const browser = await launch()
  const rows = []
  try {
    for (const frameloop of ['default', 'demand']) {
      for (const animation of ['none', 'spin', 'spin-invalidate', 'settle']) {
        const context = await browser.createBrowserContext()
        try {
          const { page, errors } = await openPage(context, url + '/?frameloop=' + frameloop + '&animation=' + animation, 'authored', { width: 1440, height: 900, deviceScaleFactor: 2 })
          await page.waitForFunction(() => window.__fixture?.ready() === true, { timeout: 30_000 })
          await sleep(3000)
          const read = async () => ({ idle: await readAll(page), rotation: await page.evaluate(() => window.__fixture.rotation()), presented: await page.evaluate(() => window.__fixture.presented()) })
          const start = await read()
          await sleep(2000)
          const idle = await read()
          await page.evaluate(() => window.__fixture.kick())
          await sleep(1500)
          const kicked = await read()
          await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 })
          await sleep(800)
          const resized = await read()
          const size = await page.evaluate(() => { const canvas = document.querySelector('canvas'); return canvas ? [canvas.width, canvas.height] : null })
          const row = {
            frameloop, animation,
            presented: start.presented,
            idleFramesPerSecond: (totalFrames(idle.idle) - totalFrames(start.idle)) / 2,
            idleRotation: idle.rotation - start.rotation,
            kickFrames: totalFrames(kicked.idle) - totalFrames(idle.idle),
            kickRotation: kicked.rotation - idle.rotation,
            resizeFrames: totalFrames(resized.idle) - totalFrames(kicked.idle),
            canvasAfterResize: size,
            errors,
          }
          rows.push(row)
          console.log(JSON.stringify(row))
        } catch (error) {
          rows.push({ frameloop, animation, failed: String(error) })
          console.log(frameloop + ' ' + animation + ' FAILED ' + error)
        } finally {
          await context.close()
        }
      }
    }
    // Renderer loss: crash the GPU process once per idle mode and count the frames the new canvas draws.
    for (const frameloop of ['default', 'demand']) {
      const crashBrowser = await launch()
      try {
        const context = crashBrowser.defaultBrowserContext()
        const { page, errors } = await openPage(context, url + '/?frameloop=' + frameloop + '&animation=none', 'authored', { width: 1440, height: 900, deviceScaleFactor: 2 })
        await page.waitForFunction(() => window.__fixture?.ready() === true, { timeout: 30_000 })
        await sleep(2000)
        const before = { idle: await readAll(page), lost: await page.evaluate(() => window.__fixture.lost()) }
        const browserSession = await crashBrowser.target().createCDPSession()
        await browserSession.send('Browser.crashGpuProcess')
        await sleep(6000)
        const after = { idle: await readAll(page), lost: await page.evaluate(() => window.__fixture.lost()), presented: await page.evaluate(() => window.__fixture.presented()) }
        const row = { frameloop, animation: 'renderer-loss', lostBefore: before.lost, lostAfter: after.lost, canvasesBefore: before.idle.canvases.length, canvasesAfter: after.idle.canvases.length, connectedFrames: after.idle.canvases.filter((c) => c.connected).map((c) => c.frames), framesOnNewCanvases: after.idle.canvases.slice(before.idle.canvases.length).map((c) => c.frames), presented: after.presented, errors }
        rows.push(row)
        console.log(JSON.stringify(row))
      } catch (error) {
        rows.push({ frameloop, animation: 'renderer-loss', failed: String(error) })
        console.log(frameloop + ' renderer-loss FAILED ' + error)
      } finally {
        await crashBrowser.close()
      }
    }
    return { chrome: await browser.version(), headless: HEADLESS, transformed, rows }
  } finally {
    await browser.close()
    await server.close()
  }
}
