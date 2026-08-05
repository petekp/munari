// @vitest-environment happy-dom
//
// The plate builder's contract. Everything here is about the two properties
// the whole teardown rests on, both of which are easy to lose silently:
//
//   THE SUBJECT IS NEVER TOUCHED. Not restyled, not re-parented, not
//   relaid out. The platform enforces the strong half for us — only an
//   immediate child of the trial canvas can be drawn (platform.md #10), so a
//   plate is necessarily a copy — but nothing stops a builder from mutating
//   the original on its way to making one.
//
//   THE PLATES REGISTER. Every plate is the same box at the same size with
//   one feature left alive, so their captures land on top of each other
//   exactly. A suppression that changed layout instead of just color would
//   break this, and it would break it *subtly*: the plates would still look
//   right apart and wrong only when collapsed.
//
// happy-dom has no compositor and no real cascade, so what is testable here
// is the geometry and the generated CSS. The ink itself — zero
// cross-contamination between plates, 107 differing px of 120 000 on
// recomposite — was measured in a browser and lives in
// docs/spikes/exploded-paint.md.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  PAINT_FEATURES,
  explodePaint,
  measureBleed,
  suppressionSheet,
  type PaintFeature,
} from './paintPlates'

/**
 * The property names a sheet actually declares. Substring matching is not
 * good enough here — `border-color` and `outline-color` both contain
 * "color", so asking whether the glyph plate suppressed `color` by searching
 * the text answers yes for the wrong reason.
 */
function declaredProperties(css: string): string[] {
  return [...css.matchAll(/^\s+(-?[a-z-]+)\s*:/gm)].map((m) => m[1])
}

/** The selector list a sheet applies to, as written. */
function selectorOf(css: string): string {
  return css.slice(0, css.indexOf('{')).trim()
}

/** A childless div — the whole point. Six plates, no children to explode. */
function specimen(css = ''): HTMLElement {
  const el = document.createElement('div')
  el.id = 'specimen'
  el.className = 'card'
  el.textContent = 'munari'
  el.style.cssText = `width:200px;height:120px;${css}`
  document.body.appendChild(el)
  // happy-dom reports 0 for offsetWidth (no layout engine). The builder reads
  // exactly those two properties, so stubbing them here is stubbing layout —
  // and it keeps the geometry assertions below about arithmetic rather than
  // about whose layout engine is running.
  Object.defineProperty(el, 'offsetWidth', { value: 200, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: 120, configurable: true })
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('suppressionSheet', () => {
  const feature = (id: string, prop: string): PaintFeature => ({
    id,
    label: id,
    note: '',
    off: [[prop, 'transparent']],
  })
  const table = [feature('a', 'color'), feature('b', 'border-color'), feature('c', 'outline-color')]

  it('suppresses every feature EXCEPT the one the plate is for', () => {
    const css = suppressionSheet('t1', table, table[1])
    // The kept feature is the plate's whole reason to exist.
    expect(declaredProperties(css)).toEqual(['color', 'outline-color'])
  })

  it('scopes to this plate — an unscoped rule would restyle the whole page', () => {
    const css = suppressionSheet('t1', table, table[0])
    // The wrapper is parked in document.body, so this sheet is live against
    // the real document. A bare `*` would neutralize the page itself, and
    // "the page went transparent" is a bug you chase in the wrong file.
    expect(selectorOf(css)).toBe('[data-plate="t1"], [data-plate="t1"] *')
  })

  it('reaches descendants, because an inherited value loses to their own', () => {
    // Measured: a <span> carrying its own `color` leaked ~10 px into EVERY
    // plate when neutralization was set inline on the root.
    const css = suppressionSheet('t1', table, table[1])
    expect(css).toContain('[data-plate="t1"] *')
  })

  it('marks every declaration !important', () => {
    // Without it the clone's own class rules win and the plate shows
    // everything — six identical plates, no error, nothing to debug.
    const css = suppressionSheet('t1', table, table[0])
    const declarations = declaredProperties(css)
    expect(declarations.length).toBeGreaterThan(0)
    expect(css.match(/!important/g)?.length).toBe(declarations.length)
  })

  it('a plate for a multi-property feature suppresses all of its siblings', () => {
    // The real table's `glyphs` carries three properties, one of which is
    // `color` — a substring of two OTHER features' properties. Whatever the
    // plate is for, none of its own properties may appear in its own sheet.
    const glyphs = PAINT_FEATURES.find((f) => f.id === 'glyphs')!
    const declared = declaredProperties(suppressionSheet('t1', PAINT_FEATURES, glyphs))
    for (const [property] of glyphs.off) expect(declared).not.toContain(property)
    expect(declared).toContain('box-shadow')
    expect(declared).toContain('text-shadow')
  })

  it('every feature in the real table can be isolated', () => {
    // A feature whose `off` list is empty, or duplicated from a neighbor,
    // produces a plate that is not actually alone — and looks plausible.
    for (const keep of PAINT_FEATURES) {
      const declared = declaredProperties(suppressionSheet('t1', PAINT_FEATURES, keep))
      const own = keep.off.map(([p]) => p)
      expect(own.length).toBeGreaterThan(0)
      for (const property of own) expect(declared).not.toContain(property)
      // …and every sibling really is switched off in this plate.
      const siblings = PAINT_FEATURES.filter((f) => f.id !== keep.id).flatMap((f) =>
        f.off.map(([p]) => p),
      )
      for (const property of siblings) expect(declared).toContain(property)
    }
  })
})

describe('explodePaint geometry', () => {
  it('gives every plate the same box, so the captures register', () => {
    const el = specimen()
    const plates = explodePaint(el, { bleed: 20 })
    expect(plates).toHaveLength(PAINT_FEATURES.length)
    for (const p of plates) {
      // Content 200×120 plus 20 of padding on all four sides.
      expect([p.width, p.height]).toEqual([240, 160])
      expect([p.contentWidth, p.contentHeight]).toEqual([200, 120])
    }
  })

  it('pads the wrapper so ink outside the border box survives the clip', () => {
    // platform.md #9: the capture is cut at the DRAWN element's border box.
    // The wrapper is the drawn element, and its padding is the only reason a
    // shadow plate is not blank.
    const plates = explodePaint(specimen(), { bleed: 20 })
    const wrapper = plates[0].node
    expect(wrapper.style.padding).toBe('20px')
    expect(wrapper.style.boxSizing).toBe('content-box')
    expect(wrapper.style.width).toBe('200px')
  })

  it('hands back an UNPARENTED wrapper — the source adopts it', () => {
    // decisions.md #13: adoption refuses a node with a parent, because
    // appendChild would move it. A builder that parked its wrappers anywhere
    // would make every plate un-adoptable.
    for (const p of explodePaint(specimen())) expect(p.node.parentNode).toBe(null)
  })

  it('pins the clone to what the subject MEASURED, not to what it can resolve', () => {
    const plates = explodePaint(specimen(), { bleed: 8 })
    const clone = plates[0].node.querySelector('.card') as HTMLElement
    // The subject's 200px could have come from a flex parent or a percentage
    // — neither of which exists inside a parked canvas. A plate that resolved
    // its own width would be a different box than the page's.
    expect(clone.style.getPropertyValue('width')).toBe('200px')
    expect(clone.style.getPropertyPriority('width')).toBe('important')
    expect(clone.style.getPropertyValue('box-sizing')).toBe('border-box')
    expect(clone.style.getPropertyPriority('margin')).toBe('important')
  })
})

describe('explodePaint leaves the subject alone', () => {
  it('does not mutate, restyle or re-parent the element it explodes', () => {
    const el = specimen('color:rebeccapurple;')
    const before = { html: el.outerHTML, parent: el.parentNode, style: el.style.cssText }
    explodePaint(el)
    expect(el.outerHTML).toBe(before.html)
    expect(el.parentNode).toBe(before.parent)
    expect(el.style.cssText).toBe(before.style)
  })

  it('copies the subtree — a plate is a clone, never the original', () => {
    const el = specimen()
    const plates = explodePaint(el)
    for (const p of plates) {
      expect(p.node.contains(el)).toBe(false)
      expect(p.node.querySelector('.card')?.textContent).toBe('munari')
    }
  })

  it('carries classes and ids across, hazard and all', () => {
    // Duplicating an id six times is invalid HTML and can break a host page's
    // getElementById. Keeping it is still right: `#id` rules are ordinary
    // CSS, and a plate that dropped them would paint something the page never
    // painted.
    const clone = explodePaint(specimen())[0].node.firstElementChild!.nextElementSibling!
    expect(clone.id).toBe('specimen')
    expect(clone.className).toBe('card')
  })

  it('gives each plate its own scope token, so sheets cannot collide', () => {
    const tokens = explodePaint(specimen()).map((p) => p.node.dataset.plate)
    expect(new Set(tokens).size).toBe(tokens.length)
    // Two explosions of the same element in the same session must not reuse
    // a token either — six plates would otherwise be neutralized by twelve
    // rules and every one of them would come out blank.
    const second = explodePaint(specimen()).map((p) => p.node.dataset.plate)
    expect(new Set([...tokens, ...second]).size).toBe(tokens.length + second.length)
  })
})

describe('measureBleed', () => {
  it('reaches as far as the shadow does', () => {
    const el = specimen('box-shadow: 0 18px 40px 6px rgba(0,0,0,0.4);')
    // |offset| + blur + spread = 18 + 40 + 6.
    expect(measureBleed(el)).toBe(64)
  })

  it('takes the furthest layer, not the first', () => {
    const el = specimen('box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 30px 60px rgba(0,0,0,0.3);')
    expect(measureBleed(el)).toBe(90)
  })

  it('measures the horizontal reach too — a side-cast shadow is not vertical', () => {
    const el = specimen('box-shadow: -50px 0 10px rgba(0,0,0,0.3);')
    expect(measureBleed(el)).toBe(60)
  })

  it('floors, so a plate with no outside ink still clears its own antialiasing', () => {
    expect(measureBleed(specimen(), 4)).toBe(4)
  })

  it('caps, because bleed enters the texture size squared', () => {
    const el = specimen('box-shadow: 0 900px 900px rgba(0,0,0,0.3);')
    expect(measureBleed(el, 4, 160)).toBe(160)
  })
})
