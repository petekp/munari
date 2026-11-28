// WebGPU geometry, dual-view DOM texture, and core WGSL definitions — owns
// deformable plane vertex/index buffers, surface texture allocation, and shared interfaces.
//
// The law: every Surface texture allocates one `rgba8unorm-srgb` store with an
// `rgba8unorm` alias view so unlit draws read hardware-linearized sRGB and lit
// or mip-filtered passes read/average raw premultiplied bytes without sRGB
// edge fringing (decisions.md #5, #48).
//
// Ownership: `@munari/core` owns density/realloc predicates; this module owns
// GPU geometry & surface texture wrappers; `webgpu.ts` owns the device & pass loop.

import { uploadNeedsRealloc, type DomTextureSource } from '@munari/core'
import {
  KEY_HEIGHT_PX,
  KEY_REST_Y,
  isSurfaceLight,
  type SurfaceLighting,
} from '../primitives/surface/surfaceLight'
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

export const FRAME_UNIFORM_BYTES = 256

export interface GpuFrameContext {
  readonly viewportW: number
  readonly viewportH: number
  readonly tail: Float32Array<ArrayBuffer>
}

function readLightingValues(
  lighting: SurfaceLighting,
  vw: number,
  vh: number,
  left: number,
  top: number,
) {
  const hasWin = 'window' in globalThis
  let keyX = hasWin ? window.innerWidth / 2 : left + vw / 2
  let keyY = hasWin ? window.innerHeight * KEY_REST_Y : top + vh * KEY_REST_Y
  let keyZ = KEY_HEIGHT_PX
  let keyBrightness = lighting === 'none' ? 0 : 1
  let keyW = 0
  let keyH = 0
  let rimBrightness = lighting === 'none' ? 0 : 1
  let rimElev = 15
  let envIntensity = lighting === 'none' ? 0 : 1

  if (lighting !== 'studio' && lighting !== 'none') {
    const k = lighting.key
    if (k) {
      const pos = isSurfaceLight(k) ? k.get() : k
      keyX = pos.x ?? keyX
      keyY = pos.y ?? keyY
      keyZ = pos.z ?? KEY_HEIGHT_PX
      keyBrightness = pos.brightness ?? 1
      if (pos.size) {
        keyW = pos.size[0]
        keyH = pos.size[1]
      }
    }
    if (lighting.rim === false) rimBrightness = 0
    else if (lighting.rim) {
      rimBrightness = lighting.rim.brightness ?? 1
      rimElev = lighting.rim.elevation ?? 15
    }
    envIntensity = lighting.environmentIntensity ?? 1
  }
  return { keyX, keyY, keyZ, keyBrightness, keyW, keyH, rimBrightness, rimElev, envIntensity }
}

/** Converts React `SurfaceLighting` + viewport into world-space frame uniforms once per frame. */
export function resolveFrameContext(
  viewport: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
    readonly cameraZ: number
    readonly dpr: number
  },
  lighting: SurfaceLighting,
  elapsedMs: number,
  dtMs: number,
  tail: Float32Array<ArrayBuffer> = new Float32Array(24),
): GpuFrameContext {
  const vw = viewport.width
  const vh = viewport.height
  const rig = readLightingValues(lighting, vw, vh, viewport.left, viewport.top)
  const rimRad = (rig.rimElev * Math.PI) / 180
  const across = Math.cos(rimRad) * Math.SQRT1_2
  tail[0] = viewport.cameraZ
  tail[1] = viewport.dpr
  tail[2] = elapsedMs * 0.001
  tail[3] = dtMs * 0.001
  tail[4] = rig.keyX - viewport.left - vw / 2
  tail[5] = vh / 2 - (rig.keyY - viewport.top)
  tail[6] = rig.keyZ
  tail[7] = rig.keyBrightness
  tail[8] = rig.keyW
  tail[9] = rig.keyH
  tail[10] = rig.envIntensity
  tail[11] = rig.rimBrightness
  tail[12] = -across
  tail[13] = across
  tail[14] = Math.sin(rimRad)
  tail[15] = 0
  tail[16] = 0
  tail[17] = 0
  tail[18] = 1
  tail[19] = 1
  tail.fill(0, 20, 24)
  return { viewportW: vw, viewportH: vh, tail }
}

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
  viewport: vec2f,
  radii: vec4f,
  camera: vec4f,
  keyPos: vec4f,
  keySize: vec4f,
  rimDir: vec4f,
  uvRect: vec4f,
  _r1: vec4f,
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

export interface GpuGeometry {
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
): GpuGeometry {
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
  const geo: GpuGeometry = {
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

export function deformGpuGeometry(
  geo: GpuGeometry,
  size: readonly [number, number],
  place: (x: number, y: number, index: number) => DeformedPoint,
): void {
  const [w, h] = size
  for (let i = 0; i < geo.vertexCount; i++) {
    const u = geo.uvs[i * 2] ?? 0
    const v = geo.uvs[i * 2 + 1] ?? 0
    const next = place((u - 0.5) * w, (v - 0.5) * h, i)
    geo.positions[i * 3] = next.x
    geo.positions[i * 3 + 1] = next.y
    geo.positions[i * 3 + 2] = next.z ?? 0
  }
  geo.updatePositions()
}

export interface GpuSurfaceTexture {
  readonly sampler: GPUSampler
  readonly view: (format: 'rgba8unorm-srgb' | 'rgba8unorm') => GPUTextureView | null
  readonly syncUpload: (
    source: DomTextureSource,
    generation: number,
    read: number,
    mips: boolean,
  ) => void
  readonly uploaded: () => boolean
  readonly uploadedGeneration: () => number
  readonly uploadedRead: () => number
  readonly dispose: () => void
}

export function createGpuSurfaceTexture(renderer: GpuRenderer): GpuSurfaceTexture {
  const { device } = renderer
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  })

  let texture: GPUTexture | null = null
  let srgbView: GPUTextureView | null = null
  let rawView: GPUTextureView | null = null
  let alloc: { width: number; height: number; mips: boolean; mipCount: number } | null = null
  let gen = -1
  let rd = -1
  let anyUpload = false

  const allocate = (width: number, height: number, mips: boolean) => {
    texture?.destroy()
    const mipCount = mips ? Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1) : 1
    texture = device.createTexture({
      size: [width, height],
      mipLevelCount: mipCount,
      format: 'rgba8unorm-srgb',
      viewFormats: ['rgba8unorm'],
      usage:
        GPU_TEXTURE_USAGE.TEXTURE_BINDING |
        GPU_TEXTURE_USAGE.COPY_DST |
        GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    })
    srgbView = texture.createView({ format: 'rgba8unorm-srgb' })
    rawView = texture.createView({ format: 'rgba8unorm' })
    alloc = { width, height, mips, mipCount }
  }

  return {
    sampler,
    view: (fmt) => (fmt === 'rgba8unorm' ? rawView : srgbView),
    syncUpload(source, generation, read, mips) {
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

export interface GpuMaterial {
  readonly ready: Promise<void>
  readonly isReady: () => boolean
  readonly usesDynamicFrameOffset?: boolean
  readonly needsBackdrop?: boolean
  readonly extraLocations?: readonly number[]
  readonly writeCustomUniforms: (data: Float32Array<ArrayBuffer>) => void
  readonly ensureBindGroup: (view: GPUTextureView, sampler: GPUSampler) => GPUBindGroup | null
  readonly extraBindGroups?: () => readonly GPUBindGroup[]
  readonly pipelineFor: (colorWrite: boolean) => GPURenderPipeline | null
  readonly updateFrameUniforms: (
    mvp: Mat4,
    modelWorld: Mat4,
    size: readonly [number, number],
    radii: readonly [number, number, number, number],
  ) => void
  readonly dispose: () => void
}

export interface GpuMaterialFactory {
  readonly sampleViewFormat?: 'rgba8unorm-srgb' | 'rgba8unorm'
  readonly create: (renderer: GpuRenderer) => GpuMaterial
}

export interface GpuPassReceipt {
  readonly colorWritten: boolean
  readonly triangles: number
}

export interface GpuDrawItem {
  readonly geometry: GpuGeometry
  readonly material: GpuMaterial
  readonly view: GPUTextureView | null
  readonly sampler: GPUSampler
  readonly modelWorld: Mat4
  readonly mvp: Mat4
  readonly size: readonly [number, number]
  readonly radii: readonly [number, number, number, number]
  readonly colorWrite: boolean
  readonly onPassComplete?: (receipt: GpuPassReceipt) => void
}

export interface CachedPipelines {
  readonly color: GPURenderPipeline
  readonly warm: GPURenderPipeline
}

export interface StaticTextureResource {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
  readonly sampler: GPUSampler
}

export interface StaticTexturePayload {
  readonly width: number
  readonly height: number
  readonly format: 'rgba8unorm' | 'rgba16float'
  readonly data: Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>
  readonly bytesPerRow: number
}

export interface GpuRenderer {
  readonly device: GPUDevice
  readonly format: GPUTextureFormat
  readonly isFallbackAdapter: boolean
  readonly maxTextureDimension2D: number
  readonly surfaceBindGroupLayout: GPUBindGroupLayout
  readonly customBindGroupLayout: GPUBindGroupLayout
  readonly emptyBindGroupLayout: GPUBindGroupLayout
  readonly backdropBindGroupLayout: GPUBindGroupLayout
  readonly dummyBackdropBindGroup: GPUBindGroup
  readonly emptyBindGroup: GPUBindGroup
  readonly frameUniformBuffer: GPUBuffer
  readonly validationErrors: readonly string[]
  getOrCreatePipelines(key: string, build: () => Promise<CachedPipelines>): Promise<CachedPipelines>
  prepareBackdropBlur(): Promise<void>
  onDispose(fn: () => void): void
  resize(width: number, height: number): void
  generateMipmaps(texture: GPUTexture, mipCount: number): void
  render(items: readonly GpuDrawItem[], frameCtx: GpuFrameContext): number
  simulateDeviceLoss(): void
  dispose(): void
}
