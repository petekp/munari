// Verifies MaterialManifest contract: explicit @group(0)/@group(1)/@group(2) pipeline layouts,
// shared host pipeline cache reuse, per-instance uniform isolation, offset pose mapping, and rounded-corner masking.
import { describe, expect, it, vi } from 'vitest'
import { createManifestDriver, createManifestMaterial, unlitSurfaceManifest, type MaterialManifest } from './manifest'
import { getOrCreateGpuHost, hitPassesSurfaceMask, hostInternals, requestGpuFrame, type RegisteredSurface, type ViewportState } from './host'
import { loadLtcTable } from './ltc'
import { mat4Identity, type RayHit } from './math'
import { IDENTITY_POSE, computeBasePose, matchDomPose } from './surfaceDom'
import { FRAME_UNIFORM_BYTES, resolveFrameContext, type CachedPipelines, type GpuRenderer } from './webgpu'

function asGpu<T>(partial: Partial<T>): T {
  // SAFETY: test double implements only the WebGPU members exercised by createManifestMaterial.
  return partial as T
}

function makeFakeRenderer() {
  const writes: { readonly bytes: number[] }[] = []
  const pipelineLayouts: { readonly count: number }[] = []
  const pipelineCache = new Map<string, Promise<CachedPipelines>>()
  const layoutEntriesLog: GPUBindGroupLayoutEntry[][] = []
  const bindGroupEntriesLog: GPUBindGroupEntry[][] = []
  const samplerOptsLog: GPUSamplerDescriptor[] = []
  const disposeHooks: (() => void)[] = []
  let pipelineBuildCalls = 0
  const dummyLayout = asGpu<GPUBindGroupLayout>({ label: '' })
  const dummyBg = asGpu<GPUBindGroup>({ label: '' })
  const dummyView = asGpu<GPUTextureView>({ label: 'static-view' })
  const dummyTex = asGpu<GPUTexture>({ createView: () => dummyView, destroy: vi.fn() })
  const dummySampler = asGpu<GPUSampler>({ label: 'static-sampler' })
  const device = asGpu<GPUDevice>({
    createBuffer: ({ size }: GPUBufferDescriptor) => asGpu<GPUBuffer>({ size, destroy: vi.fn() }),
    createShaderModule: () => asGpu<GPUShaderModule>({}),
    createBindGroupLayout: ({ entries }: GPUBindGroupLayoutDescriptor) => {
      layoutEntriesLog.push([...entries])
      return dummyLayout
    },
    createTexture: () => dummyTex,
    createSampler: (desc: GPUSamplerDescriptor = {}) => {
      samplerOptsLog.push(desc)
      return dummySampler
    },
    createPipelineLayout: ({ bindGroupLayouts }: GPUPipelineLayoutDescriptor) => {
      pipelineLayouts.push({ count: [...bindGroupLayouts].length })
      return asGpu<GPUPipelineLayout>({})
    },
    createBindGroup: ({ entries }: GPUBindGroupDescriptor) => {
      bindGroupEntriesLog.push([...entries])
      return dummyBg
    },
    createRenderPipelineAsync: () => {
      pipelineBuildCalls++
      return Promise.resolve(asGpu<GPURenderPipeline>({}))
    },
    queue: asGpu<GPUQueue>({
      writeBuffer: (_buf, _off, data) => {
        if (data instanceof ArrayBuffer) writes.push({ bytes: [...new Uint8Array(data)] })
      },
      writeTexture: vi.fn(),
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
    onDispose(fn) {
      disposeHooks.push(fn)
    },
    resize: vi.fn(),
    generateMipmaps: vi.fn(),
    render: () => 0,
    simulateDeviceLoss: vi.fn(),
    dispose: () => {
      while (disposeHooks.length > 0) disposeHooks.pop()?.()
    },
  }
  return {
    renderer,
    writes,
    pipelineLayouts,
    layoutEntriesLog,
    bindGroupEntriesLog,
    samplerOptsLog,
    getPipelineBuildCalls: () => pipelineBuildCalls,
  }
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

  it('provides non-null basePose and wakes demand hosts via requestGpuFrame', () => {
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
    expect(computeBasePose('match-dom', null, viewport, [200, 100])).toEqual(IDENTITY_POSE)
    expect(computeBasePose('manual', asGpu<DOMRect>({ left: 100, top: 100, width: 200, height: 100 }), viewport, [200, 100])).toEqual(IDENTITY_POSE)
    expect(computeBasePose('match-dom', asGpu<DOMRect>({ left: 340, top: 370, width: 200, height: 100 }), viewport, [200, 100])).toEqual(IDENTITY_POSE)

    const hostId = 'test-request-gpu-frame'
    const host = getOrCreateGpuHost(hostId)
    const invalidateSpy = vi.fn()
    hostInternals.get(host)?.setScheduler(invalidateSpy, vi.fn())
    requestGpuFrame(hostId)
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })

  it('uses 256B FrameUniforms with offset key coordinates, uvRect, and lazy static textures', async () => {
    expect(FRAME_UNIFORM_BYTES).toBe(256)

    const frameCtx = resolveFrameContext(
      { left: 40, top: 120, width: 800, height: 600, cameraZ: 780, dpr: 2 },
      { key: { x: 440, y: 420, z: 300, brightness: 1 } },
      500,
      16,
    )
    expect([...frameCtx.tail.slice(4, 8)]).toEqual([0, 0, 300, 1])
    expect([...frameCtx.tail.slice(16, 20)]).toEqual([0, 0, 1, 1])

    const [ltc1, ltc2] = await Promise.all([loadLtcTable(1), loadLtcTable(2)])
    expect(ltc1).toMatchObject({ width: 64, height: 64, format: 'rgba16float', bytesPerRow: 512 })
    expect(ltc2).toMatchObject({ width: 64, height: 64, format: 'rgba16float', bytesPerRow: 512 })
    expect(ltc1.data).toBeInstanceOf(Uint16Array)
    expect(ltc2.data).toBeInstanceOf(Uint16Array)
    expect(ltc1.data.length).toBe(64 * 64 * 4)
    expect(ltc2.data.length).toBe(64 * 64 * 4)
    expect(ltc1.data.some((v) => v !== 0)).toBe(true)
    expect(ltc2.data[3]).toBe(0x3c00)

    const { renderer, layoutEntriesLog, bindGroupEntriesLog, pipelineLayouts, samplerOptsLog } = makeFakeRenderer()
    const matA = createManifestMaterial(renderer, {
      ...unlitSurfaceManifest,
      version: 2,
      name: 'ltc-test',
      staticTextures: [
        { name: 'ltc1', cacheKey: 'munari:ltc-1', samplerBinding: 1, textureBinding: 2, filter: 'linear', load: () => loadLtcTable(1) },
        { name: 'ltc2', cacheKey: 'munari:ltc-2', textureBinding: 3, load: () => loadLtcTable(2) },
      ],
    })
    const matB = createManifestMaterial(renderer, {
      ...unlitSurfaceManifest,
      version: 2,
      name: 'ltc-test-nearest',
      staticTextures: [
        { name: 'ltc1', cacheKey: 'munari:ltc-1', samplerBinding: 1, textureBinding: 2, filter: 'nearest', load: () => loadLtcTable(1) },
      ],
    })
    await Promise.all([matA.ready, matB.ready])
    expect(pipelineLayouts[0]?.count).toBe(2)
    expect(layoutEntriesLog[0]?.map((e) => e.binding)).toEqual([1, 2, 3])
    expect(bindGroupEntriesLog[0]?.map((e) => e.binding)).toEqual([1, 2, 3])
    expect(samplerOptsLog.map((s) => s.magFilter)).toContain('nearest')
    renderer.dispose()
  })
})
