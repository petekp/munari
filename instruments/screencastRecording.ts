// Screencast recording — encoded images and page-frame evidence for one attempt.
// A stopped recording owns every delivered image through the stop response.
// Hosted gaps measured 2026-09-28 reached 35.8 ms while every page frame was
// recorded; acquisition timing cannot replace frame identity (decisions.md #2).
// The recorder owns recording transport and decoding; gates own scene judgments.
import { CDPSession, type FlattenHandle, type Frame, type JSHandle, type Page, type Protocol } from 'puppeteer-core'
import { installScreencastClock } from './screencastCoverage.ts'

export type ScreencastEncoding = 'png' | 'jpeg'
export type ScreencastOptions = Protocol.Page.StartScreencastRequest & { format: ScreencastEncoding }

export interface EncodedScreencastFrame {
  readonly index: number
  readonly t: number
  readonly data: string
}

export interface ScreencastCapture {
  readonly encoding: ScreencastEncoding
  readonly frames: readonly EncodedScreencastFrame[]
  readonly collectionEnd: {
    readonly requested: number
    readonly reached: boolean
    readonly timedOut: boolean
  }
  readonly diagnostics: {
    readonly received: number
    readonly acknowledged: number
    readonly pendingAcknowledgements: number
    readonly sessionId: string
  }
}

export interface StopScreencastOptions {
  through: number
  timeoutMs: number
}

export interface ScreencastRecorder {
  start(): Promise<void>
  stop(options: StopScreencastOptions): Promise<ScreencastCapture>
  dispose(): Promise<void>
}

export interface DecodedImage {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
}

export interface RecordedFrameMetadata {
  index: number
  t: number
  pageFrame: number | null
}

export interface BrowserScorer<Metrics, Summary> {
  inspect(image: DecodedImage, frame: RecordedFrameMetadata): Metrics | null
  summarize(): Summary
}

export type CreateScorer<Context, Metrics, Summary> = (
  referenceImage: DecodedImage | null,
  context: FlattenHandle<Context>,
) => BrowserScorer<Metrics, Summary>

export type ScreencastReference =
  | { kind: 'recorded'; index: number }
  | { kind: 'image'; encoding: ScreencastEncoding; data: string }

export interface ScoreScreencastOptions<Context, Metrics, Summary> {
  reference?: ScreencastReference | null
  selectedIndices?: readonly number[]
  context: Context
  createScorer: CreateScorer<Context, Metrics, Summary>
}

export interface ScoredScreencastRow<Metrics> extends RecordedFrameMetadata {
  value: Metrics | null
}

export interface ScoredScreencast<Metrics, Summary> {
  rows: readonly ScoredScreencastRow<Metrics>[]
  summary: Summary
  diagnostics: {
    batchSizes: readonly number[]
    payloadBytes: readonly number[]
    decodedImages: number
    referenceDecoded: boolean
  }
}

interface Failure {
  cause: unknown
}

interface EndpointWaiter {
  through: number
  timer: ReturnType<typeof setTimeout>
  settle(timedOut: boolean): void
}

interface RecordingCycle {
  client: CDPSession
  frames: EncodedScreencastFrame[]
  pending: Set<Promise<void>>
  received: number
  acknowledged: number
  failure: Failure | null
  endpoint: EndpointWaiter | null
  onFrame(frame: Protocol.Page.ScreencastFrameEvent): void
  onNavigation(frame: Frame): void
  onClose(): void
}

function finishCleanup(failure: Failure | null, cleanupErrors: readonly unknown[]): void {
  if (cleanupErrors.length > 0) {
    const errors = failure === null ? [...cleanupErrors] : [failure.cause, ...cleanupErrors]
    const cause = failure === null ? cleanupErrors[0] : failure.cause
    const descriptions = cleanupErrors.map(error => String(error)).join('; ')
    const message = failure === null ? `Cleanup failed: ${descriptions}` : `${String(cause)}; cleanup failed: ${descriptions}`
    throw new AggregateError(errors, message, { cause })
  }
  if (failure !== null) throw failure.cause
}

async function releaseHandle<T>(handle: JSHandle<T>): Promise<void> {
  let failure: Failure | null = null
  try {
    const objectId = handle.remoteObject().objectId
    if (objectId !== undefined) {
      if (!('client' in handle) || !(handle.client instanceof CDPSession)) {
        throw new Error('The screencast handle has no owning Chrome protocol session')
      }
      // Puppeteer suppresses remote release errors; cleanup needs Chrome's response.
      await handle.client.send('Runtime.releaseObject', { objectId })
    }
  } catch (cause) {
    failure = { cause }
  }
  const cleanupErrors: unknown[] = []
  try { await handle.dispose() } catch (error) { cleanupErrors.push(error) }
  finishCleanup(failure, cleanupErrors)
}

function validateFrames(frames: readonly EncodedScreencastFrame[]): void {
  const indices = new Set<number>()
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    if (!Number.isInteger(frame.index) || frame.index < 0 || indices.has(frame.index)) {
      throw new Error('Recorded images need unique nonnegative original indices')
    }
    indices.add(frame.index)
    if (!Number.isFinite(frame.t) || (i > 0 && frame.t <= frames[i - 1]!.t)) {
      throw new Error('Screencast timestamps must increase')
    }
  }
}

function encodedPayloadBytes(frames: readonly EncodedScreencastFrame[]): number {
  return frames.reduce((bytes, frame) => bytes + Buffer.byteLength(frame.data), 0)
}

export async function createScreencastRecorder(page: Page, captureOptions: ScreencastOptions): Promise<ScreencastRecorder> {
  const recordingOptions = Object.freeze({ ...captureOptions })
  if (recordingOptions.format !== 'png' && recordingOptions.format !== 'jpeg') throw new Error('Screencast encoding must be PNG or JPEG')
  const clock = await page.evaluateHandle(installScreencastClock)
  let state: 'idle' | 'recording' | 'stopping' | 'disposed' = 'idle'
  let cycle: RecordingCycle | null = null
  let startPromise: Promise<void> | null = null
  let stopPromise: Promise<ScreencastCapture> | null = null
  let disposePromise: Promise<void> | null = null
  let disposing = false
  let unusable = false

  const verifyClock = async () => {
    await clock.evaluate(scope => {
      if (window.__screencastClock !== scope) throw new Error('The recording lost its owned page clock')
    })
  }

  const failCycle = (current: RecordingCycle, cause: unknown) => {
    current.failure ??= { cause }
    current.endpoint?.settle(false)
  }

  const releaseCycle = async (current: RecordingCycle): Promise<unknown[]> => {
    const cleanupErrors: unknown[] = []
    current.endpoint?.settle(false)
    while (current.pending.size > 0) await Promise.all([...current.pending])
    try { current.client.off('Page.screencastFrame', current.onFrame) } catch (error) { cleanupErrors.push(error) }
    try { page.off('framenavigated', current.onNavigation) } catch (error) { cleanupErrors.push(error) }
    try { page.off('close', current.onClose) } catch (error) { cleanupErrors.push(error) }
    if (!current.client.detached) {
      try {
        await current.client.detach()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    return cleanupErrors
  }

  const begin = async () => {
    let allocated: RecordingCycle | null = null
    try {
      await verifyClock()
      const client = await page.createCDPSession()
      const current: RecordingCycle = {
        client,
        frames: [],
        pending: new Set(),
        received: 0,
        acknowledged: 0,
        failure: null,
        endpoint: null,
        onFrame(frame) {
          current.received++
          const timestamp = frame.metadata.timestamp ?? Number.NaN
          const t = timestamp * 1000
          if (!Number.isFinite(timestamp) || !Number.isFinite(t) || !frame.data.length || frame.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(frame.data)) {
            failCycle(current, new Error('Chrome delivered invalid screencast image metadata'))
          } else {
            current.frames.push(Object.freeze({ index: current.received - 1, t, data: frame.data }))
            if (current.endpoint !== null && t >= current.endpoint.through) current.endpoint.settle(false)
          }
          if (!Number.isInteger(frame.sessionId) || frame.sessionId < 0) {
            failCycle(current, new Error('Chrome delivered an invalid screencast acknowledgement ID'))
            return
          }
          const pending = client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).then(
            () => { current.acknowledged++ },
            cause => { failCycle(current, cause) },
          )
          current.pending.add(pending)
          void pending.then(() => current.pending.delete(pending))
        },
        onNavigation(frame) {
          if (frame === page.mainFrame()) failCycle(current, new Error('The page navigated during screencast recording'))
        },
        onClose() { failCycle(current, new Error('The page closed during screencast recording')) },
      }
      allocated = current
      cycle = current
      client.on('Page.screencastFrame', current.onFrame)
      page.on('framenavigated', current.onNavigation)
      page.on('close', current.onClose)
      await client.send('Page.startScreencast', recordingOptions)
      if (current.failure !== null) throw current.failure.cause
    } catch (cause) {
      const cleanupErrors: unknown[] = []
      if (allocated !== null) {
        // A rejected start response does not prove Chrome never began recording.
        if (!allocated.client.detached) {
          try { await allocated.client.send('Page.stopScreencast') } catch (error) { cleanupErrors.push(error) }
        }
        cleanupErrors.push(...await releaseCycle(allocated))
      }
      cycle = null
      state = 'idle'
      unusable = cleanupErrors.length > 0
      finishCleanup({ cause }, cleanupErrors)
    }
  }

  const waitThrough = (current: RecordingCycle, options: StopScreencastOptions): Promise<boolean> => {
    if (current.failure !== null || current.frames.some(frame => frame.t >= options.through)) return Promise.resolve(false)
    return new Promise(resolve => {
      const timer = setTimeout(() => current.endpoint?.settle(true), options.timeoutMs)
      const waiter: EndpointWaiter = {
        through: options.through,
        timer,
        settle(timedOut) {
          if (current.endpoint !== waiter) return
          clearTimeout(timer)
          current.endpoint = null
          resolve(timedOut)
        },
      }
      current.endpoint = waiter
    })
  }

  const end = async (current: RecordingCycle, options: StopScreencastOptions): Promise<ScreencastCapture> => {
    const timedOut = await waitThrough(current, options)
    let failure = current.failure
    const cleanupErrors: unknown[] = []
    try {
      await current.client.send('Page.stopScreencast')
    } catch (cause) {
      if (failure === null) failure = { cause }
      else cleanupErrors.push(cause)
    }
    if (failure === null) {
      try { await verifyClock() } catch (cause) { failure = { cause } }
    }
    cleanupErrors.push(...await releaseCycle(current))
    failure ??= current.failure
    cycle = null
    state = 'idle'
    unusable = failure !== null || cleanupErrors.length > 0
    finishCleanup(failure, cleanupErrors)
    const frames = Object.freeze([...current.frames].sort((left, right) => left.t - right.t))
    try { validateFrames(frames) } catch (cause) { unusable = true; throw cause }
    return Object.freeze({
      encoding: recordingOptions.format,
      frames,
      collectionEnd: Object.freeze({ requested: options.through, reached: frames.some(frame => frame.t >= options.through), timedOut }),
      diagnostics: Object.freeze({
        received: current.received,
        acknowledged: current.acknowledged,
        pendingAcknowledgements: current.pending.size,
        sessionId: current.client.id(),
      }),
    })
  }

  const dispose = async () => {
    disposing = true
    const cleanupErrors: unknown[] = []
    if (startPromise !== null) {
      try { await startPromise } catch { /* The start caller owns its initiating failure. */ }
    }
    if (state === 'stopping' && stopPromise !== null) {
      try { await stopPromise } catch (error) { cleanupErrors.push(error) }
    } else if (cycle !== null) {
      const current = cycle
      const failureBeforeStop = current.failure
      if (failureBeforeStop !== null) cleanupErrors.push(failureBeforeStop.cause)
      try { await current.client.send('Page.stopScreencast') } catch (error) { cleanupErrors.push(error) }
      cleanupErrors.push(...await releaseCycle(current))
      // An acknowledgement can reject while the stopped stream is being drained.
      if (current.failure !== null && current.failure !== failureBeforeStop) cleanupErrors.push(current.failure.cause)
      cycle = null
    }
    try { await clock.evaluate(scope => scope.dispose()) } catch (error) { cleanupErrors.push(error) }
    try { await releaseHandle(clock) } catch (error) { cleanupErrors.push(error) }
    state = 'disposed'
    finishCleanup(null, cleanupErrors)
  }

  return {
    async start() {
      if (disposing || state !== 'idle' || unusable) throw new Error(`Cannot start a ${unusable ? 'failed' : state} screencast recorder`)
      state = 'recording'
      startPromise = begin()
      try { await startPromise } finally { startPromise = null }
    },
    async stop(options) {
      if (disposing || state !== 'recording' || cycle === null || startPromise !== null || unusable) {
        throw new Error(`Cannot stop a ${unusable ? 'failed' : state} screencast recorder`)
      }
      if (!Number.isFinite(options.through) || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error('Invalid screencast collection endpoint or timeout')
      }
      state = 'stopping'
      stopPromise = end(cycle, options)
      try { return await stopPromise } finally { stopPromise = null }
    },
    dispose() {
      disposePromise ??= dispose()
      return disposePromise
    },
  }
}

interface BrowserDecoder {
  decode(data: string, encoding: ScreencastEncoding): Promise<DecodedImage>
  pageFrame(image: DecodedImage): number | null
}

function createBrowserDecoder(): BrowserDecoder {
  return {
    async decode(data, encoding) {
      const image = new Image()
      image.src = `data:image/${encoding};base64,${data}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx || canvas.width === 0 || canvas.height === 0) throw new Error('A screencast image could not be decoded')
      ctx.drawImage(image, 0, 0)
      return { ctx, width: image.width, height: image.height }
    },
    pageFrame(image) {
      const scope = window.__screencastClock
      if (!scope) throw new Error('The screencast image has no owned page clock decoder')
      return scope.read(image.ctx, image.width / window.innerWidth, image.height / window.innerHeight)
    },
  }
}

export async function scoreScreencast<Context, Metrics, Summary>(
  page: Page,
  capture: ScreencastCapture,
  options: ScoreScreencastOptions<Context, Metrics, Summary>,
): Promise<ScoredScreencast<Metrics, Summary>> {
  validateFrames(capture.frames)
  const selection = options.selectedIndices === undefined ? null : new Set(options.selectedIndices)
  if (selection !== null) {
    if (selection.size !== options.selectedIndices?.length) throw new Error('Screencast selection repeats an original index')
    const known = new Set(capture.frames.map(frame => frame.index))
    if ([...selection].some(index => !known.has(index))) throw new Error('Screencast selection contains an unknown original index')
  }
  const frames = selection === null ? capture.frames : capture.frames.filter(frame => selection.has(frame.index))
  const reference = options.reference
  let referenceSource: { encoding: ScreencastEncoding; data: string } | null = null
  if (reference?.kind === 'recorded') {
    const frame = capture.frames.find(frame => frame.index === reference.index)
    if (!frame) throw new Error('Screencast reference names an unknown original index')
    referenceSource = { encoding: capture.encoding, data: frame.data }
  } else if (reference?.kind === 'image') {
    referenceSource = reference
  }
  let decoder: JSHandle<BrowserDecoder> | null = null
  let referenceImage: JSHandle<DecodedImage> | null = null
  let scorer: JSHandle<BrowserScorer<Metrics, Summary>> | null = null
  let failure: Failure | null = null
  let result: ScoredScreencast<Metrics, Summary> | null = null
  try {
    const browserDecoder = await page.evaluateHandle(createBrowserDecoder)
    decoder = browserDecoder
    if (referenceSource !== null) {
      referenceImage = await browserDecoder.evaluateHandle((worker, source) => worker.decode(source.data, source.encoding), referenceSource)
    }
    const browserScorer = await page.evaluateHandle(options.createScorer, referenceImage, options.context)
    scorer = browserScorer
    const rows: ScoredScreencastRow<Metrics>[] = []
    const batchSizes: number[] = []
    const payloadBytes: number[] = []
    // Eight images preserve the bounded full-viewport payload in decisions.md #2.
    for (let offset = 0; offset < frames.length; offset += 8) {
      const batch = frames.slice(offset, offset + 8)
      const scored = await page.evaluate(async (worker, judge, images, encoding) => {
        const observed: ScoredScreencastRow<Metrics>[] = []
        for (const frame of images) {
          const image = await worker.decode(frame.data, encoding)
          const metadata = Object.freeze({ index: frame.index, t: frame.t, pageFrame: worker.pageFrame(image) })
          const value = judge.inspect(image, metadata)
          observed.push({ ...metadata, value })
        }
        return observed
      }, browserDecoder, browserScorer, batch, capture.encoding)
      rows.push(...scored)
      batchSizes.push(batch.length)
      payloadBytes.push(encodedPayloadBytes(batch))
    }
    const summary = await browserScorer.evaluate(judge => judge.summarize())
    result = { rows, summary, diagnostics: { batchSizes, payloadBytes, decodedImages: rows.length + (referenceImage === null ? 0 : 1), referenceDecoded: referenceImage !== null } }
  } catch (cause) {
    failure = { cause }
  }
  const cleanupErrors: unknown[] = []
  for (const handle of [scorer, referenceImage, decoder]) {
    if (handle === null) continue
    try { await releaseHandle<BrowserScorer<Metrics, Summary> | DecodedImage | BrowserDecoder>(handle) } catch (error) { cleanupErrors.push(error) }
  }
  finishCleanup(failure, cleanupErrors)
  if (result === null) throw new Error('Screencast scoring produced no result')
  return result
}
