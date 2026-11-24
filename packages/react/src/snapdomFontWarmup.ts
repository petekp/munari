// Font decode warm-up — each face a snapDOM capture embeds is painted in an
// image before the capture's own image decodes.
//
// The law: a capture image never decodes before the faces it carries can
// paint text in an image of this document.
//
// Embedding is not enough the first time a capture uses a face. Measured
// 2026-11-23 in headless Chrome 156 and 158, Controls with snapDOM: a region
// capture that added a face no earlier capture image had used published the
// field with no text (field ink 127 against 2,670, 7 of 7 runs), because the
// SVG image's decode resolved before text in that face could paint. Decoding
// a small SVG carrying the capture's faces first published complete text in
// 10 of 10 runs; a font-free decode of the same length stayed blank in 5 of 5.
// Those runs placed the warm-up just before the image got its `src`. Placed
// after it, the font-free decode also published complete text, so only a
// warm-up that finishes first is evidence for the fix.
//
// Ownership: `snapdomFonts.ts` chooses the faces and awaits this before
// snapDOM serializes the capture. This module owns only the warm-up decode
// and the record of which faces it has painted.

import type { DeclaredFace, Ranges } from './snapdomFonts'

/** One face a capture embeds, with the `@font-face` rule that carries it. */
export interface EmbeddedFace {
  face: DeclaredFace
  css: string
}

/**
 * Per document, each face that a warm-up decode has painted, keyed by
 * `warmKey`. A pending entry is shared by concurrent captures; a failed
 * decode removes its entries so a later capture tries again.
 */
const warmedFaces = new WeakMap<Document, Map<string, Promise<void>>>()

const warmKey = (face: DeclaredFace) => `${face.family}\n${face.descriptors}\n${face.url}`

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** The first value of a descriptor, which a span can use to select the face. */
function firstDescriptorValue(descriptors: string, name: string): string {
  const value = new RegExp(`(?:^|;)${name}:([^;]*);`).exec(descriptors)?.[1]?.trim()
  return value?.split(/\s+/)[0] ?? 'normal'
}

const SURROGATES = [0xd800, 0xdfff] as const

/**
 * A printable codepoint the face covers, so a span drawing it loads that face.
 * Codepoints below `!` and surrogates are skipped: an XML reference to a C0
 * control or a surrogate fails the whole warm-up decode.
 */
function sampleCodepoint(ranges: Ranges): number {
  if (!ranges) return 0x41
  for (const [low, high] of ranges) {
    let point = Math.max(low, 0x21)
    if (point >= SURROGATES[0] && point <= SURROGATES[1]) point = SURROGATES[1] + 1
    if (point <= high) return point
  }
  return 0x41
}

async function decodeFaces(faces: readonly EmbeddedFace[]): Promise<void> {
  const spans = faces.map(({ face }) => {
    const style = `font-family:'${face.family}';` +
      ['font-style', 'font-weight', 'font-stretch']
        .map((name) => `${name}:${firstDescriptorValue(face.descriptors, name)};`).join('')
    return `<span style="${escapeXml(style)}">&#x${sampleCodepoint(face.ranges).toString(16)};</span>`
  }).join('')
  const css = escapeXml(faces.map(({ css }) => css).join(''))
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="16"><foreignObject width="64" height="16">' +
    `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${spans}</div></foreignObject></svg>`
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
}

/**
 * Resolves once every face in this capture has been painted in an image in
 * this document. A capture with a face not yet painted decodes one SVG holding
 * all of its faces, as the 2026-11-23 runs did. A failed decode is ignored,
 * which leaves the capture as it was without the warm-up.
 */
export async function warmFaces(doc: Document, faces: readonly EmbeddedFace[]): Promise<void> {
  const warmed = warmedFaces.get(doc) ?? new Map<string, Promise<void>>()
  warmedFaces.set(doc, warmed)
  const fresh = faces.filter(({ face }) => !warmed.has(warmKey(face)))
  if (fresh.length > 0) {
    const decoded = decodeFaces(faces).catch(() => {
      for (const { face } of fresh) if (warmed.get(warmKey(face)) === decoded) warmed.delete(warmKey(face))
    })
    for (const { face } of fresh) warmed.set(warmKey(face), decoded)
  }
  await Promise.all(faces.map(({ face }) => warmed.get(warmKey(face))))
}
