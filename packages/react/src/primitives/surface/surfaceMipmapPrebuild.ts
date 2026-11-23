// Mipmap prebuild — three's mipmap pass, built while the renderer starts.
//
// The law: the renderer is not handed to the Canvas until three's mipmap
// pipeline exists for both texture formats a Surface uploads. three 0.186
// builds that pipeline (`WebGPUTexturePassUtils.getTransferPipeline`) once per
// format for the renderer's life, at the first mipmapped upload, and only with
// the blocking `createRenderPipeline`. Any Surface can need it: a FrameSurface
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
// view, surfaceLitTexture.ts). The build still blocks the GPU process when no
// cache holds it, now during load. It waits for the device to finish that
// work, so nothing queued later waits behind it.
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

export async function prebuildMipmapPasses(renderer: WebGPURenderer): Promise<void> {
  const { backend } = renderer
  if (!('device' in backend) || !(backend.device instanceof GPUDevice)) return
  const textures = [mipmappedTexture(THREE.SRGBColorSpace), mipmappedTexture(THREE.NoColorSpace)]
  try {
    for (const texture of textures) renderer.initTexture(texture)
    await backend.device.queue.onSubmittedWorkDone()
  } finally {
    for (const texture of textures) texture.dispose()
  }
}
