// Verifies MaterialManifest contract: explicit @group(0)/@group(1)/@group(2) pipeline layouts,
// shared host pipeline cache reuse, per-instance uniform isolation, offset pose mapping, and rounded-corner masking.
import { describe, expect, it, vi } from 'vitest'
import { createManifestDriver, createManifestMaterial, unlitSurfaceManifest, type MaterialManifest } from './manifest'
import { hitPassesSurfaceMask, type RegisteredSurface, type ViewportState } from './host'
import { mat4Identity, type RayHit } from './math'
import { matchDomPose } from './surfaceDom'
import type { CachedPipelines, GpuRenderer } from './webgpu'

function asGpu<T>(partial: Partial<T>): T {
  // SAFETY: test double implements only the WebGPU members exercised by createManifestMaterial.
  return partial as T
}

function makeFakeRenderer() {
  const writes: { readonly bytes: number[] }[] = []
  const pipelineLayouts: { readonly count: number }[] = []
  const pipelineCache = new Map<string, Promise<CachedPipelines>>()
  let pipelineBuildCalls = 0
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
    createRenderPipelineAsync: () => {
      pipelineBuildCalls++
      return Promise.resolve(asGpu<GPURenderPipeline>({}))
    },
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
    getOrCreatePipelines(key, build) {
      let entry = pipelineCache.get(key)
      if (!entry) {
        entry = build()
        pipelineCache.set(key, entry)
      }
      return entry
    },
    resize: vi.fn(),
    generateMipmaps: vi.fn(),
    render: () => 0,
    simulateDeviceLoss: vi.fn(),
    dispose: vi.fn(),
  }
  return { renderer, writes, pipelineLayouts, getPipelineBuildCalls: () => pipelineBuildCalls }
}

describe('MaterialManifest runtime', () => {
  it('binds @group(0), @group(1) empty placeholder, and @group(2) when needsBackdrop is true', async () => {
    const { renderer, pipelineLayouts } = makeFakeRenderer()
    const glassNoCustom: MaterialManifest = { ...unlitSurfaceManifest, name: 'backdrop-only', needsBackdrop: true }
    const mat = createManifestMaterial(renderer, glassNoCustom)
    await mat.ready
    expect(pipelineLayouts[0]?.count).toBe(3)
    expect(mat.needsBackdrop).toBe(true)
    expect(mat.extraBindGroups?.()).toEqual([renderer.emptyBindGroup])
  })

  it('reuses compiled pipelines across surfaces sharing a MaterialManifest', async () => {
    const { renderer, getPipelineBuildCalls } = makeFakeRenderer()
    const matA = createManifestMaterial(renderer, unlitSurfaceManifest)
    const matB = createManifestMaterial(renderer, unlitSurfaceManifest)
    await Promise.all([matA.ready, matB.ready])
    expect(getPipelineBuildCalls()).toBe(2)
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

  it('subtracts viewport offset in matchDomPose when canvas does not sit at origin', () => {
    const viewport: ViewportState = {
      left: 40,
      top: 120,
      width: 800,
      height: 600,
      dpr: 2,
      fov: 42,
      cameraZ: 780,
      viewProj: mat4Identity(),
      invViewProj: mat4Identity(),
    }
    const rect = asGpu<DOMRect>({ left: 340, top: 370, width: 200, height: 100 })
    const pose = matchDomPose(rect, viewport, [200, 100])
    expect(pose.x).toBe(0)
    expect(pose.y).toBe(0)
  })

  it('rejects transparent rounded-corner ray hits while accepting interior hits', () => {
    const surface: RegisteredSurface = {
      id: 'rounded',
      pointerEvents: () => 'geometry',
      hears: () => true,
      element: () => null,
      size: () => [200, 100],
      radii: () => [16, 16, 16, 16],
      geometry: () => null,
      worldMat: () => mat4Identity(),
      invWorldMat: () => mat4Identity(),
      onRendererLost: vi.fn(),
      tick: () => null,
    }
    const cornerHit: RayHit = { distance: 100, u: 0.005, v: 0.995, point: [-99, 49.5, 0] }
    const interiorHit: RayHit = { distance: 100, u: 0.5, v: 0.5, point: [0, 0, 0] }
    expect(hitPassesSurfaceMask(surface, cornerHit)).toBe(false)
    expect(hitPassesSurfaceMask(surface, interiorHit)).toBe(true)
  })
})
