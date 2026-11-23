// Webfont embedding for snapDOM captures — read once per stylesheet, spliced
// into the renderer's font stylesheet.
//
// The law: a capture carries the same font bytes the page rendered with, and
// pays to encode them exactly once.
//
// The fault, measured 2026-09-11 in Safari 18.6 on Genie's scheda window at
// dpr 2: snapDOM's own font pass re-derives and re-embeds the whole webfont on
// every capture, and on WebKit it also runs a font-warm probe twice per
// capture, each awaiting two animation frames. Turning snapDOM's pass off and
// supplying the same faces from here took a capture from 44.7 ms to 26.3 ms and
// throughput from 22.8/s to 38.4/s — interleaved paired blocks inside one page
// load, four clean blocks each, distributions not overlapping (base 43.2-46.3,
// here 24.7-28.0). Both conditions emit five `@font-face` rules and the same
// payload, 311 KB against 310 KB, which is what says the speed did not come out
// of fidelity. The probe's four frames were confirmed separately by their
// signature: `ut()` pairs each `requestAnimationFrame` with a
// `setTimeout(_, 1000)`, and 4.47 of those landed per capture across three runs.
//
// Not a win on its own. Measured again 2026-09-12 at 30 fps, the same
// change took a capture from 137 to 14 ms and made the scene WORSE: the gap
// paces from a capture's end, so a live source spent the saving on more
// captures, and the probe's frames had been the only yield inside one. The
// live period and the frame split in `snapdom.ts` are what turn the saving
// into frames (decisions.md #62).
//
// Why the faces are chosen per capture rather than all embedded: a family
// often ships pre-split by `unicode-range` (the lab's do), and inside an SVG
// image every byte is inline, so a range that no glyph in this subtree needs
// is pure payload. Selecting by used codepoints keeps a Latin panel at its
// Latin subset. The ENCODING is what is cached — selection is a set
// intersection over already-encoded strings.
//
// Why an SVG image needs this at all: an SVG loaded through `<img>` fetches
// nothing, so a `src: url(/fonts/...)` reference resolves to no font and the
// capture rasterizes with fallback metrics. Embedding is not an optimization
// here, it is the only way the right glyphs appear.
//
// Ownership: this module owns the `@font-face` text a capture carries.
// `snapdom.ts` owns the snapDOM call and turns snapDOM's own font pass off.
// The document owns which faces exist; this module never writes to it.

import type { SnapdomPlugin } from '@zumer/snapdom'
import { encodeFace, type EncodedFace } from './snapdomFontEncoding'

/** Inclusive codepoint pairs, or null for a face that declares no range. */
export type Ranges = readonly (readonly [number, number])[] | null

/** One `@font-face` the document declares, with its bytes not yet fetched. */
interface DeclaredFace {
  family: string
  /** The descriptors to reproduce verbatim, minus `src`. */
  descriptors: string
  /** Absolute URL of the woff2/woff/ttf this face points at. */
  url: string
  /** Parsed `unicode-range`, or null when the face declares none (= all). */
  ranges: Ranges
}

/** Descriptors that change how a face is SELECTED or rendered, so must survive. */
const CARRIED_DESCRIPTORS = [
  'font-style',
  'font-weight',
  'font-stretch',
  'font-variant',
  'font-feature-settings',
  'font-variation-settings',
  'ascent-override',
  'descent-override',
  'line-gap-override',
  'size-adjust',
  'unicode-range',
] as const

/**
 * Faces per stylesheet, keyed by sheet identity and rule count (logo scene,
 * 2026-09-12); rule count catches readable sheets mutated via `insertRule`.
 */
interface CachedSheetFaces {
  rules: number
  faces: Promise<DeclaredFace[]>
  retryAt?: number
}

const facesBySheet = new WeakMap<CSSStyleSheet, CachedSheetFaces>()
const sheetFailures = new WeakMap<CSSStyleSheet, number>()

/** Every `@font-face` the document declares across its current stylesheets. */
async function declaredFaces(doc: Document, onUnreadable?: (href: string) => void): Promise<DeclaredFace[]> {
  // Include `adoptedStyleSheets` for engines where `doc.styleSheets` omits them.
  const adopted = 'adoptedStyleSheets' in doc ? doc.adoptedStyleSheets : []
  const sheets = new Set<CSSStyleSheet>([
    ...Array.from(doc.styleSheets).filter((s): s is CSSStyleSheet => s instanceof CSSStyleSheet),
    ...adopted,
  ])
  const lists = await Promise.all(Array.from(sheets, (sheet) => sheetFaces(sheet, doc, onUnreadable)))
  return lists.flat()
}

// Reused SVG text must retain every face a new codepoint would select.
export async function declaredFontRanges(doc: Document): Promise<readonly Ranges[]> {
  return (await declaredFaces(doc)).map((face) => face.ranges)
}

function sheetFaces(
  sheet: CSSStyleSheet,
  doc: Document,
  onUnreadable?: (href: string) => void,
): Promise<DeclaredFace[]> {
  let rules: CSSRuleList | null = null
  try {
    rules = sheet.cssRules
  } catch {
    // Cross-origin sheet without CORS.
  }
  const count = rules ? rules.length : -1
  const cached = facesBySheet.get(sheet)
  if (cached?.rules === count && (cached.retryAt === undefined || performance.now() < cached.retryAt)) {
    return cached.faces
  }
  const entry: CachedSheetFaces = {
    rules: count,
    faces: rules
      ? readRules(rules, sheet.href ?? doc.baseURI, doc, onUnreadable)
      : fetchSheetFaces(sheet.href, doc, onUnreadable).then((fetched) => {
          if (fetched) {
            sheetFailures.delete(sheet)
            return fetched
          }
          const fails = (sheetFailures.get(sheet) ?? 0) + 1
          sheetFailures.set(sheet, fails)
          if (fails <= 3) {
            if (facesBySheet.get(sheet) === entry) facesBySheet.delete(sheet)
          } else {
            entry.retryAt = performance.now() + 5_000
          }
          return []
        }),
  }
  facesBySheet.set(sheet, entry)
  return entry.faces
}

/** Fallback CORS fetch for cross-origin `<link>` sheets whose `cssRules` throw. */
async function fetchSheetFaces(
  href: string | null,
  doc: Document,
  onUnreadable: ((href: string) => void) | undefined,
): Promise<DeclaredFace[] | null> {
  if (!href) return []
  try {
    const response = await fetch(href)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const parsed = new CSSStyleSheet()
    // `replaceSync` drops `@import` rules rather than following them.
    parsed.replaceSync(await response.text())
    return await readRules(parsed.cssRules, href, doc, onUnreadable)
  } catch {
    onUnreadable?.(href)
    return null
  }
}

/** An `@import` is the one rule that carries a `styleSheet`; happy-dom has no `CSSImportRule`. */
function isImport(rule: CSSRule): rule is CSSImportRule {
  return 'styleSheet' in rule
}

/** The faces in one rule list, following `@import` into the sheets it loaded. */
async function readRules(
  rules: CSSRuleList,
  base: string,
  doc: Document,
  onUnreadable?: (href: string) => void,
): Promise<DeclaredFace[]> {
  const faces: DeclaredFace[] = []
  for (const rule of Array.from(rules)) {
    if (isImport(rule)) {
      if (rule.styleSheet) faces.push(...(await sheetFaces(rule.styleSheet, doc, onUnreadable)))
      continue
    }
    if (!(rule instanceof CSSFontFaceRule)) continue
    const style = rule.style
    const family = unquote(style.getPropertyValue('font-family').trim())
    const url = firstUrl(style.getPropertyValue('src'), base)
    if (!family || !url) continue
    const descriptors = CARRIED_DESCRIPTORS.map((name) => {
      const value = style.getPropertyValue(name)
      return value ? `${name}:${value};` : ''
    }).join('')
    const rangeText = style.getPropertyValue('unicode-range')
    faces.push({ family, descriptors, url, ranges: rangeText ? parseRanges(rangeText) : null })
  }
  return faces
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

/**
 * First fetchable `url()` in a `src` list, resolved against its stylesheet URL
 * (not the document URL); `local()` entries are skipped because they cannot be embedded.
 */
function firstUrl(src: string, base: string): string | null {
  const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src)
  if (!match?.[2]) return null
  try {
    return new URL(match[2], base).href
  } catch {
    return null
  }
}

/** `U+0100-02BA, U+0131, U+20??` into inclusive codepoint pairs. */
export function parseRanges(text: string): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = []
  for (const part of text.split(',')) {
    const token = part.trim().replace(/^u\+/i, '')
    if (!token) continue
    const span = /^([0-9a-f]+)-([0-9a-f]+)$/i.exec(token)
    if (span?.[1] && span[2]) {
      ranges.push([parseInt(span[1], 16), parseInt(span[2], 16)])
      continue
    }
    // A `?` is a wildcard nibble: `20??` spans 2000-20FF.
    if (token.includes('?')) {
      const low = parseInt(token.replace(/\?/g, '0'), 16)
      const high = parseInt(token.replace(/\?/g, 'F'), 16)
      if (!Number.isNaN(low) && !Number.isNaN(high)) ranges.push([low, high])
      continue
    }
    const single = parseInt(token, 16)
    if (!Number.isNaN(single)) ranges.push([single, single])
  }
  return ranges
}

/** Prefetch declared faces at install so the first capture finds the cache warm. */
export function warmCaptureFonts(doc: Document = document): void {
  void declaredFaces(doc).then((faces) => {
    for (const face of faces) void encodeFace(face.url)
  })
}

/** Input types that draw no text from their `value`. */
const UNDRAWN_VALUE_TYPES = new Set(['checkbox', 'radio', 'color', 'range', 'file', 'hidden', 'image'])

/**
 * Every codepoint the subtree draws: its text nodes, plus field values and
 * placeholders, which are not text nodes. Counting text nodes alone, a clip
 * holding only a text field found no codepoints and embedded no face, so the
 * field rasterized in a fallback font (2026-10-18).
 */
function usedCodepoints(root: Element): Set<number> {
  const points = new Set<number>()
  const add = (text: string) => {
    for (const char of text) points.add(char.codePointAt(0) ?? 0)
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) add(node.nodeValue ?? '')
  for (const field of [root, ...root.querySelectorAll('input, textarea')]) {
    if (field instanceof HTMLTextAreaElement) add(`${field.value}${field.placeholder}`)
    if (field instanceof HTMLInputElement && !UNDRAWN_VALUE_TYPES.has(field.type)) add(`${field.value}${field.placeholder}`)
  }
  return points
}

/**
 * Families resolved by the live subtree or clip (`getComputedStyle` on the
 * live tree, never the clone's deduped classes: reading `clone.style.fontFamily`
 * matched zero faces — 41 KB vs snapDOM's 311 KB, 2026-09-11). Clips also read
 * active pseudos and intersecting ancestors.
 */
type FontClip = { x: number; y: number; width: number; height: number }

function usedFamilies(root: Element, clip?: FontClip | 'viewport' | null): Set<string> {
  const families = new Set<string>()
  const view = root.ownerDocument.defaultView
  if (!view) return families
  const add = (value: string) => {
    for (const name of value.split(',')) {
      const trimmed = unquote(name.trim())
      if (trimmed) families.add(trimmed.toLowerCase())
    }
  }
  const nodes = [root, ...root.querySelectorAll('*')]
  if (!clip || clip === 'viewport') {
    for (const element of nodes) add(view.getComputedStyle(element).fontFamily)
    return families
  }
  const left = clip.x - view.scrollX, top = clip.y - view.scrollY
  const right = left + clip.width, bottom = top + clip.height
  const selected = new Set<Element>([root])
  for (const element of nodes) {
    const rect = element.getBoundingClientRect()
    if (rect.right <= left || rect.left >= right || rect.bottom <= top || rect.top >= bottom) continue
    for (let node: Element | null = element; node && root.contains(node); node = node.parentElement) selected.add(node)
  }
  for (const element of selected) {
    add(view.getComputedStyle(element).fontFamily)
    for (const pseudo of ['::before', '::after']) {
      const style = view.getComputedStyle(element, pseudo)
      if (style.content && style.content !== 'none' && style.content !== 'normal') add(style.fontFamily)
    }
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.placeholder) {
      add(view.getComputedStyle(element, '::placeholder').fontFamily)
    }
  }
  return families
}

function intersects(
  ranges: readonly (readonly [number, number])[] | null,
  points: Set<number>,
): boolean {
  if (!ranges) return true
  for (const point of points) {
    for (const [low, high] of ranges) if (point >= low && point <= high) return true
  }
  return false
}

/**
 * Which declared faces this subtree needs. Exported so tests can verify the
 * chosen set directly — selecting nothing silently ships fallback glyphs.
 */
export function chooseFaces<T extends { family: string; ranges: Ranges }>(
  all: readonly T[],
  families: ReadonlySet<string>,
  codepoints: Set<number>,
): T[] {
  return all.filter(
    (face) => families.has(face.family.toLowerCase()) && intersects(face.ranges, codepoints),
  )
}

const fontFaceCss = (face: DeclaredFace, encoded: EncodedFace) =>
  `@font-face{font-family:'${face.family}';${face.descriptors}src:url(${encoded.data}) format('${encoded.format}');}`

export async function inputFontsEmbedded(field: HTMLInputElement, svg: XMLDocument): Promise<boolean> {
  try {
    const doc = field.ownerDocument
    const familyText = getComputedStyle(field).fontFamily
    if (!familyText || familyText.includes('\\')) return false
    const families = new Set((familyText.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? [])
      .map((name) => unquote(name.trim()).toLowerCase()))
    const points = new Set(Array.from({ length: 95 }, (_, index) => index + 32))
    const faces: DeclaredFace[] = []
    const declaredCounts = new Map<string, number>()
    const visited = new Set<CSSStyleSheet>()
    const faceKey = (family: string, style: string, weight: string, stretch: string, ranges: string) =>
      JSON.stringify([unquote(family.trim()).toLowerCase(), style || 'normal', weight || 'normal', stretch || 'normal',
        parseRanges(ranges || 'U+0-10FFFF')])
    const visitRules = (rules: CSSRuleList, base: string): boolean => {
      for (const rule of Array.from(rules)) {
        if (isImport(rule)) {
          if (!rule.styleSheet || !visitSheet(rule.styleSheet)) return false
          continue
        }
        if (!(rule instanceof CSSFontFaceRule)) {
          if ('cssRules' in rule && (!(rule.cssRules instanceof CSSRuleList) || !visitRules(rule.cssRules, base))) return false
          continue
        }
        const style = rule.style
        const family = unquote(style.getPropertyValue('font-family').trim())
        if (!families.has(family.toLowerCase())) continue
        const rangeText = style.getPropertyValue('unicode-range')
        const ranges = rangeText ? parseRanges(rangeText) : null
        if (!intersects(ranges, points)) continue
        const src = style.getPropertyValue('src')
        const url = firstUrl(src, base)
        if (!url || /\blocal\s*\(/i.test(src)) return false
        const descriptors = CARRIED_DESCRIPTORS.map((name) => {
          const value = style.getPropertyValue(name)
          return value ? `${name}:${value};` : ''
        }).join('')
        faces.push({ family, descriptors, url, ranges })
        const key = faceKey(family, style.getPropertyValue('font-style'), style.getPropertyValue('font-weight'),
          style.getPropertyValue('font-stretch'), rangeText)
        declaredCounts.set(key, (declaredCounts.get(key) ?? 0) + 1)
      }
      return true
    }
    const visitSheet = (sheet: CSSStyleSheet): boolean => {
      if (visited.has(sheet)) return true
      visited.add(sheet)
      return visitRules(sheet.cssRules, sheet.href ?? doc.baseURI)
    }
    const adopted = 'adoptedStyleSheets' in doc ? doc.adoptedStyleSheets : []
    for (const sheet of new Set([...Array.from(doc.styleSheets), ...adopted])) {
      if (!visitSheet(sheet)) return false
    }
    const liveCounts = new Map<string, number>()
    for (const face of doc.fonts) {
      if (!families.has(unquote(face.family.trim()).toLowerCase()) || !intersects(parseRanges(face.unicodeRange), points)) continue
      const key = faceKey(face.family, face.style, face.weight, face.stretch, face.unicodeRange)
      liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1)
    }
    if (liveCounts.size !== declaredCounts.size || Array.from(liveCounts).some(([key, count]) => declaredCounts.get(key) !== count)) return false
    const css = Array.from(svg.querySelectorAll('style'), (style) => style.textContent ?? '').join('\n')
    const embedded = await Promise.all(faces.map(async (face) => {
      const encoded = await encodeFace(face.url)
      return encoded !== null && css.includes(fontFaceCss(face, encoded))
    }))
    return embedded.every(Boolean)
  } catch {
    return false
  }
}

/** Build the `@font-face` block this clone needs (empty when system fonts suffice). */
async function fontCssFor(
  live: Element,
  clone: Element,
  doc: Document,
  onUnreadable?: (href: string) => void,
  clip?: FontClip | 'viewport' | null,
): Promise<string> {
  const all = await declaredFaces(doc, onUnreadable)
  if (all.length === 0) return ''
  // Families from live styles; codepoints from the clone (earlier plugins may inject text).
  const families = usedFamilies(live, clip)
  const points = usedCodepoints(clone)
  if (points.size === 0) return ''
  const wanted = chooseFaces(all, families, points)
  if (wanted.length === 0) return ''
  const blocks = await Promise.all(
    wanted.map(async (face) => {
      const encoded = await encodeFace(face.url)
      return encoded ? fontFaceCss(face, encoded) : ''
    }),
  )
  return blocks.join('')
}

// beforeRender follows snapDOM's fontsCSS initialization. A separate clone
// stylesheet makes its style-interning pass parse the font payload again.
export function fontEmbedPlugin(onUnreadable?: (href: string) => void): SnapdomPlugin {
  return {
    name: 'munari-font-embed',
    pure: true,
    async beforeRender(context) {
      const clone = context.clone
      const live = context.element
      if (!(clone instanceof Element) || !(live instanceof Element)) return
      const doc = live.ownerDocument
      context.fontsCSS = await fontCssFor(live, clone, doc, onUnreadable, context.clip)
    },
  }
}
