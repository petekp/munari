import { explodePaint, type PaintFeature } from './paintPlates'
import type { Box, Layout, Part } from './passageParts'

// The passage's other half: asking a real layout where everything is.
//
// `passageParts.ts` is the arithmetic and can be tested in a terminal. This is
// the part that has to touch a browser, and it does exactly two things per
// endpoint — lay the card out once at that width, and read it. Twice per
// flight, not a hundred and twenty times.
//
// Everything happens to a CLONE parked off-screen. The card on the page is
// measured and copied and otherwise untouched, which is the same discipline
// `paintPlates` established and for the same reason: the moment a transition
// starts restyling the thing it is transitioning, it stops being able to tell
// the truth about it.

/**
 * The two halves of a card's paint.
 *
 * Separated for one specific reason. A word quad carries a window onto the
 * texture, and that window is a RECTANGLE around some glyphs — which, in a
 * single combined capture, also contains whatever was painted behind them. Fly
 * that rectangle across a card whose background has since changed and the word
 * arrives wearing a patch of its old surroundings. Capturing the ink with
 * every background switched off makes a word quad carry the word and nothing
 * else, so it can be laid over anything.
 *
 * The suppressions are geometry-preserving, per `paintPlates`: `color:
 * transparent` and `border-color: transparent`, never `display: none` or
 * `border: none`. Both captures must be the same layout to the pixel or the
 * boxes measured here address the wrong texels.
 */
const INK: PaintFeature = {
  id: 'ink',
  label: 'ink',
  note: 'glyphs alone, with nothing painted behind them',
  off: [
    ['color', 'transparent'],
    ['text-decoration-color', 'transparent'],
    ['-webkit-text-stroke-color', 'transparent'],
    ['text-shadow', 'none'],
  ],
}

const CHROME: PaintFeature = {
  id: 'chrome',
  label: 'chrome',
  note: 'the surfaces the glyphs sit on',
  off: [
    ['box-shadow', 'none'],
    ['background', 'transparent'],
    ['border-color', 'transparent'],
    ['outline-color', 'transparent'],
  ],
}

/**
 * The card's own surface, as numbers rather than as texels.
 *
 * The panel is the one part that must NOT come out of a texture. Its border is
 * one pixel and its corners are a 14 px radius at both endpoints, so a quad
 * that stretched a capture of it 308 → 940 would render that border at three
 * times the weight along one axis and smear the corners — which is what a
 * stretched rounded rectangle always looks like, and is the likeliest reading
 * of "glitchy shading near the corners". Drawn analytically it is exact at
 * every size in between, for free.
 */
export interface Panel {
  fill: string
  edge: string
  radius: number
  border: number
}

/**
 * Where the part of the card that stays LIVE sits, at this endpoint.
 *
 * A band across the full width of the card rather than the element's own box,
 * and the reason is `cqi`. Everything about the pill — its type, its padding,
 * its gap, the diameter of its sweep, its own offset from the corner — is
 * sized in percentages of the CONTAINER's inline size, which is the card. So
 * the live element has to be re-rendered inside a container of exactly the
 * card's current width or it is the wrong size, and the simplest way to
 * guarantee that is to make the surface it is drawn on that wide.
 *
 * That is also what makes this the one thing in the flight that does not need
 * an intermediate layout to be invented for it: `cqi` is CONTINUOUS in the
 * container width. A card halfway between its two shapes gives the pill a size
 * halfway between its two sizes, from the same one authored rule, with no
 * breakpoint anywhere near it.
 */
export interface LiveBand {
  /** Card-local, full width. */
  box: Box
}

export interface Endpoint {
  width: number
  height: number
  layout: Layout
  panel: Panel
  /** Unparented, ready for a Surface to adopt. Both are `width × height`. */
  ink: HTMLElement
  chrome: HTMLElement
  /** Null unless the caller asked for a subtree to be kept live. */
  live: LiveBand | null
}

export interface MeasureOptions {
  /**
   * Subtrees that stay LIVE through the flight and so must not be flown as
   * parts. The ticking counter is the whole proof that this is a real
   * document and not a screenshot — freezing it is exactly the charge this
   * scene levels at `startViewTransition` — so the media block keeps being a
   * Surface and is skipped here.
   */
  live?: string
  /** The class the container query resolves against. */
  frameClass?: string
}

const rectOf = (el: Element): DOMRect => el.getBoundingClientRect()

const local = (r: DOMRect, origin: DOMRect): Box => ({
  x: r.left - origin.left,
  y: r.top - origin.top,
  w: r.width,
  h: r.height,
})

/**
 * Does this element paint a surface of its own?
 *
 * Only elements that answer yes become block parts. Everything else is either
 * a text container (its words fly individually) or pure layout, and a quad for
 * it would be a transparent rectangle costing a blend.
 */
function paints(cs: CSSStyleDeclaration): boolean {
  if (cs.backgroundImage !== 'none') return true
  const bg = cs.backgroundColor
  if (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) return true
  if (cs.boxShadow !== 'none') return true
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const w = parseFloat(cs[`border${side}Width` as 'borderTopWidth'] || '0')
    const style = cs[`border${side}Style` as 'borderTopStyle']
    if (w > 0 && style !== 'none' && style !== 'hidden') return true
  }
  return false
}

/**
 * The pieces of a text node that fly as one quad each.
 *
 * A run is a maximal stretch of inked characters that CANNOT be split by a
 * line break, which is exactly what a flying quad needs to be: a run that
 * spans a break opportunity would wrap at one endpoint and not the other, and
 * the union of its two client rects is a box the size of two lines with the
 * ink in opposite corners.
 *
 * TWO WAYS TO GET THIS WRONG, both measured on this card:
 *
 * Take `Intl.Segmenter`'s word-like segments and you drop every character that
 * is not a letter or a digit. The card landed reading "A box shadow lives
 * outside the border box  and the" against a DOM reading "A box-shadow lives
 * outside the border box, and the" — punctuation simply absent from the
 * flight, and absent from the landing frame until the DOM took over.
 *
 * Split on whitespace instead and "box-shadow" becomes one run, which is a
 * break opportunity the browser is entitled to take (and does, in the narrow
 * column). So: segment at word boundaries, glue each segment to the one before
 * when they touch, and close the run after any non-word-like segment — a
 * hyphen ends "box-", a comma ends "box,". Both are unbreakable, and together
 * they cover the text.
 */
export function textRuns(text: string): { index: number; length: number }[] {
  const runs: { index: number; length: number }[] = []
  let start = -1
  let end = -1
  const flush = () => {
    if (start >= 0) runs.push({ index: start, length: end - start })
    start = -1
  }
  for (const s of SEGMENTER.segment(text)) {
    if (!/\S/.test(s.segment)) {
      flush()
      continue
    }
    if (start < 0 || s.index !== end) flush()
    if (start < 0) start = s.index
    end = s.index + s.segment.length
    // A break may fall after punctuation, so the run ends with it.
    if (!s.isWordLike) flush()
  }
  flush()
  return runs
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' })

/**
 * Every part of one laid-out card: its painted surfaces, and its words.
 *
 * Blocks are taken TOPMOST-FIRST and not descended into. A stats strip with
 * three cells and two hairline separators is one quad, not five, and
 * stretching it is correct rather than approximate — the cells divide it
 * evenly at both endpoints, so a proportional stretch puts the separators
 * exactly where the destination layout puts them. Descending would produce
 * quads that overlap their own parent and blend its border twice.
 *
 * Words are taken everywhere, including inside painted blocks, because a word
 * has to fly whatever it is sitting on.
 */
function partsOf(frame: HTMLElement, origin: DOMRect, live?: string): Part[] {
  const parts: Part[] = []
  let order = 0

  const walkBlocks = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (live && child.matches(live)) continue
      const cs = getComputedStyle(child)
      if (cs.display === 'none') continue
      if (paints(cs)) {
        const r = rectOf(child)
        if (r.width > 0 && r.height > 0) {
          parts.push({ key: blockKey(child, frame), kind: 'block', box: local(r, origin), order: order++ })
        }
        // Topmost-first: the children of a painted block travel inside its
        // texture, not beside it.
        continue
      }
      walkBlocks(child)
    }
  }

  const card = frame.firstElementChild
  if (card) walkBlocks(card)

  // Text nodes are indexed over the WHOLE subtree in document order,
  // `display: none` included. That is what makes the key stable: the body
  // copy is not laid out at the small end, but its text nodes are still in
  // the tree at the same positions, so the words that appear at the large end
  // get the keys they would have had — and the matcher sees them as arrivals
  // rather than as strangers.
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
  let index = -1
  let node: Node | null
  while ((node = walker.nextNode())) {
    index++
    const text = node.nodeValue
    if (!text || !/\S/.test(text)) continue
    if (live && (node.parentElement as Element | null)?.closest(live)) continue
    const parent = node.parentElement
    const cs = parent ? getComputedStyle(parent) : null
    const fs = cs ? parseFloat(cs.fontSize) || 0 : 0
    const band = cs && fs > 0 ? fontBand(cs, fs) : null
    let word = -1
    for (const run of textRuns(text)) {
      word++
      const range = document.createRange()
      range.setStart(node, run.index)
      range.setEnd(node, run.index + run.length)
      const rects = Array.from(range.getClientRects())
      range.detach?.()
      if (!rects.length) continue
      // A word can report more than one rect when it is wrapped in inline
      // elements. Their union is still one word and still one quad.
      const l = Math.min(...rects.map((r) => r.left))
      const t = Math.min(...rects.map((r) => r.top))
      const rt = Math.max(...rects.map((r) => r.right))
      const b = Math.max(...rects.map((r) => r.bottom))
      if (rt - l <= 0 || b - t <= 0) continue
      // Swap the line box for the content box. CSS centres the font's
      // ascent+descent inside the line box (half-leading), so the content box
      // is that band placed centrally — and unlike the line box, it is a pure
      // multiple of the type size at both endpoints.
      let top = t
      let height = b - t
      if (band) {
        const content = band.ascent + band.descent
        top = t + (height - content) / 2
        height = content
      }
      parts.push({
        key: `w${index}:${word}`,
        kind: 'word',
        box: { x: l - origin.left, y: top - origin.top, w: rt - l, h: height },
        order: order++,
      })
    }
  }

  return parts
}

/**
 * The font's own content box, as a fraction of one em.
 *
 * THE REASON THIS EXISTS is the most instructive measurement in the file. A
 * `Range` around a word reports the INLINE BOX — its height is the
 * line-height, not the type size. On this card the title's line-height goes
 * 22 → 46 px between endpoints while its font-size goes 16 → 39.5: a ratio of
 * 2.09 against a ratio of 2.47. Fly a quad on the line box and the glyphs
 * inside it are cross-faded at an 18% size disagreement, which renders as a
 * doubled, embossed word for the whole flight — the exact "glitchy" reading,
 * arriving from geometry rather than from shading.
 *
 * Anchoring instead to ascent + descent makes the quad scale with the TYPE,
 * because ascent and descent are pure multiples of the font size. Then the
 * same glyph occupies the same fraction of its quad at both ends, and the
 * cross-fade has nothing left to disagree about.
 *
 * Measured from the real font rather than assumed: `fontBoundingBox*` is what
 * the rasterizer will actually use, and a guessed 0.8/0.2 is wrong by a few
 * percent per family — which is a few percent of vertical smear.
 */
const bandCache = new Map<string, { ascent: number; descent: number }>()
let bandCtx: CanvasRenderingContext2D | null = null

function fontBand(cs: CSSStyleDeclaration, fs: number): { ascent: number; descent: number } {
  const spec = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`
  const hit = bandCache.get(spec)
  if (hit) return hit
  bandCtx ??= document.createElement('canvas').getContext('2d')
  let band = { ascent: fs * 0.8, descent: fs * 0.2 }
  if (bandCtx) {
    bandCtx.font = spec
    const m = bandCtx.measureText('Hxpg')
    if (m.fontBoundingBoxAscent > 0) {
      band = { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent }
    }
  }
  bandCache.set(spec, band)
  return band
}

/**
 * A block's key, from its position in the tree rather than from its class.
 *
 * Classes are not unique and would collide across the three stat cells; a
 * child index is unique and, because both endpoints are measured from the
 * same markup, identical on both sides.
 */
function blockKey(el: Element, root: Element): string {
  const path: number[] = []
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    path.unshift(Array.prototype.indexOf.call(n.parentElement?.children ?? [], n))
  }
  return `b${path.join('.')}`
}

/**
 * Lay one card out at `width`, measure everything in it, and take its paint.
 *
 * The clone goes inside a fresh copy of the container-query element, which is
 * the whole trick: `.psg-frame` carries `container-type: inline-size`, so
 * pinning THAT to a width makes every `@container` rule in the card resolve
 * exactly as it would at that width on the page. The layout engine is being
 * asked a real question, off-screen, and it gives its real answer.
 *
 * Parked at `left: -99999px` rather than `display: none` or
 * `visibility: hidden`: it has to be laid out to be measured, and it has to be
 * painted to be captured.
 */
export function measureEndpoint(
  markup: string,
  width: number,
  options: MeasureOptions = {},
): Endpoint {
  const frameClass = options.frameClass ?? 'psg-frame'
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;pointer-events:none;`
  const frame = document.createElement('div')
  frame.className = frameClass
  frame.innerHTML = markup
  host.appendChild(frame)
  document.body.appendChild(host)

  try {
    const origin = rectOf(frame)
    const height = frame.offsetHeight
    const layout: Layout = {
      width,
      height,
      parts: partsOf(frame, origin, options.live),
    }
    const live = bandOf(frame, origin, width, options.live)
    // Zero bleed, deliberately. The card's shadow is reconstructed
    // analytically by `passageShadow` and must not also be baked into a
    // texture; and the parts measured above are in the FRAME's coordinates,
    // so any padding would offset every UV in the card by that much.
    const [ink, chrome] = explodePaint(frame, { features: [INK, CHROME], bleed: 0 })
    return {
      width,
      height,
      layout,
      panel: panelOf(frame),
      ink: ink.node,
      chrome: chrome.node,
      live,
    }
  } finally {
    host.remove()
  }
}

/**
 * The band the live subtree occupies — and the removal of it from the capture.
 *
 * Both halves matter and they are one function so they cannot be done singly.
 * The element is measured, and then it is hidden BEFORE `explodePaint` runs,
 * because a live element that is also in the texture is drawn twice: once
 * ticking, once frozen at whatever value it held when the plate was cut. That
 * frozen copy is the ghost digit visible under the counter in every capture of
 * the previous build — and worse, it is the counter-argument to the whole
 * scene, since a stopped number under a running one is exactly the failure the
 * View Transitions foil is here to demonstrate.
 *
 * `visibility: hidden` rather than `display: none`, per `paintPlates`: it must
 * still occupy its layout, or every box measured beside it moves.
 *
 * The band is padded symmetrically around the element — it sits `offset` from
 * the bottom of its own container, so `offset` above it leaves room for the
 * container's own coordinates to keep working unchanged in the live copy.
 */
function bandOf(
  frame: HTMLElement,
  origin: DOMRect,
  width: number,
  selector?: string,
): { box: Box } | null {
  if (!selector) return null
  const el = frame.querySelector<HTMLElement>(selector)
  const host = el?.parentElement
  if (!el || !host) return null
  const b = local(rectOf(el), origin)
  const h = local(rectOf(host), origin)
  const offset = h.y + h.h - (b.y + b.h)
  el.style.visibility = 'hidden'
  return { box: { x: 0, y: b.y - offset, w: width, h: b.h + 2 * offset } }
}

/** The card's background, border and radius, read rather than authored. */
function panelOf(frame: HTMLElement): Panel {
  const card = frame.firstElementChild
  if (!card) return { fill: 'transparent', edge: 'transparent', radius: 0, border: 0 }
  const cs = getComputedStyle(card)
  return {
    fill: cs.backgroundColor,
    edge: cs.borderTopColor,
    // One corner, because the card's four are equal and a shader that took
    // four would still have to be told they were. If that ever stops being
    // true the panel wants a real per-corner SDF, not a fudge here.
    radius: parseFloat(cs.borderTopLeftRadius) || 0,
    border: parseFloat(cs.borderTopWidth) || 0,
  }
}

/**
 * The markup to measure, taken from the card that is actually on the page.
 *
 * `outerHTML` of the card rather than a second React render: the point is to
 * measure what the user is looking at, and a re-render is a different tree
 * that merely ought to match. It also means this works for any card the scene
 * decides to fly without the scene having to know how to build one.
 */
export function markupOf(card: HTMLElement): string {
  return card.outerHTML
}
