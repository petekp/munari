// The selection seam. A wrong answer here is silent: the capture gets FASTER,
// the payload SHRINKS, and the text rasterizes in a fallback face — which is
// exactly how the first version of this module passed every other check while
// embedding nothing (2026-09-11).

import { describe, expect, it } from 'vitest'
import { chooseFaces, parseRanges } from './snapdomFonts'

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
