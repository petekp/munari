import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createDomSurfaceTexture } from './Surface'

describe('DOM Surface texture', () => {
  it('sets the pixel format before renderer exposure', () => {
    const canvas = { width: 8, height: 8 } as HTMLCanvasElement
    const texture = createDomSurfaceTexture(canvas, 2, true, false)

    expect(texture).toBeInstanceOf(THREE.CanvasTexture)
    expect(texture.image).toBe(canvas)
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.premultiplyAlpha).toBe(true)
    expect(texture.generateMipmaps).toBe(true)
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    expect(texture.anisotropy).toBe(8)

    texture.dispose()
  })
})
