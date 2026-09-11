// Form-field pseudo-elements, put back into a snapDOM capture.
//
// snapDOM reproduces `::before`, `::after` and `::first-line` on ordinary
// elements and does neither of a form field's properly: an `<input>`'s
// `::after` is absent from the clone entirely, and its `::placeholder`
// arrives with its colour and nothing that shapes its glyphs. No warning
// for either. Measured 2026-09-11, snapDOM 3.0.0-beta.1, Chrome 151,
// against a five-case rig: `div::after`, `span::before` and
// `p::first-line` all render; the same tick on an `appearance: none`
// checkbox does not, and a placeholder keeps only what the rule below
// describes.
//
// The fault that makes this worth code rather than a footnote: both are
// invisible in review and wrong only in the texture. Flight's done-switch
// captured as a filled orange square with no tick in it, and every note
// field captured as `Add note` where the page reads `ADD NOTE` — the
// placeholder's `text-transform`, `letter-spacing` and `font-size` all
// silently gone. A reviewer comparing a page to a Surface sees a checkbox
// and a label in both and reads them as the same thing.
//
// snapDOM is not silent about the placeholder, which is the trap: it stamps
// a `snapdom-ph-*` class on the input and emits a rule for it, so the clone
// LOOKS handled. That rule carries `color`, `opacity` and
// `-webkit-text-fill-color` and nothing else, all `!important`. Everything
// that changes the placeholder's metrics — `font-size`, `letter-spacing`,
// `text-transform` — is absent, which is why the glyphs are the wrong case
// and the wrong width while the colour is right. The rule written here
// supplies only the missing properties, so the two do not fight; the one
// they share is `color`, where snapDOM's `!important` wins with the value
// this module would have written anyway.
//
// Both halves exploit the same fact: the browser will answer for a pseudo
// it refuses to clone. `getComputedStyle(field, '::placeholder')` and
// `getComputedStyle(field, '::after')` return used values, so the styles
// are recoverable even though the boxes are not — and the live field is
// still standing when the plugin runs, because snapDOM clones rather than
// moves.
//
// Ownership: this module owns the two field pseudo-elements and nothing
// else. It is a shim over an upstream gap, it is deletable in one piece
// when snapDOM closes it, and it never touches the live DOM — every write
// lands on the detached clone.

import type { SnapdomPlugin } from '@zumer/snapdom'

const FIELDS = 'input,textarea,select'

/**
 * What a placeholder may restyle relative to the field's own text.
 *
 * Only these, and only where they actually differ: an empty field shows its
 * placeholder and nothing else, so painting the difference onto the field
 * itself puts the glyphs back without a second element to place. A field
 * holding a value is skipped for exactly that reason — there the same
 * properties would restyle the value.
 */
const PLACEHOLDER_PROPERTIES = [
  'color',
  'opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-decoration',
  'line-height',
] as const

/** Everything an overlay needs to look like the pseudo-element it replaces. */
const PSEUDO_PROPERTIES = [
  'background',
  'background-clip',
  'border-radius',
  'box-shadow',
  'box-sizing',
  'color',
  'filter',
  'font',
  'letter-spacing',
  'line-height',
  'mix-blend-mode',
  'opacity',
  'outline',
  'text-align',
  'text-transform',
  'transform',
  'transform-origin',
  'white-space',
  'z-index',
] as const

/** Border is per-side: a tick is two borders of an empty box. */
const BORDER_PROPERTIES = [
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
] as const

function fieldsOf(root: Element): Element[] {
  const own = root.matches(FIELDS) ? [root] : []
  return [...own, ...root.querySelectorAll(FIELDS)]
}

/** The quoted text of a `content` value, or '' for a decorative pseudo. */
function contentText(content: string): string {
  const quoted = /^"(.*)"$|^'(.*)'$/s.exec(content.trim())
  if (!quoted) return ''
  return (quoted[1] ?? quoted[2] ?? '').replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  )
}

/**
 * Write the field's `::placeholder` declarations as a real rule.
 *
 * A rule, not inline properties on the field: a placeholder restyles glyphs
 * inside the field's own line box, and moving its `font-size` onto the field
 * moves the field's baseline with it — measured as the whole placeholder row
 * sitting 2px high. The clone is rendered by the same browser, so a scoped
 * `::placeholder` rule is reproduced exactly, including the baseline.
 *
 * Returns the rule text, or '' when the placeholder restyles nothing.
 */
function placeholderRule(live: Element, copy: HTMLElement, token: string): string {
  // Only these two take a placeholder; `select` is in FIELDS for the pseudo
  // half and has nothing to do here.
  const field =
    live instanceof HTMLInputElement || live instanceof HTMLTextAreaElement ? live : null
  if (!field || field.placeholder === '') return ''
  const placeholder = getComputedStyle(live, '::placeholder')
  const own = getComputedStyle(live)
  const declarations: string[] = []
  for (const property of PLACEHOLDER_PROPERTIES) {
    const value = placeholder.getPropertyValue(property)
    // Only the difference. Writing the whole set would fight snapDOM's own
    // style inlining for properties it already got right.
    if (value && value !== own.getPropertyValue(property))
      declarations.push(`${property}:${value}`)
  }
  if (declarations.length === 0) return ''
  copy.classList.add(token)
  return `.${token}::placeholder{${declarations.join(';')}}`
}

/**
 * Rebuild one absolutely-positioned field pseudo-element as a real overlay.
 *
 * Absolute only, and that is not a shortcut: a pseudo-element cannot be
 * measured (`getBoundingClientRect` has nothing to take), so its box is
 * only recoverable when `left`/`top` are used values against a containing
 * block this code can locate — the field's padding box. A statically
 * positioned pseudo would need the browser's line box, which is exactly
 * what is missing. Returns false when it cannot place one, so the caller
 * can say so rather than draw it in the wrong place.
 */
function paintPseudo(
  live: Element,
  which: '::before' | '::after',
  rootRect: DOMRect,
  layer: HTMLElement,
): boolean {
  const style = getComputedStyle(live, which)
  const content = style.content
  if (!content || content === 'none' || content === 'normal') return true
  if (style.display === 'none' || style.visibility === 'hidden') return true
  if (style.position !== 'absolute' && style.position !== 'fixed') return false

  const left = Number.parseFloat(style.left)
  const top = Number.parseFloat(style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) return false

  const fieldRect = live.getBoundingClientRect()
  const fieldStyle = getComputedStyle(live)
  // An absolutely positioned child resolves against its containing block's
  // PADDING box, so the field's own borders are part of the offset.
  const originX = fieldRect.left + Number.parseFloat(fieldStyle.borderLeftWidth || '0')
  const originY = fieldRect.top + Number.parseFloat(fieldStyle.borderTopWidth || '0')

  const overlay = document.createElement('div')
  overlay.style.position = 'absolute'
  overlay.style.left = `${originX + left - rootRect.left}px`
  overlay.style.top = `${originY + top - rootRect.top}px`
  overlay.style.width = style.width
  overlay.style.height = style.height
  overlay.style.pointerEvents = 'none'
  for (const property of [...PSEUDO_PROPERTIES, ...BORDER_PROPERTIES]) {
    const value = style.getPropertyValue(property)
    if (value) overlay.style.setProperty(property, value)
  }
  overlay.textContent = contentText(content)
  layer.appendChild(overlay)
  return true
}

/**
 * Put a field's `::placeholder` and absolutely-positioned `::before`/
 * `::after` back into `clone`, reading both from the live `root`.
 *
 * Fields are paired by ordinal rather than by walking both trees together:
 * snapDOM materializes ordinary pseudo-elements as real nodes, so the two
 * trees are NOT structurally parallel — but neither that pass nor any other
 * invents a form field, so the nth field of one is the nth field of the
 * other. Returns the fields it could not place a pseudo for.
 */
export function restoreFieldPseudoElements(root: Element, clone: HTMLElement): Element[] {
  const live = fieldsOf(root)
  if (live.length === 0) return []
  const copies = fieldsOf(clone)
  // A mismatch means the pairing assumption broke. Painting into it would
  // style the wrong field, which is worse than the gap being shimmed.
  if (copies.length !== live.length) return live

  const rootRect = root.getBoundingClientRect()
  // One absolutely positioned layer rather than a wrapper per field: an
  // `<input>` takes no children, and wrapping one would add a box to a tree
  // whose every box snapDOM has already measured against the live DOM.
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible'
  if (getComputedStyle(clone).position === 'static') clone.style.position = 'relative'

  const unplaced: Element[] = []
  const rules: string[] = []
  for (const [index, field] of live.entries()) {
    const copy = copies[index]
    if (!(copy instanceof HTMLElement)) continue
    rules.push(placeholderRule(field, copy, `munari-ph-${index}`))
    const before = paintPseudo(field, '::before', rootRect, layer)
    const after = paintPseudo(field, '::after', rootRect, layer)
    if (!before || !after) unplaced.push(field)
  }
  const rule = rules.filter(Boolean).join('')
  if (rule) {
    const sheet = document.createElement('style')
    sheet.textContent = rule
    clone.appendChild(sheet)
  }
  if (layer.childElementCount > 0) clone.appendChild(layer)
  return unplaced
}

/**
 * The snapDOM plugin wrapper.
 *
 * `afterClone` is the one stage where both trees exist: the clone is built
 * and still mutable, and the live element has not been touched. `pure` is
 * true because the same input tree always produces the same overlays, which
 * keeps snapDOM's repeat-capture memoization — a capture per frame during a
 * carry cannot afford to lose it.
 */
export function fieldPseudoElementPlugin(
  onUnplaced?: (fields: Element[]) => void,
): SnapdomPlugin {
  return {
    name: 'munari-field-pseudo-elements',
    pure: true,
    afterClone(context) {
      const clone = context.clone
      if (!(clone instanceof HTMLElement)) return
      const unplaced = restoreFieldPseudoElements(context.element, clone)
      if (unplaced.length > 0) onUnplaced?.(unplaced)
    },
  }
}
