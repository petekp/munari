// @vitest-environment happy-dom
// Tab traversal follows native editing hosts; Chrome separately proves the
// IDL -1/native-tab-stop case. Layout boxes below stand in for visible DOM.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveTabIndex, radioIsStop, sortByTabOrder, tabbables } from './tabbables'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('native editing hosts', () => {
  function subtree(html: string) {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    const box = new DOMRect(0, 0, 100, 30)
    const boxes: DOMRectList = { 0: box, length: 1, item: index => index === 0 ? box : null, [Symbol.iterator]: () => [box].values() }
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(boxes)
    return root
  }

  it('includes a native editor whose IDL tabIndex is negative', () => {
    const root = subtree('<button>before</button><div contenteditable="true">notes</div><button>after</button>')
    const editor = root.querySelector<HTMLElement>('[contenteditable]')!
    expect(editor.tabIndex).toBe(-1)
    expect(effectiveTabIndex(editor)).toBe(0)
    expect(tabbables(root)).toEqual([...root.children])
  })

  it('preserves explicit negative tabindex for traversal and focus recall', () => {
    const root = subtree('<div contenteditable="true" tabindex="-1">notes</div>')
    const editor = root.firstElementChild!
    expect(editor).toBeInstanceOf(HTMLElement)
    if (!(editor instanceof HTMLElement)) throw new Error('Missing editor')
    expect(effectiveTabIndex(editor)).toBe(-1)
    expect(tabbables(root)).toEqual([])
  })

  it('excludes nested editors unless tabindex opts them into the sequence', () => {
    const root = subtree('<div id="outer" contenteditable="true"><div contenteditable="true">nested</div><div id="opted-in" contenteditable="true" tabindex="0">nested stop</div></div>')
    expect(tabbables(root).map(element => element.id)).toEqual(['outer', 'opted-in'])
  })

  it('recognizes a new editing host inside a noneditable island', () => {
    const root = subtree('<div id="outer" contenteditable="true"><div contenteditable="false"><div id="inner" contenteditable="plaintext-only">editable again</div></div></div>')
    expect(tabbables(root).map(element => element.id)).toEqual(['outer', 'inner'])
  })
})

describe('sortByTabOrder', () => {
  const e = (tabIndex: number, seq: number) => ({ tabIndex, seq })

  it('orders positive indexes first and preserves document order among equal indexes', () => {
    const sorted = sortByTabOrder([e(0, 7), e(2, 3), e(1, 5), e(1, 1), e(0, 0)])
    expect(sorted.map((x) => x.seq)).toEqual([1, 5, 3, 0, 7])
  })
})

describe('radioIsStop', () => {
  const radios = (...checked: boolean[]) => checked.map((c) => ({ checked: c }))

  it('collapses a group with a checked member to just that member', () => {
    const group = radios(false, true, false)
    expect(group.map((_, i) => radioIsStop(group, i))).toEqual([false, true, false])
  })

  it('leaves every member a stop when none is checked (native Chrome)', () => {
    const group = radios(false, false, false)
    expect(group.map((_, i) => radioIsStop(group, i))).toEqual([true, true, true])
  })

})
