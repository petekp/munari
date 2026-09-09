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

  it('keeps document order for the tabindex-0 crowd', () => {
    expect(sortByTabOrder([e(0, 0), e(0, 1), e(0, 2)]).map((x) => x.seq)).toEqual([0, 1, 2])
  })

  it('puts positive tabindexes first, ascending', () => {
    const sorted = sortByTabOrder([e(0, 0), e(2, 1), e(1, 2), e(0, 3)])
    expect(sorted.map((x) => x.seq)).toEqual([2, 1, 0, 3])
  })

  it('breaks positive-tabindex ties by document order (stable)', () => {
    const sorted = sortByTabOrder([e(1, 0), e(1, 1), e(1, 2)])
    expect(sorted.map((x) => x.seq)).toEqual([0, 1, 2])
  })

  it('treats negative tabIndex as ordinary flow (filtering happened upstream)', () => {
    // tabbables() never passes negatives in; if a caller does, they sort
    // with the zero crowd rather than exploding.
    expect(sortByTabOrder([e(-1, 0), e(0, 1)]).map((x) => x.seq)).toEqual([0, 1])
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

  it('first checked wins if markup illegally checks two', () => {
    const group = radios(false, true, true)
    expect(group.map((_, i) => radioIsStop(group, i))).toEqual([false, true, false])
  })
})
