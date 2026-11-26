// @vitest-environment happy-dom
// The selection seam. A wrong answer here is silent: the capture gets FASTER,
// the payload SHRINKS, and the text rasterizes in a fallback face — which is
// exactly how the first version of this module passed every other check while
// embedding nothing (2026-09-11).

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureContext } from '@zumer/snapdom'
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

  it('keeps a face that declares no range at all', () => {
    const unranged = face('Archivo', null)
    expect(chooseFaces([unranged], new Set(['archivo']), points('a'))).toEqual([unranged])
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

  const carried = async (live: HTMLElement, onUnreadable?: (href: string) => void) => {
    const clone = live.cloneNode(true)
    if (!(clone instanceof HTMLElement)) throw new Error('Expected an HTML clone')
    const context: CaptureContext = {
      element: live, clone, fontsCSS: '', exclude: [], excludePredicates: null,
      filter: null, format: 'svg', type: 'svg', needs: 'render',
      shouldExclude: () => false,
      get options() { return context },
    }
    await fontEmbedPlugin(onUnreadable).beforeRender?.(context)
    return context.fontsCSS ?? ''
  }

  const letter = (family: string) => {
    const live = document.createElement('span')
    live.style.fontFamily = `'${family}', serif`
    live.textContent = 'u'
    document.body.append(live)
    return live
  }

  it('embeds no font payload for a subtree with no text, including unrestricted faces', async () => {
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'Empty';src:url(https://lab.test/empty.woff2)}"
    document.head.append(style)
    serve({ 'https://lab.test/empty.woff2': 'bytes' })
    const live = letter('Empty')
    live.textContent = ''
    expect(await carried(live)).toBe('')
  })

  it.each([
    ['value', { value: 'Direct projections' }],
    ['placeholder', { placeholder: 'Direct projections' }],
  ])('embeds the face for a text field whose only text is its %s', async (_, props) => {
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'Field';src:url(https://lab.test/field.woff2)}"
    document.head.append(style)
    serve({ 'https://lab.test/field.woff2': 'bytes' })
    const field = Object.assign(document.createElement('input'), props)
    field.style.fontFamily = "'Field', serif"
    document.body.append(field)

    expect(await carried(field)).toContain("font-family:'Field'")
  })

  it('embeds no face for a checkbox, which draws no text from its value', async () => {
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'Field';src:url(https://lab.test/field.woff2)}"
    document.head.append(style)
    serve({ 'https://lab.test/field.woff2': 'bytes' })
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' })
    box.style.fontFamily = "'Field', serif"
    document.body.append(box)

    expect(await carried(box)).toBe('')
  })

  it('reads a stylesheet the document gained after the fonts were warmed', async () => {
    serve({ 'https://lab.test/late.woff2': 'bytes' })
    warmCaptureFonts(document)
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'Late';src:url(https://lab.test/late.woff2)}"
    document.head.append(style)

    const css = await carried(letter('Late'))
    expect(css).toContain("font-family:'Late'")
    expect(css).toContain('data:font/woff2;base64,Ynl0ZXM=')
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
    expect(css).toContain('data:font/woff2;base64,Ynl0ZXM=')
    expect(unreadable).toEqual([locked])
  })

  it('retries font and cross-origin stylesheet fetches after transient failures', async () => {
    const flakySheet = 'https://fonts.test/css2?family=FlakySheet'
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'RetryFace';src:url(https://lab.test/retry.woff2)}"
    document.head.append(style)

    const sheet = Object.create(CSSStyleSheet.prototype, {
      href: { value: flakySheet },
      cssRules: {
        get: () => {
          throw new DOMException('Cannot access rules', 'SecurityError')
        },
      },
    })
    const baseStyleSheet = style.sheet
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: baseStyleSheet ? [baseStyleSheet, sheet] : [sheet],
    })

    let online = false
    vi.stubGlobal('fetch', async (url: string) => {
      if (!online) return new Response('unavailable', { status: 503 })
      if (url === 'https://lab.test/retry.woff2') return new Response('retry-bytes')
      if (url === flakySheet) {
        return new Response("@font-face{font-family:'FlakySheet';src:url(https://fonts.test/flaky.woff2)}")
      }
      if (url === 'https://fonts.test/flaky.woff2') return new Response('sheet-bytes')
      throw new TypeError('Failed to fetch')
    })

    const retryNode = letter('RetryFace')
    const sheetNode = letter('FlakySheet')
    expect(await carried(retryNode)).toBe('')
    expect(await carried(sheetNode)).toBe('')

    online = true
    expect(await carried(retryNode)).toContain('data:font/woff2;base64,')
    expect(await carried(sheetNode)).toContain("font-family:'FlakySheet'")
  })

  it('fetches a font that answers 404 once across captures', async () => {
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'GoneFace';src:url(https://lab.test/gone.woff2)}"
    document.head.append(style)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return new Response('missing', { status: 404 })
    })

    const node = letter('GoneFace')
    for (let capture = 0; capture < 3; capture += 1) expect(await carried(node)).toBe('')
    expect(calls).toBe(1)
  })

  it('survives synchronous fetch throws and throttles repeated cross-origin sheet retries', async () => {
    const blockedSheet = 'https://blocked.test/fonts.css'
    const sheet = Object.create(CSSStyleSheet.prototype, {
      href: { value: blockedSheet },
      cssRules: {
        get: () => {
          throw new DOMException('Cannot access rules', 'SecurityError')
        },
      },
    })
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [sheet],
    })

    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls += 1
      throw new TypeError('Synchronous network throw')
    })

    const node = letter('Blocked')
    for (let i = 0; i < 6; i++) {
      expect(await carried(node)).toBe('')
    }
    expect(calls).toBe(4)
  })

  it('throttles repeated retries of a font face whose fetch throws', async () => {
    const style = document.createElement('style')
    style.textContent = "@font-face{font-family:'BlockedFace';src:url(https://blocked.test/face.woff2)}"
    document.head.append(style)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw new TypeError('Failed to fetch')
    })

    const node = letter('BlockedFace')
    for (let capture = 0; capture < 6; capture += 1) expect(await carried(node)).toBe('')
    expect(calls).toBe(4)
  })

  it.each([
    ['ttf extension', 'https://lab.test/body.ttf', undefined, 'data:font/ttf;base64,', "format('truetype')"],
    ['otf extension', 'https://lab.test/display.otf?v=2', undefined, 'data:font/otf;base64,', "format('opentype')"],
    ['woff extension', 'https://lab.test/legacy.woff', undefined, 'data:font/woff;base64,', "format('woff')"],
    ['ttf content-type', 'https://lab.test/font?id=7', 'font/ttf', 'data:font/ttf;base64,', "format('truetype')"],
  ])('preserves font MIME and CSS format for %s', async (_, url, contentType, expectedMime, expectedFormat) => {
    const family = `Fmt${url.length}`
    const style = document.createElement('style')
    style.textContent = `@font-face{font-family:'${family}';src:url(${url})}`
    document.head.append(style)
    vi.stubGlobal('fetch', async (requested: string) => {
      if (requested !== url) throw new TypeError('Failed to fetch')
      return new Response('bytes', contentType ? { headers: { 'content-type': contentType } } : undefined)
    })

    const css = await carried(letter(family))
    expect(css).toContain(expectedMime)
    expect(css).toContain(expectedFormat)
  })
})
