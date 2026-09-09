// Lit texture sampling — encoded premultiplied pixels for the lighting shader.
//
// Unpremultiplication must precede sRGB decoding, including filtered samples.
// On 2026-09-07, decoding before filtering produced a white edge of 75/64
// (RGB/alpha) where matching the opaque swatch required 34/64. A raw texture
// view lets the shader divide encoded RGB by alpha before decoding for light.
//
// This view shares the capture canvas, but owns its Three Source and GPU
// storage. Sharing Source would also share Three's uploaded-version ledger
// across the raw and sRGB formats, allowing one view to suppress the other's
// upload. The source runtime retains capture and paint-generation ownership.

import * as THREE from 'three'

export interface SurfaceLitTexture {
  readonly texture: THREE.Texture
  /** Retain this view through a material's committed lifetime. */
  acquire(): () => void
  /** Synchronize immediately before the material draws, after raster sizing. */
  sync(): void
}

interface LitTextureAllocation {
  width: number
  height: number
  mips: boolean
}

// Keeping a zero-owner record preserves identity through Strict Mode replay.
// Its GPU allocation and source listener are released with the last owner.
const views = new WeakMap<THREE.Texture, SurfaceLitTexture>()

function canvasImage(source: THREE.Texture): HTMLCanvasElement {
  const image = source.image
  if (!(image instanceof HTMLCanvasElement)) {
    throw new Error('Surface.LitMaterial requires a DOM capture canvas.')
  }
  return image
}

function syncSampler(source: THREE.Texture, texture: THREE.Texture): boolean {
  const changed =
    texture.wrapS !== source.wrapS || texture.wrapT !== source.wrapT ||
    texture.minFilter !== source.minFilter || texture.magFilter !== source.magFilter ||
    texture.anisotropy !== source.anisotropy || texture.generateMipmaps !== source.generateMipmaps ||
    texture.premultiplyAlpha !== source.premultiplyAlpha || texture.flipY !== source.flipY ||
    texture.unpackAlignment !== source.unpackAlignment || texture.format !== source.format ||
    texture.type !== source.type || texture.normalized !== source.normalized

  texture.mapping = source.mapping
  texture.channel = source.channel
  texture.wrapS = source.wrapS
  texture.wrapT = source.wrapT
  texture.minFilter = source.minFilter
  texture.magFilter = source.magFilter
  texture.anisotropy = source.anisotropy
  texture.generateMipmaps = source.generateMipmaps
  texture.premultiplyAlpha = source.premultiplyAlpha
  texture.flipY = source.flipY
  texture.unpackAlignment = source.unpackAlignment
  texture.format = source.format
  texture.type = source.type
  texture.normalized = source.normalized
  // Derive raw GPU storage from NoColorSpace, never an sRGB override.
  texture.internalFormat = null
  texture.colorSpace = THREE.NoColorSpace
  texture.offset.copy(source.offset)
  texture.repeat.copy(source.repeat)
  texture.center.copy(source.center)
  texture.rotation = source.rotation
  texture.matrixAutoUpdate = source.matrixAutoUpdate
  texture.matrix.copy(source.matrix)
  if (texture.matrixAutoUpdate) texture.updateMatrix()
  return changed
}

export function getSurfaceLitTexture(source: THREE.Texture): SurfaceLitTexture {
  const existing = views.get(source)
  if (existing) return existing

  // Texture.copy/clone would share Source and mark that shared Source dirty.
  const texture = new THREE.Texture(canvasImage(source))
  texture.colorSpace = THREE.NoColorSpace
  let owners = 0
  let sourceVersion = -1
  let allocation: LitTextureAllocation | null = null

  const invalidateStorage = () => {
    texture.dispose()
    allocation = null
    sourceVersion = -1
  }
  const sourceDisposed = () => {
    if (owners > 0) invalidateStorage()
  }
  const uploaded = () => {
    // The actual lit upload carries the same captured generation. The
    // presenter's post-draw receipt must see it even when no sRGB view drew.
    if (owners > 0) source.onUpdate?.(source)
  }

  const view: SurfaceLitTexture = {
    texture,
    acquire() {
      if (owners++ === 0) {
        source.addEventListener('dispose', sourceDisposed)
        texture.onUpdate = uploaded
      }
      let released = false
      return () => {
        if (released) return
        released = true
        if (--owners !== 0) return
        source.removeEventListener('dispose', sourceDisposed)
        texture.onUpdate = null
        invalidateStorage()
      }
    },
    sync() {
      if (owners === 0) return
      const image = canvasImage(source)
      const next = { width: image.width, height: image.height, mips: source.generateMipmaps }
      const imageChanged = texture.image !== image
      const samplerChanged = syncSampler(source, texture)

      texture.image = image

      if (allocation && (allocation.width !== next.width || allocation.height !== next.height || allocation.mips !== next.mips)) {
        invalidateStorage()
      }
      if (!allocation || imageChanged || samplerChanged || sourceVersion !== source.version) {
        allocation = next
        sourceVersion = source.version
        texture.needsUpdate = true
      }
    },
  }
  views.set(source, view)
  return view
}
