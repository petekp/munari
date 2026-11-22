// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { createInputWindow, PARKED_HOST_ATTRIBUTE } from '@munari/core'

// ── the input window ─────────────────────────────────────────────────────
//
// The law the rasterized engine and element capture both judge by, pinned
// where the engine's laws cannot reach it: what a hearing disowns, and the
// two gesture ends the pointer stream never reports.
describe('the input window', () => {
  it('disowns input a consumer says is another Surface\'s', () => {
    let now = 0
    const window = createInputWindow(() => now)
    const page = document.createElement('div')
    const parked = document.createElement('div')
    parked.setAttribute(PARKED_HOST_ATTRIBUTE, '')
    page.append(parked)
    document.body.append(page)
    const stop = window.hear(page, {
      ignore: (target) => target instanceof Element && target.closest(`[${PARKED_HOST_ATTRIBUTE}]`) !== null,
    })

    parked.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(window.isOpen()).toBe(false)
    // A press on a disowned node begins no gesture, so its moves count for nothing.
    parked.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1 }))
    expect(window.isOpen()).toBe(false)

    page.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(window.isOpen()).toBe(true)
    now += 151
    expect(window.isOpen()).toBe(false)
    stop()
    page.remove()
  })

  it('ends a gesture when a native drag takes over or the window loses focus', () => {
    let now = 0
    const window = createInputWindow(() => now)
    const page = document.createElement('div')
    document.body.append(page)
    const stop = window.hear(page)
    const drags = (pointerId: number) => {
      now += 151
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId }))
      return window.isOpen()
    }

    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    expect(drags(1)).toBe(true)
    document.dispatchEvent(new Event('dragstart', { bubbles: true }))
    expect(drags(1)).toBe(false)

    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }))
    expect(drags(2)).toBe(true)
    globalThis.window.dispatchEvent(new Event('blur'))
    expect(drags(2)).toBe(false)
    stop()
    page.remove()
  })
})
