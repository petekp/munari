// A renderer-free identity for caller-owned canvas frames.
//
// Publishing says only that the producer finished writing new pixels. It
// does not say that a renderer uploaded or drew them. Consumers must sample
// currentFrame() at the renderer boundary because several publications may
// merge into one upload.
//
// That gap is the module's whole reason to exist (decisions.md #24):
// `texture.needsUpdate` asks for an upload without proving which of
// several fast canvas writes the renderer took, or that a visible mesh
// used the pixels. Core owns only the naming half — a live-unique
// sourceId, a generation that advances on each completed write, sRGB and
// alpha interpretation fixed at birth. The GPU half (sampling the
// generation inside the upload callback, releasing a receipt only after
// the target mesh renders) belongs to the binding, so a receipt names
// exactly the frame that crossed both renderer boundaries. Measured
// under bursts and CPU stalls: 285 writes, 165 real uploads and draws,
// zero false receipts, zero reordering.

import { allocateSourceId } from './sourceIdentity'

export interface FrameId {
  readonly sourceId: number
  readonly generation: number
}

export interface FrameFormat {
  /** The first supported canvas contract. Wider-gamut sources need a new format. */
  readonly colorSpace: 'srgb'
  /** Whether consumers must upload RGB in premultiplied-alpha form. */
  readonly premultiplyAlpha: boolean
}

export type FrameSourceSubscriber = () => void

/** The structural contract a renderer consumes. Custom producers can implement it directly. */
export interface FrameSource {
  /** Stable caller-owned pixel storage. A FrameSource never replaces, reparents, or disposes it. */
  readonly canvas: HTMLCanvasElement
  /** Pixel interpretation fixed for this source's full lifetime. */
  readonly format: FrameFormat
  /** A live-unique, stable sourceId plus a generation that increases after each completed write. */
  currentFrame(): FrameId
  /** Notification that currentFrame() may have advanced. Returns cleanup. */
  subscribe(notify: FrameSourceSubscriber): () => void
}

/** A FrameSource whose generation the caller advances after writing the canvas. */
export interface CanvasFrameSource extends FrameSource {
  /** Increment the generation, notify subscribers, and return the published frame. */
  publish(): FrameId
}

export interface CanvasFrameSourceOptions {
  /** Required because the GPU alpha representation is fixed at first upload. */
  readonly premultiplyAlpha: boolean
}

/**
 * Give a caller-owned canvas stable source and generation identity.
 *
 * Write the complete frame first, then call publish(). The canvas remains
 * owned by the caller; this source adds no DOM lifecycle of its own.
 */
export function createCanvasFrameSource(
  canvas: HTMLCanvasElement,
  options: CanvasFrameSourceOptions,
): CanvasFrameSource {
  const sourceId = allocateSourceId()
  const format: FrameFormat = Object.freeze({
    colorSpace: 'srgb',
    premultiplyAlpha: options.premultiplyAlpha,
  })
  const subscribers = new Set<FrameSourceSubscriber>()
  let frame: FrameId = Object.freeze({ sourceId, generation: 0 })

  const source: CanvasFrameSource = {
    canvas,
    format,
    currentFrame() {
      return frame
    },
    subscribe(notify) {
      subscribers.add(notify)
      return () => {
        subscribers.delete(notify)
      }
    },
    publish() {
      const published = Object.freeze({
        sourceId,
        generation: frame.generation + 1,
      })
      frame = published
      for (const notify of subscribers) notify()
      return published
    },
  }

  return Object.freeze(source)
}
