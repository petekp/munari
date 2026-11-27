// Activity mode — which lab scenes stop updating under each idle mode.

import path from 'node:path'
import { labRoot, OUT, SETTLE_MS, HEADLESS, sleep, only } from './probeConfig.mjs'
import { transformed, startServer } from './idleModeTransform.mjs'
import { readAll, totalFrames, launch, openPage } from './pageProbe.mjs'
import { difference, shot } from './screenshotDiff.mjs'

export const SCENES = [
  'home', 'genie', 'flight', 'light', 'plume', 'selection', 'marble-hand', 'knobs', 'postcard', 'logo', 'review-notes', 'tear-planner', 'cutaway-prototype',
  'workspace', 'glass', 'explode', 'fisheye', 'slider', 'veil', 'optics', 'candidates', 'refraction', 'gallery', 'crystal', 'controls', 'gravity', 'lamp', 'rain',
  'distortion-wave', 'wordmark', 'style', 'why', 'architecture', 'polymer-prototype', 'material-finishes', 'finish-demo', 'frontier-prototype', 'beyond-prototype', 'signature-prototype',
]

export async function activityMode() {
  const { server, url } = await startServer(labRoot)
  const scenes = only('SCENES', SCENES)
  const modes = only('MODES', ['all-always', 'all-always-again', 'default-demand', 'all-demand'])
  const viewport = { width: 1280, height: 800, deviceScaleFactor: 1 }
  const browser = await launch()
  const results = []
  try {
    for (const scene of scenes) {
      const shots = {}
      for (const mode of modes) {
        const transformMode = mode === 'all-always-again' ? 'all-always' : mode
        const context = await browser.createBrowserContext()
        const prefix = path.join(OUT, scene + '.' + mode)
        const row = { scene, mode }
        try {
          const { page, errors } = await openPage(context, url + '/?scene=' + scene + '&bare', transformMode, viewport)
          await sleep(SETTLE_MS)
          const read = () => readAll(page)
          const idleStart = await read()
          const a = await shot(page, prefix + '.a.png')
          await sleep(2000)
          const b = await shot(page, prefix + '.b.png')
          const idleEnd = await read()
          await page.mouse.move(viewport.width * 0.2, viewport.height * 0.5)
          for (let step = 0; step <= 30; step++) {
            await page.mouse.move(viewport.width * (0.2 + 0.6 * step / 30), viewport.height * (0.5 + 0.15 * Math.sin(step / 5)))
            await sleep(16)
          }
          const sweepEnd = await read()
          await sleep(1500)
          const c = await shot(page, prefix + '.c.png')
          const settled = await read()
          const before = page.url()
          await page.mouse.click(viewport.width * 0.5, viewport.height * 0.5)
          await sleep(2500)
          const navigated = page.url() !== before
          const d = await shot(page, prefix + '.d.png')
          const clickEnd = await read()
          Object.assign(row, {
            canvases: idleEnd.canvases.length,
            idleFrames: totalFrames(idleEnd) - totalFrames(idleStart),
            sweepFrames: totalFrames(sweepEnd) - totalFrames(idleEnd),
            afterSweepFrames: totalFrames(settled) - totalFrames(sweepEnd),
            clickFrames: totalFrames(clickEnd) - totalFrames(settled),
            idleChange: difference(a, b),
            navigated,
            errors,
          })
          shots[mode] = { c, d }
        } catch (error) {
          row.failed = String(error)
        } finally {
          await context.close()
        }
        results.push(row)
      }
      const base = shots['all-always']
      for (const row of results.filter((r) => r.scene === scene && !r.failed)) {
        const own = shots[row.mode]
        row.vsAlways = base && own ? { settled: difference(base.c, own.c), clicked: difference(base.d, own.d) } : null
        console.log([scene, row.mode, 'canvases ' + row.canvases, 'idle ' + row.idleFrames + 'f ' + (row.idleChange.share * 100).toFixed(2) + '%', 'sweep ' + row.sweepFrames + 'f', 'after ' + row.afterSweepFrames + 'f', 'click ' + row.clickFrames + 'f', row.vsAlways ? 'vs-always settled ' + (row.vsAlways.settled.share * 100).toFixed(2) + '% clicked ' + (row.vsAlways.clicked.share * 100).toFixed(2) + '%' : '', row.navigated ? 'NAVIGATED' : '', row.errors.length ? 'errors=' + row.errors.length : ''].join('  '))
      }
      for (const row of results.filter((r) => r.scene === scene && r.failed)) console.log(scene + ' ' + row.mode + ' FAILED ' + row.failed)
    }
    return { chrome: await browser.version(), headless: HEADLESS, transformed, results }
  } finally {
    await browser.close()
    await server.close()
  }
}
