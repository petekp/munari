// @vitest-environment happy-dom
//
// The DOM-walking half of tabbables.ts: pins the CANDIDATES walk against a
// real document. happy-dom models Chrome's IDL `tabIndex` quirk for
// contenteditable (a bare `<div contenteditable>` with no explicit `tabindex`
// reports an IDL `tabIndex` of -1, exactly as Chrome does — even though
// Chrome places it in the real Tab order); the walk's `effectiveTabIndex`
// transcribes `tabbable`'s `getTabIndex` to lift that element to 0. happy-dom
// has no layout engine, so `getClientRects()` returns a non-empty list for
// every live element by default; the zero-rects arm of the walk (display:none
// somewhere above, closed <details> content) is exercised by stubbing
// `getClientRects` per element with a genuine empty `DOMRectList`, the same
// seam the conformance suite uses for happy-dom's missing layout (decisions.md
// #2).
//
// The pure ordering + radio-collapse rules stay in tabbables.test.ts under the
// node environment — these are the halves that don't need a DOM.

import { describe, expect, it } from 'vitest'
import { effectiveTabIndex, tabbables } from './tabbables'

/** A root with `html` parsed in, appended to the document so the elements
 *  are connected (contenteditable reflection and `:disabled` rely on a live
 *  document). */
function root(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  return el
}

/** happy-dom has no layout: `getClientRects()` returns length 1 for every
 *  element. A real empty DOMRectList (a collapsed Range's client rects)
 *  models the zero rects Chrome yields for an element under display:none, a
 *  closed <details>, etc. — the walk's visibility gate. Stubbing on the
 *  instance keeps the override local to one element. */
function hideViaZeroRects(el: HTMLElement): void {
  const emptyRects = document.createRange().getClientRects()
  Object.defineProperty(el, 'getClientRects', {
    value: () => emptyRects,
    configurable: true,
  })
}

describe('effectiveTabIndex — transcribes tabbable getTabIndex', () => {
  it('returns the IDL tabIndex for a normal tab stop (button → 0)', () => {
    const btn = document.createElement('button')
    expect(effectiveTabIndex(btn)).toBe(0)
  })

  it('returns an explicit positive tabindex verbatim', () => {
    const div = document.createElement('div')
    div.setAttribute('tabindex', '3')
    expect(effectiveTabIndex(div)).toBe(3)
  })

  it('lifts a bare contenteditable="true" (no explicit tabindex) to 0 — THE FIX', () => {
    // Chrome (and happy-dom) report IDL -1 for a contenteditable with no
    // tabindex, yet it is a real tab stop. tabbable treats this as 0; so
    // does effectiveTabIndex.
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'true')
    expect(effectiveTabIndex(ce)).toBe(0)
  })

  it('lifts the empty-string contenteditable="" form to 0 (the true state per the HTML microsyntax)', () => {
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', '')
    expect(effectiveTabIndex(ce)).toBe(0)
  })

  it('respects an explicit tabindex=0 on a contenteditable', () => {
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'true')
    ce.setAttribute('tabindex', '0')
    expect(effectiveTabIndex(ce)).toBe(0)
  })

  it('keeps an explicit tabindex=-1 on a contenteditable as a genuine removal (-1)', () => {
    // The attribute check is what separates a real [tabindex="-1"] removal
    // from the contenteditable default — the rescue must NOT fire here.
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'true')
    ce.setAttribute('tabindex', '-1')
    expect(effectiveTabIndex(ce)).toBe(-1)
  })

  it('does not rescue a non-contenteditable [tabindex="-1"] container (-1)', () => {
    const proxy = document.createElement('div')
    proxy.setAttribute('tabindex', '-1')
    expect(effectiveTabIndex(proxy)).toBe(-1)
  })

  it('lifts <audio controls>, <video controls>, <details> without an explicit tabindex to 0 (parity with tabbable)', () => {
    // Surface markup bans these forms (docs/focus.md "Surface markup
    // rules"), but effectiveTabIndex matches tabbable's full rule for
    // parity — the same IDL quirk Chrome applies to them.
    const audio = document.createElement('audio')
    audio.setAttribute('controls', '')
    const video = document.createElement('video')
    video.setAttribute('controls', '')
    const details = document.createElement('details')
    expect(effectiveTabIndex(audio)).toBe(0)
    expect(effectiveTabIndex(video)).toBe(0)
    expect(effectiveTabIndex(details)).toBe(0)
  })

  it('keeps an explicit tabindex=-1 on audio/video/details as a genuine removal (-1)', () => {
    const audio = document.createElement('audio')
    audio.setAttribute('controls', '')
    audio.setAttribute('tabindex', '-1')
    expect(effectiveTabIndex(audio)).toBe(-1)
  })

  it('does not rescue contenteditable="false" (not editable; the selector filters it anyway)', () => {
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'false')
    expect(effectiveTabIndex(ce)).toBe(-1)
  })
})

describe('tabbables(root) — the contenteditable IDL quirk (the cited bug)', () => {
  it('a subtree whose only candidate is a contenteditable returns it (the shipping lab notes panel)', () => {
    // Reproduces apps/lab/src/scenes/workspace/workspaceContent.ts: the
    // panel's only interior control is a contenteditable. Before the fix,
    // `tabbables(root)` was `[]`, which broke Enter-descend (interiorFirst
    // null → focus stays on the unit root) and Tab-ring closure
    // (interiorBoundary always 'native').
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'true')
    const r = document.createElement('div')
    r.append(ce)
    document.body.append(r)
    expect(tabbables(r)).toHaveLength(1)
    expect(tabbables(r)[0]).toBe(ce)
  })

  it('drops a contenteditable with an explicit tabindex=-1 (genuine removal preserved)', () => {
    const r = root('<div contenteditable="true" tabindex="-1"></div>')
    expect(tabbables(r)).toEqual([])
  })

  it('still drops a non-contenteditable [tabindex="-1"] unit container (no regression on the gate)', () => {
    // A Surface's unit root carries tabindex="-1" so it can be focused by
    // script only; it must stay out of the interior walk.
    const r = root('<div tabindex="-1"></div>')
    expect(tabbables(r)).toEqual([])
  })

  it('orders a contenteditable + button + input in document order (the tabindex-0 crowd, stable)', () => {
    const r = root(`
      <div contenteditable="true">ce</div>
      <button>btn</button>
      <input>`)
    const ce = r.querySelector<HTMLElement>('[contenteditable]')!
    const btn = r.querySelector('button')!
    const input = r.querySelector('input')!
    const seq = tabbables(r)
    expect(seq).toHaveLength(3)
    expect(seq[0]).toBe(ce)
    expect(seq[1]).toBe(btn)
    expect(seq[2]).toBe(input)
  })

  it('puts an explicit positive tabindex ahead of a contenteditable (positive-first rule)', () => {
    // sortByTabOrder bins the positive tabindex first (ascending), then the
    // tabindex-0 crowd (the contenteditable) in document order.
    const r = root(`
      <div contenteditable="true">ce</div>
      <div tabindex="2">pos</div>`)
    const ce = r.querySelector<HTMLElement>('[contenteditable]')!
    const pos = r.querySelector('[tabindex="2"]')!
    const seq = tabbables(r)
    expect(seq).toHaveLength(2)
    expect(seq[0]).toBe(pos)
    expect(seq[1]).toBe(ce)
  })
})

describe('tabbables(root) — non-regression on the existing walk rules', () => {
  it('includes input, button, textarea, a[href], and [tabindex=0]', () => {
    const r = root(`
      <input>
      <button>btn</button>
      <textarea></textarea>
      <a href="#">link</a>
      <div tabindex="0">div</div>`)
    expect(tabbables(r)).toHaveLength(5)
  })

  it('sorts explicit positive tabindexes first ascending, then tabindex-0 in document order', () => {
    const r = root(`
      <button>zero</button>
      <div tabindex="1">one</div>
      <div tabindex="2">two</div>`)
    expect(tabbables(r).map((e) => e.textContent)).toEqual(['one', 'two', 'zero'])
  })

  it('excludes a hidden input (type="hidden")', () => {
    const r = root('<input type="hidden"><button>go</button>')
    expect(tabbables(r)).toHaveLength(1)
    expect(tabbables(r)[0]?.tagName).toBe('BUTTON')
  })

  it('excludes a directly-disabled button', () => {
    // happy-dom does not model fieldset-disabled propagation; the walk's
    // `:disabled` selector is exercised here on a directly-disabled element.
    const r = root('<button disabled>no</button><button>yes</button>')
    expect(tabbables(r)).toHaveLength(1)
    expect(tabbables(r)[0]?.textContent).toBe('yes')
  })

  it('collapses a checked radio group to the checked member', () => {
    const r = root(`
      <input type="radio" name="g" value="a">
      <input type="radio" name="g" value="b" checked>
      <input type="radio" name="g" value="c">`)
    expect(tabbables(r)).toHaveLength(1)
    expect(tabbables(r)[0]?.getAttribute('value')).toBe('b')
  })

  it('leaves every member a stop when no radio is checked (native Chrome)', () => {
    const r = root(`
      <input type="radio" name="g" value="a">
      <input type="radio" name="g" value="b">`)
    expect(tabbables(r)).toHaveLength(2)
  })

  it('a bare <details> (no summary) is rescued as a tab stop via the DETAILS arm (parity with tabbable)', () => {
    // Surface markup makes <summary> the stop, not <details>, so this form is
    // banned from conforming markup (docs/focus.md "Surface markup rules");
    // effectiveTabIndex still rescues <details> for parity with `tabbable`'s
    // getTabIndex (same IDL -1 quirk as contenteditable). happy-dom reports
    // details.tabIndex === -1, so the rescue IS exercised here.
    const r = root('<details><p>body</p></details>')
    expect(tabbables(r)).toHaveLength(1)
    expect(tabbables(r)[0]?.tagName).toBe('DETAILS')
  })

  it('a <details> with a <summary>: the walk drops the details (yields to the summary)', () => {
    // The designated-<summary> IDL tabIndex quirk (Chrome reports 0 for a
    // designated summary; happy-dom reports -1) is a happy-dom gap the
    // platform probes verify in real Chrome, not something this fix targets
    // — `tabbable` rescues AUDIO/VIDEO/DETAILS/contentEditable but NOT
    // SUMMARY, because Chrome's IDL is already 0 for designated summaries.
    // Here we pin only the half happy-dom models: the <details> itself is
    // dropped when a summary is present, so it never competes with the
    // summary for the stop.
    const r = root('<details><summary>x</summary><p>body</p></details>')
    const seq = tabbables(r)
    expect(seq.find((e) => e.tagName === 'DETAILS')).toBeUndefined()
  })
})

describe('tabbables(root) — zero client rects = not tabbable', () => {
  it('drops an input whose getClientRects is empty (display:none analog)', () => {
    // Guards the visibility gate against accidental removal — unchanged by
    // the fix, but load-bearing for boundary interception.
    const r = root('<input>')
    const input = r.querySelector('input')!
    hideViaZeroRects(input)
    expect(tabbables(r)).toEqual([])
  })

  it('drops a contenteditable whose getClientRects is empty (the gate applies equally to the rescued element)', () => {
    const r = root('<div contenteditable="true">ce</div>')
    const ce = r.querySelector<HTMLElement>('[contenteditable]')!
    hideViaZeroRects(ce)
    expect(tabbables(r)).toEqual([])
  })
})
