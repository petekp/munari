// @vitest-environment happy-dom — happy-dom is a root devDependency (decisions.md #2, README.md)
//
// Route parity: two ways in, one story out.
//
// A Surface's parked content can hear the pointer two ways. The relay
// synthesizes the whole interaction; the native route lifts the parked canvas
// over the renderer canvas wearing the presented pose and lets the browser
// hit-test the real child through it. The law that picks between them is
// `pointerRoute.ts`; this file is the other half of that law's contract —
// **whichever route runs, the content is left in the same observable state**.
//
// Why that has to be pinned rather than reasoned about: the routes have almost
// nothing in common mechanically. The relay walks the DOM and dispatches; the
// native route installs four listeners and stamps attributes off events the
// browser produced. A scene never learns which one it got — it writes one set
// of `[data-hover]`/`[data-active]` twins (docs/authoring.md) and reads one
// canvas cursor — so any divergence surfaces as a panel that behaves
// differently under the origin trial than without it, on a machine the author
// does not have.
//
// What each route contributes to a shared assertion is NOT the same, and the
// per-case comments say which half is the library's:
//
//   relay   — everything. The hover chain, the active chain, the cursor, the
//             click, the focus fixup: all `forwardEvents.ts`.
//   native  — the twins and the modality note. The click, the focus, the
//             caret, the selection and the cursor are the browser's, and the
//             library's whole job there is to not interfere.
//
// happy-dom runs event dispatch but no layout and no default actions, so the
// native driver below supplies the browser's own focus-on-press and
// click-after-release, exactly as `box()` supplies the layout. Those stubs are
// the environment, not the subject. The assertions that hold the native
// route's feet to the fire are the negative ones at the bottom: with the rig
// riding, the library dispatches nothing at all.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIVE_ATTR,
  HOVER_ATTR,
  clearPointerState,
  createNativePointerRig,
  createSurfacePose,
  forwardPointer,
  isRelayed,
  nativeRideStyle,
  poseMatrix3d,
  surfaceCursorAt,
  surfacePose,
  trackFocusModality,
  type NativePointerRig,
} from '@munari/core'

// ── the parked rig ────────────────────────────────────────────────────────

const CONTENT_W = 320
const CONTENT_H = 200

/** Every parked source stands at the viewport origin (mapping/parkingCoincidence). */
const ROOT_BOX = [0, 0, CONTENT_W, CONTENT_H] as const
const CARD_BOX = [20, 20, 300, 130] as const
const BUTTON_BOX = [40, 40, 160, 70] as const
const FIELD_BOX = [40, 80, 280, 110] as const
const LOOSE_BOX = [20, 140, 160, 170] as const

let canvas: HTMLCanvasElement
let root: HTMLElement
let card: HTMLElement
let button: HTMLButtonElement
let field: HTMLInputElement
let loose: HTMLButtonElement
/** The renderer canvas — where both routes are required to write the cursor. */
let glCanvas: HTMLCanvasElement
let rig: NativePointerRig | null
let dispatched: string[]
let unlisten: () => void

function box(el: Element, [left, top, right, bottom]: readonly number[]) {
  const rect = new DOMRect(left, top, (right ?? 0) - (left ?? 0), (bottom ?? 0) - (top ?? 0))
  el.getBoundingClientRect = () => rect
}

/** The centre of an element's stubbed box, as a texture uv on the parked root. */
function uvOf(el: Element) {
  const r = el.getBoundingClientRect()
  const x = (r.left + r.right) / 2
  const y = (r.top + r.bottom) / 2
  return { u: x / CONTENT_W, v: 1 - y / CONTENT_H, x, y }
}

function pointerInit(el: Element, overrides: PointerEventInit = {}): PointerEventInit {
  const at = uvOf(el)
  return {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: at.x,
    clientY: at.y,
    ...overrides,
  }
}

/** Every element carrying `attr`, in document order. */
function stamped(attr: string): Element[] {
  return Array.from(root.ownerDocument.querySelectorAll(`[${attr}]`))
}

// ── the two drivers ───────────────────────────────────────────────────────
//
// Each one plays the same gesture through the route that owns it. Nothing
// below reaches past what the presenter itself does: the relay driver's cursor
// write is `SurfaceMesh`'s own line, and the native driver dispatches only
// events a browser dispatches.

interface RouteDriver {
  readonly route: 'relay' | 'native'
  /** The pointer arrives on `el` from off the content. */
  enter: (el: HTMLElement) => void
  /** The pointer moves to `el` from wherever it was inside the content. */
  moveTo: (el: HTMLElement) => void
  /** The pointer leaves the content entirely. */
  leave: () => void
  press: (el: HTMLElement) => void
  release: (el: HTMLElement) => void
  /** The button comes up somewhere off the content. */
  releaseAway: () => void
}

function relayDriver(): RouteDriver {
  const move = (el: HTMLElement, kind: 'move' | 'down' | 'up') => {
    const at = uvOf(el)
    const hit = forwardPointer(root, at.u, at.v, kind)
    glCanvas.style.cursor = hit ? surfaceCursorAt(hit.target) : ''
  }
  return {
    route: 'relay',
    enter: (el) => move(el, 'move'),
    moveTo: (el) => move(el, 'move'),
    leave: () => {
      clearPointerState(root)
      glCanvas.style.cursor = ''
    },
    press: (el) => move(el, 'down'),
    release: (el) => move(el, 'up'),
    releaseAway: () => {
      forwardPointer(root, 0, 0, 'cancel')
      glCanvas.style.cursor = ''
    },
  }
}

/**
 * The browser's side of the native route, played by hand.
 *
 * `focus` and `click` are the browser's default actions on a trusted press and
 * release, which happy-dom does not run. They are here so the shared spec can
 * state one end-state for both routes; the library contributes none of them,
 * which is what the "dispatches nothing of its own" cases below prove.
 */
function nativeDriver(): RouteDriver {
  let over: HTMLElement | null = null
  const send = (el: EventTarget, type: string, init: PointerEventInit) => {
    el.dispatchEvent(new PointerEvent(type, init))
  }
  return {
    route: 'native',
    enter: (el) => {
      send(el, 'pointerover', pointerInit(el))
      over = el
    },
    moveTo: (el) => {
      // A real browser fires out-then-over across a boundary, each carrying
      // the other element as `relatedTarget`.
      if (over) send(over, 'pointerout', pointerInit(over, { relatedTarget: el }))
      send(el, 'pointerover', pointerInit(el, { relatedTarget: over }))
      over = el
    },
    leave: () => {
      if (over) send(over, 'pointerout', pointerInit(over, { relatedTarget: document.body }))
      over = null
    },
    press: (el) => {
      send(el, 'pointerdown', pointerInit(el, { button: 0, buttons: 1, pressure: 0.5 }))
      el.dispatchEvent(new MouseEvent('mousedown', pointerInit(el, { button: 0, buttons: 1 })))
      const focusable = el.closest<HTMLElement>('input, textarea, select, button, [tabindex]')
      if (focusable) focusable.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    },
    release: (el) => {
      send(el, 'pointerup', pointerInit(el))
      el.dispatchEvent(new MouseEvent('mouseup', pointerInit(el)))
      el.dispatchEvent(new MouseEvent('click', pointerInit(el)))
    },
    releaseAway: () => {
      document.dispatchEvent(new PointerEvent('pointerup', pointerInit(document.body)))
    },
  }
}

/** Put the rig on the road, wearing the resting pose. */
function ride() {
  const pose = surfacePose(
    {
      contentWidth: CONTENT_W,
      contentHeight: CONTENT_H,
      mirrorU: false,
      model: [CONTENT_W, 0, 0, 0, 0, CONTENT_H, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      projection: [2 / CONTENT_W, 0, 0, 0, 0, 2 / CONTENT_H, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
      viewportLeft: 0,
      viewportTop: 0,
      viewportWidth: CONTENT_W,
      viewportHeight: CONTENT_H,
    },
    createSurfacePose(),
  )
  const live = createNativePointerRig(canvas, root, glCanvas)
  live.ride(nativeRideStyle(poseMatrix3d(pose, 0, 0), 7))
  return live
}

beforeEach(() => {
  document.body.innerHTML = ''
  dispatched = []

  canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;'
  root = document.createElement('div')
  // As parked by paint/htmlInCanvas: the canvas is `pointer-events: none` and
  // the property inherits, so the parking re-roots the cascade on the child.
  root.style.pointerEvents = 'auto'
  card = document.createElement('div')
  button = document.createElement('button')
  button.style.cursor = 'pointer'
  field = document.createElement('input')
  field.type = 'text'
  // Declared, because happy-dom's computed `cursor` is empty rather than the
  // initial `auto` a browser reports — and `auto` is the value whose
  // resolution (I-beam over text entry, arrow elsewhere) is the thing under
  // test here.
  field.style.cursor = 'auto'
  loose = document.createElement('button')
  card.append(button, field)
  root.append(card, loose)
  canvas.append(root)
  glCanvas = document.createElement('canvas')
  document.body.append(canvas, glCanvas)

  box(root, ROOT_BOX)
  box(card, CARD_BOX)
  box(button, BUTTON_BOX)
  box(field, FIELD_BOX)
  box(loose, LOOSE_BOX)

  // Module-state hygiene, as in forwardEvents.test.ts: a previous test's
  // unreleased press leaves a surface drag live, and `clearPointerState` then
  // defers by design. Done before the log is armed, so its own dispatches do
  // not appear in it.
  forwardPointer(root, 0.5, 0.5, 'up')
  rig = null

  // Every dispatch that reaches the document, whoever made it. The native
  // cases below read this to prove the library added nothing. Removed again in
  // afterEach: the document outlives the test, and listeners left on it would
  // count every later test's events too.
  const types = [
    'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointermove',
    'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click',
  ]
  const log = (e: Event) => {
    dispatched.push(`${e.type}${isRelayed(e) ? ' (relayed)' : ''}`)
  }
  for (const type of types) document.addEventListener(type, log)
  unlisten = () => {
    for (const type of types) document.removeEventListener(type, log)
  }
})

afterEach(() => {
  rig?.park()
  rig = null
  unlisten()
})

const drivers: RouteDriver[] = [relayDriver(), nativeDriver()]

// ── the shared spec ───────────────────────────────────────────────────────

describe.each(drivers)('the $route route', (driver) => {
  beforeEach(() => {
    if (driver.route === 'native') rig = ride()
  })

  it('stamps the hover twin on the whole chain under the pointer', () => {
    // The authoring contract (docs/authoring.md): a scene writes
    // `[data-hover]` twins for its own hover styling, because a real `:hover`
    // is a compositor state the capture cannot always see. One set of twins,
    // whichever route wrote them.
    driver.enter(button)

    expect(stamped(HOVER_ATTR)).toEqual([root, card, button])
  })

  it('clears the hover twin when the pointer leaves the content', () => {
    driver.enter(button)
    driver.leave()

    expect(stamped(HOVER_ATTR)).toEqual([])
  })

  it('moves the hover twin between siblings without dropping their shared ancestors', () => {
    // The ancestors must not blink. A twin removed and re-added inside one
    // style recalc restarts a CSS transition on the card, which reads as a
    // flicker under a pointer sweeping across two controls.
    driver.enter(button)
    const watch = new MutationObserver(() => {})
    watch.observe(root, { attributes: true, subtree: true, attributeFilter: [HOVER_ATTR] })

    driver.moveTo(field)
    // `takeRecords`, not the callback: a MutationObserver callback is a
    // microtask, and this test is synchronous — reading the callback's records
    // would assert on an empty array however hard the twins blinked.
    const touched = watch.takeRecords().map((record) => record.target)
    watch.disconnect()

    expect(stamped(HOVER_ATTR)).toEqual([root, card, field])
    expect(touched).not.toContain(card)
    expect(touched).not.toContain(root)
  })

  it('stamps the active twin for the press and drops it on release', () => {
    driver.enter(button)
    driver.press(button)
    expect(stamped(ACTIVE_ATTR)).toEqual([root, card, button])

    driver.release(button)
    expect(stamped(ACTIVE_ATTR)).toEqual([])
  })

  it('drops the active twin when the button comes up off the content', () => {
    // `:active` ends wherever the button is released, and a press that drags
    // off the panel never fires a release on the content at all. A route that
    // only listened on its own subtree would leave the control stuck pressed —
    // visible, permanent, and nothing more will arrive to clear it.
    driver.enter(button)
    driver.press(button)
    driver.releaseAway()

    expect(stamped(ACTIVE_ATTR)).toEqual([])
  })

  it('delivers exactly one click for one press', () => {
    // The whole reason the route is a single verdict rather than two enable
    // flags. Two live paths into one copy land the press on the right element
    // twice: a counter counts two, a toggle returns to where it started, a
    // form submits twice — and every one of those looks like a consumer bug.
    let clicks = 0
    button.addEventListener('click', () => clicks++)

    driver.enter(button)
    driver.press(button)
    driver.release(button)

    expect(clicks).toBe(1)
  })

  it('leaves the pressed control holding focus', () => {
    driver.enter(button)
    driver.press(button)
    driver.release(button)

    expect(document.activeElement).toBe(button)
  })

  it('releases focus when the press lands on nothing focusable', () => {
    driver.enter(button)
    driver.press(button)
    driver.release(button)
    driver.moveTo(card)
    driver.press(card)
    driver.release(card)

    expect(document.activeElement).not.toBe(button)
  })

  it('reports the pointer modality, so the focus ring stays suppressed', () => {
    // `:focus-visible` is a verdict the browser reaches from TRUSTED events.
    // The relay's are synthetic, so the browser never hears its pointer story;
    // the native route's press is trusted, but nothing tells the mirror the
    // press happened at all. Both routes therefore have to declare it, or a
    // button shows a ring on one route and not the other for the same click.
    const release = trackFocusModality()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    try {
      driver.enter(button)
      driver.press(button)
      driver.release(button)

      expect(button.hasAttribute('data-pointer-focus')).toBe(true)
    } finally {
      release()
    }
  })
})

// ── the cursor ────────────────────────────────────────────────────────────
//
// The one place the two routes are allowed to differ, and the difference is
// the design: the relay mirrors the content cursor onto the renderer canvas
// because that canvas is the hit target; on the native route the hit target
// is the real child, so the browser's own hit chain owns the cursor and the
// library writes nothing. Whether Chrome applies an unpainted canvas child's
// `cursor` is an open question (decisions.md #39) — a probe settles it, not a
// write the rig cannot verify.

describe('the cursor', () => {
  it('is mirrored onto the renderer canvas by the relay, and cleared on the way out', () => {
    const driver = relayDriver()
    driver.enter(button)
    expect(glCanvas.style.cursor).toBe('pointer')

    driver.moveTo(field)
    expect(glCanvas.style.cursor).toBe('text')

    driver.leave()
    expect(glCanvas.style.cursor).toBe('')
  })

  it('is surrendered to the browser while the rig rides', () => {
    // The ride clears whatever cursor the relay left on the renderer canvas —
    // a mirrored `pointer` standing under the browser's own cursor would show
    // the moment the pointer crossed off the projected quad — and then no
    // native event writes it again.
    glCanvas.style.cursor = 'pointer'
    rig = ride()
    expect(glCanvas.style.cursor).toBe('')

    const driver = nativeDriver()
    driver.enter(button)
    driver.moveTo(field)
    expect(glCanvas.style.cursor).toBe('')
  })
})

// ── what only the native route can do ─────────────────────────────────────
//
// Written as its own block rather than skipped inside the shared spec, so the
// gap is a statement instead of an absence. These are the reasons the route
// exists: a synthetic dispatch cannot produce any of them, at any cost.

describe('the native route alone', () => {
  beforeEach(() => {
    rig = ride()
  })

  it('dispatches nothing of its own — the browser is the only speaker', () => {
    // The heart of the law. The rig listens and stamps; it never speaks. If it
    // ever did, the second dispatch would arrive on the same element the
    // browser already reached, which is the duplication decision #33 was
    // written for, at a scale nobody would notice in review.
    const driver = nativeDriver()
    driver.enter(button)
    driver.press(button)
    driver.release(button)
    driver.leave()

    expect(dispatched.filter((one) => one.endsWith('(relayed)'))).toEqual([])
    expect(dispatched).toEqual([
      'pointerover',
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
      'pointerout',
    ])
  })

  it('refuses a relayed event, so the two routes cannot both stamp', () => {
    // Exclusivity in the DOM, not just in the law. The rig and the relay speak
    // through the same subtree, and the pointer gate's own clones are relayed
    // too — a rig that stamped from those would hold a hover the browser has
    // already dropped.
    const relay = relayDriver()
    relay.enter(button)
    relay.leave()

    // The relay stamped and cleared its own twins; the rig never joined in,
    // so nothing is left holding a hover the browser is not backing.
    expect(stamped(HOVER_ATTR)).toEqual([])
  })

  it('leaves the caret and the selection to the browser', () => {
    // The route's whole point, and the thing the relay provably cannot do: a
    // caret is placed by a TRUSTED press inside a text node, and a selection
    // is dragged by the browser's own selection machinery. A synthetic
    // pointerdown places no caret and extends no selection at any coordinate
    // — there is no API that asks for one. So the library's contribution here
    // is to write nothing that would stop the browser: no preventDefault, no
    // synthetic press, no `user-select` of its own.
    const driver = nativeDriver()
    driver.enter(field)
    driver.press(field)
    driver.release(field)

    expect(dispatched.some((one) => one.endsWith('(relayed)'))).toBe(false)
    expect(document.activeElement).toBe(field)
    expect(root.style.userSelect).toBe('')
  })

  it('hides the canvas without hiding the child, and never with opacity', () => {
    // Measured 2026-09-02 on Chrome 151: an `opacity: 0` canvas captures
    // blank, and a static drawn root at `opacity: 0` bakes the blank into the
    // paint record — the capture would go black the instant the route
    // engaged. `visibility: hidden` on the canvas leaves the capture running,
    // and the child's own `visibility: visible` restores its hit-testing
    // without painting it, because canvas children are fallback content and
    // are never painted.
    expect(canvas.style.visibility).toBe('hidden')
    expect(canvas.style.opacity).toBe('')
    expect(root.style.visibility).toBe('visible')
    expect(root.style.opacity).toBe('')
  })

  it('lifts the parked canvas above the renderer canvas, and keeps the cascade', () => {
    // The canvas stays `pointer-events: none` and the child stays `auto`, so
    // the browser hands the event to the child and the renderer canvas below
    // never sees it. That is the DOM half of "exactly one route owns input".
    expect(canvas.style.zIndex).toBe('7')
    expect(canvas.style.pointerEvents).toBe('none')
    expect(root.style.pointerEvents).toBe('auto')
  })

  it('wears the pose on the canvas, from the parked origin, with the child untouched', () => {
    // The pose goes on the CANVAS: its transformed box is what clips native
    // hit-testing, so a canvas wearing the full pose is hittable on exactly
    // the projected quad — and a transform restyle on the canvas is
    // paint-free after the first, where the same restyle on the drawn child
    // costs one paint every frame (platform.md #20–#21).
    expect(canvas.style.transformOrigin).toBe('0 0')
    expect(canvas.style.transform.startsWith('matrix3d(')).toBe(true)
    expect(root.style.transform).toBe('')
  })
})

// ── the switch ────────────────────────────────────────────────────────────

describe('changing route mid-gesture', () => {
  it('puts every property back exactly as it found it', () => {
    // Parking has to be total. Anything the rig leaves behind — a stray
    // transform above all — poisons the relay, which reads the drawn root's
    // UNTRANSFORMED layout box to turn a uv into a page point. A leftover
    // transform makes `getBoundingClientRect` report the transformed AABB, and
    // every relayed click after that lands somewhere else.
    const before = canvas.style.cssText
    const rootBefore = root.style.cssText

    const live = ride()
    expect(canvas.style.cssText).not.toBe(before)
    live.park()

    expect(canvas.style.cssText).toBe(before)
    expect(root.style.cssText).toBe(rootBefore)
    expect(root.style.transform).toBe('')
  })

  it('drops the twins it was holding when it parks', () => {
    // A route that leaves its hover behind leaves a control lit under no
    // pointer at all, and the arriving route has no way to know it is there.
    const live = ride()
    nativeDriver().enter(button)
    expect(stamped(HOVER_ATTR)).toEqual([root, card, button])

    live.park()

    expect(stamped(HOVER_ATTR)).toEqual([])
    expect(glCanvas.style.cursor).toBe('')
  })

  it('goes deaf the moment it parks', () => {
    // The listeners come off with the styles. A rig that kept listening would
    // stamp twins from the pointer gate's own relayed clones while the relay
    // was stamping its own — two writers, one attribute.
    const live = ride()
    live.park()

    nativeDriver().enter(button)

    expect(stamped(HOVER_ATTR)).toEqual([])
  })

  it('leaves focus where the gesture put it', () => {
    // A handoff is a change of who is listening, not a change of what the
    // user is doing. Blurring across it would close every popover a Surface
    // opened, the instant the pose stopped being planar.
    const live = ride()
    const driver = nativeDriver()
    driver.enter(button)
    driver.press(button)
    driver.release(button)
    expect(document.activeElement).toBe(button)

    live.park()

    expect(document.activeElement).toBe(button)
  })

  it('survives being parked twice, and ridden again', () => {
    const live = ride()
    live.park()
    live.park()
    expect(live.riding()).toBe(false)

    rig = ride()
    expect(rig.riding()).toBe(true)
    expect(canvas.style.visibility).toBe('hidden')
  })
})
