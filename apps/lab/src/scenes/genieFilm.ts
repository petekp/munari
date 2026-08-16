import {
  createCanvasFrameSource,
  type FrameId,
  type FrameSource,
} from '@petepetrash/munari'

export const GENIE_FILM_WIDTH = 600
export const GENIE_FILM_HEIGHT = 396

/** Stable names for browser probes. Values are plain strings for CSS selectors. */
export const GENIE_FILM_DATA_ATTRIBUTES = Object.freeze({
  role: 'data-genie-film-role',
  attached: 'data-genie-film-attached',
  ready: 'data-genie-film-ready',
  frozen: 'data-genie-film-frozen',
  sourceId: 'data-genie-film-source-id',
  generation: 'data-genie-film-generation',
  drawCount: 'data-genie-film-draw-count',
  mediaTime: 'data-genie-film-media-time',
  presentedFrames: 'data-genie-film-presented-frames',
  error: 'data-genie-film-error',
} as const)

export interface GenieFilmControllerOptions {
  /** Draw errors do not stop the decoder callback chain. */
  readonly onError?: (error: Error) => void
}

export interface GenieFilmController {
  /** The source appears after the first canvas attachment and keeps its identity. */
  readonly source: FrameSource | null
  readonly canvas: HTMLCanvasElement | null
  readonly video: HTMLVideoElement | null
  readonly frozen: boolean
  /** Null means that generation zero still contains no decoded picture. */
  readonly lastFrame: FrameId | null

  /** Attach the one caller-owned canvas. The returned cleanup is idempotent. */
  attachCanvas(canvas: HTMLCanvasElement): () => void
  /** Attach the one caller-owned decoder. The returned cleanup is idempotent. */
  attachVideo(video: HTMLVideoElement): () => void

  /** Hold and republish the last drawn pixels. Null means no real picture exists yet. */
  freeze(): FrameId | null
  /** Draw and resume only if the optional token is still the active freeze. */
  resume(expected?: FrameId): FrameId | null
  dispose(): void
}

const HAVE_CURRENT_DATA = 2

/**
 * Own the film's pixel timing without owning either DOM element.
 *
 * One decoder writes one opaque sRGB canvas. The returned FrameSource is stable
 * across ref cleanup and reattachment of those same elements.
 */
export function createGenieFilmController(
  options: GenieFilmControllerOptions = {},
): GenieFilmController {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  let writableSource: ReturnType<typeof createCanvasFrameSource> | null = null
  let unsubscribeSource: (() => void) | null = null
  let video: HTMLVideoElement | null = null

  const canvasAttachments = new Set<symbol>()
  const videoAttachments = new Set<symbol>()

  let callbackId: number | null = null
  let videoEpoch = 0
  let listenersInstalled = false
  let disposed = false
  let frozen = false
  let lastFrame: FrameId | null = null
  let heldFrame: FrameId | null = null
  let drawCount = 0
  let lastMetadata: VideoFrameCallbackMetadata | null = null

  // Normalized at the one place a throw is caught, so the attribute, the
  // console and the consumer's handler all read the same sentence.
  const reportError = (error: Error) => {
    canvas?.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.error, error.message)
    options.onError?.(error)
  }

  const assertLive = () => {
    if (disposed) throw new Error('Genie film controller is disposed')
  }

  const setAttached = (element: Element, value: boolean) => {
    element.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.attached, String(value))
  }

  const recordMetadata = (element: Element, metadata: VideoFrameCallbackMetadata) => {
    element.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.mediaTime, String(metadata.mediaTime))
    element.setAttribute(
      GENIE_FILM_DATA_ATTRIBUTES.presentedFrames,
      String(metadata.presentedFrames),
    )
  }

  const publishDrawnPixels = (metadata: VideoFrameCallbackMetadata | null): FrameId | null => {
    if (
      !canvas ||
      !context ||
      !writableSource ||
      !video ||
      canvasAttachments.size === 0 ||
      videoAttachments.size === 0 ||
      video.readyState < HAVE_CURRENT_DATA
    ) {
      return null
    }

    // drawImage completes the canvas write before publish notifies the renderer.
    context.drawImage(video, 0, 0, GENIE_FILM_WIDTH, GENIE_FILM_HEIGHT)
    drawCount += 1
    canvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.drawCount, String(drawCount))
    if (metadata) recordMetadata(canvas, metadata)

    const frame = writableSource.publish()
    canvas.removeAttribute(GENIE_FILM_DATA_ATTRIBUTES.error)
    return frame
  }

  const tryPublishDrawnPixels = (
    metadata: VideoFrameCallbackMetadata | null,
  ): FrameId | null => {
    try {
      return publishDrawnPixels(metadata)
    } catch (cause) {
      reportError(cause instanceof Error ? cause : new Error(String(cause)))
      return null
    }
  }

  const schedule = () => {
    if (
      disposed ||
      callbackId !== null ||
      !video ||
      videoAttachments.size === 0
    ) {
      return
    }

    const scheduledVideo = video
    const scheduledEpoch = videoEpoch
    callbackId = scheduledVideo.requestVideoFrameCallback((_now, metadata) => {
      if (
        disposed ||
        scheduledEpoch !== videoEpoch ||
        scheduledVideo !== video ||
        videoAttachments.size === 0
      ) {
        return
      }

      callbackId = null
      lastMetadata = metadata
      recordMetadata(scheduledVideo, metadata)

      if (!frozen) tryPublishDrawnPixels(metadata)
      schedule()
    })
  }

  const onVideoReady = () => {
    schedule()
  }

  const installVideoListeners = () => {
    if (!video || listenersInstalled) return
    video.addEventListener('loadeddata', onVideoReady)
    video.addEventListener('playing', onVideoReady)
    listenersInstalled = true
  }

  const removeVideoListeners = () => {
    if (!video || !listenersInstalled) return
    video.removeEventListener('loadeddata', onVideoReady)
    video.removeEventListener('playing', onVideoReady)
    listenersInstalled = false
  }

  const stopVideoPump = () => {
    videoEpoch += 1
    const pendingId = callbackId
    callbackId = null
    removeVideoListeners()
    if (pendingId !== null && video) video.cancelVideoFrameCallback(pendingId)
  }

  const controller: GenieFilmController = {
    get source() {
      return writableSource
    },
    get canvas() {
      return canvas
    },
    get video() {
      return video
    },
    get frozen() {
      return frozen
    },
    get lastFrame() {
      return lastFrame
    },

    attachCanvas(nextCanvas) {
      assertLive()
      if (canvas && canvas !== nextCanvas) {
        throw new Error('Genie film controller accepts one canvas for its lifetime')
      }

      if (!canvas) {
        nextCanvas.width = GENIE_FILM_WIDTH
        nextCanvas.height = GENIE_FILM_HEIGHT
        const nextContext = nextCanvas.getContext('2d', {
          alpha: false,
          colorSpace: 'srgb',
        })
        if (!nextContext) throw new Error('Genie film needs a Canvas 2D context')

        const attributes = nextContext.getContextAttributes()
        if (attributes.alpha !== false || attributes.colorSpace !== 'srgb') {
          throw new Error('Genie film needs an opaque sRGB Canvas 2D context')
        }

        canvas = nextCanvas
        context = nextContext
        writableSource = createCanvasFrameSource(nextCanvas, {
          premultiplyAlpha: false,
        })
        // Register first so every renderer subscriber sees matching controller
        // state and probe attributes during the same synchronous notification.
        unsubscribeSource = writableSource.subscribe(() => {
          if (!writableSource || !canvas) return
          const published = writableSource.currentFrame()
          lastFrame = published
          if (frozen) heldFrame = published
          canvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.ready, 'true')
          canvas.setAttribute(
            GENIE_FILM_DATA_ATTRIBUTES.generation,
            String(published.generation),
          )
        })

        nextCanvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.role, 'canvas')
        nextCanvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.ready, 'false')
        nextCanvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.frozen, 'false')
        nextCanvas.setAttribute(
          GENIE_FILM_DATA_ATTRIBUTES.sourceId,
          String(writableSource.currentFrame().sourceId),
        )
        nextCanvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.generation, '0')
        nextCanvas.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.drawCount, '0')
      } else if (
        nextCanvas.width !== GENIE_FILM_WIDTH ||
        nextCanvas.height !== GENIE_FILM_HEIGHT
      ) {
        throw new Error('Genie film canvas dimensions changed after source creation')
      }

      const attachment = Symbol('canvas attachment')
      const wasDetached = canvasAttachments.size === 0
      canvasAttachments.add(attachment)
      setAttached(nextCanvas, true)
      if (wasDetached && videoAttachments.size > 0 && !frozen) {
        tryPublishDrawnPixels(lastMetadata)
      }

      let active = true
      return () => {
        if (!active) return
        active = false
        canvasAttachments.delete(attachment)
        if (canvasAttachments.size === 0) setAttached(nextCanvas, false)
      }
    },

    attachVideo(nextVideo) {
      assertLive()
      if (video && video !== nextVideo) {
        throw new Error('Genie film controller accepts one video for its lifetime')
      }
      if (
        !('requestVideoFrameCallback' in nextVideo) ||
        !('cancelVideoFrameCallback' in nextVideo)
      ) {
        throw new Error('Genie film needs requestVideoFrameCallback support')
      }

      if (!video) {
        video = nextVideo
        nextVideo.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.role, 'decoder')
      }

      const attachment = Symbol('video attachment')
      const wasDetached = videoAttachments.size === 0
      videoAttachments.add(attachment)
      setAttached(nextVideo, true)
      if (wasDetached) {
        installVideoListeners()
        if (canvasAttachments.size > 0 && !frozen) {
          tryPublishDrawnPixels(lastMetadata)
        }
        schedule()
      }

      let active = true
      return () => {
        if (!active) return
        active = false
        videoAttachments.delete(attachment)
        if (videoAttachments.size === 0) {
          setAttached(nextVideo, false)
          stopVideoPump()
        }
      }
    },

    freeze() {
      assertLive()
      if (!writableSource || !lastFrame) return null

      frozen = true
      canvas?.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.frozen, 'true')
      return writableSource.publish()
    },

    resume(expected) {
      assertLive()
      if (
        expected &&
        (!heldFrame ||
          heldFrame.sourceId !== expected.sourceId ||
          heldFrame.generation !== expected.generation)
      ) {
        return null
      }
      frozen = false
      heldFrame = null
      canvas?.setAttribute(GENIE_FILM_DATA_ATTRIBUTES.frozen, 'false')
      const frame = tryPublishDrawnPixels(lastMetadata)
      schedule()
      return frame
    },

    dispose() {
      if (disposed) return
      disposed = true
      canvasAttachments.clear()
      videoAttachments.clear()
      if (canvas) setAttached(canvas, false)
      if (video) setAttached(video, false)
      unsubscribeSource?.()
      unsubscribeSource = null
      stopVideoPump()
    },
  }

  return Object.freeze(controller)
}
