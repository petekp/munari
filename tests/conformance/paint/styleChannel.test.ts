// @vitest-environment happy-dom
//
// The style bridge's plumbing. happy-dom has no style engine — computed
// custom properties come back empty and CSS.registerProperty doesn't exist —
// so getComputedStyle is stubbed per element and the tests exercise what the
// channel DOES with values: live reads, the transition-bounded rAF sampling
// window, discrete-change coalescing, and teardown. Whether real CSS eases
// the value is the browser's half (verified in a browser probe).

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStyleChannel, ensureChannelRegistered, type StyleChannel } from '@munari/core'

let value = '0'
// Opt-in counter for tests that assert on per-frame read counts (the
// interrupt-deformation tests). Off by default so the value-only suites are
// unaffected. Hurled into the shared `channelEl` stub so it sees real reads.
let computeCalls = 0
let counting = false
function channelEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) => {
    const style = real(target)
    if (target === el) {
      const orig = style.getPropertyValue.bind(style)
      // SAFETY: the channel reads exactly one thing off a computed style —
      // `getPropertyValue` — so the stub carries that method and nothing
      // else. A channel that grew a second reader would fail here loudly.
      return {
        getPropertyValue: (p: string) => {
          if (p === '--depth') {
            if (counting) computeCalls += 1
            return value
          }
          return orig(p)
        },
      } as CSSStyleDeclaration
    }
    return style
  })
  return el
}

const channels: StyleChannel[] = []
function channel(el: HTMLElement) {
  const c = createStyleChannel(el, '--depth')
  channels.push(c)
  return c
}
afterEach(() => {
  while (channels.length) channels.pop()!.dispose()
  vi.restoreAllMocks()
  value = '0'
  computeCalls = 0
  counting = false
  document.body.innerHTML = ''
})

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()))
const transition = (el: HTMLElement, type: string, propertyName = '--depth') => {
  const e = new TransitionEvent(type, { bubbles: true })
  // happy-dom drops `propertyName` from the init, and the channel keys its
  // whole sampling window on that one field.
  Object.defineProperty(e, 'propertyName', { value: propertyName })
  el.dispatchEvent(e)
}

describe('get', () => {
  it('reads the computed value live', () => {
    const el = channelEl()
    const c = channel(el)
    expect(c.get()).toBe(0)
    value = '0.75'
    expect(c.get()).toBe(0.75)
  })

  it('falls back to the initial value when the property is unset', () => {
    const el = channelEl()
    value = ''
    const c = createStyleChannel(el, '--depth', { initialValue: '0.5' })
    channels.push(c)
    expect(c.get()).toBe(0.5)
  })
})

describe('the transition window', () => {
  it('samples per frame between transitionrun and transitionend', () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)

    const frames: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun')
    expect(frames.length).toBe(1)
    value = '0.3'
    frames[0]!(0)
    expect(cb).toHaveBeenCalledWith(0.3)
    value = '0.6'
    frames[1]!(0)
    expect(cb).toHaveBeenCalledWith(0.6)

    transition(el, 'transitionend')
    value = '1'
    frames[2]!(0) // window closed — this frame is the loop noticing
    expect(frames.length).toBe(3)
    raf.mockRestore()
  })

  it('lands the exact final value after the window closes', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    transition(el, 'transitionrun')
    value = '1'
    transition(el, 'transitionend')
    await flush()
    expect(cb).toHaveBeenCalledWith(1)
  })

  it('ignores transitions of other properties', () => {
    const el = channelEl()
    channel(el)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    transition(el, 'transitionrun', 'opacity')
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })
})

describe('the interrupt window', () => {
  // The documented invariant for the ref-count + rAF loop: "overlapping
  // transitions (interrupted + restarted) keep one loop." A `transitioncancel`
  // followed by a `transitionrun` must NOT spawn a second self-perpetuating
  // `tick` on top of the one already pending from the prior run. The harness
  // mirrors `the transition window` — rAF captured into `frames[]` — and adds
  // per-frame `getComputedStyle` read counts to surface a duplicated loop as a
  // measurable quantity, not just a count of pending callbacks.

  it('a single cancel→run interrupt keeps one pending tick loop', () => {
    const el = channelEl()
    channel(el)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun') // live 0→1, start the sampling loop
    expect(frames.length).toBe(1)
    value = '0.25'
    frames[0]!(0) // tick fires (live>0): emit + reschedule
    transition(el, 'transitioncancel') // live 1→0
    transition(el, 'transitionrun') // live 0→1; NO new loop (one already pending)

    // Buggy source receives 3 here: cancel→run re-triggers `if (live === 1)`.
    expect(frames.length).toBe(2)
  })

  it('bounds getComputedStyle reads to 1 per frame across a 60-move drag', () => {
    const el = channelEl()
    counting = true
    channel(el)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun')
    const N = 60
    const perFrame: number[] = []
    for (let i = 0; i < N; i++) {
      value = String(i / 100)
      const pending = frames.splice(0)
      const before = computeCalls
      for (const f of pending) f(0)
      perFrame.push(computeCalls - before)
      transition(el, 'transitioncancel')
      transition(el, 'transitionrun')
    }
    // Buggy: maxPerFrame 60, total 1831, frames.length 61. Fix: 1 / 61 / 1.
    expect(Math.max(...perFrame)).toBe(1)
    expect(computeCalls).toBe(61)
    expect(frames.length).toBe(1)
  })

  it('duplicate loops self-drain to zero once the final transition settles', () => {
    const el = channelEl()
    channel(el)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun')
    const N = 10
    for (let i = 0; i < N; i++) {
      value = String(i / 100)
      const pending = frames.splice(0)
      for (const f of pending) f(0)
      transition(el, 'transitioncancel')
      transition(el, 'transitionrun')
    }
    // Buggy: 11 pending loops. Fix: 1.
    expect(frames.length).toBe(1)

    transition(el, 'transitionend') // live → 0
    const pending = frames.splice(0)
    for (const f of pending) f(0) // one rAF batch collapses the loop
    expect(frames.length).toBe(0)
  })

  it('a cancel that fully drains then a run starts exactly one fresh loop', () => {
    const el = channelEl()
    channel(el)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun')
    transition(el, 'transitioncancel') // live → 0
    const pending = frames.splice(0)
    for (const f of pending) f(0) // tick fires with live<=0: clears loop, no reschedule
    expect(frames.length).toBe(0)

    transition(el, 'transitionrun') // live===0 && !loop → start fresh loop
    expect(frames.length).toBe(1)
    value = '0.5'
    frames[0]!(0) // tick fires: emit + reschedule
    transition(el, 'transitionend')
    const rest = frames.splice(0)
    for (const f of rest) f(0)
    expect(frames.length).toBe(0)
  })

  it('two genuinely overlapping transitions keep one loop and stop only after both end', () => {
    const el = channelEl()
    channel(el)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun') // live 1, loop starts
    transition(el, 'transitionrun') // live 2; second run must NOT start a second loop
    expect(frames.length).toBe(1)

    transition(el, 'transitionend') // live → 1; loop must still be alive
    const pending = frames.splice(0)
    for (const f of pending) f(0)
    expect(frames.length).toBe(1) // tick rescheduled because live > 0

    transition(el, 'transitionend') // live → 0; loop now stops
    const rest = frames.splice(0)
    for (const f of rest) f(0)
    expect(frames.length).toBe(0)
  })

  it('dispose mid-loop halts the tick and clears the loop flag', () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun')
    value = '0.5'
    frames[0]!(0) // tick fires: emit + reschedule (frames has the rescheduled tick)
    expect(cb).toHaveBeenCalledWith(0.5)
    cb.mockClear()

    c.dispose()
    const pending = frames.splice(0)
    for (const f of pending) f(0) // tick short-circuits on `disposed`; clears loop
    expect(cb).not.toHaveBeenCalled()
    expect(frames.length).toBe(0) // no further rAF scheduled
  })
})

describe('discrete changes', () => {
  it('emits once, coalesced, after an attribute change', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    value = '0.4'
    el.setAttribute('data-hover', '')
    el.className = 'lifted'
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(0.4)
  })

  it('does not emit when the value did not move', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    el.setAttribute('data-inert', '')
    await flush()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('teardown', () => {
  it('unsubscribe and dispose both silence the channel', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    const off = c.observe(cb)
    off()
    value = '0.9'
    el.setAttribute('data-x', '')
    await flush()
    expect(cb).not.toHaveBeenCalled()

    const cb2 = vi.fn()
    c.observe(cb2)
    c.dispose()
    value = '0.1'
    el.setAttribute('data-y', '')
    await flush()
    expect(cb2).not.toHaveBeenCalled()
  })
})

describe('registration', () => {
  it('is idempotent and survives a missing CSS.registerProperty', () => {
    // happy-dom has no CSS.registerProperty — must not throw.
    expect(() => {
      ensureChannelRegistered('--depth')
      ensureChannelRegistered('--depth')
    }).not.toThrow()
  })
})
