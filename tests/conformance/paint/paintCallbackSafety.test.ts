// @vitest-environment happy-dom
// A throwing subscribePaint listener must not corrupt completed paint state into
// a platform capture failure or starve later subscribers on either engine.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRasterizedSource,
  htmlInCanvasEngine,
  paintStats,
  type DomPaintReceipt,
  type RasterImage,
} from '@munari/core'

interface StubTrialCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

describe('subscribePaint callback isolation', () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('preserves painted() and notifies later subscribers when a listener throws on html-in-canvas', async () => {
    const reported: Error[] = []
    vi.stubGlobal('reportError', (err: Error) => reported.push(err))
    class Ctx2D {
      drawElementImage() {}
      setTransform() {}
      clearRect() {}
    }
    vi.stubGlobal('CanvasRenderingContext2D', Ctx2D)
    // SAFETY: installs trial members onto the prototype for happy-dom.
    const proto = HTMLCanvasElement.prototype as StubTrialCanvas
    proto.layoutSubtree = false
    proto.onpaint = null
    proto.requestPaint = () => {}
    // SAFETY: returns our stub 2D context for '2d'.
    HTMLCanvasElement.prototype.getContext = ((id: string) =>
      id === '2d' ? new Ctx2D() : null) as typeof realGetContext

    const sourceErrors: Error[] = []
    const source = htmlInCanvasEngine.createSource('<div>ok</div>', 120, 60, {
      label: 'hic-throw-check',
      onError: (err) => sourceErrors.push(err),
    })
    const boom = new Error('listener boom')
    const later: DomPaintReceipt[] = []
    source.subscribePaint(() => {
      throw boom
    })
    source.subscribePaint((receipt) => later.push(receipt))

    // SAFETY: htmlInCanvasEngine's host is the TrialCanvas with `onpaint`.
    const host = source.host as StubTrialCanvas
    host.onpaint?.()

    expect(source.painted()).toBe(true)
    expect(later).toHaveLength(1)
    expect(sourceErrors).toEqual([])
    expect(paintStats().find((s) => s.label === 'hic-throw-check')?.errors).toBe(0)
    await Promise.resolve()
    expect(reported).toEqual([boom])
    source.dispose()
  })

  it('preserves painted() and notifies later subscribers when a listener throws on rasterizedSource', async () => {
    const reported: Error[] = []
    vi.stubGlobal('reportError', (err: Error) => reported.push(err))
    const ctx = { drawImage() {}, setTransform() {}, clearRect() {} }
    // SAFETY: returns stub 2D context for '2d'.
    HTMLCanvasElement.prototype.getContext = ((id: string) =>
      id === '2d' ? ctx : null) as typeof realGetContext

    const sourceErrors: Error[] = []
    const source = createRasterizedSource(
      async (): Promise<RasterImage> => new Image(120, 60),
      'test-raster',
      '<div>ok</div>',
      120,
      60,
      { label: 'raster-throw-check', onError: (err) => sourceErrors.push(err) },
    )
    const boom = new Error('raster listener boom')
    const later: DomPaintReceipt[] = []
    source.subscribePaint(() => {
      throw boom
    })
    source.subscribePaint((receipt) => later.push(receipt))

    for (let i = 0; i < 6; i++) await Promise.resolve()

    expect(source.painted()).toBe(true)
    expect(later).toHaveLength(1)
    expect(sourceErrors).toEqual([])
    expect(paintStats().find((s) => s.label === 'raster-throw-check')?.errors).toBe(0)
    expect(reported).toEqual([boom])
    source.dispose()
  })
})
