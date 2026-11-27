// Lazy static-texture upload and `@group(1)` layout builder for Manifest v2
// materials, imported dynamically so pages without static LUTs ship zero bytes.
//
// The law: static textures cache per GPUDevice keyed by `cacheKey|filter|addressMode`,
// and cleanup hooks onto `renderer.onDispose` so device loss frees GPU textures cleanly.
//
// Ownership: `@petepetrash/munari/gpu`.

import type { ManifestStaticTexture } from './manifest'
import type { GpuRenderer, StaticTextureResource } from './webgpu'

const GPU_SHADER_STAGE_VF = 0x3
const GPU_TEXTURE_USAGE_STATIC = 0x0004 | 0x0002

interface DeviceStaticCache {
  readonly layouts: Map<string, GPUBindGroupLayout>
  readonly textures: Map<string, Promise<StaticTextureResource>>
  readonly owned: GPUTexture[]
}

const deviceCaches = new WeakMap<GPUDevice, DeviceStaticCache>()

function getDeviceCache(renderer: GpuRenderer): DeviceStaticCache {
  let cache = deviceCaches.get(renderer.device)
  if (!cache) {
    cache = { layouts: new Map(), textures: new Map(), owned: [] }
    const target = cache
    renderer.onDispose(() => {
      for (const tex of target.owned) tex.destroy()
      target.owned.length = 0
      target.textures.clear()
      target.layouts.clear()
      deviceCaches.delete(renderer.device)
    })
    deviceCaches.set(renderer.device, cache)
  }
  return cache
}

function getOrCreateLayout(
  renderer: GpuRenderer,
  cache: DeviceStaticCache,
  customBuffer: GPUBuffer | null,
  specs: readonly ManifestStaticTexture[],
): GPUBindGroupLayout {
  const layoutKey = `${Boolean(customBuffer)}|${specs.map((s) => `${s.textureBinding}:${s.samplerBinding ?? ''}`).join(',')}`
  let layout = cache.layouts.get(layoutKey)
  if (!layout) {
    const entries: GPUBindGroupLayoutEntry[] = []
    if (customBuffer) {
      entries.push({ binding: 0, visibility: GPU_SHADER_STAGE_VF, buffer: { type: 'uniform', hasDynamicOffset: false } })
    }
    for (const st of specs) {
      if (st.samplerBinding !== undefined) {
        entries.push({ binding: st.samplerBinding, visibility: GPU_SHADER_STAGE_VF, sampler: { type: 'filtering' } })
      }
      entries.push({
        binding: st.textureBinding,
        visibility: GPU_SHADER_STAGE_VF,
        texture: { sampleType: 'float', viewDimension: '2d' },
      })
    }
    layout = renderer.device.createBindGroupLayout({ entries })
    cache.layouts.set(layoutKey, layout)
  }
  return layout
}

function getOrCreateStaticTex(
  renderer: GpuRenderer,
  cache: DeviceStaticCache,
  spec: ManifestStaticTexture,
): Promise<StaticTextureResource> {
  const filter = spec.filter ?? 'linear'
  const addressMode = spec.addressMode ?? 'clamp-to-edge'
  const fullKey = `${spec.cacheKey}|${filter}|${addressMode}`
  let entry = cache.textures.get(fullKey)
  if (!entry) {
    entry = Promise.resolve()
      .then(spec.load)
      .then((payload) => {
        const texture = renderer.device.createTexture({
          size: [payload.width, payload.height],
          format: payload.format,
          usage: GPU_TEXTURE_USAGE_STATIC,
        })
        renderer.device.queue.writeTexture(
          { texture },
          payload.data,
          { bytesPerRow: payload.bytesPerRow, rowsPerImage: payload.height },
          [payload.width, payload.height],
        )
        cache.owned.push(texture)
        const sampler = renderer.device.createSampler({
          magFilter: filter,
          minFilter: filter,
          addressModeU: addressMode,
          addressModeV: addressMode,
        })
        return { texture, view: texture.createView(), sampler }
      })
      .catch((err) => {
        cache.textures.delete(fullKey)
        throw err
      })
    cache.textures.set(fullKey, entry)
  }
  return entry
}

/** Lazily uploads static textures and constructs `@group(1)` layout + bind group for a manifest. */
export async function resolveStaticGroup1(
  renderer: GpuRenderer,
  customBuffer: GPUBuffer | null,
  specs: readonly ManifestStaticTexture[],
): Promise<{ readonly layout: GPUBindGroupLayout; readonly bindGroup: GPUBindGroup }> {
  const cache = getDeviceCache(renderer)
  const layout = getOrCreateLayout(renderer, cache, customBuffer, specs)
  const resources = await Promise.all(specs.map((spec) => getOrCreateStaticTex(renderer, cache, spec)))
  const entries: GPUBindGroupEntry[] = []
  if (customBuffer) entries.push({ binding: 0, resource: { buffer: customBuffer } })
  for (let i = 0; i < specs.length; i++) {
    const st = specs[i]!
    const res = resources[i]!
    if (st.samplerBinding !== undefined) {
      entries.push({ binding: st.samplerBinding, resource: res.sampler })
    }
    entries.push({ binding: st.textureBinding, resource: res.view })
  }
  return { layout, bindGroup: renderer.device.createBindGroup({ layout, entries }) }
}
