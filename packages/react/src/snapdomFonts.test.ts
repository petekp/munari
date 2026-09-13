// @vitest-environment happy-dom
// The selection seam. A wrong answer here is silent: the capture gets FASTER,
// the payload SHRINKS, and the text rasterizes in a fallback face — which is
// exactly how the first version of this module passed every other check while
// embedding nothing (2026-09-11).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseFaces, fontEmbedPlugin, parseRanges, warmCaptureFonts } from './snapdomFonts'

/** A face as `chooseFaces` sees it: a family and a parsed range. */
const face = (family: string, range: string | null) => ({
  family,
  ranges: range === null ? null : parseRanges(range),
})

const points = (text: string) => new Set([...text].map((c) => c.codePointAt(0) ?? 0))

describe('parseRanges', () => {
  it('reads a span, a single codepoint and a wildcard nibble', () => {
    expect(parseRanges('U+0100-02BA')).toEqual([[0x0100, 0x02ba]])
    expect(parseRanges('U+0131')).toEqual([[0x0131, 0x0131]])
    // `20??` is every codepoint sharing the high byte, not a literal `?`.
    expect(parseRanges('U+20??')).toEqual([[0x2000, 0x20ff]])
  })

  it('reads a comma list as separate ranges', () => {
    expect(parseRanges('U+0000-00FF, U+0131, U+2000-206F')).toEqual([
      [0x0000, 0x00ff],
      [0x0131, 0x0131],
      [0x2000, 0x206f],
    ])
  })
})

describe('chooseFaces', () => {
  const latin = face('Archivo', 'U+0000-00FF')
  const latinExt = face('Archivo', 'U+0100-02BA')
  const other = face('Bodoni Moda', 'U+0000-00FF')

  it('takes the subset the text needs and leaves the ones it does not', () => {
    const chosen = chooseFaces([latin, latinExt, other], new Set(['archivo']), points('Scheda'))
    expect(chosen).toEqual([latin])
  })

  it('adds an extended subset once a glyph falls in its range', () => {
    const chosen = chooseFaces([latin, latinExt], new Set(['archivo']), points('Schedā'))
    expect(chosen).toEqual([latin, latinExt])
  })

  it('matches the family case-insensitively, as CSS does', () => {
    expect(chooseFaces([latin], new Set(['archivo']), points('a'))).toEqual([latin])
    expect(chooseFaces([face('ARCHIVO', 'U+0000-00FF')], new Set(['archivo']), points('a'))).toHaveLength(1)
  })

  it('skips a declared family the subtree never asks for', () => {
    expect(chooseFaces([other], new Set(['archivo']), points('a'))).toEqual([])
  })

  it('keeps a face that declares no range at all', () => {
    const unranged = face('Archivo', null)
    expect(chooseFaces([unranged], new Set(['archivo']), points('a'))).toEqual([unranged])
  })

  it('chooses nothing when the subtree has no text, so a glyphless panel pays no payload', () => {
    expect(chooseFaces([latin], new Set(['archivo']), new Set())).toEqual([])
  })
})

// Where the faces come from. A face the plugin never reads is the same silent
// fallback as one it reads and fails to choose: the logo scene's letters lost
// every face its Google Fonts sheet declared, because that sheet was linked
// after install and refuses `cssRules` to script (2026-09-12).
describe('fontEmbedPlugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    // Drops the own property a test defined, uncovering the prototype getter.
    Reflect.deleteProperty(document, 'styleSheets')
    document.head.replaceChildren()
    document.body.replaceChildren()
  })

  /** Serve each URL's text; any other URL is a network failure. */
  const serve = (routes: Record<string, string>) =>
    vi.stubGlobal('fetch', async (url: string) => {
      const body = routes[url]
      if (body === undefined) throw new TypeError('Failed to fetch')
      return new Response(body)
    })

  /** The `@font-face` block the plugin appends to a clone of `live`. */
  const carried = async (live: HTMLElement, onUnreadable?: (href: string) => void) => {
    // SAFETY: cloning an element yields an element.
    const clone = live.cloneNode(true) as Element
    // SAFETY: the plugin's afterClone reads only `element` and `clone`.
    await fontEmbedPlugin(onUnreadable).afterClone?.({ element: live, clone } as never)
    return clone.querySelector('style')?.textContent ?? ''
  }

  const letter = (family: string) => {
    const live = document.createElement('span')
    live.style.fontFamily = `'${family}', serif`
    live.textContent = 'u'
    document.body.append(live)
    return live
  }

  it('reads a stylesheet the document gained after the fonts were warmed', async () => {
    serve({ 'https://lab.test/late.woff2': 'bytes' })
    warmCaptureFonts(document)
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'Late';src:url(https://lab.test/late.woff2)}"
    document.head.append(style)

    expect(await carried(letter('Late'))).toContain("font-family:'Late'")
  })

  it('reads a cross-origin stylesheet from its text, and names one it cannot fetch', async () => {
    const guest = 'https://fonts.test/css2?family=Guest'
    const locked = 'https://locked.test/fonts.css'
    serve({
      [guest]: "@font-face{font-family:'Guest';src:url(guest.woff2)}",
      'https://fonts.test/guest.woff2': 'bytes',
    })
    // Listed on `document.styleSheets` only, so the DOM's own style
    // resolution never meets a sheet that throws.
    const refusing = (href: string): CSSStyleSheet =>
      Object.create(CSSStyleSheet.prototype, {
        href: { value: href },
        cssRules: {
          get: () => {
            throw new DOMException('Cannot access rules', 'SecurityError')
          },
        },
      })
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [refusing(guest), refusing(locked)],
    })
    const unreadable: string[] = []

    const css = await carried(letter('Guest'), (href) => unreadable.push(href))
    // The face's `url()` resolves against the sheet, not the document.
    expect(css).toContain("font-family:'Guest'")
    expect(unreadable).toEqual([locked])
  })
})
