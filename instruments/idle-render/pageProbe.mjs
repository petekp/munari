// Page probe — the counters installed in each page before it loads, and the
// readers for frames, GPU time, CPU time and profiles.

import puppeteer from 'puppeteer-core'
import { HEADLESS, chromePath, ARGS, sleep } from './probeConfig.mjs'

export function pageInit(mode, timestamps) {
  globalThis.__idleRenderMode = mode
  globalThis.__idleRenderTimestamps = timestamps
  // GPU time of every SurfaceCanvas pass since the previous call, from three's timestamp queries.
  window.__idleGpu = async () => {
    let ms = 0, passes = 0
    const frames = new Set()
    for (const [index, renderer] of (globalThis.__idleRenderers ?? []).entries()) {
      for (const type of ['render', 'compute']) {
        const pool = renderer.backend?.timestampQueryPool?.[type]
        if (!pool) continue
        await renderer.resolveTimestampsAsync(type)
        for (const [uid, duration] of pool.timestamps) {
          ms += duration
          passes++
          frames.add(index + ':' + type + ':' + uid.slice(uid.lastIndexOf(':f')))
        }
        pool.timestamps.clear()
      }
    }
    return { ms, passes, frames: frames.size, renderers: (globalThis.__idleRenderers ?? []).length }
  }
  const canvases = new Map()
  const counts = { submits: 0, rafCallbacks: 0 }
  window.__idle = {
    read: () => ({
      submits: counts.submits,
      rafCallbacks: counts.rafCallbacks,
      canvases: [...canvases.entries()].map(([canvas, frames]) => ({ frames, width: canvas.width, height: canvas.height, connected: canvas.isConnected })),
    }),
  }
  if ('GPUCanvasContext' in globalThis) {
    const current = GPUCanvasContext.prototype.getCurrentTexture
    GPUCanvasContext.prototype.getCurrentTexture = function () {
      canvases.set(this.canvas, (canvases.get(this.canvas) ?? 0) + 1)
      return current.call(this)
    }
    const submit = GPUQueue.prototype.submit
    GPUQueue.prototype.submit = function (buffers) {
      counts.submits++
      return submit.call(this, buffers)
    }
  }
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => raf((now) => {
    counts.rafCallbacks++
    callback(now)
  })
}

/** The counters of every frame on the page: lab demos draw inside a child frame. */
export async function readAll(page) {
  const readings = await Promise.all(page.frames().map((frame) => frame.evaluate(() => window.__idle?.read() ?? null).catch(() => null)))
  const present = readings.filter((reading) => reading !== null)
  return {
    frames: present.length,
    submits: present.reduce((sum, reading) => sum + reading.submits, 0),
    rafCallbacks: present.reduce((sum, reading) => sum + reading.rafCallbacks, 0),
    canvases: present.flatMap((reading) => reading.canvases),
  }
}

export const totalFrames = (reading) => reading.canvases.reduce((sum, canvas) => sum + canvas.frames, 0)
export const frameDelta = (before, after) => after.canvases.map((canvas, index) => canvas.frames - (before.canvases[index]?.frames ?? 0))

export async function launch() {
  return puppeteer.launch({ executablePath: chromePath, headless: HEADLESS, defaultViewport: null, protocolTimeout: 180_000, args: ARGS })
}

export async function openPage(context, url, mode, viewport, timestamps = false) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 300))
  })
  await page.setViewport(viewport)
  await page.evaluateOnNewDocument(pageInit, mode, timestamps)
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
  return { page, errors }
}


export async function gpuTime(page) {
  const readings = await Promise.all(page.frames().map((frame) => frame.evaluate(() => window.__idleGpu?.() ?? null).catch(() => null)))
  return readings.filter(Boolean).reduce((sum, reading) => ({ ms: sum.ms + reading.ms, passes: sum.passes + reading.passes, frames: sum.frames + reading.frames, renderers: sum.renderers + reading.renderers }), { ms: 0, passes: 0, frames: 0, renderers: 0 })
}

export async function sampleGpu(page, ms) {
  const total = { ms: 0, passes: 0, frames: 0, renderers: 0 }
  const end = Date.now() + ms
  while (Date.now() < end) {
    await sleep(250)
    const reading = await gpuTime(page)
    total.ms += reading.ms; total.passes += reading.passes; total.frames += reading.frames; total.renderers = reading.renderers
  }
  return total
}

export async function profileTop(page, ms) {
  const session = await page.createCDPSession()
  await session.send('Profiler.enable')
  await session.send('Profiler.setSamplingInterval', { interval: 200 })
  await session.send('Profiler.start')
  await sleep(ms)
  const { profile } = await session.send('Profiler.stop')
  const self = new Map()
  const interval = (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length) / 1000
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  for (const id of profile.samples) {
    const { callFrame } = byId.get(id)
    const key = (callFrame.functionName || '(anonymous)') + ' ' + callFrame.url.replace(/^.*\/(apps|packages|node_modules)\//, '$1/').replace(/\?.*$/, '') + ':' + (callFrame.lineNumber + 1)
    self.set(key, (self.get(key) ?? 0) + interval)
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, selfMs]) => ({ name, msPerSecond: selfMs / (ms / 1000) }))
}

export async function processCpu(browserSession) {
  const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo')
  const byType = {}
  for (const info of processInfo) byType[info.type] = (byType[info.type] ?? 0) + info.cpuTime
  return byType
}

export async function mainThread(pageSession) {
  const { metrics } = await pageSession.send('Performance.getMetrics')
  const value = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0
  return { task: value('TaskDuration'), script: value('ScriptDuration'), layout: value('LayoutDuration'), style: value('RecalcStyleDuration') }
}
