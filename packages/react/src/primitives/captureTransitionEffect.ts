// Capture transition effect — the canvas side of a capture transition. Provisional:
// its shape may change in any release.
//
// The law: a run captures a copy of the outgoing state and proves its upload.
// The effect copies that frame, and the effect's cover mesh must draw it on
// screen with color before the app's update runs (decisions.md #25, #77). A run
// may then capture the incoming state the same way. Each capture request is
// bounded at CAPTURE_REQUEST_LIMIT_MS; the outgoing request's bound also covers
// the wait for the cover draw. A failed or unsupported capture, a timeout, or a
// disconnected target cancels the run and applies its update once.
//
// The fault: on HTML-in-canvas a paint receipt can arrive before the canvas
// copy completes (decisions.md #60), so a run that copied on the receipt alone
// could copy the previous capture. For such an engine a run waits one more
// frame, and every run proves its upload carried the published paint.
// instruments/paired-capture blocks each upload in turn to check this.
//
// Ownership: the queue (captureTransition.ts) owns order and the queue bound.
// This hook owns the capture phases, their bounds, the upload proof and the
// cover-draw proof. The effect owns admission, snapshots, texture copies,
// drawing and timing.
import { useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { useFrame, useThree } from '@react-three/fiber'
import type { DomPaintReceipt } from '@munari/core'
import type { BufferGeometry, Camera, Material, Scene, Texture, WebGLRenderer } from 'three'
import {
  connectCapture,
  createCapture,
  inspectCapture,
  subscribeCaptureFrames,
  type CaptureConnection,
  type CaptureFrame,
  type CaptureHandle,
} from './capture'
import {
  captureTransitionQueue,
  type CaptureTransition,
  type CaptureTransitionRequest,
} from './captureTransition'
import { useLatest } from './useLatest'

/** One capture request may wait this long for its frame and, outgoing, its cover draw. */
export const CAPTURE_REQUEST_LIMIT_MS = 1000

/** Detached HTML to capture, sized in CSS pixels. The hook adopts and returns it. */
export interface CaptureTransitionSnapshot {
  readonly element: HTMLElement
  readonly size: readonly [number, number]
}

export type CaptureTransitionSide = 'before' | 'after'

/** What an effect returns when it accepts a request. */
export interface CaptureTransitionRun {
  readonly before: CaptureTransitionSnapshot
  /**
   * Builds the incoming snapshot after the update commits. Omit it to skip the
   * incoming capture. A null result ends the run without its effect.
   */
  readonly after?: () => CaptureTransitionSnapshot | null
  /** Copies a borrowed frame. Its texture is reused after this returns. */
  copy(frame: CaptureFrame, side: CaptureTransitionSide): void
  /** Every capture is copied and the update has run. Start the effect's clock. */
  ready(): void
  /** The run ended without its effect. Its update has already run. */
  abort(): void
}

export interface CaptureTransitionEffect<Options> {
  /**
   * Called in a frame for the first waiting request while no capture is
   * pending. Return a run to accept it, `'wait'` to leave it queued, or
   * `'skip'` to apply its update with no effect.
   */
  accept(request: CaptureTransitionRequest<Options>): CaptureTransitionRun | 'wait' | 'skip'
  /** Ends every running effect at once. */
  finish(): void
}

type Renderer = Pick<WebGLRenderer, 'getRenderTarget' | 'info'>
type CoverCallback = (renderer: Renderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material) => void

export interface CaptureTransitionControls {
  /** Spread on the mesh that draws every run. Its color draw to the screen releases the update. */
  readonly cover: { readonly onBeforeRender: CoverCallback; readonly onAfterRender: CoverCallback }
  /** Cancels the run whose capture is pending. Its update applies, and the run aborts. */
  cancel(): void
}

interface Job {
  run: CaptureTransitionRun
  update: () => boolean
}

interface PendingCapture {
  job: Job
  snapshot: CaptureTransitionSnapshot
  phase: 'capture-before' | 'present-before' | 'capture-after'
  target: HTMLElement
  handle: CaptureHandle
  connection: CaptureConnection
  unsubscribe: () => void
  settledSourceId?: number
  timeout: ReturnType<typeof setTimeout>
}

interface PendingSlot {
  current: PendingCapture | null
}

type TextureUploader = { initTexture(texture: Texture): void }

const uploads = new WeakMap<TextureUploader, WeakMap<Texture, { paint: DomPaintReceipt; version: number }>>()

/** Uploads a capture texture now and reports whether the upload carried `paint`. */
function uploadCaptureFrame(texture: Texture, paint: DomPaintReceipt, connection: CaptureConnection, renderer: TextureUploader): boolean {
  let receipts = uploads.get(renderer)
  if (!receipts) {
    receipts = new WeakMap()
    uploads.set(renderer, receipts)
  }
  const receipt = receipts.get(texture)
  if (receipt?.paint === paint && receipt.version === texture.version) return true
  const previous = texture.onUpdate
  let uploaded = false
  texture.onUpdate = (updated) => {
    previous?.(updated)
    uploaded = texture.source.dataReady && connection.currentPaint() === paint
  }
  try {
    texture.needsUpdate = true
    renderer.initTexture(texture)
  } finally {
    texture.onUpdate = previous
  }
  if (uploaded) receipts.set(texture, { paint, version: texture.version })
  return uploaded
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function createRunner<Options>(
  transition: CaptureTransition<Options>,
  effect: { current: CaptureTransitionEffect<Options> },
  invalidate: () => void,
) {
  const queue = transition[captureTransitionQueue]
  const pending: PendingSlot = { current: null }
  let reducedBefore = false

  const clear = () => {
    const current = pending.current
    if (!current) return
    clearTimeout(current.timeout)
    pending.current = null
    current.unsubscribe()
    current.connection.dispose()
  }

  const cancel = () => {
    const current = pending.current
    if (!current) return
    clear()
    if (current.phase !== 'capture-after') flushSync(current.job.update)
    current.job.run.abort()
  }

  const dispose = () => {
    const current = pending.current
    if (!current) return
    clear()
    if (current.phase !== 'capture-after') current.job.update()
  }

  const request = (job: Job, target: HTMLElement, snapshot: CaptureTransitionSnapshot, phase: PendingCapture['phase']) => {
    const handle = createCapture()
    let connection: CaptureConnection
    try {
      connection = connectCapture(handle, snapshot.element, snapshot.size)
    } catch (error) {
      queueMicrotask(() => reportError(error))
      if (phase !== 'capture-after') flushSync(job.update)
      job.run.abort()
      return
    }
    const current: PendingCapture = {
      job, snapshot, phase, target, handle, connection,
      unsubscribe: subscribeCaptureFrames(handle, invalidate),
      timeout: setTimeout(() => {
        if (pending.current === current) cancel()
      }, CAPTURE_REQUEST_LIMIT_MS),
    }
    pending.current = current
    invalidate()
  }

  const admit = () => {
    const waiting = queue.peek()
    if (!waiting) return
    if (!waiting.target.isConnected) {
      queue.take()
      flushSync(waiting.update)
      invalidate()
      return
    }
    const decision = effect.current.accept({ target: waiting.target, options: waiting.options })
    if (decision === 'wait') return
    queue.take()
    if (decision === 'skip') {
      flushSync(waiting.update)
      invalidate()
      return
    }
    request({ run: decision, update: waiting.update }, waiting.target, decision.before, 'capture-before')
  }

  const read = (renderer: TextureUploader) => {
    const current = pending.current
    if (!current || current.phase === 'present-before') return
    const { status, frame } = inspectCapture(current.handle)
    if (status.status === 'error' || status.status === 'unsupported') {
      queueMicrotask(() => {
        if (pending.current === current) cancel()
      })
      return
    }
    const source = current.snapshot
    const matches = frame !== null && frame.width === source.size[0] && frame.height === source.size[1]
    if (!matches) return
    const paint = current.connection.currentPaint()
    const samePaint = paint !== null && paint.frame.sourceId === frame.sourceId &&
      paint.frame.generation === frame.generation
    if (samePaint && current.connection.drawTrailsPaint() && current.settledSourceId !== frame.sourceId) {
      current.settledSourceId = frame.sourceId
      invalidate()
      return
    }
    if (!samePaint || !uploadCaptureFrame(frame.texture, paint, current.connection, renderer)) {
      invalidate()
      return
    }
    const incoming = current.phase === 'capture-after'
    current.job.run.copy(frame, incoming ? 'after' : 'before')
    if (incoming) {
      clear()
      current.job.run.ready()
    } else {
      current.phase = 'present-before'
    }
  }

  const presented = () => {
    const current = pending.current
    if (current?.phase !== 'present-before') return
    queueMicrotask(() => {
      if (pending.current !== current || current.phase !== 'present-before') return
      current.phase = 'capture-after'
      const applied = flushSync(current.job.update)
      if (pending.current !== current) return
      if (!applied) {
        clear()
        current.job.run.abort()
        return
      }
      const after = current.job.run.after
      const incoming = after?.()
      clear()
      if (incoming) request(current.job, current.target, incoming, 'capture-after')
      else if (after) current.job.run.abort()
      else current.job.run.ready()
    })
  }

  const frame = (renderer: TextureUploader) => {
    const reduced = prefersReducedMotion()
    const startedReducing = reduced && !reducedBefore
    reducedBefore = reduced
    if (reduced && (startedReducing || pending.current || queue.peek())) {
      queue.finish()
      return
    }
    const current = pending.current
    if (current && !current.target.isConnected) cancel()
    if (!pending.current) admit()
    read(renderer)
    if (pending.current || queue.peek()) invalidate()
  }

  // A draw counts only when it reached the screen with color writes on and drew
  // triangles (decisions.md #25). Three runs these callbacks for color-disabled
  // passes and render targets too.
  let began: { calls: number; triangles: number } | null = null
  const cover = {
    onBeforeRender: ((renderer, scene, _camera, _geometry, material) => {
      began = renderer.getRenderTarget() === null && !scene.overrideMaterial && material.colorWrite
        ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
        : null
    }) satisfies CoverCallback,
    onAfterRender: ((renderer, _scene, _camera, _geometry, material) => {
      const draw = began
      began = null
      const { calls, triangles } = renderer.info.render
      if (draw && calls === draw.calls && triangles > draw.triangles &&
        renderer.getRenderTarget() === null && material.colorWrite) presented()
    }) satisfies CoverCallback,
  }

  const connect = () => queue.connect({
    wake: invalidate,
    finish: () => {
      cancel()
      effect.current.finish()
      invalidate()
    },
    dispose,
  })

  return { connect, frame, cover, cancel }
}

/**
 * Draws a capture transition. Provisional: its shape may change in any
 * release. Call it in the effect component inside a `SurfaceCanvas`, and
 * spread `cover` on the mesh that draws every run. The cover-draw check reads
 * `WebGPURenderer`'s draw counters, which a plain `WebGLRenderer` counts
 * differently, so under another canvas every run times out and applies its
 * update with no effect.
 */
export function useCaptureTransitionEffect<Options>(
  transition: CaptureTransition<Options>,
  effect: CaptureTransitionEffect<Options>,
): CaptureTransitionControls {
  const invalidate = useThree(state => state.invalidate)
  const gl = useThree(state => state.gl)
  const effectRef = useLatest(effect)
  const [runner] = useState(() => createRunner(transition, effectRef, invalidate))
  useLayoutEffect(() => {
    gl.domElement.dataset.apiCaptureConsumer = ''
  }, [gl])
  useLayoutEffect(() => runner.connect(), [runner])
  useFrame(() => runner.frame(gl))
  return runner
}

