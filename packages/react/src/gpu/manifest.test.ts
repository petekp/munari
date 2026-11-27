// Verifies MaterialManifest contract: explicit @group(0)/@group(1)/@group(2) pipeline layouts,
// per-instance uniform isolation across shared drivers, and unlitSurfaceManifest defaults.
import { describe, expect, it, vi } from 'vitest'
import { createManifestDriver, createManifestMaterial, unlitSurfaceManifest, type MaterialManifest } from './manifest'
import type { GpuRenderer } from './webgpu'

function asGpu<T>(partial: Partial<T>): T {
  // SAFETY: test double implements only the WebGPU members exercised by createManifestMaterial.
  return partial as T
}

function makeFakeRenderer() {
  const writes: { readonly bytes: number[] }[] = []
  const pipelineLayouts: { readonly count: number }[] = []
  const dummyLayout = asGpu<GPUBindGroupLayout>({ label: '' })
  const dummyBg = asGpu<GPUBindGroup>({ label: '' })
  const device = asGpu<GPUDevice>({
    createBuffer: ({ size }: GPUBufferDescriptor) => asGpu<GPUBuffer>({ size, destroy: vi.fn() }),
    createShaderModule: () => asGpu<GPUShaderModule>({}),
    createBindGroupLayout: () => dummyLayout,
    createPipelineLayout: ({ bindGroupLayouts }: GPUPipelineLayoutDescriptor) => {
      pipelineLayouts.push({ count: [...bindGroupLayouts].length })
      return asGpu<GPUPipelineLayout>({})
    },
    createBindGroup: () => dummyBg,
    createRenderPipelineAsync: () => Promise.resolve(asGpu<GPURenderPipeline>({})),
    queue: asGpu<GPUQueue>({
      writeBuffer: (_buf, _off, data) => {
        if (data instanceof ArrayBuffer) writes.push({ bytes: [...new Uint8Array(data)] })
      },
    }),
  })
  const frameUniformBuffer = asGpu<GPUBuffer>({ label: '' })

  const renderer: GpuRenderer = {
    device,
    format: 'bgra8unorm',
    isFallbackAdapter: false,
    maxTextureDimension2D: 8192,
    surfaceBindGroupLayout: dummyLayout,
    customBindGroupLayout: dummyLayout,
    emptyBindGroupLayout: dummyLayout,
    backdropBindGroupLayout: dummyLayout,
    dummyBackdropBindGroup: dummyBg,
    emptyBindGroup: dummyBg,
    frameUniformBuffer,
    validationErrors: [],
    resize: vi.fn(),
    generateMipmaps: vi.fn(),
    render: () => 0,
    simulateDeviceLoss: vi.fn(),
    dispose: vi.fn(),
  }
  return { renderer, writes, pipelineLayouts }
}

describe('MaterialManifest runtime', () => {
  it('binds @group(0), @group(1) empty placeholder, and @group(2) when needsBackdrop is true', () => {
    const { renderer, pipelineLayouts } = makeFakeRenderer()
    const glassNoCustom: MaterialManifest = { ...unlitSurfaceManifest, name: 'backdrop-only', needsBackdrop: true }
    const mat = createManifestMaterial(renderer, glassNoCustom)
    expect(pipelineLayouts[0]?.count).toBe(3)
    expect(mat.needsBackdrop).toBe(true)
    expect(mat.extraBindGroups?.()).toEqual([renderer.emptyBindGroup])
  })

  it('isolates uniform writes per surface instance on one shared manifest driver', () => {
    const { renderer, writes } = makeFakeRenderer()
    const customManifest: MaterialManifest<{ readonly gain: number }> = {
      ...unlitSurfaceManifest,
      name: 'custom-gain',
      customUniforms: {
        byteSize: 4,
        initial: { gain: 1 },
        pack: (v, view, off) => view.setFloat32(off, v.gain, true),
      },
    }
    const driver = createManifestDriver(customManifest)
    const matA = driver.factory.create(renderer)
    const matB = driver.factory.create(renderer)

    writes.length = 0
    driver.writeUniforms(matA, { gain: 2 })
    driver.writeUniforms(matB, { gain: 4 })
    expect(writes).toHaveLength(2)
    expect(new Float32Array(new Uint8Array(writes[0]!.bytes).buffer)[0]).toBe(2)
    expect(new Float32Array(new Uint8Array(writes[1]!.bytes).buffer)[0]).toBe(4)
  })
})
