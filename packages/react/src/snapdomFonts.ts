// Webfont embedding for snapDOM captures — built once per document, spliced
// into every clone.
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
 * Read every `@font-face` the document declares.
 *
 * Cross-origin sheets throw on `cssRules` rather than returning an empty list,
 * and a page that links one would otherwise lose every face behind it — so the
 * throw is caught per sheet and the rest are still read.
 */
function readDeclaredFaces(doc: Document): DeclaredFace[] {
  const faces: DeclaredFace[] = []
  // `styleSheets` already includes anything adopted in engines that support
  // it, but reading `adoptedStyleSheets` as well costs nothing and covers the
  // ones where it does not; the duplicate pass is harmless because a face read
  // twice produces the same entry.
  const adopted = 'adoptedStyleSheets' in doc ? doc.adoptedStyleSheets : []
  const sheets: CSSStyleSheet[] = [
    ...Array.from(doc.styleSheets).filter((s): s is CSSStyleSheet => s instanceof CSSStyleSheet),
    ...adopted,
  ]
  for (const sheet of sheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const style = rule.style
      const family = unquote(style.getPropertyValue('font-family').trim())
      const url = firstUrl(style.getPropertyValue('src'), doc)
      if (!family || !url) continue
      const descriptors = CARRIED_DESCRIPTORS.map((name) => {
        const value = style.getPropertyValue(name)
        return value ? `${name}:${value};` : ''
      }).join('')
      const rangeText = style.getPropertyValue('unicode-range')
      faces.push({ family, descriptors, url, ranges: rangeText ? parseRanges(rangeText) : null })
    }
  }
  return faces
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

/**
 * The first fetchable URL in a `src` list.
 *
 * `local()` entries are skipped rather than resolved: a local face cannot be
 * embedded, and picking it would leave the capture with no bytes at all.
 */
function firstUrl(src: string, doc: Document): string | null {
  const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src)
  if (!match?.[2]) return null
  try {
    return new URL(match[2], doc.baseURI).href
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

/**
 * Fetch a face and encode it, at most once per URL for the life of the page.
 *
 * The promise itself is cached, not the result, so captures that overlap the
 * first fetch all wait on the same request instead of starting their own.
 */
const encodedByUrl = new Map<string, Promise<string | null>>()

function encodeFace(url: string): Promise<string | null> {
  const cached = encodedByUrl.get(url)
  if (cached) return cached
  const pending = (async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      // Chunked: `String.fromCharCode(...bytes)` overflows the argument limit
      // somewhere around 100 KB, and these faces run to 90 KB and up.
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      return `data:font/woff2;base64,${btoa(binary)}`
    } catch {
      return null
    }
  })()
  encodedByUrl.set(url, pending)
  return pending
}

let declared: DeclaredFace[] | null = null

function faces(doc: Document): DeclaredFace[] {
  return (declared ??= readDeclaredFaces(doc))
}

/**
 * Start fetching every declared face.
 *
 * Called at install so the first capture finds the cache warm. A capture that
 * beats it embeds nothing and rasterizes that one frame with fallback metrics,
 * which is the same failure `embedFonts` had while its own fetch was in
 * flight — so this is a head start, not a new requirement.
 */
export function warmCaptureFonts(doc: Document = document): void {
  for (const face of faces(doc)) void encodeFace(face.url)
}

/** Every codepoint in the subtree's text, including attribute-driven content. */
function usedCodepoints(root: Element): Set<number> {
  const points = new Set<number>()
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const char of node.nodeValue ?? '') points.add(char.codePointAt(0) ?? 0)
  }
  return points
}

/**
 * Every family the LIVE subtree resolves to.
 *
 * Read from the live tree through `getComputedStyle`, not from the clone:
 * snapDOM dedups its inlined styles into generated classes, so a clone's
 * `style.fontFamily` is empty and a selector built from it matches no face at
 * all — which reads as a large speedup and ships fallback glyphs (caught
 * 2026-09-11 by checking the serialized payload: 41 KB with zero `@font-face`
 * rules against snapDOM's own 311 KB).
 *
 * One `getComputedStyle` per node is the cost this module accepts. It is the
 * same order as the walk snapDOM was already doing, against a pass that
 * re-encoded the whole font every frame.
 */
function usedFamilies(root: Element): Set<string> {
  const families = new Set<string>()
  const view = root.ownerDocument.defaultView
  if (!view) return families
  const add = (value: string) => {
    for (const name of value.split(',')) {
      const trimmed = unquote(name.trim())
      if (trimmed) families.add(trimmed.toLowerCase())
    }
  }
  add(view.getComputedStyle(root).fontFamily)
  for (const element of Array.from(root.querySelectorAll('*'))) {
    add(view.getComputedStyle(element).fontFamily)
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
 * Which declared faces this subtree needs.
 *
 * Exported because selecting NOTHING is a silent failure: the capture speeds up,
 * the payload shrinks, and the text quietly rasterizes in a fallback face. The
 * only cheap signal is the chosen set, so it is a seam a test can hold.
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

/**
 * Build the `@font-face` block this clone needs.
 *
 * Returns an empty string when nothing matches, which is the correct answer
 * for a subtree drawn entirely in system fonts.
 */
async function fontCssFor(live: Element, clone: Element, doc: Document): Promise<string> {
  const all = faces(doc)
  if (all.length === 0) return ''
  // Families off the LIVE tree (the clone carries classes, not inline styles);
  // codepoints off the CLONE, because a plugin earlier in the chain may have
  // put text there that the live tree never had.
  const families = usedFamilies(live)
  const points = usedCodepoints(clone)
  if (points.size === 0) return ''
  const wanted = chooseFaces(all, families, points)
  if (wanted.length === 0) return ''
  const blocks = await Promise.all(
    wanted.map(async (face) => {
      const data = await encodeFace(face.url)
      if (!data) return ''
      return `@font-face{font-family:'${face.family}';${face.descriptors}src:url(${data}) format('woff2');}`
    }),
  )
  return blocks.join('')
}

/**
 * The plugin that carries the fonts.
 *
 * `afterClone` is where the clone exists and is still mutable. A `<style>`
 * appended here survives serialization: snapDOM lifts out only its own
 * `style[data-sd]` elements, and its per-node style pass returns early on a
 * `STYLE` tag, so this block is neither rewritten nor charged per-node.
 *
 * `pure` is true because the same subtree yields the same block, which is what
 * keeps snapDOM's repeat-capture memoization alive — a capture per frame
 * cannot afford to lose it.
 */
export function fontEmbedPlugin(): SnapdomPlugin {
  return {
    name: 'munari-font-embed',
    pure: true,
    async afterClone(context) {
      const clone = context.clone
      const live = context.element
      if (!(clone instanceof Element) || !(live instanceof Element)) return
      const doc = live.ownerDocument
      const css = await fontCssFor(live, clone, doc)
      if (!css) return
      const style = doc.createElement('style')
      style.textContent = css
      clone.appendChild(style)
    },
  }
}
