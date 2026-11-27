// Claim runners 3–5 and adapter telemetry for the Step 1 WebGPU probe.

import {
  GPU_SHADER_STAGE,
  GPU_TEXTURE_USAGE,
  MIPMAP_WGSL,
  MIP_SAMPLE_RAW_WGSL,
  MIP_SAMPLE_SRGB_2_WGSL,
  MIP_SAMPLE_WGSL,
  SWAPCHAIN_RAW_WGSL,
  buildRealisticLitGlassWgsl,
  buildSaltedShaders,
  createPipeline,
  generateMipmaps,
  maxChannelDelta,
  renderToReadback,
  sampleBuffer,
  type RgbaSample,
} from './probeShaders'
import type {
  AdapterReport,
  Claim3Report,
  Claim5Report,
  ComplexCompileReport,
  TranslucentMipReport,
  UploadLatencyStats,
} from './probeClaimTypes'

export {
  runClaim1,
  setupClaim2Canvases,
  type AdapterReport,
  type Claim1Report,
  type Claim3Report,
  type Claim4Report,
  type Claim5Report,
} from './probeClaimTypes'

interface RafGapMetrics {
  readonly maxGapMs: number
  readonly p95GapMs: number
  readonly frames: number
}

interface RafWatcher {
  stop(): RafGapMetrics
}

function measureRafGaps(): RafWatcher {
  const gaps: number[] = []
  let prev = performance.now()
  let raf = 0
  let active = true
  const step = () => {
    if (!active) return
    const now = performance.now()
    gaps.push(now - prev)
    prev = now
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return {
    stop() {
      active = false
      cancelAnimationFrame(raf)
      const sorted = [...gaps].sort((a, b) => a - b)
      const maxGapMs = sorted[sorted.length - 1] ?? 0
      const p95GapMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0
      return { maxGapMs, p95GapMs, frames: gaps.length }
    },
  }
}

async function runMipmapCheck(device: GPUDevice) {
  const mipLevels = 9
  const tex = device.createTexture({
    size: [256, 256],
    mipLevelCount: mipLevels,
    format: 'rgba8unorm-srgb',
    viewFormats: ['rgba8unorm'],
    usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
  })
  const c2d = document.createElement('canvas')
  c2d.width = 256
  c2d.height = 256
  const ctx2d = c2d.getContext('2d')!
  ctx2d.fillStyle = 'rgb(200, 80, 40)'
  ctx2d.fillRect(0, 0, 256, 256)
  device.queue.copyExternalImageToTexture({ source: c2d }, { texture: tex, premultipliedAlpha: true }, [256, 256])

  const mipSrgbPipe = await createPipeline(device, MIPMAP_WGSL, 'rgba8unorm-srgb')
  const mipRawPipe = await createPipeline(device, MIPMAP_WGSL, 'rgba8unorm')
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' })

  await generateMipmaps(device, mipSrgbPipe, mipSampler, tex, 'rgba8unorm-srgb', mipLevels)
  const srgbMipBuf = await renderToReadback(
    device,
    await createPipeline(device, MIP_SAMPLE_WGSL, 'rgba8unorm'),
    mipSampler,
    tex.createView({ format: 'rgba8unorm-srgb' }),
    16,
    16,
  )
  const mipmapSampleSrgb = sampleBuffer(srgbMipBuf, 16, 8, 8)

  await generateMipmaps(device, mipRawPipe, mipSampler, tex, 'rgba8unorm', mipLevels)
  const rawMipBuf = await renderToReadback(
    device,
    await createPipeline(device, SWAPCHAIN_RAW_WGSL, 'rgba8unorm'),
    mipSampler,
    tex.createView({ format: 'rgba8unorm' }),
    16,
    16,
  )
  const mipmapSampleRaw = sampleBuffer(rawMipBuf, 16, 8, 8)
  tex.destroy()
  return { mipmapSampleSrgb, mipmapSampleRaw }
}

export async function runClaim3(device: GPUDevice): Promise<Claim3Report> {
  const validationErrors: string[] = []
  device.pushErrorScope('validation')

  const baseSalt = Math.floor(Math.random() * 1_000_000_000)
  const asyncShaders = buildSaltedShaders(baseSalt)
  const syncShaders = buildSaltedShaders(baseSalt + 1)

  const asyncWatcher = measureRafGaps()
  await new Promise((r) => setTimeout(r, 40))
  const asyncStart = performance.now()
  await Promise.all(asyncShaders.map((code) => createPipeline(device, code, 'rgba8unorm')))
  const asyncCompileMs = performance.now() - asyncStart
  await new Promise((r) => setTimeout(r, 40))
  const asyncMetrics = asyncWatcher.stop()

  const syncWatcher = measureRafGaps()
  await new Promise((r) => setTimeout(r, 40))
  const syncStart = performance.now()
  for (const code of syncShaders) {
    const module = device.createShaderModule({ code })
    device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    })
  }
  const syncCompileMs = performance.now() - syncStart
  await new Promise((r) => setTimeout(r, 40))
  const syncMetrics = syncWatcher.stop()

  const { mipmapSampleSrgb, mipmapSampleRaw } = await runMipmapCheck(device)
  const err = await device.popErrorScope()
  if (err) validationErrors.push(err.message)

  const ok =
    validationErrors.length === 0 &&
    Math.abs(mipmapSampleSrgb.r - 200) <= 3 &&
    Math.abs(mipmapSampleRaw.r - 200) <= 3

  return {
    ok,
    asyncCompileMs: Math.round(asyncCompileMs * 10) / 10,
    asyncMaxFrameGapMs: Math.round(asyncMetrics.maxGapMs * 10) / 10,
    asyncP95FrameGapMs: Math.round(asyncMetrics.p95GapMs * 10) / 10,
    asyncFrames: asyncMetrics.frames,
    syncCompileMs: Math.round(syncCompileMs * 10) / 10,
    syncMaxFrameGapMs: Math.round(syncMetrics.maxGapMs * 10) / 10,
    mipmapSampleSrgb,
    mipmapSampleRaw,
    validationErrors,
  }
}

function summarizeTimings(values: readonly number[]): UploadLatencyStats {
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0
  return {
    median: Math.round(median * 100) / 100,
    p90: Math.round(p90 * 100) / 100,
  }
}

export async function measureUploadLatency(device: GPUDevice, willReadFrequently: boolean): Promise<UploadLatencyStats> {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d', { willReadFrequently })!
  const tex = device.createTexture({
    size: [512, 512],
    format: 'rgba8unorm-srgb',
    viewFormats: ['rgba8unorm'],
    usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
  })
  const samples: number[] = []
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `rgb(${100 + i}, 80, 40)`
    ctx.fillRect(0, 0, 512, 512)
    const t0 = performance.now()
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture: tex, premultipliedAlpha: true }, [512, 512])
    await device.queue.onSubmittedWorkDone()
    samples.push(performance.now() - t0)
  }
  tex.destroy()
  return summarizeTimings(samples)
}

interface AdapterWithFallback extends GPUAdapter {
  readonly isFallbackAdapter?: boolean
}

export function readAdapterReport(adapter: GPUAdapter, preferredCanvasFormat: string): AdapterReport {
  const info = adapter.info
  // SAFETY: older WebGPU typings omit `isFallbackAdapter` on GPUAdapter even after `in` checks.
  const adapterFallback = adapter as AdapterWithFallback
  const fallback =
    'isFallbackAdapter' in info
      ? Boolean(info.isFallbackAdapter)
      : 'isFallbackAdapter' in adapter
        ? Boolean(adapterFallback.isFallbackAdapter)
        : null
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: fallback,
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    preferredCanvasFormat,
  }
}

async function runTranslucentMipCheck(device: GPUDevice): Promise<TranslucentMipReport> {
  const mipLevels = 5
  const tex = device.createTexture({
    size: [256, 256],
    mipLevelCount: mipLevels,
    format: 'rgba8unorm-srgb',
    viewFormats: ['rgba8unorm'],
    usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
  })
  const c2d = document.createElement('canvas')
  c2d.width = 256
  c2d.height = 256
  const ctx2d = c2d.getContext('2d')!
  // 1px opaque / 1px transparent edge stripes -> averages to 50% coverage (100, 40, 20, 128) at mip >= 1.
  ctx2d.clearRect(0, 0, 256, 256)
  ctx2d.fillStyle = 'rgb(200, 80, 40)'
  for (let x = 0; x < 256; x += 2) {
    ctx2d.fillRect(x, 0, 1, 256)
  }
  device.queue.copyExternalImageToTexture({ source: c2d }, { texture: tex, premultipliedAlpha: true }, [256, 256])

  const mipRawPipe = await createPipeline(device, MIPMAP_WGSL, 'rgba8unorm')
  const mipSrgbPipe = await createPipeline(device, MIPMAP_WGSL, 'rgba8unorm-srgb')
  const readRawPipe = await createPipeline(device, MIP_SAMPLE_RAW_WGSL, 'rgba8unorm')
  const readSrgbPipe = await createPipeline(device, MIP_SAMPLE_SRGB_2_WGSL, 'rgba8unorm')
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' })

  await generateMipmaps(device, mipRawPipe, mipSampler, tex, 'rgba8unorm', mipLevels)
  const rawMipBuf = await renderToReadback(device, readRawPipe, mipSampler, tex.createView({ format: 'rgba8unorm' }), 16, 16)
  const rawSample = sampleBuffer(rawMipBuf, 16, 8, 8)

  await generateMipmaps(device, mipSrgbPipe, mipSampler, tex, 'rgba8unorm-srgb', mipLevels)
  const srgbMipBuf = await renderToReadback(
    device,
    readSrgbPipe,
    mipSampler,
    tex.createView({ format: 'rgba8unorm-srgb' }),
    16,
    16,
  )
  const srgbBadSample = sampleBuffer(srgbMipBuf, 16, 8, 8)
  tex.destroy()

  const refPremultSample: RgbaSample = { r: 100, g: 40, b: 20, a: 128 }
  const rawDeltaMax = maxChannelDelta(rawSample, refPremultSample)
  const srgbBadDeltaMax = maxChannelDelta(srgbBadSample, refPremultSample)
  return {
    ok: rawDeltaMax <= 3 && srgbBadDeltaMax >= 15,
    refPremultSample,
    rawSample,
    srgbBadSample,
    rawDeltaMax,
    srgbBadDeltaMax,
  }
}

async function runComplexCompileCheck(device: GPUDevice, baseSalt: number): Promise<ComplexCompileReport> {
  const surfaceLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } },
      { binding: 1, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  })
  const customLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [surfaceLayout, customLayout] })
  const vertexBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
  ]
  const makeDesc = (code: string): GPURenderPipelineDescriptor => {
    const module = device.createShaderModule({ code })
    return {
      layout,
      vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [
          {
            format: 'bgra8unorm',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    }
  }

  const asyncWgsl = buildRealisticLitGlassWgsl(baseSalt)
  const asyncWatcher = measureRafGaps()
  await new Promise((r) => setTimeout(r, 40))
  const tAsync0 = performance.now()
  await device.createRenderPipelineAsync(makeDesc(asyncWgsl))
  const asyncCompileMs = performance.now() - tAsync0
  await new Promise((r) => setTimeout(r, 40))
  const asyncMetrics = asyncWatcher.stop()

  const syncWgsl = buildRealisticLitGlassWgsl(baseSalt + 1)
  const syncWatcher = measureRafGaps()
  await new Promise((r) => setTimeout(r, 40))
  const tSync0 = performance.now()
  device.createRenderPipeline(makeDesc(syncWgsl))
  const syncCompileMs = performance.now() - tSync0
  await new Promise((r) => setTimeout(r, 40))
  const syncMetrics = syncWatcher.stop()

  return {
    ok: true,
    shaderBytes: new TextEncoder().encode(asyncWgsl).length,
    asyncCompileMs: Math.round(asyncCompileMs * 10) / 10,
    asyncMaxFrameGapMs: Math.round(asyncMetrics.maxGapMs * 10) / 10,
    asyncP95FrameGapMs: Math.round(asyncMetrics.p95GapMs * 10) / 10,
    syncCompileMs: Math.round(syncCompileMs * 10) / 10,
    syncMaxFrameGapMs: Math.round(syncMetrics.maxGapMs * 10) / 10,
  }
}

export async function runClaim5(device: GPUDevice): Promise<Claim5Report> {
  const validationErrors: string[] = []
  device.pushErrorScope('validation')
  const translucentMip = await runTranslucentMipCheck(device)
  const complexCompile = await runComplexCompileCheck(device, Math.floor(Math.random() * 1_000_000_000))
  const err = await device.popErrorScope()
  if (err) validationErrors.push(err.message)
  return {
    ok: validationErrors.length === 0 && translucentMip.ok && complexCompile.ok,
    translucentMip,
    complexCompile,
    validationErrors,
  }
}
