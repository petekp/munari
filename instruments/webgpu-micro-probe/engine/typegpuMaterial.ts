// TypeGPU v0.12 material adapter over Munari's dual-view MicroSurfaceTexture
// and write-free async warmup pipeline contract.

import tgpu, { type TgpuRenderPipeline, type TgpuRoot } from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import type { Mat4 } from './math'
import type { MicroMaterial, MicroRenderer } from './webgpu'

const GPU_COLOR_WRITE_ALL = 0xf

export const SurfaceFrameUniforms = d.struct({
  mvp: d.mat4x4f,
  modelWorld: d.mat4x4f,
  size: d.vec2f,
  radii: d.vec4f,
})

const EXPECTED_FRAME_BYTES = d.sizeOf(SurfaceFrameUniforms)

export const surfaceLayout = tgpu
  .bindGroupLayout({
    frame: { uniform: SurfaceFrameUniforms },
    samp: { sampler: 'filtering' },
    tex: { texture: d.texture2d(d.f32) },
  })
  .$idx(0)

export const posVertexLayout = tgpu.vertexLayout((n) => d.disarrayOf(d.vec3f, n))
export const uvVertexLayout = tgpu.vertexLayout((n) => d.disarrayOf(d.vec2f, n))

export function scalarVertexLayout() {
  return tgpu.vertexLayout((n) => d.arrayOf(d.f32, n))
}

export const SURFACE_ATTRIBS = {
  position: posVertexLayout.attrib,
  uv: uvVertexLayout.attrib,
}

export const srgbOetf = tgpu.fn([d.vec3f], d.vec3f)((c) => {
  'use gpu'
  const lo = c.mul(12.92)
  const hi = std.pow(std.max(c, d.vec3f(0.0)), d.vec3f(1.0 / 2.4)).mul(1.055).sub(0.055)
  return std.select(hi, lo, std.le(c, d.vec3f(0.0031308)))
})

export const srgbEotf = tgpu.fn([d.vec3f], d.vec3f)((c) => {
  'use gpu'
  const lo = c.div(12.92)
  const hi = std.pow(std.max(c, d.vec3f(0.0)).add(0.055).div(1.055), d.vec3f(2.4))
  return std.select(hi, lo, std.le(c, d.vec3f(0.04045)))
})

export const sampleSurface = tgpu.fn([d.vec2f], d.vec4f)((uv) => {
  'use gpu'
  return std.textureSample(surfaceLayout.$.tex, surfaceLayout.$.samp, d.vec2f(uv.x, 1.0 - uv.y))
})

export const surfaceRadiusMask = tgpu.fn([d.vec2f, d.vec2f, d.vec4f], d.f32)((uv, size, radii) => {
  'use gpu'
  const point = uv.sub(0.5).mul(size)
  const left = std.select(radii.w, radii.x, point.y > 0.0)
  const right = std.select(radii.z, radii.y, point.y > 0.0)
  const radius = std.select(right, left, point.x < 0.0)
  const dBox = std.abs(point).sub(size.mul(0.5)).add(d.vec2f(radius))
  const dist = std.min(std.max(dBox.x, dBox.y), 0.0) + std.length(std.max(dBox, d.vec2f(0.0))) - radius
  const edge = std.max(std.fwidth(dist), 1e-4)
  return 1.0 - std.smoothstep(-edge, edge, dist)
})

const deviceRoots = new WeakMap<GPUDevice, TgpuRoot>()

export function getTypeGpuRoot(device: GPUDevice): TgpuRoot {
  const existing = deviceRoots.get(device)
  if (existing) return existing
  const root = tgpu.initFromDevice({ device })
  deviceRoots.set(device, root)
  return root
}

const PREMULT_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
}

export interface TypeGpuPipelineConfig {
  readonly doubleSided?: boolean
  readonly depthTest?: boolean
  readonly depthWrite?: boolean
  readonly buildPipeline: (
    root: TgpuRoot,
    colorTarget: GPUColorTargetState,
    depthStencil: GPUDepthStencilState,
    primitive: GPUPrimitiveState,
  ) => TgpuRenderPipeline
  readonly createExtras?: (root: TgpuRoot) => {
    readonly bindGroups: () => readonly GPUBindGroup[]
    readonly dispose: () => void
  }
}

export function createTypeGpuMaterial(
  renderer: MicroRenderer,
  config: TypeGpuPipelineConfig,
): MicroMaterial {
  const root = getTypeGpuRoot(renderer.device)
  const frameData = new Float32Array(EXPECTED_FRAME_BYTES / 4)
  const frameBuffer = root.createBuffer(SurfaceFrameUniforms).$usage('uniform')
  const extras = config.createExtras?.(root) ?? null

  const primitive: GPUPrimitiveState = {
    topology: 'triangle-list',
    cullMode: config.doubleSided ? 'none' : 'back',
  }
  const depthTest = config.depthTest ?? true
  const depthWrite = config.depthWrite ?? false
  const colorTarget: GPUColorTargetState = {
    format: renderer.format,
    writeMask: GPU_COLOR_WRITE_ALL,
    blend: PREMULT_BLEND,
  }
  const warmTarget: GPUColorTargetState = {
    format: renderer.format,
    writeMask: 0,
    blend: PREMULT_BLEND,
  }
  const colorDepth: GPUDepthStencilState = {
    format: 'depth24plus',
    depthWriteEnabled: depthWrite,
    depthCompare: depthTest ? 'less-equal' : 'always',
  }
  const warmDepth: GPUDepthStencilState = {
    format: 'depth24plus',
    depthWriteEnabled: false,
    depthCompare: depthTest ? 'less-equal' : 'always',
  }

  const colorPipeline = config.buildPipeline(root, colorTarget, colorDepth, primitive)
  const warmPipeline = config.buildPipeline(root, warmTarget, warmDepth, primitive)

  let rawColorPipe: GPURenderPipeline | null = null
  let rawWarmPipe: GPURenderPipeline | null = null
  let built = false
  let disposed = false
  let cachedView: GPUTextureView | null = null
  let cachedSampler: GPUSampler | null = null
  let cachedBindGroup: GPUBindGroup | null = null

  const ready = Promise.all([colorPipeline.initAsync(), warmPipeline.initAsync()]).then(() => {
    if (disposed) return
    rawColorPipe = root.unwrap(colorPipeline)
    rawWarmPipe = root.unwrap(warmPipeline)
    built = true
  })

  return {
    ready,
    isReady: () => built,
    usesDynamicFrameOffset: false,
    writeCustomUniforms() {
      // Custom uniforms for TypeGPU materials are written directly via typed buffers.
    },
    updateFrameUniforms(mvp: Mat4, modelWorld: Mat4, size: readonly [number, number], radii: readonly [number, number, number, number]) {
      frameData.set(mvp, 0)
      frameData.set(modelWorld, 16)
      frameData[32] = size[0]
      frameData[33] = size[1]
      frameData[34] = 0
      frameData[35] = 0
      frameData[36] = radii[0]
      frameData[37] = radii[1]
      frameData[38] = radii[2]
      frameData[39] = radii[3]
      frameBuffer.write(frameData.buffer)
    },
    ensureBindGroup(view, sampler) {
      if (!rawColorPipe) return null
      if (cachedBindGroup && cachedView === view && cachedSampler === sampler) return cachedBindGroup
      cachedView = view
      cachedSampler = sampler
      const bg = root.createBindGroup(surfaceLayout, {
        frame: frameBuffer,
        samp: sampler,
        tex: view,
      })
      cachedBindGroup = root.unwrap(bg)
      return cachedBindGroup
    },
    extraBindGroups: extras ? extras.bindGroups : undefined,
    pipelineFor: (colorWrite) => (colorWrite ? rawColorPipe : rawWarmPipe),
    dispose() {
      disposed = true
      frameBuffer.destroy()
      extras?.dispose()
      cachedBindGroup = null
    },
  }
}

const unlitVertexFn = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return {
    pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
    uv: input.uv,
  }
})

const unlitFragmentFn = tgpu.fragmentFn({
  in: {
    uv: d.vec2f,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const c = sampleSurface(input.uv)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(c.rgb.mul(mask), c.a * mask)
  if (outCol.a < 0.004) {
    std.discard()
  }
  return outCol
})

export function createDefaultUnlitTypeGpuMaterial(renderer: MicroRenderer): MicroMaterial {
  return createTypeGpuMaterial(renderer, {
    buildPipeline: (root, colorTarget, depthStencil, primitive) =>
      root.createRenderPipeline({
        attribs: SURFACE_ATTRIBS,
        vertex: unlitVertexFn,
        fragment: unlitFragmentFn,
        targets: colorTarget,
        depthStencil,
        primitive,
      }),
  })
}
