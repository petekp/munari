// Claim 1 (dual-view/resize) and Claim 2 (swapchain compositing) plus probe report types.

import { createDomTextureSource, type DomTextureSource } from '@munari/core'
import {
  GLOW_WGSL,
  LIT_BAD_SRGB_WGSL,
  LIT_RAW_UNPREMULT_WGSL,
  SWAPCHAIN_RAW_WGSL,
  UNLIT_SRGB_WGSL,
  allocateDualTexture,
  buildDualSwatchElement,
  createPipeline,
  maxChannelDelta,
  premultiplySample,
  renderToReadback,
  repaintAndWait,
  rgbDeltaMax,
  sampleBuffer,
  sampleCanvas2D,
  waitNextPaint,
  type RgbaSample,
} from './probeShaders'

export interface AdapterReport {
  readonly vendor: string
  readonly architecture: string
  readonly device: string
  readonly description: string
  readonly isFallbackAdapter: boolean | null
  readonly maxTextureDimension2D: number
  readonly preferredCanvasFormat: string
}

export interface Claim1Report {
  readonly ok: boolean
  readonly validationErrors: readonly string[]
  readonly unlitOpaqueDeltaMax: number
  readonly unlitTranslucentDeltaMax: number
  readonly unlitOpaqueSample: RgbaSample
  readonly unlitTranslucentSample: RgbaSample
  readonly refOpaqueSample: RgbaSample
  readonly refTranslucentSample: RgbaSample
  readonly litRawUnpremultiplied: RgbaSample
  readonly litRawDeltaFromOpaqueMax: number
  readonly litBadSrgbNegativeControl: RgbaSample
  readonly litBadSrgbDeltaFromOpaqueMax: number
  readonly resizeSteps: readonly {
    readonly width: number
    readonly height: number
    readonly sample: RgbaSample
    readonly deltaMax: number
  }[]
}

export interface Claim3Report {
  readonly ok: boolean
  readonly asyncCompileMs: number
  readonly asyncMaxFrameGapMs: number
  readonly asyncP95FrameGapMs: number
  readonly asyncFrames: number
  readonly syncCompileMs: number
  readonly syncMaxFrameGapMs: number
  readonly mipmapSampleSrgb: RgbaSample
  readonly mipmapSampleRaw: RgbaSample
  readonly validationErrors: readonly string[]
}

export interface UploadLatencyStats {
  readonly median: number
  readonly p90: number
}

export interface Claim4Report {
  readonly adapter: AdapterReport
  readonly willReadFrequentlyFalseMs: UploadLatencyStats
  readonly willReadFrequentlyTrueMs: UploadLatencyStats
}

export interface TranslucentMipReport {
  readonly ok: boolean
  readonly refPremultSample: RgbaSample
  readonly rawSample: RgbaSample
  readonly srgbBadSample: RgbaSample
  readonly rawDeltaMax: number
  readonly srgbBadDeltaMax: number
}

export interface ComplexCompileReport {
  readonly ok: boolean
  readonly shaderBytes: number
  readonly asyncCompileMs: number
  readonly asyncMaxFrameGapMs: number
  readonly asyncP95FrameGapMs: number
  readonly syncCompileMs: number
  readonly syncMaxFrameGapMs: number
}

export interface Claim5Report {
  readonly ok: boolean
  readonly translucentMip: TranslucentMipReport
  readonly complexCompile: ComplexCompileReport
  readonly validationErrors: readonly string[]
}

async function runResizeChecks(
  device: GPUDevice,
  el: HTMLDivElement,
  source: DomTextureSource,
  unlitPipe: GPURenderPipeline,
  sampler: GPUSampler,
) {
  const steps: { readonly width: number; readonly height: number; readonly sample: RgbaSample; readonly deltaMax: number }[] = []
  for (const [rw, rh] of [[480, 240], [120, 80]] as const) {
    el.style.width = `${rw}px`
    el.style.height = `${rh}px`
    source.setSize(rw, rh)
    source.resettle()
    await repaintAndWait(source)
    const tex = allocateDualTexture(device, source.canvas)
    const nw = source.canvas.width
    const nh = source.canvas.height
    const resizedBuf = await renderToReadback(
      device,
      unlitPipe,
      sampler,
      tex.createView({ format: 'rgba8unorm-srgb' }),
      nw,
      nh,
    )
    const sx = Math.floor(nw * 0.5)
    const sy = Math.floor(nh * 0.16)
    const sample = sampleBuffer(resizedBuf, nw, sx, sy)
    const ref = sampleCanvas2D(source.canvas, sx, sy)
    steps.push({ width: nw, height: nh, sample, deltaMax: maxChannelDelta(sample, ref) })
    tex.destroy()
  }
  return steps
}

export async function runClaim1(device: GPUDevice): Promise<Claim1Report> {
  const validationErrors: string[] = []
  device.pushErrorScope('validation')

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const unlitPipe = await createPipeline(device, UNLIT_SRGB_WGSL, 'rgba8unorm')
  const litRawPipe = await createPipeline(device, LIT_RAW_UNPREMULT_WGSL, 'rgba8unorm')
  const litBadPipe = await createPipeline(device, LIT_BAD_SRGB_WGSL, 'rgba8unorm')

  const el = buildDualSwatchElement(200, 120)
  const source = createDomTextureSource(el, 200, 120, { scale: 1 })
  await waitNextPaint(source)

  const gpuTex = allocateDualTexture(device, source.canvas)
  const w = source.canvas.width
  const h = source.canvas.height
  const srgbView = gpuTex.createView({ format: 'rgba8unorm-srgb' })
  const rawView = gpuTex.createView({ format: 'rgba8unorm' })

  const unlitPixels = await renderToReadback(device, unlitPipe, sampler, srgbView, w, h)
  const litRawPixels = await renderToReadback(device, litRawPipe, sampler, rawView, w, h)
  const litBadPixels = await renderToReadback(device, litBadPipe, sampler, srgbView, w, h)
  gpuTex.destroy()

  const sx = Math.floor(w * 0.5)
  const topY = Math.floor(h * 0.16)
  const midY = Math.floor(h * 0.5)

  const refOpaqueSample = sampleCanvas2D(source.canvas, sx, topY)
  const refTranslucentSample = sampleCanvas2D(source.canvas, sx, midY)
  const unlitOpaqueSample = sampleBuffer(unlitPixels, w, sx, topY)
  const unlitTranslucentSample = sampleBuffer(unlitPixels, w, sx, midY)
  const litRawUnpremultiplied = sampleBuffer(litRawPixels, w, sx, midY)
  const litBadSrgbNegativeControl = sampleBuffer(litBadPixels, w, sx, midY)

  const resizeSteps = await runResizeChecks(device, el, source, unlitPipe, sampler)
  source.dispose()
  const err = await device.popErrorScope()
  if (err) validationErrors.push(err.message)

  const unlitOpaqueDeltaMax = maxChannelDelta(unlitOpaqueSample, premultiplySample(refOpaqueSample))
  const unlitTranslucentDeltaMax = maxChannelDelta(unlitTranslucentSample, premultiplySample(refTranslucentSample))
  const litRawDeltaFromOpaqueMax = rgbDeltaMax(litRawUnpremultiplied, refOpaqueSample)
  const litBadSrgbDeltaFromOpaqueMax = rgbDeltaMax(litBadSrgbNegativeControl, refOpaqueSample)

  const ok =
    validationErrors.length === 0 &&
    unlitOpaqueDeltaMax <= 2 &&
    unlitTranslucentDeltaMax <= 2 &&
    litRawDeltaFromOpaqueMax <= 3 &&
    litBadSrgbDeltaFromOpaqueMax >= 25 &&
    resizeSteps.every((step) => step.deltaMax <= 2)

  return {
    ok,
    validationErrors,
    unlitOpaqueDeltaMax,
    unlitTranslucentDeltaMax,
    unlitOpaqueSample,
    unlitTranslucentSample,
    refOpaqueSample,
    refTranslucentSample,
    litRawUnpremultiplied,
    litRawDeltaFromOpaqueMax,
    litBadSrgbNegativeControl,
    litBadSrgbDeltaFromOpaqueMax,
    resizeSteps,
  }
}

function drawClaim2Zone(
  device: GPUDevice,
  format: GPUTextureFormat,
  id: string,
  pipeline: GPURenderPipeline,
  sampler: GPUSampler,
  bindTex: GPUTextureView | null,
): void {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLCanvasElement)) throw new Error(`Missing canvas ${id}`)
  const ctx = el.getContext('webgpu')
  if (!(ctx instanceof GPUCanvasContext)) throw new Error(`No webgpu context on ${id}`)
  ctx.configure({ device, format, alphaMode: 'premultiplied' })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  if (bindTex) {
    const bg = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: bindTex },
      ],
    })
    pass.setBindGroup(0, bg)
  }
  pass.draw(6)
  pass.end()
  device.queue.submit([encoder.finish()])
}

export async function setupClaim2Canvases(device: GPUDevice, format: GPUTextureFormat): Promise<() => void> {
  const card = document.createElement('div')
  card.className = 'swatch-card'
  card.textContent = 'Ag'
  const source = createDomTextureSource(card, 160, 120, { scale: 1 })
  await waitNextPaint(source)

  const tex = allocateDualTexture(device, source.canvas)
  const rawView = tex.createView({ format: 'rgba8unorm' })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

  const premultBlend: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  }
  const straightBlend: GPUBlendState = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  }

  const modTex = device.createShaderModule({ code: SWAPCHAIN_RAW_WGSL })
  const pipeZoneB = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: modTex, entryPoint: 'vsMain' },
    fragment: { module: modTex, entryPoint: 'fsMain', targets: [{ format, blend: premultBlend }] },
    primitive: { topology: 'triangle-list' },
  })
  const modGlow = device.createShaderModule({ code: GLOW_WGSL })
  const pipeZoneC = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: modGlow, entryPoint: 'vsMain' },
    fragment: { module: modGlow, entryPoint: 'fsMain', targets: [{ format, blend: premultBlend }] },
    primitive: { topology: 'triangle-list' },
  })
  const pipeZoneD = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: modGlow, entryPoint: 'vsMain' },
    fragment: { module: modGlow, entryPoint: 'fsMain', targets: [{ format, blend: straightBlend }] },
    primitive: { topology: 'triangle-list' },
  })

  drawClaim2Zone(device, format, 'zone-b', pipeZoneB, sampler, rawView)
  drawClaim2Zone(device, format, 'zone-c', pipeZoneC, sampler, null)
  drawClaim2Zone(device, format, 'zone-d', pipeZoneD, sampler, null)
  await device.queue.onSubmittedWorkDone()

  return () => {
    tex.destroy()
    source.dispose()
  }
}
