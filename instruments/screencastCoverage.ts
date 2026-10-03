// Screencast coverage — which page frames a recording shows.
//
// The law: a visual verdict covers an interval only when every frame the page
// produced in it appears in at least one recorded image. A page frame nobody
// recorded is missing evidence, even when the recorded pictures agree.
//
// The fault, measured 2026-09-28: coverage was a 20 ms limit on the time
// between recorded images. On hosted Ubuntu runners all 18 restore recordings
// showed every page frame, and the limit refused 14 of them for gaps of
// 20.0-35.8 ms. The page made 5-7 frames in 150 ms while the recorder sent an
// image about every 17 ms, so the gaps were recorder jitter (decisions.md #2).
//
// Limit: a change the compositor makes between page frames, such as an
// animated transform, is judged only in the images that happen to show it.
export interface RecordedFrame {
  t: number
  /** The page frame this image shows, or null when the strip was unreadable. */
  pageFrame: number | null
}

export class IncompleteScreencastError extends Error {
  override name = 'IncompleteScreencastError'
}

export interface ScreencastClockScope {
  read(context: CanvasRenderingContext2D, scaleX: number, scaleY: number): number | null
  dispose(): void
}

declare global {
  interface Window {
    __screencastClock?: ScreencastClockScope
  }
}

// Chrome need not send unchanged frames. A marker outside the sampled region
// makes quiet intervals observable without changing the content under test.
//
// A second strip writes the page's animation-frame number into pixels, so each
// recorded image names the page frame it shows. Both run inside the page:
// this function is serialized, and must not read module scope.
export function installScreencastClock(): ScreencastClockScope {
  if (Object.hasOwn(window, '__screencastClock')) throw new Error('A screencast clock already owns this page')
  const marker = document.createElement('div')
  marker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;z-index:2147483647;pointer-events:none'
  marker.dataset.screencastClock = 'marker'
  let animation: Animation | null = null
  let callback = 0
  let disposed = false

  const cell = 4
  const left = 2
  const top = 10
  const preamble = [1, 0, 1, 0, 1, 1, 0, 0]
  const checksum = (frame: number) => (frame ^ (frame >>> 8) ^ (frame >>> 16) ^ 165) & 255
  const strip = document.createElement('canvas')
  strip.width = 40 * cell
  strip.height = cell
  strip.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${strip.width}px;height:${cell}px;z-index:2147483647;pointer-events:none`
  strip.dataset.screencastClock = 'strip'
  const ink = strip.getContext('2d')
  if (!ink) throw new Error('The screencast clock needs a 2D context')
  let frame = 0
  const tick = () => {
    if (disposed) return
    frame = (frame + 1) & 0xffffff
    const bits = [...preamble]
    for (let i = 0; i < 24; i++) bits.push((frame >>> i) & 1)
    const check = checksum(frame)
    for (let i = 0; i < 8; i++) bits.push((check >>> i) & 1)
    bits.forEach((bit, i) => {
      ink.fillStyle = bit ? '#fff' : '#000'
      ink.fillRect(i * cell, 0, cell, cell)
    })
    callback = requestAnimationFrame(tick)
  }

  // Returns null for an image recorded before the strip's first frame.
  const read = (context: CanvasRenderingContext2D, scaleX: number, scaleY: number): number | null => {
    const bits: number[] = []
    for (let i = 0; i < 40; i++) {
      const x = Math.round((left + i * cell + cell / 2) * scaleX)
      const y = Math.round((top + cell / 2) * scaleY)
      bits.push(context.getImageData(x, y, 1, 1).data[0]! > 127 ? 1 : 0)
    }
    if (preamble.some((bit, i) => bits[i] !== bit)) return null
    let value = 0
    for (let i = 0; i < 24; i++) value |= bits[i + 8]! << i
    let check = 0
    for (let i = 0; i < 8; i++) check |= bits[i + 32]! << i
    return check === checksum(value) ? value : null
  }
  const scope: ScreencastClockScope = {
    read,
    dispose() {
      if (disposed) return
      disposed = true
      const cleanupErrors: unknown[] = []
      try { cancelAnimationFrame(callback) } catch (error) { cleanupErrors.push(error) }
      try { animation?.cancel() } catch (error) { cleanupErrors.push(error) }
      try { marker.remove() } catch (error) { cleanupErrors.push(error) }
      try { strip.remove() } catch (error) { cleanupErrors.push(error) }
      try {
        if (window.__screencastClock === scope) delete window.__screencastClock
      } catch (error) { cleanupErrors.push(error) }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, `Clock cleanup failed: ${cleanupErrors.map(error => String(error)).join('; ')}`, { cause: cleanupErrors[0] })
      }
    },
  }
  try {
    document.body.append(marker, strip)
    animation = marker.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, iterations: Infinity })
    Object.defineProperty(window, '__screencastClock', { value: scope, configurable: true })
    callback = requestAnimationFrame(tick)
    return scope
  } catch (cause) {
    try {
      scope.dispose()
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], `${String(cause)}; cleanup failed: ${String(cleanupError)}`, { cause })
    }
    throw cause
  }
}

// Missing evidence throws IncompleteScreencastError, which a caller may retry.
// An unreadable or backward page frame is a broken instrument and throws Error.
export function requirePageFrameCoverage(
  frames: readonly RecordedFrame[],
  start: number,
  end: number,
): void {
  if (![start, end].every(Number.isFinite) || end <= start) {
    throw new Error('Invalid screencast observation interval')
  }
  let first = -1
  let last = -1
  for (let i = 0; i < frames.length; i++) {
    const time = frames[i]!.t
    if (!Number.isFinite(time) || (i > 0 && time <= frames[i - 1]!.t)) {
      throw new Error('Screencast timestamps must increase')
    }
    if (time <= start) first = i
    if (time >= end && last < 0) last = i
  }
  if (first < 0 || last < 0) throw new IncompleteScreencastError('Screencast does not cover both ends of the observation')
  let before: number | null = null
  for (let i = first; i <= last; i++) {
    const shown = frames[i]!.pageFrame
    if (shown === null || !Number.isInteger(shown)) throw new Error('A recorded image has no readable page frame')
    if (before !== null) {
      if (shown < before) throw new Error('Recorded page frames must not go backward')
      const skipped = shown - before - 1
      if (skipped > 0) {
        throw new IncompleteScreencastError(`Screencast skipped ${skipped} page frame${skipped === 1 ? '' : 's'} after frame ${before}; visual result is unverified`)
      }
    }
    before = shown
  }
}
