// @vitest-environment happy-dom
// Motion is approximate, rest is exact: a rasterized source whose backing store
// was resampled during LOD steps or mid-capture resizes must recapture at rest.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRasterizedSource, type CaptureClock, type RasterImage } from '@munari/core'

function handCranked() {
  let now = 0
  const waits: { at: number; run: () => void }[] = []
  const clock: CaptureClock = {
    now: () => now,
    wait: (run, ms) => {
      const entry = { at: now + ms, run }
      waits.push(entry)
      return () => {
        const at = waits.indexOf(entry)
        if (at >= 0) waits.splice(at, 1)
      }
    },
  }
  return {
    clock,
    pass(ms: number) {
      now += ms
      for (const entry of [...waits]) {
        if (entry.at > now) continue
        waits.splice(waits.indexOf(entry), 1)
        entry.run()
      }
    },
  }
}

const drain = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('createRasterizedSource resettle sharpness', () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext

  beforeEach(() => {
    const context = { drawImage() {}, setTransform() {}, clearRect() {} }
    // SAFETY: test stub supplies the three 2D canvas operations the rasterizer uses.
    HTMLCanvasElement.prototype.getContext = ((id: string) =>
      id === '2d' ? context : null) as typeof realGetContext
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext
    document.body.innerHTML = ''
  })

  it('recaptures on resettle after an LOD downshift and return stretched the store', async () => {
    const time = handCranked()
    const calls: Array<readonly [number, number]> = []
    const source = createRasterizedSource(
      async (_el, sx, sy): Promise<RasterImage> => {
        calls.push([sx, sy])
        return new Image(Math.round(100 * sx), Math.round(100 * sy))
      },
      'test',
      '<div></div>',
      100,
      100,
      {},
      time.clock,
    )
    await drain()
    expect(calls).toEqual([[1, 1]])

    // Settling when nothing resampled the store skips a redundant capture.
    source.resettle()
    time.pass(1000)
    await drain()
    expect(calls).toEqual([[1, 1]])

    // Shrinking to 0.25x destroys 15/16ths of texels; returning to 1x stretches 25x25 to 100x100.
    source.setRasterScale(0.25, 0.25)
    source.setRasterScale(1, 1)
    expect(calls).toEqual([[1, 1]])

    // Rest must repay the stretch with a fresh 1x raster.
    source.resettle()
    time.pass(1000)
    await drain()
    expect(calls).toEqual([[1, 1], [1, 1]])
    source.dispose()
  })

  it('recaptures on resettle when the store grew while an in-flight raster was running', async () => {
    const time = handCranked()
    const pending: Array<{ scale: readonly [number, number]; resolve: (img: RasterImage) => void }> = []
    const source = createRasterizedSource(
      (_el, sx, sy) =>
        new Promise<RasterImage>((resolve) => {
          pending.push({ scale: [sx, sy], resolve })
        }),
      'test',
      '<div></div>',
      100,
      100,
      { scale: 0.5 },
      time.clock,
    )
    await drain()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.scale).toEqual([0.5, 0.5])

    // Store grows to 2x while the 0.5x capture is still in flight.
    source.setRasterScale(2, 2)
    pending[0]!.resolve(new Image(50, 50))
    await drain()

    // The 50x50 raster was stretched into the 200x200 store; resettle must ask for 2x.
    source.resettle()
    time.pass(1000)
    await drain()
    expect(pending).toHaveLength(2)
    expect(pending[1]?.scale).toEqual([2, 2])
    pending[1]!.resolve(new Image(200, 200))
    await drain()
    source.dispose()
  })
})
