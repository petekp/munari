import { parseBoxShadow } from '@petekp/munari'

// Exploded paint — one element's own paint, taken apart into plates.
//
// The premise no CSS "exploded DOM" demo can touch: a shadow, a background, a
// border and the glyphs are ONE paint of ONE box. There is no element to
// grab, no node to translate, nothing to hand a z-offset to. Tree-based
// exploders separate *elements*; below the element there is nothing for them
// to hold. The only way to pull those layers apart is to render the same box
// several times, each time with a different feature left switched on — and
// then place the results at different depths.
//
// The mechanism, every step measured in docs/spikes/exploded-paint.md:
//
//     clone → padded wrapper → neutralizing stylesheet → Surface
//
// Each step is load-bearing.
//
//   CLONE, because `drawElementImage` accepts only immediate children of the
//   trial canvas (platform.md #10) — a page element and even a descendant of
//   a legitimate child are both refused outright. So a plate is always a copy
//   and the live page is untouched BY CONSTRUCTION rather than by discipline.
//   Nothing here restyles, re-parents or relayouts the subject; it is read
//   twice (`offsetWidth`, `getComputedStyle`) and cloned.
//
//   PADDED WRAPPER, because the capture is clipped to the DRAWN element's
//   border box (platform.md #9). A shadow lives outside that box: the probe
//   drew a div with `box-shadow: 0 60px 0 0 red` and captured ZERO red
//   pixels. The clip follows whichever element was passed, so the fix is to
//   pass a bigger one — the same element inside `padding: 100px`, drawing the
//   wrapper, captured all 12000. The padding is a required parameter, not an
//   optimization, and `measureBleed` derives it from the subject's own ink.
//
//   NEUTRALIZING STYLESHEET rather than inline styles on the root, because an
//   inherited value loses to a descendant's own: a `<span>` carrying its own
//   `color` leaked into every plate until the rule went descendant-wide with
//   `!important`. The sheet is scoped to one plate by a unique attribute —
//   the plate ends up parked in `document.body`, so an unscoped rule would
//   restyle the entire page.
//
//   And the suppressions are GEOMETRY-PRESERVING, always: `border-color:
//   transparent`, never `border: none`; `color: transparent`, never
//   `display: none`. Layout must not move one pixel between plates or they
//   stop registering — and registration is the whole illusion. Measured over
//   120 000 px, the only disagreement between four recomposited plates and
//   the undecomposed capture was 107 px of border-radius antialiasing.

/**
 * One separable paint feature of a single box.
 *
 * `off` is what switches the feature off; a plate for feature F is the clone
 * wearing the `off` declarations of every feature EXCEPT F. Stated as
 * property/value pairs rather than a CSS string so the sheet cannot be
 * malformed and every declaration is guaranteed its `!important`.
 */
export interface PaintFeature {
  id: string
  /** The CSS that paints it — this is the plate's label in the scene. */
  label: string
  /** What this plate proves, for a caption. */
  note: string
  off: readonly (readonly [property: string, value: string])[]
}

/**
 * The features one childless box can be taken apart into, in CSS 2.1
 * Appendix E paint order — back to front. The order is not cosmetic: it is
 * the answer to "what is actually on top of what", and laying the plates out
 * in it is the point of the exercise.
 *
 * Two pairs here are the ones that make the case:
 *
 *   - `background` / `border` / `box-shadow` are three separate sheets from a
 *     box with no children at all. Nothing in a tree-based teardown can name
 *     them, let alone move them.
 *   - `text-shadow` and the glyphs themselves come apart, because a shadow
 *     paints straight THROUGH `color: transparent` — measured, 4836 ink px
 *     with the text invisible. Two plates from one string of characters.
 *
 * `outline` is here for a third reason: it paints outside the border box
 * entirely, so it is the feature that fails without the padded wrapper.
 * Treat the table as open — a candidate is screened by rendering the plate
 * with everything suppressed and confirming the capture reads zero ink.
 */
export const PAINT_FEATURES: readonly PaintFeature[] = [
  {
    id: 'shadow',
    label: 'box-shadow',
    note: 'paints outside the border box — invisible to any capture of the element itself',
    // One `off` covers every layer, inset included: a plate is either showing
    // the shadow or it is not.
    off: [['box-shadow', 'none']],
  },
  {
    id: 'background',
    label: 'background',
    note: 'the full fill, including the part the border and glyphs paint over',
    // `background` shorthand zeroes color AND image in one declaration —
    // gradients are backgrounds, and a plate that killed only the color would
    // quietly keep them.
    off: [['background', 'transparent']],
  },
  {
    id: 'border',
    label: 'border',
    note: 'color removed, width kept — the box must not move between plates',
    off: [['border-color', 'transparent']],
  },
  {
    id: 'textShadow',
    label: 'text-shadow',
    note: 'paints through transparent glyphs — its own plate, from the same characters',
    off: [['text-shadow', 'none']],
  },
  {
    id: 'glyphs',
    label: 'color',
    note: 'the characters alone, with their own shadow left behind',
    // Four properties paint through `color: transparent` (probe B). Three of
    // them are here; `text-shadow` is the fourth and is deliberately its own
    // feature above, because separating it is the interesting part.
    off: [
      ['color', 'transparent'],
      ['text-decoration-color', 'transparent'],
      ['-webkit-text-stroke-color', 'transparent'],
    ],
  },
  {
    id: 'outline',
    label: 'outline',
    note: 'painted last, and entirely outside the border box',
    off: [['outline-color', 'transparent']],
  },
]

/** A built plate: hand `node` to a `<Surface html={…}>` at `width × height`. */
export interface Plate {
  feature: PaintFeature
  /**
   * The padded wrapper, unparented and ready to be adopted. Its border box is
   * `width × height`; the clone sits inside it inset by `bleed` on every side.
   */
  node: HTMLElement
  width: number
  height: number
  /** Padding on each side, CSS px — the room the outside ink needs. */
  bleed: number
  /** The subject's own border-box size, CSS px. */
  contentWidth: number
  contentHeight: number
}

export interface ExplodeOptions {
  /** Which features to build plates for. Defaults to the full table. */
  features?: readonly PaintFeature[]
  /** Override the measured padding. Rarely wanted — see `measureBleed`. */
  bleed?: number
}

/**
 * How much room this element's ink needs outside its own border box.
 *
 * Derived, not guessed: every outer shadow layer reaches
 * `|offset| + blur + spread` (an over-estimate by roughly half the blur,
 * which costs texels and never truth), and an outline reaches
 * `width + offset`. The result is one uniform padding rather than four edges
 * — the plates all share it, so a rectangle they agree on is worth more than
 * the texels a tight fit would save.
 *
 * The floor keeps a plate with no outside ink from having a border box that
 * ends exactly on its own antialiasing. The ceiling is a texture-memory
 * guard: bleed enters the Surface's size squared, and the spike measured a
 * padded wrapper already costing 2.2× the texels of a bare capture.
 */
export function measureBleed(subject: Element, floor = 4, ceiling = 160): number {
  const cs = getComputedStyle(subject)
  let reach = 0
  for (const layer of parseBoxShadow(cs.boxShadow)) {
    reach = Math.max(reach, Math.abs(layer.x) + layer.blur + layer.spread)
    reach = Math.max(reach, Math.abs(layer.y) + layer.blur + layer.spread)
  }
  if (cs.outlineStyle !== 'none') {
    reach = Math.max(reach, parseFloat(cs.outlineWidth || '0') + parseFloat(cs.outlineOffset || '0'))
  }
  return Math.min(ceiling, Math.max(floor, Math.ceil(reach)))
}

let plateSeq = 0

/**
 * Take one element's paint apart into plates. The subject is never touched:
 * it is measured and cloned, and everything after that happens to copies.
 *
 * Returns one plate per feature, all sharing identical geometry — which is
 * what lets them be stacked back into the original when their depths collapse
 * to zero.
 */
export function explodePaint(subject: HTMLElement, options: ExplodeOptions = {}): Plate[] {
  const features = options.features ?? PAINT_FEATURES
  const bleed = options.bleed ?? measureBleed(subject)
  // `offsetWidth`, never `getBoundingClientRect()`: the rect includes any
  // transform, so a subject mid-animation would bake its own scale into every
  // plate's geometry and the collapse would land on the wrong size.
  const contentWidth = subject.offsetWidth
  const contentHeight = subject.offsetHeight

  return features.map((feature) => {
    const token = `plate-${plateSeq++}`
    const wrapper = document.createElement('div')
    wrapper.dataset.plate = token
    // content-box is stated rather than assumed: a page reset that had set
    // `border-box` globally would silently eat the padding, and the padding IS
    // the mechanism.
    wrapper.style.cssText =
      `box-sizing:content-box;width:${contentWidth}px;height:${contentHeight}px;` +
      `padding:${bleed}px;margin:0;background:transparent;`

    const clone = subject.cloneNode(true) as HTMLElement
    // Pin the clone to what the subject actually measured. Its size may have
    // come from a layout context that does not exist in here — a flex parent,
    // a percentage, a grid track — and a plate that resolved its own width
    // would be a different box than the one on the page.
    clone.style.setProperty('box-sizing', 'border-box', 'important')
    clone.style.setProperty('width', `${contentWidth}px`, 'important')
    clone.style.setProperty('height', `${contentHeight}px`, 'important')
    clone.style.setProperty('margin', '0', 'important')

    // NOTE the clone keeps its id and classes. Duplicating an id across six
    // plates is invalid HTML and a real hazard for a host page's own
    // `getElementById`. It is still the right call: `#id` rules are ordinary
    // CSS, and a plate that stripped them would paint something the page
    // never painted — which is the one thing a tool that exists to tell the
    // truth about paint must never do.
    const sheet = document.createElement('style')
    sheet.textContent = suppressionSheet(token, features, feature)

    wrapper.append(sheet, clone)
    return { feature, node: wrapper, width: contentWidth + bleed * 2, height: contentHeight + bleed * 2, bleed, contentWidth, contentHeight }
  })
}

/**
 * The rule that leaves exactly one feature alive.
 *
 * Scoped to this plate's token — the wrapper is parked in `document.body`
 * where an unscoped `*` would restyle the whole page — and applied to the
 * wrapper AND its descendants, because an inherited value loses to a
 * descendant's own declaration (a `<span>` with its own `color` leaked
 * through a root-only neutralization in the spike).
 */
export function suppressionSheet(
  token: string,
  features: readonly PaintFeature[],
  keep: PaintFeature,
): string {
  const body = features
    .filter((f) => f.id !== keep.id)
    .flatMap((f) => f.off)
    .map(([property, value]) => `  ${property}: ${value} !important;`)
    .join('\n')
  const scope = `[data-plate="${token}"]`
  return `${scope}, ${scope} * {\n${body}\n}`
}
