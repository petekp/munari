// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  createSurfaceFocusLedger,
  surfaceFocusKey,
  surfaceFocusTarget,
  transferSurfaceFocus,
} from './surfaceFocus'

/** Two copies of the same markup, as a Surface renders them. */
function copy(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe('naming an element across two copies', () => {
  it('names it by its structural position', () => {
    const page = copy('<p>a</p><div><button>go</button></div>')
    const source = copy('<p>a</p><div><button>go</button></div>')
    const key = surfaceFocusKey(page, page.querySelector('button')!)
    expect(key).toBe('1.0')
    expect(surfaceFocusTarget(source, key!)).toBe(source.querySelector('button'))
  })

  it('anchors to an authored key so the copies need not agree above it', () => {
    const page = copy('<div><span data-munari-focus="dial"><i>x</i></span></div>')
    // The source copy wraps the dial one level deeper: the structural path
    // differs, the authored key does not.
    const source = copy('<div><div><span data-munari-focus="dial"><i>x</i></span></div></div>')
    const key = surfaceFocusKey(page, page.querySelector('i')!)
    expect(key).toBe('@dial/0')
    expect(surfaceFocusTarget(source, key!)).toBe(source.querySelector('i'))
  })

  it('refuses an element that is not in the copy at all', () => {
    const page = copy('<button>go</button>')
    expect(surfaceFocusKey(page, document.body)).toBeNull()
  })

  it('answers null when the other copy has no such element', () => {
    const source = copy('<p>a</p>')
    expect(surfaceFocusTarget(source, '4.2')).toBeNull()
    expect(surfaceFocusTarget(source, '@dial')).toBeNull()
  })
})

describe('moving focus when the hold moves', () => {
  it('lands on the matching element in the other copy', () => {
    const page = copy('<div><button data-page>go</button></div>')
    const source = copy('<div><button data-source>go</button></div>')
    page.querySelector('button')!.focus()
    const landed = transferSurfaceFocus(page, source)
    expect(landed).toBe(source.querySelector('button'))
    expect(document.activeElement).toBe(source.querySelector('button'))
  })

  it('carries the caret with it', () => {
    const page = copy('<input value="munari" />')
    const source = copy('<input value="munari" />')
    const input = page.querySelector('input')!
    input.focus()
    input.setSelectionRange(2, 5)
    transferSurfaceFocus(page, source)
    const landed = source.querySelector('input')!
    expect([landed.selectionStart, landed.selectionEnd]).toEqual([2, 5])
  })

  // The fault this exists for: `inert` on the released copy blurs it, and a
  // transfer that found no match would leave focus on <body> — no ring, and
  // the next Tab restarts at the top of the document.
  it('never leaves focus on the body when the copies disagree', () => {
    const page = copy('<button>go</button>')
    const source = copy('<p>no controls here</p>')
    page.querySelector('button')!.focus()
    expect(transferSurfaceFocus(page, source)).toBe(source)
    expect(document.activeElement).toBe(source)
  })

  it('does nothing when the copy losing the hold never had focus', () => {
    const page = copy('<button>go</button>')
    const source = copy('<button>go</button>')
    document.body.focus()
    expect(transferSurfaceFocus(page, source)).toBeNull()
  })
})

describe('one logical focus over two copies', () => {
  it('reports focus arriving once', async () => {
    const notify = vi.fn()
    const ledger = createSurfaceFocusLedger(notify)
    ledger.report('page', true)
    await Promise.resolve()
    expect(notify.mock.calls).toEqual([[true]])
  })

  // A transfer is a focusout immediately followed by a focusin. A consumer
  // that saw the pair would close its editor between them.
  it('does not report a blur that a transfer immediately answers', async () => {
    const notify = vi.fn()
    const ledger = createSurfaceFocusLedger(notify)
    ledger.report('page', true)
    await Promise.resolve()
    notify.mockClear()
    ledger.report('page', false)
    ledger.report('source', true)
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()
    expect(ledger.focused()).toBe(true)
  })

  it('reports the blur when focus really left both copies', async () => {
    const notify = vi.fn()
    const ledger = createSurfaceFocusLedger(notify)
    ledger.report('source', true)
    await Promise.resolve()
    ledger.report('source', false)
    await Promise.resolve()
    expect(notify.mock.calls).toEqual([[true], [false]])
  })

  it('says nothing after it is disposed', async () => {
    const notify = vi.fn()
    const ledger = createSurfaceFocusLedger(notify)
    ledger.report('page', true)
    ledger.dispose()
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()
  })
})
