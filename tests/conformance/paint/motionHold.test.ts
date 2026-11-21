// @vitest-environment happy-dom
// matchMotion copies numeric timeline times while ignoring non-mutable ScrollTimeline
// percentage values that throw on assignment in Chromium.

import { describe, expect, it } from 'vitest'
import { matchMotion } from '@munari/core'

interface ScrollProgressStub {
  readonly unit: string
  readonly value: number
}

describe('matchMotion scroll-driven timeline safety', () => {
  it('skips non-numeric CSSNumericValue currentTime without throwing', () => {
    const from = document.createElement('div')
    const to = document.createElement('div')

    const scrollProgress: ScrollProgressStub = { unit: 'percent', value: 50 }
    Object.defineProperty(from, 'getAnimations', {
      value: () => [
        {
          animationName: 'parallax',
          playState: 'running',
          currentTime: scrollProgress,
        },
        {
          animationName: 'pulse',
          playState: 'paused',
          currentTime: 420,
        },
      ],
    })

    let pulseTime: number | null = 0
    let pulsePaused = false
    Object.defineProperty(to, 'getAnimations', {
      value: () => [
        {
          animationName: 'parallax',
          playState: 'running',
          get currentTime(): ScrollProgressStub {
            return scrollProgress
          },
          set currentTime(_next: ScrollProgressStub) {
            throw new TypeError('ScrollTimeline currentTime is read-only')
          },
          pause() {},
        },
        {
          animationName: 'pulse',
          playState: 'running',
          get currentTime() {
            return pulseTime
          },
          set currentTime(next: number | null) {
            pulseTime = next
          },
          pause() {
            pulsePaused = true
          },
        },
      ],
    })

    expect(() => matchMotion(from, to)).not.toThrow()
    expect(pulseTime).toBe(420)
    expect(pulsePaused).toBe(true)
  })
})
