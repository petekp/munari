// @vitest-environment happy-dom
// Surface material policy — texture identity and premultiplied blending.
//
// These properties fail as dark fringes or one blank resize, not as thrown
// errors. The tests pin the live Three objects rather than restating props.

import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { configureSurfaceMaterial, useSurfaceUniforms, type SurfaceUniforms } from './surfaceMaterials'
import { createDomSurfaceTexture } from './surfaceSourceRuntime'
import {
  DEFAULT_PART,
  SurfaceMaterialContext,
  SurfacePartContext,
  type SurfaceMaterialValue,
  type SurfacePartValue,
} from './surfaceContext'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

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

// The contract is reference identity: the hook must hand back the
// PRESENTER's radii/size uniform objects, not copies — a private copy
// compiles fine and then never tracks a chrome change. And the returned
// object must keep ITS identity across renders, because it is what a
// mounted shaderMaterial holds.
describe('useSurfaceUniforms', () => {
  function harness(texture: () => THREE.CanvasTexture) {
    const slot: SurfaceMaterialValue = {
      radii: { value: new THREE.Vector4(4, 4, 4, 4) },
      size: { value: new THREE.Vector2(200, 100) },
      transparent: true,
    }
    const stub: Pick<SurfaceSourceRuntime, 'texture'> = { texture }
    // SAFETY: the hook reaches only `runtime.texture()`; the rest of the
    // runtime never runs in this test, so a stub carrying that one method
    // stands in for the full interface.
    const runtime = stub as SurfaceSourceRuntime
    const part: SurfacePartValue = {
      id: DEFAULT_PART,
      runtime,
      size: [200, 100],
      captureRoot: null,
      pageRoot: null,
      setPageRoot: () => {},
      setMeasuredSize: () => {},
    }
    const seen: SurfaceUniforms[] = []
    function Probe(): ReactNode {
      seen.push(useSurfaceUniforms())
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = () =>
      flushSync(() =>
        root.render(
          createElement(
            SurfacePartContext,
            { value: part },
            createElement(SurfaceMaterialContext, { value: slot }, createElement(Probe)),
          ),
        ),
      )
    return { slot, seen, render, unmount: () => flushSync(() => root.unmount()) }
  }

  it('wires the presenter’s own uniform objects and keeps its identity', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 100
    const first = createDomSurfaceTexture(canvas, 1, false, true)
    let texture = first
    const { slot, seen, render, unmount } = harness(() => texture)

    render()
    const [wired] = seen
    if (!wired) throw new Error('the probe never rendered')
    expect(wired.uMunariRadii).toBe(slot.radii)
    expect(wired.uMunariSize).toBe(slot.size)
    expect(wired.tMap.value).toBe(first)

    // A texture swap lands as a value write into the SAME object — the
    // one the mounted program is holding.
    const replacement = createDomSurfaceTexture(canvas, 1, false, true)
    texture = replacement
    render()
    expect(seen[1]).toBe(wired)
    expect(wired.tMap.value).toBe(replacement)
    unmount()
  })
})
