// Screencast coverage bounds the interval a visual assertion can describe.
// A missing frame is missing evidence, even when the recorded pictures agree.
export interface TimedFrame {
  t: number
}

export class IncompleteScreencastError extends Error {
  override name = 'IncompleteScreencastError'
}

// Chrome need not send unchanged frames. A marker outside the sampled region
// makes quiet intervals observable without changing the content under test.
//
// A second strip writes the page's animation-frame number into pixels, so each
// recorded image names the page frame it shows. Both run inside the page:
// this function is serialized, and must not read module scope.
export function installScreencastClock(): void {
  const marker = document.createElement('div')
  marker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;z-index:2147483647;pointer-events:none'
  document.body.append(marker)
  marker.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, iterations: Infinity })

  const cell = 4
  const left = 2
  const top = 10
  const preamble = [1, 0, 1, 0, 1, 1, 0, 0]
  const checksum = (frame: number) => (frame ^ (frame >>> 8) ^ (frame >>> 16) ^ 165) & 255
  const strip = document.createElement('canvas')
  strip.width = 40 * cell
  strip.height = cell
  strip.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${strip.width}px;height:${cell}px;z-index:2147483647;pointer-events:none`
  document.body.append(strip)
  const ink = strip.getContext('2d')
  if (!ink) throw new Error('The screencast clock needs a 2D context')
  const times: number[] = []
  let frame = 0
  const tick = () => {
    frame = (frame + 1) & 0xffffff
    times[frame] = performance.timeOrigin + performance.now()
    const bits = [...preamble]
    for (let i = 0; i < 24; i++) bits.push((frame >>> i) & 1)
    const check = checksum(frame)
    for (let i = 0; i < 8; i++) bits.push((check >>> i) & 1)
    bits.forEach((bit, i) => {
      ink.fillStyle = bit ? '#fff' : '#000'
      ink.fillRect(i * cell, 0, cell, cell)
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

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
  Object.defineProperty(window, '__screencastClock', { value: { times, read } })
}

export function requireScreencastCoverage(
  frames: readonly TimedFrame[],
  start: number,
  end: number,
  maximumGap: number,
): void {
  if (![start, end, maximumGap].every(Number.isFinite) || end <= start || maximumGap <= 0) {
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
  let largestGap = 0
  for (let i = first + 1; i <= last; i++) {
    largestGap = Math.max(largestGap, frames[i]!.t - frames[i - 1]!.t)
  }
  if (largestGap > maximumGap) {
    throw new IncompleteScreencastError(`Screencast gap ${largestGap.toFixed(1)}ms exceeds ${maximumGap}ms; visual result is unverified`)
  }
}
