// @vitest-environment happy-dom
// Source runtime lifecycle — one texture, one adopted node, and a hard stop.
//
// A continuous paint loop that survives dispose leaks both work and its DOM
// tree. A texture replaced during resize gives every material a stale map.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSurfaceSourceRuntime } from './surfaceSourceRuntime'

interface TrialCanvas extends HTMLCanvasElement {
  requestPaint: () => void
  onpaint: (() => void) | null
  layoutSubtree: boolean
}

function completePaint(canvas: HTMLCanvasElement) {
  // SAFETY: beforeEach installs the trial canvas members used by every source.
  const trial = canvas as TrialCanvas
  trial.onpaint?.()
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
  it('keeps one texture through resize, and stops working on teardown', () => {
    const adopted = document.createElement('section')
    const runtime = createSurfaceSourceRuntime({
      label: 'resize-and-teardown',
      content: adopted,
      size: [200, 100],
      resolution: 1,
      mirrorU: false,
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

it('combines raster demands per axis and restores native capture density when consumers leave',()=>{
 const runtime=createSurfaceSourceRuntime({content:document.createElement('div'),size:[200,100],resolution:'auto',mirrorU:false,pixelRatio:2,onError:error=>{throw error}})
 runtime.proposeRaster(1,[2.4,1.7]);runtime.proposeRaster(2,[2,3])
 expect(runtime.source.rasterScale()).toEqual([2.4,3])
 runtime.proposeRaster(2,null)
 expect(runtime.source.rasterScale()).toEqual([2.4,1.7])
 runtime.proposeRaster(1,null)
 runtime.setPixelRatio(3)
 expect(runtime.source.rasterScale()).toEqual([3,3])
 runtime.dispose()
})
it('keeps an explicit resolution pin when display density changes',()=>{
 const runtime=createSurfaceSourceRuntime({content:document.createElement('div'),size:[200,100],resolution:1,mirrorU:false,pixelRatio:2,onError:error=>{throw error}})
 runtime.proposeRaster(1,[3,2]);runtime.setPixelRatio(3)
 expect(runtime.source.rasterScale()).toEqual([1,1])
 runtime.dispose()
})

describe('storage changes after an upload has been armed', () => {
  it.each(['tier', 'raster', 'size', 'resolution', 'display'] as const)(
    'invalidates %s storage in the same frame without replacing the texture',
    (change) => {
      const runtime = createSurfaceSourceRuntime({content:document.createElement('div'),size:[200,100],resolution:'auto',mirrorU:false,pixelRatio:1,onError:error=>{throw error}})
      completePaint(runtime.source.canvas)
      runtime.frame()
      const texture = runtime.texture()!
      const disposed = vi.fn()
      texture.addEventListener('dispose', disposed)
      const version = texture.version
      if (change === 'tier') runtime.proposeTier(1, 2)
      if (change === 'raster') runtime.proposeRaster(1, [2, 3])
      if (change === 'size') runtime.setSize([500, 300])
      // Same dimensions, different mip allocation.
      if (change === 'resolution') runtime.setResolution(1)
      if (change === 'display') runtime.setPixelRatio(2)
      expect(disposed).toHaveBeenCalledTimes(1)
      expect(runtime.texture()).toBe(texture)
      expect(texture.version).toBeGreaterThan(version)
      texture.onUpdate?.(texture)
      expect(runtime.uploadedGeneration()).toBe(runtime.currentPaint()?.frame.generation)
      runtime.frame()
      expect(disposed).toHaveBeenCalledTimes(1)
      runtime.dispose()
    },
  )

  // A density change re-arms the settle exactly as a resize does, and for the
  // same reason: an engine is allowed to decline to rasterize while the
  // density moves (`PaintReason`), so the settle is the only thing that ever
  // asks it for a sharp one. A Surface that moves only in depth never changes
  // size, so watching the box alone would settle once and never again.
  it('asks for a paint again once a density change goes quiet', () => {
    const runtime = createSurfaceSourceRuntime({content:document.createElement('div'),size:[200,100],resolution:'auto',mirrorU:false,pixelRatio:1,onError:error=>{throw error}})
    completePaint(runtime.source.canvas)
    for (let i=0;i<12;i++) runtime.frame()
    expect(runtime.frame()).toBe(false)

    runtime.proposeTier(1, 2)
    completePaint(runtime.source.canvas)
    const asked = requests
    // Quiet for longer than the settle, with the density held where it
    // landed: the settle fires once and asks for one more paint.
    for (let i=0;i<12;i++) runtime.frame()
    expect(requests).toBeGreaterThan(asked)
    const settled = requests
    for (let i=0;i<12;i++) runtime.frame()
    expect(requests).toBe(settled)
    runtime.dispose()
  })
})
