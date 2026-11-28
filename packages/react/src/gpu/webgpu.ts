// Pure WebGPU renderer — owns adapter/device lifecycle, mipmap generator,
// dynamic-offset frame ring, and two-pass backdrop capture.
//
// The law: frame uniforms ride in a single dynamic-offset ring buffer (`256 B`
// stride) so multiple Surfaces never clobber one another; materials setting
// `needsBackdrop: true` draw in pass 2 over a lazy copy of pass 1 (`decisions.md #80`).
//
// Ownership: `./gpuGeometry` owns geometry & surface texture primitives; this
// module owns device creation & command submission and re-exports geometry types.

import { type BackdropBlurEngine } from './backdropBlur'
import { type Mat4 } from './math'
import {
  FRAME_UNIFORM_BYTES,
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  GPU_TEXTURE_USAGE,
  type CachedPipelines,
  type GpuDrawItem,
  type GpuFrameContext,
  type GpuRenderer,
} from './gpuGeometry'

export {
  DEFAULT_UNLIT_SURFACE_WGSL,
  FRAME_UNIFORM_BYTES,
  SURFACE_WGSL_COMMON,
  createGpuSurfaceTexture,
  createPlaneGeometry,
  deformGpuGeometry,
  resolveFrameContext,
  type CachedPipelines,
  type DeformedPoint,
  type GpuDrawItem,
  type GpuFrameContext,
  type GpuGeometry,
  type GpuMaterial,
  type GpuMaterialFactory,
  type GpuPassReceipt,
  type GpuRenderer,
  type GpuSurfaceTexture,
  type StaticTexturePayload,
  type StaticTextureResource,
} from './gpuGeometry'

const MIPMAP_PASS_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: VsOut;
  out.pos = vec4f(pos[vid], 0.0, 1.0);
  out.uv = uv[vid];
  return out;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
`

interface AdapterWithFallback extends GPUAdapter {
  readonly isFallbackAdapter?: boolean
}

function encodeDrawItem(
  pass: GPURenderPassEncoder,
  item: GpuDrawItem,
  dynamicOffset: number,
  backdropBindGroup: GPUBindGroup | null,
): number {
  if (!item.view || item.geometry.indexCount <= 0) return 0
  const pipe = item.material.pipelineFor(item.colorWrite)
  if (!pipe) return 0
  const bg = item.material.ensureBindGroup(item.view, item.sampler)
  if (!bg) return 0
  pass.setPipeline(pipe)
  if (item.material.usesDynamicFrameOffset) {
    pass.setBindGroup(0, bg, [dynamicOffset])
  } else {
    pass.setBindGroup(0, bg)
  }
  const extras = item.material.extraBindGroups?.()
  if (extras) {
    for (let i = 0; i < extras.length; i++) {
      pass.setBindGroup(i + 1, extras[i]!)
    }
  }
  if (item.material.needsBackdrop && backdropBindGroup) {
    pass.setBindGroup(2, backdropBindGroup)
  }
  pass.setVertexBuffer(0, item.geometry.posBuffer)
  pass.setVertexBuffer(1, item.geometry.uvBuffer)
  const locs = item.material.extraLocations
  if (locs) {
    for (let idx = 0; idx < locs.length; idx++) {
      const loc = locs[idx]!
      const buf = item.geometry.extraBuffers.get(loc - 2) ?? item.geometry.extraBuffers.get(loc)
      if (buf) pass.setVertexBuffer(2 + idx, buf)
    }
  } else {
    for (const [slot, buf] of item.geometry.extraBuffers) {
      pass.setVertexBuffer(slot, buf)
    }
  }
  pass.setIndexBuffer(item.geometry.indexBuffer, 'uint32')
  pass.drawIndexed(item.geometry.indexCount)
  return Math.floor(item.geometry.indexCount / 3)
}

function createFrameRing(device: GPUDevice) {
  const align = Math.max(256, device.limits.minUniformBufferOffsetAlignment || 256)
  const stride = Math.ceil(FRAME_UNIFORM_BYTES / align) * align
  let capacity = 32
  let buffer = device.createBuffer({
    size: stride * capacity,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  })
  const scratch = new Float32Array(FRAME_UNIFORM_BYTES / 4)

  return {
    stride,
    get buffer() {
      return buffer
    },
    ensureCapacity(draws: number) {
      if (draws <= capacity) return
      buffer.destroy()
      capacity = Math.max(draws, capacity * 2)
      buffer = device.createBuffer({
        size: stride * capacity,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })
    },
    write(
      slot: number,
      mvp: Mat4,
      modelWorld: Mat4,
      size: readonly [number, number],
      radii: readonly [number, number, number, number],
      frameCtx: GpuFrameContext,
    ) {
      scratch.set(mvp, 0)
      scratch.set(modelWorld, 16)
      scratch[32] = size[0]
      scratch[33] = size[1]
      scratch[34] = frameCtx.viewportW
      scratch[35] = frameCtx.viewportH
      scratch.set(radii, 36)
      scratch.set(frameCtx.tail, 40)
      device.queue.writeBuffer(buffer, slot * stride, scratch)
    },
    dispose() {
      buffer.destroy()
    },
  }
}

const MAX_VALIDATION_ERRORS = 64

function pushDevScope(device: GPUDevice): void {
  if (process.env.NODE_ENV !== 'production') device.pushErrorScope('validation')
}

function popDevScope(device: GPUDevice, pushError: (msg: string) => void): void {
  if (process.env.NODE_ENV === 'production') return
  void device.popErrorScope().then((err) => {
    if (!err) return
    pushError(err.message)
    console.error('[munari/gpu WebGPU validation]', err.message)
  })
}

export async function createGpuRenderer(
  canvas: HTMLCanvasElement,
  onDeviceLost?: (reason: string) => void,
): Promise<GpuRenderer> {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No WebGPU adapter available')
  const maxTextureDimension2D = adapter.limits.maxTextureDimension2D
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D },
  })
  const validationErrors: string[] = []
  const pushValidationError = (msg: string) => {
    if (validationErrors.length >= MAX_VALIDATION_ERRORS) validationErrors.shift()
    validationErrors.push(msg)
  }
  device.addEventListener('uncapturederror', (event) => {
    const msg = event.error?.message ?? String(event.error)
    pushValidationError(msg)
    if (process.env.NODE_ENV !== 'production') console.error('[munari/gpu WebGPU error]', msg)
  })

  const info = adapter.info
  // SAFETY: older WebGPU typings omit `isFallbackAdapter` on GPUAdapter even after `in` checks.
  const adapterFallback = adapter as AdapterWithFallback
  const isFallbackAdapter =
    'isFallbackAdapter' in info
      ? Boolean(info.isFallbackAdapter)
      : 'isFallbackAdapter' in adapter
        ? Boolean(adapterFallback.isFallbackAdapter)
        : false

  let intentionallyDisposed = false
  void device.lost.then((lostInfo) => {
    if (!intentionallyDisposed) onDeviceLost?.(lostInfo.message || lostInfo.reason || 'device lost')
  })

  const rawContext = canvas.getContext('webgpu')
  if (!(rawContext instanceof GPUCanvasContext)) throw new Error('Could not acquire webgpu canvas context')
  const context = rawContext
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
    usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
  })

  const vis = GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT
  const surfaceBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: vis, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_BYTES } },
      { binding: 1, visibility: vis, sampler: { type: 'filtering' } },
      { binding: 2, visibility: vis, texture: { sampleType: 'float', viewDimension: '2d' } },
    ],
  })
  const customBindGroupLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: vis, buffer: { type: 'uniform', hasDynamicOffset: false } }],
  })
  const emptyBindGroupLayout = device.createBindGroupLayout({ entries: [] })
  const emptyBindGroup = device.createBindGroup({ layout: emptyBindGroupLayout, entries: [] })
  const backdropBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    ],
  })
  const backdropSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const dummyBackdropTex = device.createTexture({
    size: [1, 1],
    format,
    usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
  })
  const dummyBackdropBindGroup = device.createBindGroup({
    layout: backdropBindGroupLayout,
    entries: [
      { binding: 0, resource: backdropSampler },
      { binding: 1, resource: dummyBackdropTex.createView() },
    ],
  })
  const frameRing = createFrameRing(device)

  let blurEngine: BackdropBlurEngine | null = null
  let blurPromise: Promise<void> | null = null
  let blurFailed = false

  const prepareBackdropBlur = () => {
    if (blurFailed) return Promise.resolve()
    blurPromise ??= import('./backdropBlur')
      .then(({ createBackdropBlur }) =>
        createBackdropBlur(device, format, backdropBindGroupLayout, backdropSampler),
      )
      .then((engine) => {
        if (intentionallyDisposed) {
          engine.dispose()
          return
        }
        blurEngine = engine
      })
      .catch((err) => {
        blurPromise = null
        blurFailed = true
        throw err
      })
    return blurPromise
  }

  const mipLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    ],
  })
  const mipModule = device.createShaderModule({ code: MIPMAP_PASS_WGSL })
  const mipPipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [mipLayout] }),
    vertex: { module: mipModule, entryPoint: 'vsMain' },
    fragment: { module: mipModule, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  })
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

  let depthTex: GPUTexture | null = null
  let depthWidth = 0
  let depthHeight = 0

  const ensureDepth = (w: number, h: number): GPUTextureView => {
    const safeW = Math.max(1, w)
    const safeH = Math.max(1, h)
    if (!depthTex || depthWidth !== safeW || depthHeight !== safeH) {
      depthTex?.destroy()
      depthTex = device.createTexture({
        size: [safeW, safeH],
        format: 'depth24plus',
        usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
      })
      depthWidth = safeW
      depthHeight = safeH
    }
    return depthTex.createView()
  }

  const pipelineCache = new Map<string, Promise<CachedPipelines>>()
  const disposeHooks: (() => void)[] = []

  return {
    device,
    format,
    isFallbackAdapter,
    maxTextureDimension2D,
    surfaceBindGroupLayout,
    customBindGroupLayout,
    emptyBindGroupLayout,
    backdropBindGroupLayout,
    dummyBackdropBindGroup,
    emptyBindGroup,
    get frameUniformBuffer() {
      return frameRing.buffer
    },
    validationErrors,
    getOrCreatePipelines(key, build) {
      let cached = pipelineCache.get(key)
      if (!cached) {
        cached = build().catch((err) => {
          pipelineCache.delete(key)
          throw err
        })
        pipelineCache.set(key, cached)
      }
      return cached
    },
    prepareBackdropBlur,
    onDispose(fn) {
      if (intentionallyDisposed) fn()
      else disposeHooks.push(fn)
    },
    resize(width, height) {
      const w = Math.min(maxTextureDimension2D, Math.max(1, Math.round(width)))
      const h = Math.min(maxTextureDimension2D, Math.max(1, Math.round(height)))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      ensureDepth(w, h)
    },
    generateMipmaps(texture, mipCount) {
      pushDevScope(device)
      const encoder = device.createCommandEncoder()
      for (let level = 1; level < mipCount; level++) {
        // Filtering in plain rgba8unorm preserves encoded premultiplied values (decisions.md #48).
        const src = texture.createView({ format: 'rgba8unorm', baseMipLevel: level - 1, mipLevelCount: 1 })
        const dst = texture.createView({ format: 'rgba8unorm', baseMipLevel: level, mipLevelCount: 1 })
        const bg = device.createBindGroup({
          layout: mipLayout,
          entries: [
            { binding: 0, resource: mipSampler },
            { binding: 1, resource: src },
          ],
        })
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store' }],
        })
        pass.setPipeline(mipPipeline)
        pass.setBindGroup(0, bg)
        pass.draw(3)
        pass.end()
      }
      device.queue.submit([encoder.finish()])
      popDevScope(device, pushValidationError)
    },
    render(items, frameCtx) {
      pushDevScope(device)
      frameRing.ensureCapacity(items.length)
      const baseIndices: number[] = []
      const backdropIndices: number[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!
        if (item.material.usesDynamicFrameOffset) {
          frameRing.write(i, item.mvp, item.modelWorld, item.size, item.radii, frameCtx)
        } else {
          item.material.updateFrameUniforms(item.mvp, item.modelWorld, item.size, item.radii)
        }
        if (item.material.needsBackdrop) backdropIndices.push(i)
        else baseIndices.push(i)
      }
      baseIndices.sort((a, b) => items[a]!.modelWorld[14]! - items[b]!.modelWorld[14]! || a - b)
      backdropIndices.sort((a, b) => items[a]!.modelWorld[14]! - items[b]!.modelWorld[14]! || a - b)

      const colorTex = context.getCurrentTexture()
      const colorView = colorTex.createView()
      const depthView = ensureDepth(colorTex.width, colorTex.height)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: colorView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      })

      let draws = 0
      const receipts: { readonly item: GpuDrawItem; readonly triangles: number }[] = []
      for (const idx of baseIndices) {
        const item = items[idx]!
        const triangles = encodeDrawItem(pass, item, idx * frameRing.stride, null)
        if (triangles > 0) {
          draws++
          receipts.push({ item, triangles })
        }
      }
      pass.end()

      // Pass 2 draws all backdrop-reading surfaces against the single post-pass-1
      // snapshot, so transmissive surfaces behind other transmissive surfaces are excluded.
      if (backdropIndices.length > 0 && blurEngine) {
        const backdropBg = blurEngine.encode(encoder, colorTex, colorTex.width, colorTex.height)
        const pass2 = encoder.beginRenderPass({
          colorAttachments: [{ view: colorView, loadOp: 'load', storeOp: 'store' }],
          depthStencilAttachment: {
            view: depthView,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
          },
        })
        for (const idx of backdropIndices) {
          const item = items[idx]!
          const triangles = encodeDrawItem(pass2, item, idx * frameRing.stride, backdropBg)
          if (triangles > 0) {
            draws++
            receipts.push({ item, triangles })
          }
        }
        pass2.end()
      }

      device.queue.submit([encoder.finish()])
      popDevScope(device, pushValidationError)

      for (const r of receipts) {
        r.item.onPassComplete?.({ colorWritten: r.item.colorWrite, triangles: r.triangles })
      }
      return draws
    },
    simulateDeviceLoss() {
      device.destroy()
    },
    dispose() {
      intentionallyDisposed = true
      pipelineCache.clear()
      while (disposeHooks.length > 0) disposeHooks.pop()?.()
      frameRing.dispose()
      depthTex?.destroy()
      depthTex = null
      blurEngine?.dispose()
      blurEngine = null
      dummyBackdropTex.destroy()
      device.destroy()
    },
  }
}
