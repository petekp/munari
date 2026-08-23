// @vitest-environment happy-dom
//
// The two doubles below are REAL elements with the one origin-trial member
// each stubbed. That is the difference between a test that proves the
// controller drives a canvas and a test that proves it drives an object
// shaped like the controller's own idea of one: the attributes it writes are
// read back off the element that received them, not out of a Map the double
// kept in parallel.

import { describe, expect, it, vi } from 'vitest'
import {
  GENIE_FILM_DATA_ATTRIBUTES as DATA,
  GENIE_FILM_HEIGHT,
  GENIE_FILM_WIDTH,
  createGenieFilmController,
} from './genieFilm'

/** What the controller wrote, as the element itself holds it. */
interface AttributeLog {
  get(name: string): string | undefined
  has(name: string): boolean
}

function attributeLog(element: Element): AttributeLog {
  return {
    get: (name) => element.getAttribute(name) ?? undefined,
    has: (name) => element.hasAttribute(name),
  }
}

interface FakeCanvas {
  readonly width: number
  readonly height: number
  readonly attributes: AttributeLog
  readonly contextOptions: CanvasRenderingContext2DSettings | undefined
  readonly drawImage: ReturnType<typeof vi.fn>
  readonly element: HTMLCanvasElement
}

function fakeCanvas(
  reported: CanvasRenderingContext2DSettings = { alpha: false, colorSpace: 'srgb' },
): FakeCanvas {
  const drawImage = vi.fn()
  let contextOptions: CanvasRenderingContext2DSettings | undefined
  const context = {
    drawImage,
    getContextAttributes: () => reported,
  }
  const element = document.createElement('canvas')
  // SAFETY: the real `getContext` is overloaded across every context id and
  // answers each with a different class. This one answers '2d' with the two
  // members the controller uses — the draw call, and the attributes it
  // checks before it trusts the context — and every other id with `null`.
  element.getContext = ((kind: string, options?: CanvasRenderingContext2DSettings) => {
    contextOptions = options
    return kind === '2d' ? context : null
  }) as typeof element.getContext

  return {
    element,
    attributes: attributeLog(element),
    get width() {
      return element.width
    },
    get height() {
      return element.height
    },
    get contextOptions() {
      return contextOptions
    },
    drawImage,
  }
}

interface FakeVideo {
  readonly element: HTMLVideoElement
  readonly attributes: AttributeLog
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
  const callbacks = new Map<number, VideoFrameRequestCallback>()
  const allCallbacks = new Map<number, VideoFrameRequestCallback>()
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const cancelled: number[] = []
  let nextId = 1

  const element = document.createElement('video')

  // A decoder's readiness is the browser's to report and this suite's to
  // drive, so the real read-only property is replaced by one the test moves.
  let readyState = options.readyState ?? 0
  Object.defineProperty(element, 'readyState', {
    configurable: true,
    get: () => readyState,
  })

  // The frame callback is an origin-trial member no test environment ships.
  element.requestVideoFrameCallback = (callback) => {
    const id = nextId++
    callbacks.set(id, callback)
    allCallbacks.set(id, callback)
    return id
  }
  element.cancelVideoFrameCallback = (id) => {
    cancelled.push(id)
    callbacks.delete(id)
  }

  // Counted on the way through, never intercepted: the element still gets
  // every listener, so `listenerCount` measures what the controller left
  // behind rather than what it announced.
  const install = element.addEventListener.bind(element)
  const uninstall = element.removeEventListener.bind(element)
  element.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    listenerOptions?: boolean | AddEventListenerOptions,
  ) => {
    // A null listener is a no-op in the DOM, so it is one here too.
    if (!listener) return
    const group = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    group.add(listener)
    listeners.set(type, group)
    install(type, listener, listenerOptions)
  }
  element.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    listenerOptions?: boolean | EventListenerOptions,
  ) => {
    if (!listener) return
    listeners.get(type)?.delete(listener)
    uninstall(type, listener, listenerOptions)
  }

  const invoke = (
    callback: VideoFrameRequestCallback | undefined,
    metadata?: Partial<VideoFrameCallbackMetadata>,
  ) => {
    if (!callback) throw new Error('No video frame callback exists')
    callback(8, frameMetadata(metadata))
  }

  return {
    element,
    attributes: attributeLog(element),
    cancelled,
    pendingCount: () => callbacks.size,
    listenerCount: () =>
      [...listeners.values()].reduce((count, group) => count + group.size, 0),
    present(metadata) {
      const [id, callback] = callbacks.entries().next().value ?? []
      if (id === undefined || !callback) throw new Error('No pending video frame callback')
      callbacks.delete(id)
      readyState = 2
      invoke(callback, metadata)
    },
    invokeStale(id, metadata) {
      invoke(allCallbacks.get(id), metadata)
    },
  }
}

describe('Genie film controller', () => {
  // Safari 18.6 omits `alpha` from getContextAttributes() altogether — the
  // keys it answers with are colorSpace, desynchronized, willReadFrequently.
  // Reading that absence as a refusal threw out of the ref callback that
  // attaches this canvas and blanked the whole lab page (2026-08-23).
  it('accepts a context whose browser does not report the alpha it was asked for', () => {
    const canvas = fakeCanvas({ colorSpace: 'srgb', willReadFrequently: false })
    const controller = createGenieFilmController()
    expect(() => controller.attachCanvas(canvas.element)).not.toThrow()
    expect(canvas.contextOptions).toEqual({ alpha: false, colorSpace: 'srgb' })
    expect(controller.source?.format).toEqual({ colorSpace: 'srgb', premultiplyAlpha: false })
  })

  // A browser that says yes to the request and then reports the opposite is
  // the fault the check is actually for, and it still is one.
  it('refuses a context reported as non-opaque or not sRGB', () => {
    expect(() =>
      createGenieFilmController().attachCanvas(fakeCanvas({ alpha: true, colorSpace: 'srgb' }).element),
    ).toThrow(/opaque sRGB/)
    expect(() =>
      createGenieFilmController().attachCanvas(
        fakeCanvas({ alpha: false, colorSpace: 'display-p3' }).element,
      ),
    ).toThrow(/opaque sRGB/)
  })

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
    const errors: Error[] = []
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
