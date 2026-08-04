import { describe, expect, it } from 'vitest'
import { textRuns } from './passageMeasure'

/**
 * A flying word is a quad cut out of a rasterised card, so the set of runs has
 * to account for EVERY inked character in the text node. The first cut of this
 * used `Intl.Segmenter`'s `isWordLike` to pick segments, which silently drops
 * every hyphen, comma, period and separator: the card landed reading
 * "A box shadow lives outside the border box  and the" against a DOM that read
 * "A box-shadow lives outside the border box, and the". Measured against the
 * landed page 2026-08-04.
 */
const slice = (text: string, runs: ReturnType<typeof textRuns>) =>
  runs.map((r) => text.slice(r.index, r.index + r.length))

describe('textRuns', () => {
  it('accounts for every non-whitespace character', () => {
    const text = 'A box-shadow lives outside the border box, and the'
    expect(slice(text, textRuns(text)).join('')).toBe(text.replace(/\s+/g, ''))
  })

  it('keeps punctuation glued to the word it follows', () => {
    const text = 'the border box, and'
    expect(slice(text, textRuns(text))).toContain('box,')
  })

  it('breaks after a hyphen, because the browser may too', () => {
    const runs = slice('box-shadow', textRuns('box-shadow'))
    expect(runs).toEqual(['box-', 'shadow'])
  })

  it('keeps a free-standing separator as its own run', () => {
    expect(slice('Chrome 150 · 6 min', textRuns('Chrome 150 · 6 min'))).toEqual([
      'Chrome',
      '150',
      '·',
      '6',
      'min',
    ])
  })

  it('never emits an empty or whitespace-only run', () => {
    const text = '  PLATFORM · 04\n  '
    for (const r of textRuns(text)) {
      expect(r.length).toBeGreaterThan(0)
      expect(text.slice(r.index, r.index + r.length)).toMatch(/\S/)
    }
  })

  it('returns runs in document order, non-overlapping', () => {
    const text = 'A box-shadow lives outside the border box, and the'
    let end = 0
    for (const r of textRuns(text)) {
      expect(r.index).toBeGreaterThanOrEqual(end)
      end = r.index + r.length
    }
  })

  it('has nothing to say about whitespace', () => {
    expect(textRuns('   \n  ')).toEqual([])
  })
})
