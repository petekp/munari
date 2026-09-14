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
export function installScreencastClock(): void {
  const marker = document.createElement('div')
  marker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;z-index:2147483647;pointer-events:none'
  document.body.append(marker)
  marker.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, iterations: Infinity })
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
