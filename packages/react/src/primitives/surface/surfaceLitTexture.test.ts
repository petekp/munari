// @vitest-environment happy-dom
// Lit view ownership — shared canvas, independent upload state, and no idle GPU hold.

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { getSurfaceLitTexture } from './surfaceLitTexture'

function sourceTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 100
  const source = new THREE.CanvasTexture(canvas)
  source.colorSpace = THREE.SRGBColorSpace
  source.premultiplyAlpha = true
  source.generateMipmaps = false
  source.minFilter = THREE.LinearFilter
  return { source, canvas }
}

describe('the shared lit view', () => {
  it('shares one canvas and one view while keeping upload versions independent', () => {
    const { source, canvas } = sourceTexture()
    const version = source.version
    const dataVersion = source.source.version
    const first = getSurfaceLitTexture(source)
    const second = getSurfaceLitTexture(source)
    const releaseFirst = first.acquire()
    const releaseSecond = second.acquire()
    first.sync()
    expect(second).toBe(first)
    expect(first.texture.image).toBe(canvas)
    expect(first.texture.source).not.toBe(source.source)
    expect(first.texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(source.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(source.version).toBe(version)
    expect(source.source.version).toBe(dataVersion)

    const disposed = vi.fn()
    first.texture.addEventListener('dispose', disposed)
    releaseFirst()
    releaseFirst()
    expect(disposed).not.toHaveBeenCalled()
    releaseSecond()
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('uploads each source update once and forwards the actual view upload receipt', () => {
    const { source } = sourceTexture()
    const view = getSurfaceLitTexture(source)
    const release = view.acquire()
    const receipt = vi.fn()
    source.onUpdate = receipt
    view.sync()
    const initialVersion = view.texture.version
    view.sync()
    expect(view.texture.version).toBe(initialVersion)
    expect(receipt).not.toHaveBeenCalled()

    source.needsUpdate = true
    const sourceVersion = source.version
    const dataVersion = source.source.version
    view.sync()
    expect(view.texture.version).toBe(initialVersion + 1)
    expect(source.version).toBe(sourceVersion)
    expect(source.source.version).toBe(dataVersion)
    expect(receipt).not.toHaveBeenCalled()
    view.texture.onUpdate?.(view.texture)
    expect(receipt).toHaveBeenCalledExactlyOnceWith(source)
    release()
  })

  it('reclaims a late resize and mip change before the next draw', () => {
    const { source, canvas } = sourceTexture()
    const view = getSurfaceLitTexture(source)
    const release = view.acquire()
    const disposed = vi.fn()
    view.texture.addEventListener('dispose', disposed)
    view.sync()

    // The runtime disposes before applying its new filter policy. Sampling
    // policy must be read at draw time, not from the dispose notification.
    source.dispose()
    canvas.width = 400
    canvas.height = 300
    source.generateMipmaps = true
    source.minFilter = THREE.LinearMipmapLinearFilter
    source.needsUpdate = true
    view.sync()
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(view.texture.image).toBe(canvas)
    expect(view.texture.generateMipmaps).toBe(true)
    expect(view.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    const version = view.texture.version
    view.sync()
    expect(view.texture.version).toBe(version)

    // An image can also change dimensions after upload was armed, without
    // a matching original disposal having reached this view yet.
    canvas.width = 600
    view.sync()
    expect(disposed).toHaveBeenCalledTimes(2)
    expect(view.texture.version).toBe(version + 1)
    release()
  })

  it('copies sampler and UV policy without writing to the original', () => {
    const { source } = sourceTexture()
    const view = getSurfaceLitTexture(source)
    const release = view.acquire()
    source.wrapS = THREE.RepeatWrapping
    source.repeat.set(-1, 2)
    source.offset.set(0.25, 0.5)
    source.rotation = 0.3
    source.anisotropy = 8
    source.flipY = false
    source.updateMatrix()
    const matrix = source.matrix.clone()
    view.sync()
    expect(view.texture.wrapS).toBe(source.wrapS)
    expect(view.texture.repeat).toEqual(source.repeat)
    expect(view.texture.offset).toEqual(source.offset)
    expect(view.texture.matrix).toEqual(matrix)
    expect(view.texture.anisotropy).toBe(8)
    expect(view.texture.flipY).toBe(false)
    expect(source.matrix).toEqual(matrix)
    source.matrixAutoUpdate = false
    source.matrix.makeScale(2, 3)
    view.sync()
    expect(view.texture.matrix).toEqual(source.matrix)
    release()
  })

  it('reuses a released record through cleanup replay without retaining listeners', () => {
    const { source } = sourceTexture()
    const view = getSurfaceLitTexture(source)
    const add = vi.spyOn(source, 'addEventListener')
    const remove = vi.spyOn(source, 'removeEventListener')
    const disposed = vi.fn()
    view.texture.addEventListener('dispose', disposed)
    const release = view.acquire()
    view.sync()
    const version = view.texture.version
    release()
    release()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(view.texture.onUpdate).toBeNull()
    source.dispose()
    view.sync()
    expect(disposed).toHaveBeenCalledTimes(1)

    const same = getSurfaceLitTexture(source)
    expect(same).toBe(view)
    const leaveAgain = same.acquire()
    same.sync()
    expect(add).toHaveBeenCalledTimes(2)
    expect(view.texture.version).toBe(version + 1)
    source.dispose()
    expect(disposed).toHaveBeenCalledTimes(2)
    leaveAgain()
    expect(remove).toHaveBeenCalledTimes(2)
    expect(disposed).toHaveBeenCalledTimes(3)
  })
})
