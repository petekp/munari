// @vitest-environment happy-dom
// What a handoff carries when the browser cannot move a node in place.
//
// The fallback is invisible when it breaks: the content arrives, looks right,
// and has quietly lost the caret the reader was typing into. Safari is the
// browser that takes this path (platform.md #29), so nothing in a Chrome run
// would catch a regression here.

import { afterEach, describe, expect, it } from 'vitest'
import { moveRetained } from './retainedMove'

const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore')

afterEach(() => {
  if (descriptor) Object.defineProperty(Element.prototype, 'moveBefore', descriptor)
  else Reflect.deleteProperty(Element.prototype, 'moveBefore')
  document.body.replaceChildren()
})

function rig() {
  const home = document.createElement('div')
  const away = document.createElement('div')
  const content = document.createElement('div')
  content.innerHTML = '<input><div class="scroller"></div>'
  home.append(content)
  document.body.append(home, away)
  return { home, away, content }
}

describe('a retained move', () => {
  it('carries focus, selection and scroll where the node cannot move in place', () => {
    Reflect.deleteProperty(Element.prototype, 'moveBefore')
    const { away, content } = rig()
    const field = content.querySelector('input')!
    const scroller = content.querySelector('.scroller')!
    field.value = 'typed here'
    field.focus()
    field.setSelectionRange(2, 6)
    scroller.scrollTop = 120

    moveRetained(content, away)

    expect(content.parentElement).toBe(away)
    expect(field.value).toBe('typed here')
    expect(document.activeElement).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6])
    expect(scroller.scrollTop).toBe(120)
  })

  it('leaves focus alone when nothing inside the moved content held it', () => {
    Reflect.deleteProperty(Element.prototype, 'moveBefore')
    const { away, content } = rig()
    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()

    moveRetained(content, away)

    // Restoring focus unconditionally would steal it from the page.
    expect(document.activeElement).toBe(outside)
  })

  it('moves the node in place when the browser can', () => {
    const moved: Element[] = []
    Object.defineProperty(Element.prototype, 'moveBefore', {
      configurable: true,
      value(this: Element, node: Node, before: Node | null) {
        moved.push(this)
        this.insertBefore(node, before)
      },
    })
    const { away, content } = rig()

    moveRetained(content, away)

    expect(moved).toEqual([away])
    expect(content.parentElement).toBe(away)
  })
})
