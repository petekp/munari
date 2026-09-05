// @vitest-environment happy-dom
// Source runtime lifecycle — one texture, one adopted node, and a hard stop.
//
// A continuous paint loop that survives dispose leaks both work and its DOM
// tree. A texture replaced during resize gives every material a stale map.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createSurfaceSourceRuntime } from './surfaceSourceRuntime'

interface TrialCanvas extends HTMLCanvasElement {
  requestPaint: () => void
  onpaint: (() => void) | null
  layoutSubtree: boolean
}

let requests = 0
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  requests = 0
  class Context2D {
    drawElementImage() {}
  }
  vi.stubGlobal('CanvasRenderingContext2D', Context2D)
  // SAFETY: the next three assignments install exactly these trial members
  // on happy-dom's canvas prototype before any source is created.
  const prototype = HTMLCanvasElement.prototype as TrialCanvas
  prototype.requestPaint = () => {
    requests += 1
  }
  prototype.onpaint = null
  prototype.layoutSubtree = false
  originalGetContext = HTMLCanvasElement.prototype.getContext
  const context = {
    setTransform() {},
    clearRect() {},
    drawElementImage() {},
  }
  // SAFETY: the runtime asks only for a 2D context and only calls the three
  // methods above. Other context IDs return null, as a browser may.
  HTMLCanvasElement.prototype.getContext = ((id: string) =>
    id === '2d' ? context : null) as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('a source runtime', () => {
  it('keeps one texture through resize and stops paint-always on teardown', () => {
    const adopted = document.createElement('section')
    const runtime = createSurfaceSourceRuntime({
      label: 'always',
      content: adopted,
      size: [200, 100],
      resolution: 1,
      mirrorU: false,
      paint: 'always',
      pixelRatio: 1,
      onError: (error) => {
        throw error
      },
    })
    const texture = runtime.texture()
    expect(texture).not.toBeNull()
    expect(adopted.parentElement?.tagName).toBe('CANVAS')
    runtime.setSize([420, 210])
    runtime.frame()
    expect(runtime.texture()).toBe(texture)
    const beforeDispose = requests
    runtime.dispose()
    expect(adopted.parentElement).toBeNull()
    expect(runtime.texture()).toBeNull()
    expect(runtime.frame()).toBe(false)
    expect(requests).toBe(beforeDispose)
  })
})

describe('the mirrorU signal', () => {
  it('fires on a flip and not on a no-op, and stops on unsubscribe', () => {
    const adopted = document.createElement('section')
    const runtime = createSurfaceSourceRuntime({
      label: 'mirror',
      content: adopted,
      size: [200, 100],
      resolution: 1,
      mirrorU: false,
      paint: 'auto',
      pixelRatio: 1,
      onError: (error) => {
        throw error
      },
    })
    const texture = runtime.texture()
    expect(texture).not.toBeNull()
    expect(texture!.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(texture!.repeat.x).toBe(1)

    const seen: boolean[] = []
    const unsubscribe = runtime.subscribeMirrorU((mirrorU) => {
      seen.push(mirrorU)
    })

    // A flip applies the mirror to the texture AND notifies the listener.
    runtime.setMirrorU(true)
    expect(seen).toEqual([true])
    expect(texture!.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture!.repeat.x).toBe(-1)

    // A second call with the same value is a no-op: the runtime's guard
    // short-circuits and no listener fires.
    runtime.setMirrorU(true)
    expect(seen).toEqual([true])

    runtime.setMirrorU(false)
    expect(seen).toEqual([true, false])
    expect(texture!.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(texture!.repeat.x).toBe(1)

    // After unsubscribe, a flip no longer reaches this listener.
    unsubscribe()
    runtime.setMirrorU(true)
    expect(seen).toEqual([true, false])

    runtime.dispose()
  })

  it('fires no mirror listener when the runtime is created or disposed', () => {
    const adopted = document.createElement('section')
    const runtime = createSurfaceSourceRuntime({
      label: 'mirror-quiet',
      content: adopted,
      size: [200, 100],
      resolution: 1,
      mirrorU: false,
      paint: 'auto',
      pixelRatio: 1,
      onError: (error) => {
        throw error
      },
    })
    let fires = 0
    runtime.subscribeMirrorU(() => {
      fires += 1
    })
    expect(fires).toBe(0)
    // dispose neither flips mirror nor fires the listener.
    runtime.setMirrorU(true)
    expect(fires).toBe(1)
    runtime.dispose()
    expect(fires).toBe(1)
  })
})
