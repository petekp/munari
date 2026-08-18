// @vitest-environment happy-dom
// Surface material policy — texture identity and premultiplied blending.
//
// These properties fail as dark fringes or one blank resize, not as thrown
// errors. The tests pin the live Three objects rather than restating props.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { configureSurfaceMaterial } from './surfaceMaterials'
import { createDomSurfaceTexture } from './surfaceSourceRuntime'

describe('a DOM Surface texture', () => {
  it('is born sRGB, premultiplied, mirrored on request, and keeps its identity', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 100
    const texture = createDomSurfaceTexture(canvas, 1, false, true)
    const uuid = texture.uuid
    canvas.width = 420
    canvas.height = 210
    texture.needsUpdate = true
    expect(texture.uuid).toBe(uuid)
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.premultiplyAlpha).toBe(true)
    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.repeat.x).toBe(-1)
  })
})

describe('custom material configuration', () => {
  it('configures one material once and leaves its other policy untouched', () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    const version = material.version
    configureSurfaceMaterial(material)
    expect(material.premultipliedAlpha).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.version).toBeGreaterThan(version)
    const configuredVersion = material.version
    configureSurfaceMaterial(material)
    expect(material.version).toBe(configuredVersion)
  })

  it('configures every material in an authored material array', () => {
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshStandardMaterial()]
    configureSurfaceMaterial(materials)
    expect(materials.every((material) => material.premultipliedAlpha)).toBe(true)
  })
})
