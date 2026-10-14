// Input SVG template — an owned public snapshot for repeated value edits.
// Only the marked input's value changes; styles, geometry and font faces stay
// with the accepted capture. Controls spent about 40–64 ms preparing a capture
// at 4×–6× CPU slowdown in the 2026-10-13 profile (decisions.md #62).
// The region rasterizer owns invalidation; core owns publication.

import { declaredFontRanges, inputFontsEmbedded, type Ranges } from './snapdomFonts'

const normalizedImages = new WeakMap<HTMLImageElement, XMLDocument>()

export function retainNormalizedSvg(image: HTMLImageElement, document: XMLDocument): void {
  normalizedImages.set(image, document)
}

export async function decodeInputSvg(document: XMLDocument, width: number, height: number): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`
  await image.decode()
  image.width = width
  image.height = height
  return image
}

const decodeBlankInput = (document: XMLDocument, index: number, width: number, height: number) => {
  const blank = document.cloneNode(true)
  if (!(blank instanceof Document)) throw new Error('munari: input SVG clone is not a document')
  const input = blank.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'input')[index]
  if (!input) throw new Error('munari: input SVG clone has no field')
  input.setAttribute('value', '')
  input.removeAttribute('placeholder')
  return decodeInputSvg(blank, width, height)
}

const printableAscii = (value: string) => /^[ -~]*$/.test(value)

const covers = (ranges: Ranges, point: number) => ranges === null || ranges.some(([first, last]) => point >= first && point <= last)

const coveredAscii = (ranges: readonly Ranges[], value: string) => {
  const points = Array.from(value, (character) => character.charCodeAt(0))
  const selected = ranges.map((range) => points.some((point) => covers(range, point)))
  const characters = new Set<string>()
  for (let point = 32; point <= 126; point++) {
    if (ranges.every((range, index) => !covers(range, point) || selected[index])) characters.add(String.fromCharCode(point))
  }
  return characters
}

const parseInputSvg = (url: string) => {
  const comma = url.indexOf(',')
  const header = url.slice(0, comma)
  if (comma < 0 || !header.startsWith('data:image/svg+xml') || header.includes(';base64')) return null
  try {
    const document = new DOMParser().parseFromString(decodeURIComponent(url.slice(comma + 1)), 'image/svg+xml')
    return document.documentElement instanceof SVGSVGElement ? document : null
  } catch {
    return null
  }
}

export function createInputSvgTemplate(
  image: HTMLImageElement,
  field: HTMLInputElement,
  value: string,
  scroll: readonly [number, number],
) {
  if (!printableAscii(value)) return null
  const document = normalizedImages.get(image) ?? parseInputSvg(image.src)
  if (!document) return null
  const inputs = Array.from(document.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'input'))
  const anchor = field.getAttribute('data-munari-anchor')
  const anchored = anchor ? inputs.filter((input) => input.getAttribute('data-munari-anchor') === anchor) : []
  const identified = field.id ? inputs.filter((input) => input.id === field.id) : []
  const matches = anchored.length === 1 ? anchored : identified
  const input = matches[0]
  if (matches.length !== 1 || !(input instanceof HTMLInputElement) || input.children.length !== 0 || input.getAttribute('value') !== value) return null
  if (input.style.fontSize && input.style.fontSize !== getComputedStyle(field).fontSize) return null
  const type = input.getAttribute('type')?.toLowerCase()
  if (type && type !== 'text') return null
  const width = image.width
  const height = image.height
  const characters = new Set(Array.from(value))
  let additionalCharacters = new Set<string>()
  let blankImage: Promise<HTMLImageElement> | null = null
  let fontCompleteness: Promise<boolean> | null = null
  // The embedder selects faces by codepoint range. A new glyph is safe only
  // when it selects no face absent from the saved capture.
  void declaredFontRanges(field.ownerDocument).then(
    (ranges) => { additionalCharacters = coveredAscii(ranges, value) },
    () => { additionalCharacters = new Set() },
  )

  return {
    canReuse(candidate: HTMLInputElement, next: string, nextScroll: readonly [number, number]) {
      return candidate === field && printableAscii(next) && Array.from(next).every((character) => characters.has(character) || additionalCharacters.has(character))
        && nextScroll[0] === scroll[0] && nextScroll[1] === scroll[1]
        && candidate.selectionStart !== null && candidate.selectionStart === candidate.selectionEnd
    },
    fontsEmbedded() {
      fontCompleteness ??= inputFontsEmbedded(field, document)
      return fontCompleteness
    },
    blank() {
      blankImage ??= decodeBlankInput(document, inputs.indexOf(input), width, height)
      return blankImage
    },
    render(next: string) {
      input.setAttribute('value', next)
      return decodeInputSvg(document, width, height)
    },
  }
}
