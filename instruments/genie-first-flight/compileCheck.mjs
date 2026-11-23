// Compile checks for the genie-first-flight probe — two measurements taken
// after a load's flights or on a load with no flights, both traced on traced
// browsers.
//
// The replay trace answers whether a pipeline the page creates with
// createRenderPipelineAsync compiles on a Dawn worker while the GPU process's
// main thread stays free. The compile check answers what three's
// renderer.compileAsync does with a mipmapped CanvasTexture, the shape of
// every Surface's capture texture: which builds stay asynchronous, whether
// three's mipmap pass (WebGPUTexturePassUtils) still uses the blocking call,
// and whether the first real draw after compileAsync builds anything again.
//
// The check mesh is a MeshBasicNodeMaterial, not a Surface material, so its
// compile time is not the sheet's. It must run on a load with no flights:
// three keeps one mipmap pipeline per texture format for the renderer's life,
// so a flight before it would have built that pipeline already.

import assert from 'node:assert/strict'
import { round } from './flightSummary.mjs'
import { gpuProcessBreakdown } from './traceBreakdown.ts'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CHECK_FRAMES = 20

// Runs in the page. three is imported from the URL the lab already loaded, so
// it is the renderer's own module instance.
const COMPILE_CHECK = async (frameCount) => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/deps\/three_webgpu\.js/.test(n))
  if (!url) throw new Error('three_webgpu.js is not among the loaded modules')
  const T = await import(url)
  const renderer = window.__genieRenderer
  const { scene, camera, invalidate } = window.__genieState
  const device = renderer.backend.device
  const calls = []
  const asyncCreate = device.createRenderPipelineAsync
  const syncCreate = device.createRenderPipeline
  device.createRenderPipelineAsync = function (d) {
    const row = { kind: 'async', entry: d.fragment?.entryPoint ?? '', at: performance.now(), resolvedMs: null }
    calls.push(row)
    const p = asyncCreate.call(this, d)
    p.then(() => { row.resolvedMs = performance.now() - row.at }, () => { row.resolvedMs = -1 })
    return p
  }
  device.createRenderPipeline = function (d) {
    calls.push({ kind: 'sync', entry: d.fragment?.entryPoint ?? '', at: performance.now() })
    return syncCreate.call(this, d)
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 1024, 1024)
  gradient.addColorStop(0, '#c33')
  gradient.addColorStop(1, '#33c')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1024, 1024)
  const texture = new T.CanvasTexture(canvas)
  texture.generateMipmaps = true
  texture.minFilter = T.LinearMipmapLinearFilter
  const material = new T.MeshBasicNodeMaterial({ map: texture, transparent: true })
  const mesh = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), material)
  mesh.frustumCulled = false
  const forward = new T.Vector3()
  camera.getWorldDirection(forward)
  mesh.position.copy(camera.position).addScaledVector(forward, 1)
  mesh.quaternion.copy(camera.quaternion)
  let renders = 0
  let drawn = 0
  let firstDrawAt = null
  let base = 0
  mesh.onBeforeRender = (r) => { base = r.info.render.triangles }
  mesh.onAfterRender = (r) => {
    renders++
    if (r.info.render.triangles > base) {
      drawn++
      firstDrawAt ??= performance.now()
    }
  }
  const start = performance.now()
  performance.mark('ff-compile-check')
  await renderer.compileAsync(mesh, camera, scene)
  const compiled = performance.now()
  scene.add(mesh)
  for (let i = 0; i < frameCount; i++) {
    invalidate()
    await new Promise((r) => requestAnimationFrame(r))
  }
  const end = performance.now()
  scene.remove(mesh)
  material.dispose()
  texture.dispose()
  mesh.geometry.dispose()
  Reflect.deleteProperty(device, 'createRenderPipelineAsync')
  Reflect.deleteProperty(device, 'createRenderPipeline')
  return { start, compiled, end, calls, renders, drawn, firstDrawAt }
}

function traceWindow(trace, markName, pageFrom, pageTo) {
  const events = JSON.parse(Buffer.from(trace).toString('utf8')).traceEvents
  const mark = events.find((e) => e.name === markName && (e.cat ?? '').includes('blink.user_timing'))
  assert.ok(mark, `trace has no mark ${markName}`)
  const offset = mark.ts - pageFrom * 1000
  return { events, at: (pageMs) => pageMs * 1000 + offset, window: { from: mark.ts, to: pageTo * 1000 + offset } }
}

function gpuSummary(events, window) {
  const gpu = gpuProcessBreakdown(events, window)
  const r = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))
  return {
    syncCompile: r(gpu.sync),
    syncThreads: gpu.syncThreads,
    asyncCompile: r(gpu.async),
    asyncThreads: gpu.asyncThreads,
    mainLongestTaskMs: round(gpu.mainLongestTaskMs),
    mainLongestTaskInside: gpu.mainLongestTaskInside.slice(0, 6),
  }
}

const longestGap = (frames, from, to) => {
  let longest = 0
  for (let i = 1; i < frames.length; i++) if (frames[i] > from && frames[i] <= to) longest = Math.max(longest, frames[i] - frames[i - 1])
  return round(longest)
}

/** The cold-compile replay, traced from its first compile to its last. */
export async function tracedReplay(page, { traced, categories, leadMs }) {
  if (traced) await page.tracing.start({ categories })
  await sleep(leadMs)
  const run = await page.evaluate(async () => {
    const start = performance.now()
    performance.mark('ff-replay')
    const rows = (await window.__ffReplay?.()) ?? []
    return { start, end: performance.now(), rows }
  })
  await sleep(200)
  const trace = traced ? await page.tracing.stop() : null
  const frames = await page.evaluate(() => window.__ff.frames)
  const summary = { replayMs: round(run.end - run.start), longestFrameGapMs: longestGap(frames, run.start, run.end) }
  if (trace) {
    const { events, window } = traceWindow(trace, 'ff-replay', run.start, run.end)
    summary.gpu = gpuSummary(events, window)
  }
  return { rows: run.rows, summary }
}

/** compileAsync on a mipmapped CanvasTexture mesh, then CHECK_FRAMES real frames with it in the scene. */
export async function compileCheck(page, { traced, categories, leadMs }) {
  if (traced) await page.tracing.start({ categories })
  await sleep(leadMs)
  const run = await page.evaluate(COMPILE_CHECK, CHECK_FRAMES)
  await sleep(200)
  const trace = traced ? await page.tracing.stop() : null
  const frames = await page.evaluate(() => window.__ff.frames)
  const describe = (c) => ({ kind: c.kind, entry: c.entry, atMs: round(c.at - run.start), resolvedMs: c.kind === 'async' ? round(c.resolvedMs) : null })
  const summary = {
    compileAsyncMs: round(run.compiled - run.start),
    callsDuringCompile: run.calls.filter((c) => c.at <= run.compiled).map(describe),
    callsAfterCompile: run.calls.filter((c) => c.at > run.compiled).map(describe),
    renders: run.renders,
    drawn: run.drawn,
    firstDrawAfterCompileMs: run.firstDrawAt === null ? null : round(run.firstDrawAt - run.compiled),
    longestFrameGapDuringCompileMs: longestGap(frames, run.start, run.compiled),
    longestFrameGapAfterCompileMs: longestGap(frames, run.compiled, run.end),
  }
  if (trace) {
    const { events, at, window } = traceWindow(trace, 'ff-compile-check', run.start, run.end)
    summary.gpuDuringCompile = gpuSummary(events, { from: window.from, to: at(run.compiled) })
    summary.gpuAfterCompile = gpuSummary(events, { from: at(run.compiled), to: window.to })
  }
  return summary
}
