// @vitest-environment happy-dom
// Capture storage selection must settle cleanly even when `adapter.info` is absent
// or `requestAdapter` throws, clear its deadline timer on early settlement, and
// stop scheduling canvas paints after `dispose()`.

import { afterEach, describe, expect, it, vi } from 'vitest'

interface StubTrialCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

describe('captureMemoryChosen and post-dispose paint guards', () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext

  afterEach(() => {
    for (const key of ['layoutSubtree', 'onpaint', 'requestPaint']) {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, key)
    }
    HTMLCanvasElement.prototype.getContext = realGetContext
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    document.body.innerHTML = ''
  })

  it('settles to GPU storage and clears the 3s timer when adapter.info is absent', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: async () => ({}),
      },
    })
    const { captureMemoryChosen, captureContext } = await import('@munari/core')
    const optionsSeen: Array<CanvasRenderingContext2DSettings | undefined> = []
    const ctx = { drawImage() {}, setTransform() {}, clearRect() {} }
    // SAFETY: records options passed to getContext('2d', options).
    HTMLCanvasElement.prototype.getContext = ((id: string, options?: CanvasRenderingContext2DSettings) => {
      if (id === '2d') {
        optionsSeen.push(options)
        return ctx
      }
      return null
    }) as typeof realGetContext

    const pending = captureMemoryChosen()
    expect(pending).not.toBeNull()
    await pending
    expect(vi.getTimerCount()).toBe(0)
    expect(captureMemoryChosen()).toBeNull()
    expect(captureContext(document.createElement('canvas'))).toBe(ctx)
    expect(optionsSeen).toEqual([undefined])
  })

  it('falls back to GPU storage when requestAdapter throws synchronously', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: () => {
          throw new Error('WebGPU blocked by policy')
        },
      },
    })
    const { captureMemoryChosen } = await import('@munari/core')
    await captureMemoryChosen()
    expect(captureMemoryChosen()).toBeNull()
  })

  it('does not call requestPaint after htmlInCanvas source is disposed', async () => {
    let resolveAdapter: (value: null) => void = () => {}
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: () =>
          new Promise<null>((resolve) => {
            resolveAdapter = resolve
          }),
      },
    })
    class Ctx2D {
      drawElementImage() {}
      setTransform() {}
      clearRect() {}
    }
    vi.stubGlobal('CanvasRenderingContext2D', Ctx2D)
    let paintRequests = 0
    // SAFETY: installs trial members onto the prototype for happy-dom.
    const proto = HTMLCanvasElement.prototype as StubTrialCanvas
    proto.layoutSubtree = false
    proto.onpaint = null
    proto.requestPaint = () => {
      paintRequests++
    }

    const { htmlInCanvasEngine } = await import('@munari/core')
    const source = htmlInCanvasEngine.createSource('<div>ok</div>', 80, 40)
    expect(paintRequests).toBe(1)

    // Trigger onpaint while adapter choice is pending, then dispose before it resolves.
    // SAFETY: htmlInCanvasEngine's host is the TrialCanvas.
    const host = source.host as StubTrialCanvas
    host.onpaint?.()
    source.dispose()

    resolveAdapter(null)
    for (let i = 0; i < 4; i++) await Promise.resolve()
    source.repaint()
    expect(paintRequests).toBe(1)
  })
})
