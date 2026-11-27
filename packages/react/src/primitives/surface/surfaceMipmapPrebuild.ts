// Mipmap prebuild — three's mipmap pass, built while the renderer starts.
//
// The law: the renderer is not handed to the Canvas until three's mipmap
// pipeline exists for both texture formats a Surface uploads. three 0.186
// builds that pipeline (`WebGPUTexturePassUtils.getTransferPipeline`) once per
// format for the renderer's life, at the first mipmapped upload, and only with
// the blocking `createRenderPipeline`. So each pass is built first with
// `createRenderPipelineAsync`, from the descriptor three would use, and three's
// own blocking build of that descriptor then finds it built (surfaceCompile.ts
// measures that rebuild at 0.2-1 ms). Any Surface can need it: a FrameSurface
// texture always has mipmaps, and a DOM Surface has them when its resolution
// is pinned or at a tier of 0.5 or below (surfaceSourceRuntime.ts).
//
// The fault, 2026-11-22 (instruments/genie-first-flight): Genie's first flight
// built the pass mid-flight, 85-114 ms of Metal compile on the GPU process's
// main thread, with every frame frozen behind it. An asynchronous compile
// queued behind that build waited for it too.
//
// Two formats: `rgba8unorm-srgb` for SRGBColorSpace (DOM Surfaces and
// FrameSurface) and `rgba8unorm` for NoColorSpace (the lit material's raw
// view, surfaceLitTexture.ts). The descriptor is read by letting three ask for
// the pipeline once and refusing the call: three caches a pass only after
// the call returns, so a refused upload leaves nothing behind but a texture
// this module disposes. The fault before this, 2026-11-26 on m2 (Chrome 159):
// the prebuild itself blocked the GPU process, 18 blocking builds in Bench's
// cold load included it (instruments/loading-matrix).
//
// Ownership: SurfaceCanvas calls this once per renderer. The WebGL 2 fallback
// has no such pass, and gets nothing.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

// The smallest texture with more than one mip level that a 2D canvas fills.
const PREBUILD_SIZE = 4

function mipmappedTexture(colorSpace: THREE.ColorSpace): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = PREBUILD_SIZE
  canvas.height = PREBUILD_SIZE
  canvas.getContext('2d')?.fillRect(0, 0, PREBUILD_SIZE, PREBUILD_SIZE)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = colorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  return texture
}

class PassDescriptorRead extends Error {
  constructor(readonly descriptor: GPURenderPipelineDescriptor) {
    super('mipmap pass descriptor read')
  }
}

/** A copy of what three hands the device: it resets its own descriptor after each call. */
function copyDescriptor(descriptor: GPURenderPipelineDescriptor): GPURenderPipelineDescriptor {
  const { vertex, fragment, label, layout, primitive, multisample, depthStencil } = descriptor
  const copy: GPURenderPipelineDescriptor = { label, layout, vertex: { ...vertex } }
  if (fragment) copy.fragment = { ...fragment, targets: [...fragment.targets].map((target) => (target ? { ...target } : target)) }
  if (primitive) copy.primitive = { ...primitive }
  if (multisample) copy.multisample = { ...multisample }
  if (depthStencil) copy.depthStencil = { ...depthStencil }
  return copy
}

/** The descriptor three builds a format's mipmap pass from, without building it. */
function readPassDescriptor(renderer: WebGPURenderer, device: GPUDevice, colorSpace: THREE.ColorSpace): GPURenderPipelineDescriptor | null {
  const texture = mipmappedTexture(colorSpace)
  const createRenderPipeline = Object.getOwnPropertyDescriptor(device, 'createRenderPipeline')
  device.createRenderPipeline = (descriptor) => {
    throw new PassDescriptorRead(copyDescriptor(descriptor))
  }
  try {
    renderer.initTexture(texture)
    return null
  } catch (error) {
    if (error instanceof PassDescriptorRead) return error.descriptor
    throw error
  } finally {
    if (createRenderPipeline) Object.defineProperty(device, 'createRenderPipeline', createRenderPipeline)
    else Reflect.deleteProperty(device, 'createRenderPipeline')
    texture.dispose()
  }
}

export async function prebuildMipmapPasses(renderer: WebGPURenderer): Promise<void> {
  const { backend } = renderer
  if (!('device' in backend) || !(backend.device instanceof GPUDevice)) return
  const device = backend.device
  const colorSpaces = [THREE.SRGBColorSpace, THREE.NoColorSpace]
  const descriptors = colorSpaces.map((colorSpace) => readPassDescriptor(renderer, device, colorSpace))
  await Promise.allSettled(descriptors.map((descriptor) => (descriptor ? device.createRenderPipelineAsync(descriptor) : null)))
  const textures = colorSpaces.map(mipmappedTexture)
  try {
    for (const texture of textures) renderer.initTexture(texture)
    await device.queue.onSubmittedWorkDone()
  } finally {
    for (const texture of textures) texture.dispose()
  }
}
