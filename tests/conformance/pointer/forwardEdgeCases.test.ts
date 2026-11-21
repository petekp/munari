// @vitest-environment happy-dom
// Pointer relay resilience across window blur, Surface-to-Surface-to-empty exits,
// disabled form controls, and non-editable contenteditable attributes.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPointerState,
  forwardPointer,
  HOVER_ATTR,
  nudgeSelect,
  trackDrag,
  type ForwardPointerSample,
} from '@munari/core'

function box(el: Element, left: number, top: number, right: number, bottom: number) {
  const rect = new DOMRect(left, top, right - left, bottom - top)
  el.getBoundingClientRect = () => rect
}

const sample = (overrides: Partial<ForwardPointerSample> = {}): ForwardPointerSample => ({
  pointerId: 1,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 0,
  pressure: 0,
  width: 1,
  height: 1,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...overrides,
})

describe('forwardEvents edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('unwedges deferred hover clears when the window blurs mid-press', async () => {
    const stopDrag = trackDrag()
    const root = document.createElement('div')
    const button = document.createElement('button')
    root.append(button)
    document.body.append(root)
    box(root, 0, 0, 100, 100)
    box(button, 10, 10, 90, 90)

    try {
      forwardPointer(root, 0.5, 0.5, 'down', sample({ buttons: 1, pressure: 0.5 }))
      clearPointerState(root)
      // Deferred while drag is active.
      expect(button.hasAttribute(HOVER_ATTR)).toBe(true)

      window.dispatchEvent(new Event('blur'))
      await Promise.resolve()
      expect(button.hasAttribute(HOVER_ATTR)).toBe(false)
    } finally {
      stopDrag()
    }
  })

  it('clears lastForward when the destination Surface also departs so earlier away-moves aim off-surface', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })

    const surfaceA = document.createElement('div')
    const btnA = document.createElement('button')
    surfaceA.append(btnA)
    const surfaceB = document.createElement('div')
    const btnB = document.createElement('button')
    surfaceB.append(btnB)
    document.body.append(surfaceA, surfaceB)
    box(surfaceA, 0, 0, 100, 100)
    box(btnA, 0, 0, 100, 100)
    box(surfaceB, 200, 200, 300, 300)
    box(btnB, 200, 200, 300, 300)

    const awayPositionsOnA: Array<[number, number]> = []
    surfaceA.addEventListener('pointermove', (event) => {
      awayPositionsOnA.push([event.clientX, event.clientY])
    })

    // Enter A, cross to B (A begins 3-frame departure), then immediately leave B for empty space.
    forwardPointer(surfaceA, 0.5, 0.5, 'move')
    awayPositionsOnA.length = 0
    forwardPointer(surfaceB, 0.5, 0.5, 'move')
    clearPointerState(surfaceA)
    clearPointerState(surfaceB)

    const firstStepForA = frames[0]
    expect(firstStepForA).toBeDefined()
    firstStepForA!(16)
    expect(awayPositionsOnA[0]?.[0]).toBeLessThan(0)
    expect(awayPositionsOnA[0]?.[1]).toBeLessThan(0)
  })

  it('skips disabled options and refuses disabled or empty <select> elements in nudgeSelect', () => {
    const disabledSelect = document.createElement('select')
    disabledSelect.disabled = true
    disabledSelect.innerHTML = '<option>a</option><option>b</option>'
    let changes = 0
    disabledSelect.addEventListener('change', () => changes++)
    nudgeSelect(disabledSelect)
    expect(disabledSelect.selectedIndex).toBe(0)
    expect(changes).toBe(0)

    const emptySelect = document.createElement('select')
    emptySelect.addEventListener('change', () => changes++)
    nudgeSelect(emptySelect)
    expect(changes).toBe(0)

    const withDisabledOption = document.createElement('select')
    withDisabledOption.innerHTML = '<option>first</option><option disabled>second</option><option>third</option>'
    withDisabledOption.addEventListener('change', () => changes++)
    nudgeSelect(withDisabledOption)
    expect(withDisabledOption.selectedIndex).toBe(2)
    expect(changes).toBe(1)
  })

  it('blurs an active input when clicking a disabled button or contenteditable="false" block', () => {
    const root = document.createElement('div')
    const input = document.createElement('input')
    const disabledBtn = document.createElement('button')
    disabledBtn.disabled = true
    const nonEditable = document.createElement('div')
    nonEditable.setAttribute('contenteditable', 'false')
    root.append(input, disabledBtn, nonEditable)
    document.body.append(root)
    box(root, 0, 0, 100, 300)
    box(input, 0, 0, 100, 80)
    box(disabledBtn, 0, 100, 100, 180)
    box(nonEditable, 0, 200, 100, 280)

    input.focus()
    expect(document.activeElement).toBe(input)
    forwardPointer(root, 0.5, 0.5, 'down', sample({ buttons: 1, pressure: 0.5 }))
    forwardPointer(root, 0.5, 0.5, 'up', sample({ buttons: 0 }))
    expect(document.activeElement).not.toBe(input)

    input.focus()
    expect(document.activeElement).toBe(input)
    forwardPointer(root, 0.5, 0.15, 'down', sample({ buttons: 1, pressure: 0.5 }))
    forwardPointer(root, 0.5, 0.15, 'up', sample({ buttons: 0 }))
    expect(document.activeElement).not.toBe(input)
  })
})
