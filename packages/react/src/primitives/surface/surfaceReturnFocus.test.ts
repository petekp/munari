// @vitest-environment happy-dom
//
// The return edge of an exclusive Surface handoff. Focus that left the page
// copy when the Surface lifted to WebGL must land back on the matching
// element in the page copy when it lands — not stay stranded in the parked,
// off-screen capture copy where the release edge parked it.
//
// Why it can strand: the page copy is released by `inert` AND
// `visibility: hidden`, and `focus()` inside either is a silent spec no-op
// (HTML §6.7.2). The release edge (page → WebGL) moves focus OUT before the
// page is inerted, which is the order `inert` is designed for. The return
// edge (WebGL → page) is the mirror: the page must be CLEARED before focus
// moves INTO it. `<Surface.DOM>` keeps a per-edge hold listener order so
// release remains "transfer then inert" while return becomes "clear then
// transfer".
//
// Why the listeners are wired by hand: the production subscription order is
// set by React's effect scheduler — the focus-transfer listener is
// subscribed from a layout effect in the source host, the page-holder
// listener (apply, plus this fix's early-clear) from effects in
// `<Surface.DOM>`. happy-dom's scheduler does not reproduce the production
// order (the layout-effect `setPageRoot` re-render is not flushed before the
// passive phase the way it is in a real browser), so a mounted round trip
// here does not strand focus. Wiring the listeners by hand against the real
// store and the real `transferSurfaceFocus` — in the production order the
// bug report establishes for a real browser — makes the per-edge rule itself
// provable without depending on that scheduler. The control test reverses
// to the old single-order wiring to show the same logic strands focus
// without the per-edge split.
//
// No JSX here: the runner only discovers `.test.ts`.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSurfaceStore, type SurfaceStore } from './surfaceHandle'
import { SurfaceSourceHost } from './surfaceSourceHost'
import { SurfaceDOM } from './SurfaceDOM'
import { DEFAULT_PART, SurfaceRootContext, type SurfaceRootValue } from './surfaceContext'
import { transferSurfaceFocus } from './surfaceFocus'

// React reads this global to decide whether renders must be wrapped in
// `act`. It is React's own contract, not ours, so it is declared rather
// than asserted onto globalThis at the point of use.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

// The one spec sentence happy-dom omits: `focus()` is a no-op on an element
// inside an `inert` subtree, or one not being rendered (`visibility: hidden`
// on an ancestor the target does not itself override). happy-dom reflects
// `inert` and inline `visibility` but does not enforce the no-op, so the
// stranding is invisible without it. Models exactly that rule and nothing
// more.
let originalFocus: typeof HTMLElement.prototype.focus
function installSpecFocus() {
  originalFocus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    let node: Element | null = this
    while (node instanceof HTMLElement) {
      if (node.inert) return
      const visibility = node.style.visibility
      // The nearest explicit visibility wins; a descendant that sets
      // `visible` overrides a hidden ancestor.
      if (visibility === 'hidden') return
      if (visibility === 'visible') break
      node = node.parentElement
    }
    return originalFocus.call(this, options)
  }
}
function restoreSpecFocus() {
  HTMLElement.prototype.focus = originalFocus
}

afterEach(restoreSpecFocus)

// Two DOM copies of the same single-button markup, as a Surface renders
// them, so the focus key names the same element in both.
function copies() {
  const pageRoot = document.createElement('div')
  const pageButton = document.createElement('button')
  pageRoot.append(pageButton)
  document.body.append(pageRoot)
  const captureRoot = document.createElement('div')
  const captureButton = document.createElement('button')
  captureRoot.append(captureButton)
  document.body.append(captureRoot)
  return { pageRoot, pageButton, captureRoot, captureButton }
}

// The store an exclusive Surface stands on, armed the way
// `surfaceHandle.test.ts` arms one for a round trip.
function exclusive(): SurfaceStore {
  const store = createSurfaceStore('panel')
  store.acquire(1)
  store.setExclusive(true)
  store.registerPresenter('a')
  return store
}

// The exact round trip `surfaceHandle.test.ts` uses for an exclusive
// Surface: a warm-up proof opens the lift gate, the color-writing `present`
// releases the page, and the long `tick` home takes the hold back.
function roundTrip(store: SurfaceStore) {
  store.prove('a', store.readinessLifetime(), store.epoch())
  store.request('webgl')
  store.tick(500)
  store.present('a', store.epoch())
  store.request('dom')
  store.tick(5000)
}

describe('an exclusive round trip through the mounted components', () => {
  // A real component mount, driving the real store and the real
  // `transferSurfaceFocus` through `<SurfaceSourceHost>` + `<Surface.DOM>`.
  // happy-dom's effect scheduler does not reproduce the production
  // subscription order (the layout-effect `setPageRoot` re-render is not
  // flushed before the passive phase the way it is in a real browser), so the
  // stranding itself is reproducible only in the hand-wired crux below. What
  // this mount guards is the production code path: the fix's early-clear must
  // not break the release edge (focus still escapes before the page is
  // inerted) and must still land focus on the page copy after the return.
  let reactContainer: HTMLDivElement
  let reactRoot: ReturnType<typeof createRoot> | null
  let unpresent: (() => void) | null

  beforeEach(() => {
    reactContainer = document.createElement('div')
    document.body.append(reactContainer)
    reactRoot = null
    unpresent = null
  })

  afterEach(() => {
    unpresent?.()
    if (reactRoot) flushSync(() => reactRoot!.unmount())
    reactContainer.remove()
  })

  function mount() {
    const store = createSurfaceStore('panel')
    store.acquire(1)
    store.setExclusive(true)
    // happy-dom has no drawElementImage, so the source runtime throws on
    // mount; silence the platform error so the test log stays honest.
    store.setCallbacks({ onError: () => {} })
    const root: SurfaceRootValue = {
      store,
      handle: store.handle,
      host: null,
      canvas: undefined,
      name: store.name,
      instanceId: 'surface-return-focus',
      wiring: 'page',
      exclusive: true,
      reportMeasuredSize: () => {},
      measuredSize: () => null,
      partRuntime: () => null,
    }
    // The capture copy: an element the host adopts. The runtime would park
    // it in a real browser; here the platform gate throws before it moves,
    // so it stays where the test puts it.
    const captureRoot = document.createElement('div')
    const captureButton = document.createElement('button')
    captureRoot.append(captureButton)
    document.body.append(captureRoot)

    reactRoot = createRoot(reactContainer)
    flushSync(() => {
      reactRoot!.render(
        createElement(
          SurfaceRootContext.Provider,
          { value: root },
          createElement(
            SurfaceSourceHost,
            { root, id: DEFAULT_PART, adopt: captureRoot },
            // The page copy: <Surface.DOM> with the same single button, so
            // the focus key names the same element in both copies.
            createElement(SurfaceDOM, null, createElement('button', null, 'go')),
          ),
        ),
      )
    })
    // Arm the readiness the way a <Surface.WebGL> would, so the releasing
    // `present` is not refused at the part or readiness gate.
    unpresent = store.registerPartPresenter(DEFAULT_PART)
    store.registerPresenter('a')

    const pageButton = reactContainer.querySelector('button')!
    const pageRoot = pageButton.parentElement!
    return { store, pageRoot, pageButton, captureButton }
  }

  it('carries focus from page to capture and back across the round trip', () => {
    installSpecFocus()
    const { store, pageRoot, pageButton, captureButton } = mount()

    // A keyboard user had focus inside the page copy when it lifted.
    pageButton.focus()
    expect(document.activeElement).toBe(pageButton)

    // RELEASE: focus escapes the page before it is inerted.
    store.prove('a', store.readinessLifetime(), store.epoch())
    store.request('webgl')
    store.tick(500)
    store.present('a', store.epoch())
    expect(store.holdsPage()).toBe(false)
    expect(pageRoot.inert).toBe(true)
    expect(pageRoot.style.visibility).toBe('hidden')
    // Focus escaped to the capture copy — NOT left on <body>, which is what
    // inerting the page before the transfer would produce.
    expect(document.activeElement).toBe(captureButton)
    expect(document.activeElement).not.toBe(document.body)

    // RETURN: focus lands back on the page copy.
    store.request('dom')
    store.tick(5000)
    expect(store.holdsPage()).toBe(true)
    expect(pageRoot.inert).toBe(false)
    expect(pageRoot.style.visibility).toBe('')
    expect(document.activeElement).toBe(pageButton)
  })
})

describe('the return edge of an exclusive Surface handoff', () => {
  it('clears the page before focus moves into it (the per-edge order this fix ships)', () => {
    installSpecFocus()
    const store = exclusive()
    const { pageRoot, pageButton, captureRoot, captureButton } = copies()

    const events: string[] = []
    const inertAtTransfer: boolean[] = []

    // The three hold listeners, subscribed in the production order this
    // module ships:
    //   1) the early-clear, from a layout effect in <Surface.DOM> — fires
    //      first on every hold. Return edge only; on the release edge it is
    //      a no-op and the apply below inerts the page after the transfer.
    const unsubscribeClear = store.subscribeHold(() => {
      events.push('clear')
      if (!store.holdsPage()) return
      pageRoot.style.visibility = ''
      pageRoot.inert = false
      pageRoot.removeAttribute('aria-hidden')
    })
    //   2) the focus-transfer listener, from a layout effect in the source
    //      host. `inertAtTransfer` snapshots the page holder's state at the
    //      moment focus is about to move.
    let held = store.holdsPage()
    const unsubscribeTransfer = store.subscribeHold(() => {
      events.push('transfer')
      const next = store.holdsPage()
      if (next === held) return
      held = next
      inertAtTransfer.push(pageRoot.inert)
      transferSurfaceFocus(next ? captureRoot : pageRoot, next ? pageRoot : captureRoot)
    })
    //   3) the passive `apply` from <Surface.DOM>, subscribed after the
    //      layout-effect listeners and so firing last on every hold.
    const unsubscribeApply = store.subscribeHold(() => {
      events.push('apply')
      const released = !store.holdsPage()
      pageRoot.style.visibility = released ? 'hidden' : ''
      pageRoot.inert = released
      if (released) pageRoot.setAttribute('aria-hidden', 'true')
      else pageRoot.removeAttribute('aria-hidden')
    })

    // A keyboard user had focus inside the page copy when it lifted.
    pageButton.focus()
    expect(document.activeElement).toBe(pageButton)

    roundTrip(store)

    // Release: clear (no-op) → transfer (focus out, page still clear) →
    //   apply (inerts the page). Return: clear (releases the page) →
    //   transfer (focus into a clear page, lands) → apply (no-op clear).
    expect(events).toEqual(['clear', 'transfer', 'apply', 'clear', 'transfer', 'apply'])
    // The page holder is clear at the moment the transfer runs on BOTH
    // edges — false on release because apply has not inerted yet, false on
    // return because the early-clear just released it.
    expect(inertAtTransfer).toEqual([false, false])
    expect(pageRoot.inert).toBe(false)
    expect(pageRoot.style.visibility).toBe('')
    // Focus landed on the page copy — not stranded in the capture copy.
    expect(document.activeElement).toBe(pageButton)
    expect(document.activeElement).not.toBe(captureButton)

    unsubscribeClear()
    unsubscribeTransfer()
    unsubscribeApply()
  })
})
