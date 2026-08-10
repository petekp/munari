import { describe, expect, it, vi } from 'vitest'
import {
  GENIE_FILM_DATA_ATTRIBUTES as DATA,
  GENIE_FILM_HEIGHT,
  GENIE_FILM_WIDTH,
  createGenieFilmController,
} from './genieFilm'

interface FakeCanvas {
  width: number
  height: number
  attributes: Map<string, string>
  contextOptions: CanvasRenderingContext2DSettings | undefined
  drawImage: ReturnType<typeof vi.fn>
  element: HTMLCanvasElement
}

function fakeCanvas(): FakeCanvas {
  const attributes = new Map<string, string>()
  const drawImage = vi.fn()
  let contextOptions: CanvasRenderingContext2DSettings | undefined
  const context = {
    drawImage,
    getContextAttributes: () => ({ alpha: false, colorSpace: 'srgb' as const }),
  }
  const raw = {
    width: 0,
    height: 0,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getContext: (_kind: string, options?: CanvasRenderingContext2DSettings) => {
      contextOptions = options
      return context
    },
  }
  return {
    get width() {
      return raw.width
    },
    set width(value: number) {
      raw.width = value
    },
    get height() {
      return raw.height
    },
    set height(value: number) {
      raw.height = value
    },
    attributes,
    get contextOptions() {
      return contextOptions
    },
    drawImage,
    element: raw as unknown as HTMLCanvasElement,
  }
}

interface FakeVideo {
  readonly element: HTMLVideoElement
  readonly attributes: Map<string, string>
  readonly cancelled: number[]
  readonly pendingCount: () => number
  readonly listenerCount: () => number
  present(metadata?: Partial<VideoFrameCallbackMetadata>): void
  invokeStale(id: number, metadata?: Partial<VideoFrameCallbackMetadata>): void
}

interface FakeVideoOptions {
  readonly readyState?: number
}

function frameMetadata(
  metadata: Partial<VideoFrameCallbackMetadata> = {},
): VideoFrameCallbackMetadata {
  return {
    expectedDisplayTime: 10,
    height: GENIE_FILM_HEIGHT,
    mediaTime: 1.25,
    presentationTime: 9,
    presentedFrames: 7,
    width: GENIE_FILM_WIDTH,
    ...metadata,
  }
}

function fakeVideo(options: FakeVideoOptions = {}): FakeVideo {
  const attributes = new Map<string, string>()
  const callbacks = new Map<number, VideoFrameRequestCallback>()
  const allCallbacks = new Map<number, VideoFrameRequestCallback>()
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const cancelled: number[] = []
  let nextId = 1

  const raw = {
    readyState: options.readyState ?? 0,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
      const id = nextId++
      callbacks.set(id, callback)
      allCallbacks.set(id, callback)
      return id
    },
    cancelVideoFrameCallback(id: number) {
      cancelled.push(id)
      callbacks.delete(id)
    },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const group = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener)
    },
  }

  const invoke = (
    callback: VideoFrameRequestCallback | undefined,
    metadata?: Partial<VideoFrameCallbackMetadata>,
  ) => {
    if (!callback) throw new Error('No video frame callback exists')
    callback(8, frameMetadata(metadata))
  }

  return {
    element: raw as unknown as HTMLVideoElement,
    attributes,
    cancelled,
    pendingCount: () => callbacks.size,
    listenerCount: () =>
      [...listeners.values()].reduce((count, group) => count + group.size, 0),
    present(metadata) {
      const entry = callbacks.entries().next().value as
        | [number, VideoFrameRequestCallback]
        | undefined
      if (!entry) throw new Error('No pending video frame callback')
      callbacks.delete(entry[0])
      raw.readyState = 2
      invoke(entry[1], metadata)
    },
    invokeStale(id, metadata) {
      invoke(allCallbacks.get(id), metadata)
    },
  }
}

describe('Genie film controller', () => {
  it('creates one opaque sRGB source and keeps it across ref reattachment', () => {
    const canvas = fakeCanvas()
    const controller = createGenieFilmController()

    const detach = controller.attachCanvas(canvas.element)
    const source = controller.source
    expect(canvas.width).toBe(GENIE_FILM_WIDTH)
    expect(canvas.height).toBe(GENIE_FILM_HEIGHT)
    expect(canvas.contextOptions).toEqual({ alpha: false, colorSpace: 'srgb' })
    expect(source?.format).toEqual({ colorSpace: 'srgb', premultiplyAlpha: false })
    expect(canvas.attributes.get(DATA.sourceId)).toBe(
      String(source?.currentFrame().sourceId),
    )

    detach()
    detach()
    const detachAgain = controller.attachCanvas(canvas.element)
    expect(controller.source).toBe(source)
    expect(canvas.attributes.get(DATA.attached)).toBe('true')
    detachAgain()
    expect(canvas.attributes.get(DATA.attached)).toBe('false')

    expect(() => controller.attachCanvas(fakeCanvas().element)).toThrow(/one canvas/)
  })

  it('publishes only after each completed draw and records decoder metadata', () => {
    const canvas = fakeCanvas()
    const video = fakeVideo()
    const controller = createGenieFilmController()
    controller.attachCanvas(canvas.element)
    controller.attachVideo(video.element)
    const generations: number[] = []
    controller.source?.subscribe(() => {
      expect(canvas.drawImage).toHaveBeenCalledTimes(generations.length + 1)
      const current = controller.source?.currentFrame()
      expect(controller.lastFrame).toBe(current)
      expect(canvas.attributes.get(DATA.generation)).toBe(String(current?.generation))
      generations.push(current?.generation ?? -1)
    })

    expect(video.pendingCount()).toBe(1)
    video.present({ mediaTime: 2.5, presentedFrames: 11 })

    expect(generations).toEqual([1])
    expect(controller.lastFrame?.generation).toBe(1)
    expect(canvas.drawImage).toHaveBeenCalledWith(
      video.element,
      0,
      0,
      GENIE_FILM_WIDTH,
      GENIE_FILM_HEIGHT,
    )
    expect(canvas.attributes.get(DATA.ready)).toBe('true')
    expect(canvas.attributes.get(DATA.mediaTime)).toBe('2.5')
    expect(video.attributes.get(DATA.presentedFrames)).toBe('11')
    expect(video.pendingCount()).toBe(1)
  })

  it.each(['canvas-first', 'video-first'] as const)(
    'draws an already-decoded picture when the final element attaches: %s',
    (order) => {
      const canvas = fakeCanvas()
      const video = fakeVideo({ readyState: 2 })
      const controller = createGenieFilmController()

      if (order === 'canvas-first') {
        controller.attachCanvas(canvas.element)
        expect(controller.lastFrame).toBeNull()
        controller.attachVideo(video.element)
      } else {
        controller.attachVideo(video.element)
        expect(controller.lastFrame).toBeNull()
        controller.attachCanvas(canvas.element)
      }

      expect(canvas.drawImage).toHaveBeenCalledTimes(1)
      expect(controller.lastFrame?.generation).toBe(1)
      expect(controller.source?.currentFrame()).toBe(controller.lastFrame)
      expect(canvas.attributes.get(DATA.ready)).toBe('true')
      expect(canvas.attributes.get(DATA.generation)).toBe('1')
      expect(video.pendingCount()).toBe(1)
    },
  )

  it('does not freeze generation-zero black and rejects a replaced freeze token', () => {
    const canvas = fakeCanvas()
    const video = fakeVideo()
    const controller = createGenieFilmController()
    controller.attachCanvas(canvas.element)
    controller.attachVideo(video.element)

    expect(controller.freeze()).toBeNull()
    expect(controller.frozen).toBe(false)
    video.present()

    const heldObservations: number[] = []
    controller.source?.subscribe(() => {
      if (!controller.frozen) return
      const current = controller.source?.currentFrame()
      expect(controller.lastFrame).toBe(current)
      expect(canvas.attributes.get(DATA.generation)).toBe(String(current?.generation))
      heldObservations.push(current?.generation ?? -1)
    })

    const held = controller.freeze()
    expect(held?.generation).toBe(2)
    const newerHeld = controller.freeze()
    expect(newerHeld?.generation).toBe(3)
    expect(newerHeld).not.toBe(held)
    expect(heldObservations).toEqual([2, 3])
    expect(controller.frozen).toBe(true)
    expect(canvas.attributes.get(DATA.frozen)).toBe('true')

    const drawsBeforeStaleResume = canvas.drawImage.mock.calls.length
    expect(controller.resume(held ?? undefined)).toBeNull()
    expect(controller.frozen).toBe(true)
    expect(controller.lastFrame).toBe(newerHeld)
    expect(canvas.drawImage).toHaveBeenCalledTimes(drawsBeforeStaleResume)

    video.present({ mediaTime: 1.5, presentedFrames: 8 })
    expect(canvas.drawImage).toHaveBeenCalledTimes(1)
    expect(controller.lastFrame).toBe(newerHeld)

    const resumed = controller.resume(newerHeld ?? undefined)
    expect(resumed?.generation).toBe(4)
    expect(controller.frozen).toBe(false)
    expect(canvas.drawImage).toHaveBeenCalledTimes(2)
    expect(canvas.attributes.get(DATA.drawCount)).toBe('2')
  })

  it('cleans every listener and callback, and rejects stale callbacks', () => {
    const canvas = fakeCanvas()
    const video = fakeVideo()
    const controller = createGenieFilmController()
    controller.attachCanvas(canvas.element)
    const detachA = controller.attachVideo(video.element)
    const detachB = controller.attachVideo(video.element)

    expect(video.listenerCount()).toBe(2)
    expect(video.pendingCount()).toBe(1)
    detachA()
    expect(video.listenerCount()).toBe(2)
    expect(video.pendingCount()).toBe(1)

    detachB()
    detachB()
    expect(video.listenerCount()).toBe(0)
    expect(video.pendingCount()).toBe(0)
    expect(video.cancelled).toEqual([1])

    const detachAgain = controller.attachVideo(video.element)
    expect(video.listenerCount()).toBe(2)
    expect(video.pendingCount()).toBe(1)
    video.invokeStale(1)
    expect(canvas.drawImage).not.toHaveBeenCalled()
    expect(video.pendingCount()).toBe(1)

    detachAgain()
    controller.dispose()
    controller.dispose()
    expect(video.listenerCount()).toBe(0)
    expect(video.pendingCount()).toBe(0)
    expect(() => controller.attachVideo(video.element)).toThrow(/disposed/)
  })

  it('does not publish a failed canvas draw and keeps the callback pump alive', () => {
    const canvas = fakeCanvas()
    const video = fakeVideo()
    const errors: unknown[] = []
    canvas.drawImage.mockImplementationOnce(() => {
      throw new Error('decoder not drawable')
    })
    const controller = createGenieFilmController({ onError: (error) => errors.push(error) })
    controller.attachCanvas(canvas.element)
    controller.attachVideo(video.element)

    video.present()
    expect(controller.lastFrame).toBeNull()
    expect(controller.source?.currentFrame().generation).toBe(0)
    expect(errors).toHaveLength(1)
    expect(video.pendingCount()).toBe(1)

    video.present()
    expect(controller.lastFrame?.generation).toBe(1)
    expect(canvas.attributes.has(DATA.error)).toBe(false)
  })
})
