// The background clock contract — one published second, held on pause.
// Wall time arrives as an argument so these cases pin the arithmetic
// rather than a timer. The browser gate owns the two-renderer evidence.

import { describe, expect, it } from 'vitest'
import { createMarbleBackgroundClock } from './marbleHandBackgroundClock'

describe('the marble background clock', () => {
  it('reports elapsed seconds, and only at a published sample', () => {
    const clock = createMarbleBackgroundClock()
    clock.resume(1000)
    expect(clock.now()).toBe(0)
    expect(clock.sample(2500)).toBeCloseTo(1.5, 10)
    expect(clock.now()).toBeCloseTo(1.5, 10)
    // A later wall time that nobody published must not reach a reader.
    expect(clock.now()).toBeCloseTo(1.5, 10)
    expect(clock.running()).toBe(true)
  })

  it('holds its value while paused and continues without a jump', () => {
    const clock = createMarbleBackgroundClock()
    clock.resume(0)
    clock.sample(4000)
    clock.pause(4000)
    expect(clock.running()).toBe(false)
    expect(clock.sample(9000)).toBeCloseTo(4, 10)
    expect(clock.now()).toBeCloseTo(4, 10)
    // Five paused seconds are not owed back on resume.
    clock.resume(9000)
    expect(clock.sample(9500)).toBeCloseTo(4.5, 10)
  })

  it('ignores a repeated pause or resume', () => {
    const clock = createMarbleBackgroundClock()
    clock.resume(0)
    clock.resume(3000)
    expect(clock.sample(1000)).toBeCloseTo(1, 10)
    clock.pause(1000)
    clock.pause(6000)
    clock.resume(6000)
    expect(clock.sample(7000)).toBeCloseTo(2, 10)
  })

  it('freezes at an exact second and stays there under any wall time', () => {
    const clock = createMarbleBackgroundClock()
    clock.resume(0)
    clock.sample(2000)
    clock.freezeAt(37.5)
    expect(clock.now()).toBe(37.5)
    expect(clock.running()).toBe(false)
    expect(clock.sample(90_000)).toBe(37.5)
    // A resume after a freeze counts from the frozen still, not from zero.
    clock.resume(90_000)
    expect(clock.sample(91_000)).toBeCloseTo(38.5, 10)
  })

  it('hands every published value to a subscriber, current one first', () => {
    const clock = createMarbleBackgroundClock()
    clock.resume(0)
    clock.sample(1000)
    const seen: number[] = []
    const stop = clock.subscribe((seconds) => seen.push(seconds))
    clock.sample(2000)
    clock.pause(3000)
    clock.freezeAt(37.5)
    stop()
    clock.sample(9000)
    expect(seen).toEqual([1, 2, 3, 37.5])
  })

  it('starts held at zero, so a page that never renders reflects a still', () => {
    const clock = createMarbleBackgroundClock()
    expect(clock.running()).toBe(false)
    expect(clock.sample(50_000)).toBe(0)
  })
})
