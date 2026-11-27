// Zero-dependency Material Manifest runtime over WebGPU MicroRenderer.
// Binds explicit @group(0) (dynamic-offset frame uniforms, sampler, surface texture)
// and optional @group(1) per-instance custom uniform buffer, with async warmup pipelines.

import {
  FRAME_UNIFORM_BYTES,
  type MicroMaterial,
  type MicroRenderer,
} from './webgpu'
import type { MicroMaterialFactory } from './reactHost'

const GPU_BUFFER_USAGE = {
  UNIFORM: 0x0040,
  COPY_DST: 0x0008,
} as const

const GPU_COLOR_WRITE_ALL = 0xf

export interface ManifestAttribute {
  readonly name: string
  readonly location: number
  readonly format: GPUVertexFormat
  readonly stride: number
}

export interface ManifestUniformSpec<TValues> {
  readonly byteSize: number
  readonly initial: TValues
  readonly pack: (values: TValues, view: DataView, byteOffset: number) => void
}

export interface MaterialManifest<TValues = never> {
  readonly name: string
  readonly wgsl: string
  readonly vertexEntry?: string
  readonly fragmentEntry?: string
  readonly sampleViewFormat: 'rgba8unorm' | 'rgba8unorm-srgb'
  readonly attributes: readonly ManifestAttribute[]
  readonly customUniforms: ManifestUniformSpec<TValues> | null
  readonly cullMode: GPUCullMode
  readonly depthWrite: boolean
  readonly depthTest: boolean
  readonly needsBackdrop?: boolean
  readonly animated?: boolean
}

export interface ManifestMaterial<TValues = never> extends MicroMaterial {
  readonly setUniforms: (values: TValues) => void
}

export interface ManifestDriver<TValues> {
  readonly factory: MicroMaterialFactory
  readonly writeUniforms: (material: MicroMaterial, values: TValues) => void
}

export function createManifestMaterial<TValues>(
  renderer: MicroRenderer,
  manifest: MaterialManifest<TValues>,
): ManifestMaterial<TValues> {
  const { device, format } = renderer
  const customSpec = manifest.customUniforms
  const bufSize = customSpec ? Math.max(16, Math.ceil(customSpec.byteSize / 16) * 16) : 0
  const staging = bufSize > 0 ? new ArrayBuffer(bufSize) : null
  const stagingView = staging ? new DataView(staging) : null
  const customBuffer =
    bufSize > 0
      ? device.createBuffer({
          size: bufSize,
          usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        })
      : null

  if (customSpec && staging && stagingView && customBuffer) {
    customSpec.pack(customSpec.initial, stagingView, 0)
    device.queue.writeBuffer(customBuffer, 0, staging)
  }

  const vertexBuffers: GPUVertexBufferLayout[] = manifest.attributes.map((attr) => ({
    arrayStride: attr.stride,
    attributes: [{ shaderLocation: attr.location, offset: 0, format: attr.format }],
  }))
  const extraLocations = manifest.attributes
    .filter((attr) => attr.location >= 2)
    .map((attr) => attr.location)

  const module = device.createShaderModule({ label: `${manifest.name}-shader`, code: manifest.wgsl })
  const bindGroupLayouts: GPUBindGroupLayout[] = [renderer.surfaceBindGroupLayout]
  if (customBuffer || manifest.needsBackdrop) {
    bindGroupLayouts.push(customBuffer ? renderer.customBindGroupLayout : renderer.emptyBindGroupLayout)
  }
  if (manifest.needsBackdrop) {
    bindGroupLayouts.push(renderer.backdropBindGroupLayout)
  }
  const pipelineLayout = device.createPipelineLayout({
    label: `${manifest.name}-layout`,
    bindGroupLayouts,
  })

  const makePipeline = (colorWrite: boolean) => {
    const vertexDesc: GPUVertexState = manifest.vertexEntry
      ? { module, entryPoint: manifest.vertexEntry, buffers: vertexBuffers }
      : { module, buffers: vertexBuffers }

    const targets: GPUColorTargetState[] = [
      {
        format,
        writeMask: colorWrite ? GPU_COLOR_WRITE_ALL : 0,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      },
    ]
    const fragmentDesc: GPUFragmentState = manifest.fragmentEntry
      ? { module, entryPoint: manifest.fragmentEntry, targets }
      : { module, targets }

    return device.createRenderPipelineAsync({
      label: `${manifest.name}-${colorWrite ? 'color' : 'warm'}`,
      layout: pipelineLayout,
      vertex: vertexDesc,
      fragment: fragmentDesc,
      primitive: { topology: 'triangle-list', cullMode: manifest.cullMode },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: colorWrite && manifest.depthWrite,
        depthCompare: manifest.depthTest ? 'less-equal' : 'always',
      },
    })
  }

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

  const ready = Promise.all([makePipeline(true), makePipeline(false)]).then(([c, w]) => {
    if (disposed) return
    colorPipe = c
    warmPipe = w
    built = true
  })

  const extraBindGroups = (() => {
    if (!customBindGroup && !manifest.needsBackdrop) return undefined
    const first = customBindGroup ?? renderer.emptyBindGroup
    return () => [first]
  })()

  return {
    ready,
    isReady: () => built,
    usesDynamicFrameOffset: true,
    needsBackdrop: Boolean(manifest.needsBackdrop),
    extraLocations,
    setUniforms(values: TValues) {
      if (!customSpec || !staging || !stagingView || !customBuffer) return
      customSpec.pack(values, stagingView, 0)
      device.queue.writeBuffer(customBuffer, 0, staging)
    },
    writeCustomUniforms() {
      // Manifest materials write typed structs via setUniforms / driver.writeUniforms.
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
    extraBindGroups,
    pipelineFor: (colorWrite) => (colorWrite ? colorPipe : warmPipe),
    dispose() {
      disposed = true
      customBuffer?.destroy()
      cachedBindGroup = null
    },
  }
}

export function createManifestDriver<TValues>(
  manifest: MaterialManifest<TValues>,
): ManifestDriver<TValues> {
  const writers = new WeakMap<MicroMaterial, (values: TValues) => void>()
  const factory: MicroMaterialFactory = {
    sampleViewFormat: manifest.sampleViewFormat,
    create: (renderer) => {
      const mat = createManifestMaterial(renderer, manifest)
      writers.set(mat, mat.setUniforms)
      return mat
    },
  }
  return {
    factory,
    writeUniforms(material, values) {
      writers.get(material)?.(values)
    },
  }
}
