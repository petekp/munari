// Cost mode — idle frames, GPU time and CPU time per page and idle mode.

import { labRoot, ROUNDS, SETTLE_MS, WINDOW_MS, HEADLESS, sleep, only } from './probeConfig.mjs'
import { transformed, startServer } from './idleModeTransform.mjs'
import { readAll, totalFrames, frameDelta, launch, openPage, gpuTime, sampleGpu, profileTop, processCpu, mainThread } from './pageProbe.mjs'

// `bare` drops the lab's own furniture, whose animated wordmark costs more
// main-thread time than any canvas here; knobs-shell keeps it to measure it.
export const PAGES = [
  { id: 'blank', path: null },
  { id: 'bench', path: '/?scene=material-finishes&compare=glass&bare&finish=glass-frosted&count=12' },
  { id: 'knobs', path: '/?scene=knobs&bare' },
  { id: 'light', path: '/?scene=light&bare' },
  { id: 'glass', path: '/?scene=glass&bare' },
  { id: 'workspace', path: '/?scene=workspace&bare' },
  { id: 'optics', path: '/?scene=optics&bare' },
  { id: 'knobs-shell', path: '/?scene=knobs' },
]

export async function costMode() {
  const { server, url } = await startServer(labRoot)
  const pages = only('PAGES', PAGES)
  const modes = only('MODES', ['authored', 'all-always', 'all-demand'])
  const browser = await launch()
  const browserSession = await browser.target().createCDPSession()
  const rows = []
  try {
    for (let round = 0; round < ROUNDS; round++) {
      for (const target of pages) {
        for (const mode of target.path ? modes : ['authored']) {
          const context = await browser.createBrowserContext()
          try {
            const { page, errors } = await openPage(context, target.path ? url + target.path : 'about:blank', mode, { width: 1440, height: 900, deviceScaleFactor: 2 }, true)
            const session = await page.createCDPSession()
            await session.send('Performance.enable')
            await sleep(SETTLE_MS)
            await gpuTime(page)
            const before = { idle: await readAll(page), cpu: await processCpu(browserSession), main: await mainThread(session), at: performance.now() }
            const gpu = await sampleGpu(page, WINDOW_MS)
            const after = { idle: await readAll(page), cpu: await processCpu(browserSession), main: await mainThread(session), at: performance.now() }
            const seconds = (after.at - before.at) / 1000
            const perSecond = (value) => value / seconds
            const cpu = {}
            for (const type of Object.keys(after.cpu)) cpu[type] = (perSecond(after.cpu[type] - (before.cpu[type] ?? 0)) * 1000)
            const row = {
              round, page: target.id, mode, seconds,
              framesPerSecond: perSecond(totalFrames(after.idle) - totalFrames(before.idle)),
              perCanvas: frameDelta(before.idle, after.idle).map(perSecond),
              canvases: after.idle.canvases.map(({ width, height, connected }) => ({ width, height, connected })),
              submitsPerSecond: perSecond(after.idle.submits - before.idle.submits),
              rafPerSecond: perSecond(after.idle.rafCallbacks - before.idle.rafCallbacks),
              mainTaskMsPerSecond: perSecond(after.main.task - before.main.task) * 1000,
              mainScriptMsPerSecond: perSecond(after.main.script - before.main.script) * 1000,
              cpuMsPerSecond: cpu,
              gpuMsPerSecond: perSecond(gpu.ms),
              gpuMsPerFrame: gpu.frames > 0 ? gpu.ms / gpu.frames : null,
              gpuTimedFramesPerSecond: perSecond(gpu.frames),
              surfaceRenderers: gpu.renderers,
              profile: process.env.PROFILE === '1' && target.path ? await profileTop(page, 3000) : null,
              errors,
            }
            rows.push(row)
            console.log([round, target.id, mode, row.framesPerSecond.toFixed(1) + ' fps', row.submitsPerSecond.toFixed(1) + ' submit/s', row.rafPerSecond.toFixed(0) + ' raf/s', row.mainTaskMsPerSecond.toFixed(1) + ' main ms/s', 'gpu-proc ' + (cpu.GPU ?? cpu.gpu ?? 0).toFixed(1) + ' ms/s', 'renderer ' + (cpu.renderer ?? 0).toFixed(1) + ' ms/s', 'gpu ' + row.gpuMsPerSecond.toFixed(2) + ' ms/s (' + (row.gpuMsPerFrame?.toFixed(3) ?? '-') + ' ms/frame, ' + row.surfaceRenderers + ' renderers)', errors.length ? 'errors=' + errors.length : ''].join('  '))
          } catch (error) {
            rows.push({ round, page: target.id, mode, failed: String(error) })
            console.log(round + ' ' + target.id + ' ' + mode + ' FAILED ' + error)
          } finally {
            await context.close()
          }
        }
      }
    }
    return { chrome: await browser.version(), headless: HEADLESS, transformed, rows }
  } finally {
    await browser.close()
    await server.close()
  }
}
