// Verifies MaterialManifest contract: explicit @group(0)/@group(1)/@group(2) pipeline layouts,
// shared host pipeline cache reuse, per-instance uniform isolation, offset pose mapping, and rounded-corner masking.
import { describe, expect, it, vi } from 'vitest'
import { resolveFinish } from '../primitives/surface/surfaceFinish'
import { clampBackdropCrop } from './backdropBlur'
import { createGpuFinishMaterial, packFinishUniforms, selectFinishManifestKind } from './finishLookup'
import { createManifestDriver, createManifestMaterial, unlitSurfaceManifest, type MaterialManifest } from './manifest'
import { getOrCreateGpuHost, hitPassesSurfaceMask, hostInternals, requestGpuFrame, type RegisteredSurface, type ViewportState } from './host'
import { loadLtcTable } from './ltc'
import { mat4Identity, type RayHit } from './math'
import { IDENTITY_POSE, computeBasePose, computeBleedUvRect, matchDomPose, resolveBleed } from './surfaceDom'
import { computeShadowProjection } from './surfaceShadow'
import { FRAME_UNIFORM_BYTES, createPlaneGeometry, resolveFrameContext, type CachedPipelines, type GpuRenderer } from './webgpu'

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
    prepareBackdropBlur: vi.fn(() => Promise.resolve()),
    lastGpuPassMs: () => null,
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

  it('computes exact 15-deg unit rimDir and gates prepareBackdropBlur on needsBackdrop', async () => {
    const frameCtx = resolveFrameContext(
      { left: 0, top: 0, width: 1000, height: 600, cameraZ: 800, dpr: 2 },
      'studio',
      0,
      16,
    )
    const rimRad = (15 * Math.PI) / 180
    const across = Math.cos(rimRad) * Math.SQRT1_2
    expect(frameCtx.tail[12]).toBeCloseTo(-across, 5)
    expect(frameCtx.tail[11]).toBe(1)
    expect(frameCtx.tail[12]).toBeCloseTo(-across, 5)
    expect(frameCtx.tail[13]).toBeCloseTo(across, 5)
    expect(frameCtx.tail[14]).toBeCloseTo(Math.sin(rimRad), 5)
    expect(frameCtx.tail[15]).toBe(0)

    const { renderer } = makeFakeRenderer()
    const opaqueMat = createManifestMaterial(renderer, { ...unlitSurfaceManifest, name: 'no-blur', needsBackdrop: false })
    await opaqueMat.ready
    expect(renderer.prepareBackdropBlur).toHaveBeenCalledTimes(0)

    const glassMat = createManifestMaterial(renderer, { ...unlitSurfaceManifest, name: 'needs-blur', needsBackdrop: true })
    await glassMat.ready
    expect(renderer.prepareBackdropBlur).toHaveBeenCalledTimes(1)
    renderer.dispose()
  })

  it('selects finish manifest variants, packs linear sRGB uniforms, dirty-checks writes, and swaps variants safely', async () => {
    const opaqueFinish = { color: '#800000', roughness: 0.3 }
    const layeredFinish = {
      ...opaqueFinish,
      film: { amount: 0.5, ior: 1.4, thickness: 380, variation: 0.3, scale: 120 },
    }
    const glassFinish = { ...opaqueFinish, transmission: { amount: 1, thickness: 12, dispersion: 0 } }

    expect(selectFinishManifestKind(resolveFinish(opaqueFinish))).toBe('opaque')
    expect(selectFinishManifestKind(resolveFinish(layeredFinish))).toBe('layered')
    expect(selectFinishManifestKind(resolveFinish(glassFinish))).toBe('transmissive')

    const packed = packFinishUniforms(resolveFinish(opaqueFinish))
    expect(packed.bodyColor[0]).toBeCloseTo(((128 / 255 + 0.055) / 1.055) ** 2.4, 5)
    expect(packed.bodyColor[1]).toBe(0)
    expect(packed.bodyColor[3]).toBe(1)

    const packedInvalidHex = packFinishUniforms(resolveFinish({ color: '#ff00zz', roughness: 0.3 }))
    expect(packedInvalidHex.bodyColor).toEqual([1, 1, 1, 1])
    const packedAlphaHex = packFinishUniforms(resolveFinish({ color: '#800000ff', roughness: 0.3 }))
    expect(packedAlphaHex.bodyColor[0]).toBeCloseTo(packed.bodyColor[0], 5)
    expect(packedAlphaHex.bodyColor[1]).toBe(0)

    const { renderer, writes } = makeFakeRenderer()
    let variantSwaps = 0
    let resolveSwap!: () => void
    const swapDone = new Promise<void>((r) => {
      resolveSwap = r
    })
    const handle = createGpuFinishMaterial(renderer, opaqueFinish, () => {
      variantSwaps++
      if (variantSwaps >= 2) resolveSwap()
    })
    await handle.ready
    expect(handle.isReady()).toBe(true)
    expect(handle.needsBackdrop).toBe(false)
    expect(handle.pipelineFor(true)).not.toBeNull()

    const countAfterReady = writes.length
    handle.updateFinish({ color: '#800000', roughness: 0.3 })
    expect(writes.length).toBe(countAfterReady)

    handle.updateFinish({ color: '#800000', roughness: 0.45 })
    expect(writes.length).toBeGreaterThan(countAfterReady)

    // Switch A -> B -> A while B is still loading: returning to A cancels B so B never replaces A.
    const countBeforeRace = writes.length
    handle.updateFinish(glassFinish)
    handle.updateFinish({ color: '#800000', roughness: 0.6 })
    await new Promise((r) => setTimeout(r, 0))
    expect(variantSwaps).toBe(1)
    expect(handle.needsBackdrop).toBe(false)
    expect(writes.length).toBeGreaterThan(countBeforeRace)

    const prevPipe = handle.pipelineFor(true)
    handle.updateFinish(glassFinish)
    expect(handle.pipelineFor(true)).toBe(prevPipe)
    await swapDone
    expect(handle.needsBackdrop).toBe(true)
    expect(renderer.prepareBackdropBlur).toHaveBeenCalledTimes(2)
    handle.dispose()
    expect(handle.isReady()).toBe(false)
    renderer.dispose()
  })

  it('expands plane geometry & uvRect for bleed, rejects bleed pointer hits, projects shadow, and clamps backdrop crop', () => {
    const { renderer } = makeFakeRenderer()
    const bleed = resolveBleed(20)
    expect(bleed).toEqual([20, 20])
    const uvRect = computeBleedUvRect([200, 100], bleed)
    expect(uvRect).toEqual([0.1, 0.2, 1.2, 1.4])

    const geo = createPlaneGeometry(renderer.device, 200, 100, 1, 1, bleed[0], bleed[1])
    // Top-left corner extends 20px outward and sits at UV (-0.1, +1.2).
    expect(geo.positions[0]).toBe(-120)
    expect(geo.positions[1]).toBe(70)
    expect(geo.uvs[0]).toBeCloseTo(-0.1, 5)
    expect(geo.uvs[1]).toBeCloseTo(1.2, 5)
    geo.dispose()

    const regSurface: RegisteredSurface = {
      id: 'bleed-surface',
      pointerEvents: () => 'geometry',
      hears: () => true,
      element: () => null,
      size: () => [200, 100],
      radii: () => [0, 0, 0, 0],
      geometry: () => null,
      worldMat: mat4Identity,
      invWorldMat: mat4Identity,
      onRendererLost() {},
      tick: () => null,
    }
    const bleedHit: RayHit = { distance: 10, point: [-110, 0, 0], u: -0.05, v: 0.5 }
    const cardHit: RayHit = { distance: 10, point: [0, 0, 0], u: 0.5, v: 0.5 }
    expect(hitPassesSurfaceMask(regSurface, bleedHit)).toBe(false)
    expect(hitPassesSurfaceMask(regSurface, cardHit)).toBe(true)

    const proj = computeShadowProjection(
      [200, 100],
      { x: 100, y: 50, z: 32, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      [0, 0, 480],
      { blur: 14, spread: 0, elevationScale: 0.4 },
    )
    const scale = 1 + (32 - -0.5) / (480 - 32)
    expect(proj.sigma).toBeCloseTo(14 + 32 * 0.4, 4)
    expect(proj.cardHalf[0]).toBeCloseTo(100 * scale, 4)
    expect(proj.quadHalf[0]).toBeGreaterThan(proj.cardHalf[0] + proj.sigma * 2)

    const projLeft = computeShadowProjection(
      [200, 100],
      { x: 0, y: 0, z: 32, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      [-200, 0, 480],
      { blur: 14, spread: 0, elevationScale: 0.4 },
    )
    const projRight = computeShadowProjection(
      [200, 100],
      { x: 0, y: 0, z: 32, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      [200, 0, 480],
      { blur: 14, spread: 0, elevationScale: 0.4 },
    )
    const cxLeft = (projLeft.verts[0] + projLeft.verts[2]) * 0.5
    const cxRight = (projRight.verts[0] + projRight.verts[2]) * 0.5
    expect(projLeft.visible).toBe(true)
    expect(cxLeft).toBeGreaterThan(0)
    expect(cxRight).toBeLessThan(0)

    const belowGround = computeShadowProjection(
      [200, 100],
      { x: 0, y: 0, z: -12, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      [0, 0, 480],
      { blur: 14, spread: 0, elevationScale: 0.4 },
    )
    expect(belowGround.visible).toBe(false)

    expect(clampBackdropCrop({ x: -12.2, y: 15.6, w: 3000, h: 0.2 }, 1920, 1080)).toEqual({
      x: 0,
      y: 15,
      w: 1920,
      h: 1,
    })
    expect(clampBackdropCrop({ x: 10.6, y: 20.6, w: 40, h: 30 }, 1920, 1080)).toEqual({
      x: 10,
      y: 20,
      w: 41,
      h: 31,
    })
    renderer.dispose()
  })
})
