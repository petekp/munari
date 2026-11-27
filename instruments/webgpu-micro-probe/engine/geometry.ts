// Micro-engine geometry, dual-view DOM texture, material compiler, and core WGSL.

import { uploadNeedsRealloc, type DomTextureSource } from '@munari/core'
import { computeAabb, type Aabb, type Mat4 } from './math'

export const GPU_BUFFER_USAGE = {
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  COPY_DST: 0x0008,
} as const

export const GPU_TEXTURE_USAGE = {
  COPY_SRC: 0x0001,
  COPY_DST: 0x0002,
  TEXTURE_BINDING: 0x0004,
  RENDER_ATTACHMENT: 0x0010,
} as const

export const GPU_SHADER_STAGE = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
} as const

export const GPU_COLOR_WRITE_ALL = 0xf
export const FRAME_UNIFORM_BYTES = 160

export const SURFACE_WGSL_COMMON = /* wgsl */ `
fn srgbOetf(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn srgbEotf(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((max(c, vec3f(0.0)) + 0.055) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn sampleSurface(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec4f {
  return textureSample(tex, samp, vec2f(uv.x, 1.0 - uv.y));
}

fn surfaceRadiusMask(uv: vec2f, size: vec2f, radii: vec4f) -> f32 {
  let point = (uv - 0.5) * size;
  let left = select(radii.w, radii.x, point.y > 0.0);
  let right = select(radii.z, radii.y, point.y > 0.0);
  let radius = select(right, left, point.x < 0.0);
  let d = abs(point) - size * 0.5 + vec2f(radius);
  let dist = min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - radius;
  let edge = max(fwidth(dist), 1e-4);
  return 1.0 - smoothstep(-edge, edge, dist);
}
`

export const DEFAULT_UNLIT_SURFACE_WGSL =
  SURFACE_WGSL_COMMON +
  /* wgsl */ `
struct FrameUniforms {
  mvp: mat4x4f,
  modelWorld: mat4x4f,
  size: vec2f,
  _pad: vec2f,
  radii: vec4f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsMain(@location(0) position: vec3f, @location(1) uv: vec2f) -> VsOut {
  var out: VsOut;
  out.pos = frame.mvp * vec4f(position, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = sampleSurface(tex, samp, uv);
  let mask = surfaceRadiusMask(uv, frame.size, frame.radii);
  let outCol = vec4f(c.rgb * mask, c.a * mask);
  if (outCol.a < 0.004) {
    discard;
  }
  return outCol;
}
`

export interface MicroGeometry {
  readonly positions: Float32Array<ArrayBuffer>
  readonly uvs: Float32Array<ArrayBuffer>
  readonly indices: Uint32Array<ArrayBuffer>
  readonly indexCount: number
  readonly vertexCount: number
  readonly posBuffer: GPUBuffer
  readonly uvBuffer: GPUBuffer
  readonly indexBuffer: GPUBuffer
  readonly extraBuffers: Map<number, GPUBuffer>
  bounds: Aabb
  updatePositions(): void
  setExtraAttribute(slot: number, data: Float32Array<ArrayBuffer>): void
  dispose(): void
}

function buildPlaneArrays(width: number, height: number, segX: number, segY: number) {
  const cols = segX + 1
  const rows = segY + 1
  const vertexCount = cols * rows
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(segX * segY * 6)

  for (let iy = 0; iy < rows; iy++) {
    const v = 1 - iy / segY
    const y = (0.5 - iy / segY) * height
    for (let ix = 0; ix < cols; ix++) {
      const u = ix / segX
      const x = (ix / segX - 0.5) * width
      const vi = iy * cols + ix
      positions[vi * 3] = x
      positions[vi * 3 + 1] = y
      positions[vi * 3 + 2] = 0
      uvs[vi * 2] = u
      uvs[vi * 2 + 1] = v
    }
  }

  let k = 0
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * cols + ix
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices[k++] = a
      indices[k++] = c
      indices[k++] = b
      indices[k++] = b
      indices[k++] = c
      indices[k++] = d
    }
  }
  return { positions, uvs, indices, vertexCount }
}

export function createPlaneGeometry(
  device: GPUDevice,
  width: number,
  height: number,
  segX = 1,
  segY = 1,
): MicroGeometry {
  const { positions, uvs, indices, vertexCount } = buildPlaneArrays(width, height, segX, segY)
  const posBuffer = device.createBuffer({
    size: Math.max(4, positions.byteLength),
    usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
  })
  device.queue.writeBuffer(posBuffer, 0, positions)

  const uvBuffer = device.createBuffer({
    size: Math.max(4, uvs.byteLength),
    usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
  })
  device.queue.writeBuffer(uvBuffer, 0, uvs)

  const indexBuffer = device.createBuffer({
    size: Math.max(4, indices.byteLength),
    usage: GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST,
  })
  device.queue.writeBuffer(indexBuffer, 0, indices)

  const extraBuffers = new Map<number, GPUBuffer>()
  const geo: MicroGeometry = {
    positions,
    uvs,
    indices,
    indexCount: indices.length,
    vertexCount,
    posBuffer,
    uvBuffer,
    indexBuffer,
    extraBuffers,
    bounds: computeAabb(positions),
    updatePositions() {
      device.queue.writeBuffer(posBuffer, 0, positions)
      geo.bounds = computeAabb(positions)
    },
    setExtraAttribute(slot, data) {
      let buf = extraBuffers.get(slot)
      if (!buf || buf.size < data.byteLength) {
        buf?.destroy()
        buf = device.createBuffer({
          size: Math.max(4, data.byteLength),
          usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
        })
        extraBuffers.set(slot, buf)
      }
      device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength)
    },
    dispose() {
      posBuffer.destroy()
      uvBuffer.destroy()
      indexBuffer.destroy()
      for (const buf of extraBuffers.values()) buf.destroy()
      extraBuffers.clear()
    },
  }
  return geo
}

export interface DeformedPoint {
  readonly x: number
  readonly y: number
  readonly z?: number
}

export function deformMicroGeometry(
  geometry: MicroGeometry,
  size: readonly [number, number],
  place: (x: number, y: number, index: number) => DeformedPoint,
): void {
  const [w, h] = size
  const { positions, uvs, vertexCount } = geometry
  for (let i = 0; i < vertexCount; i++) {
    const cx = uvs[i * 2]! * w
    const cy = (1 - uvs[i * 2 + 1]!) * h
    const p = place(cx, cy, i)
    positions[i * 3] = p.x - w / 2
    positions[i * 3 + 1] = h / 2 - p.y
    positions[i * 3 + 2] = p.z ?? 0
  }
  geometry.updatePositions()
}

export interface MicroSurfaceTexture {
  readonly view: (format?: 'rgba8unorm-srgb' | 'rgba8unorm') => GPUTextureView | null
  readonly sampler: GPUSampler
  readonly syncUpload: (source: DomTextureSource, generation: number, read: number, mips: boolean) => void
  readonly uploaded: () => boolean
  readonly uploadedGeneration: () => number
  readonly uploadedRead: () => number
  readonly dispose: () => void
}

export function createMicroSurfaceTexture(renderer: MicroRenderer): MicroSurfaceTexture {
  const { device } = renderer
  let texture: GPUTexture | null = null
  let srgbView: GPUTextureView | null = null
  let rawView: GPUTextureView | null = null
  let alloc: { width: number; height: number; mips: boolean; mipCount: number } | null = null
  let gen = -1
  let rd = -1
  let anyUpload = false

  const linearSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest',
    maxAnisotropy: 1,
  })
  const mipSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  })
  let currentMips = false

  const allocate = (width: number, height: number, mips: boolean) => {
    texture?.destroy()
    const mipCount = mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1
    texture = device.createTexture({
      size: [width, height],
      mipLevelCount: mipCount,
      format: 'rgba8unorm-srgb',
      viewFormats: ['rgba8unorm'],
      usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    })
    srgbView = texture.createView({ format: 'rgba8unorm-srgb' })
    rawView = texture.createView({ format: 'rgba8unorm' })
    alloc = { width, height, mips, mipCount }
    currentMips = mips
  }

  return {
    view(format = 'rgba8unorm') {
      return format === 'rgba8unorm-srgb' ? srgbView : rawView
    },
    get sampler() {
      return currentMips ? mipSampler : linearSampler
    },
    syncUpload(source, generation, read, mips) {
      if (!source.painted()) return
      const w = source.canvas.width
      const h = source.canvas.height
      if (w <= 0 || h <= 0) return
      if (!alloc || uploadNeedsRealloc(alloc, { width: w, height: h }) || alloc.mips !== mips) {
        allocate(w, h, mips)
      }
      if (!texture) return
      device.queue.copyExternalImageToTexture(
        { source: source.canvas },
        { texture, premultipliedAlpha: true },
        [w, h],
      )
      if (mips && alloc && alloc.mipCount > 1) {
        renderer.generateMipmaps(texture, alloc.mipCount)
      }
      gen = generation
      rd = read
      anyUpload = true
    },
    uploaded: () => anyUpload,
    uploadedGeneration: () => gen,
    uploadedRead: () => rd,
    dispose() {
      texture?.destroy()
      texture = null
      srgbView = null
      rawView = null
      alloc = null
    },
  }
}

export interface MicroMaterialOptions {
  readonly wgsl?: string
  readonly sampleViewFormat?: 'rgba8unorm-srgb' | 'rgba8unorm'
  readonly doubleSided?: boolean
  readonly depthWrite?: boolean
  readonly depthTest?: boolean
  readonly customUniformFloats?: number
  readonly extraVertexSlots?: readonly { readonly shaderLocation: number; readonly format: GPUVertexFormat }[]
}

export interface MicroMaterial {
  readonly ready: Promise<void>
  readonly isReady: () => boolean
  readonly usesDynamicFrameOffset?: boolean
  readonly needsBackdrop?: boolean
  readonly extraLocations?: readonly number[]
  readonly writeCustomUniforms: (data: Float32Array<ArrayBuffer>) => void
  readonly ensureBindGroup: (view: GPUTextureView, sampler: GPUSampler) => GPUBindGroup | null
  readonly extraBindGroups?: () => readonly GPUBindGroup[]
  readonly pipelineFor: (colorWrite: boolean) => GPURenderPipeline | null
  readonly updateFrameUniforms: (mvp: Mat4, modelWorld: Mat4, size: readonly [number, number], radii: readonly [number, number, number, number]) => void
  readonly dispose: () => void
}

export function createMicroMaterial(
  renderer: MicroRenderer,
  options: MicroMaterialOptions = {},
): MicroMaterial {
  const { device, format } = renderer
  const wgsl = options.wgsl ?? DEFAULT_UNLIT_SURFACE_WGSL
  const extraSlots = options.extraVertexSlots ?? []
  const customFloats = options.customUniformFloats ?? 0
  const hasCustom = customFloats > 0
  const customData = new Float32Array(Math.max(4, customFloats))
  const customBuffer = hasCustom
    ? device.createBuffer({
        size: Math.ceil((customFloats * 4) / 16) * 16,
        usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
      })
    : null

  const buffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
    ...extraSlots.map((slot) => ({
      arrayStride: 4,
      attributes: [{ shaderLocation: slot.shaderLocation, offset: 0, format: slot.format }],
    })),
  ]

  const module = device.createShaderModule({ code: wgsl })
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: hasCustom
      ? [renderer.surfaceBindGroupLayout, renderer.customBindGroupLayout]
      : [renderer.surfaceBindGroupLayout],
  })
  const cullMode: GPUCullMode = options.doubleSided ? 'none' : 'back'
  const depthTest = options.depthTest ?? true
  const depthWrite = options.depthWrite ?? false

  const makePipeline = (colorWrite: boolean) =>
    device.createRenderPipelineAsync({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vsMain', buffers },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [
          {
            format,
            writeMask: colorWrite ? GPU_COLOR_WRITE_ALL : 0,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: colorWrite && depthWrite,
        depthCompare: depthTest ? 'less-equal' : 'always',
      },
    })

  let colorPipe: GPURenderPipeline | null = null
  let warmPipe: GPURenderPipeline | null = null
  let built = false
  let disposed = false
  let cachedView: GPUTextureView | null = null
  let cachedSampler: GPUSampler | null = null
  let cachedFrameBuffer: GPUBuffer | null = null
  let cachedBindGroup: GPUBindGroup | null = null

  const customBindGroup = customBuffer
    ? device.createBindGroup({
        layout: renderer.customBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: customBuffer } }],
      })
    : null
  const extraLocations = extraSlots.map((slot) => slot.shaderLocation)

  const ready = Promise.all([makePipeline(true), makePipeline(false)]).then(([c, w]) => {
    if (disposed) return
    colorPipe = c
    warmPipe = w
    built = true
  })

  return {
    ready,
    isReady: () => built,
    usesDynamicFrameOffset: true,
    extraLocations,
    writeCustomUniforms(data) {
      if (!customBuffer) return
      customData.set(data.subarray(0, customFloats), 0)
      device.queue.writeBuffer(customBuffer, 0, customData)
    },
    updateFrameUniforms() {
      // Dynamic-offset frame uniforms are written per draw slot in renderer.render().
    },
    ensureBindGroup(view, sampler) {
      if (!colorPipe) return null
      const frameBuf = renderer.frameUniformBuffer
      if (
        cachedBindGroup &&
        cachedView === view &&
        cachedSampler === sampler &&
        cachedFrameBuffer === frameBuf
      ) {
        return cachedBindGroup
      }
      cachedView = view
      cachedSampler = sampler
      cachedFrameBuffer = frameBuf
      cachedBindGroup = device.createBindGroup({
        layout: renderer.surfaceBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: frameBuf, offset: 0, size: FRAME_UNIFORM_BYTES } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: view },
        ],
      })
      return cachedBindGroup
    },
    extraBindGroups: customBindGroup ? () => [customBindGroup] : undefined,
    pipelineFor: (colorWrite) => (colorWrite ? colorPipe : warmPipe),
    dispose() {
      disposed = true
      customBuffer?.destroy()
      cachedBindGroup = null
    },
  }
}

export interface MicroPassReceipt {
  readonly colorWritten: boolean
  readonly triangles: number
}

export interface MicroDrawItem {
  readonly geometry: MicroGeometry
  readonly material: MicroMaterial
  readonly view: GPUTextureView | null
  readonly sampler: GPUSampler
  readonly modelWorld: Mat4
  readonly mvp: Mat4
  readonly size: readonly [number, number]
  readonly radii: readonly [number, number, number, number]
  readonly colorWrite: boolean
  readonly onPassComplete?: (receipt: MicroPassReceipt) => void
}

export interface MicroRenderer {
  readonly device: GPUDevice
  readonly format: GPUTextureFormat
  readonly isFallbackAdapter: boolean
  readonly maxTextureDimension2D: number
  readonly surfaceBindGroupLayout: GPUBindGroupLayout
  readonly customBindGroupLayout: GPUBindGroupLayout
  readonly emptyBindGroupLayout: GPUBindGroupLayout
  readonly backdropBindGroupLayout: GPUBindGroupLayout
  readonly emptyBindGroup: GPUBindGroup
  readonly frameUniformBuffer: GPUBuffer
  readonly validationErrors: readonly string[]
  resize(width: number, height: number): void
  generateMipmaps(texture: GPUTexture, mipCount: number): void
  render(items: readonly MicroDrawItem[]): number
  simulateDeviceLoss(): void
  dispose(): void
}
