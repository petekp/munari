// Plume ledger tests — the exact text and cells that keep their clocks.
//
// The law: editing one word cannot disturb another word's identity, and an
// anchor can stamp only the grains inside its own UV box. These are the two
// quiet errors that turn a delayed word effect into a page-wide restart.
//
// The regression budget, 2026-08-30: append, middle edit, duplicate words,
// rearm, phase boundaries, and a 4×2 grain field. Ownership: this suite pins
// pure scene behavior; browser evidence must still judge typography and air.

import { describe, expect, it } from 'vitest'
import { buildPlumeGrid, stampPlumeReleases } from './plumeCloud'
import {
  nextTimelineBoundary,
  rearmWords,
  reconcileWords,
  splitWords,
  wordPhase,
} from './plumeLaw'

describe('plume word identity', () => {
  it('retains exact words and refreshes only the word being edited', () => {
    const first = reconcileWords([], 'one quiet thought', 100, 900, 0)
    const second = reconcileWords(first.words, 'one quieter thought', 500, 900, first.nextId)
    expect(second.words.map((word) => word.id)).toEqual([
      first.words[0]?.id,
      'plume-word-3',
      first.words[2]?.id,
    ])
    expect(second.words.map((word) => word.releaseAt)).toEqual([1000, 1400, 1000])
  })

  it('keeps duplicate words in stable order around an insertion', () => {
    const first = reconcileWords([], 'air air', 0, 1000, 0)
    const second = reconcileWords(first.words, 'soft air air', 20, 1000, first.nextId)
    expect(second.words.slice(1).map((word) => word.id)).toEqual(
      first.words.map((word) => word.id),
    )
  })

  it('retains whitespace offsets and reconstructs the source exactly', () => {
    const value = '  one\n two\tthree  '
    const words = splitWords(value)
    expect(words.map((word) => [word.text, word.start, word.end])).toEqual([
      ['one', 2, 5],
      ['two', 7, 10],
      ['three', 11, 16],
    ])
  })

  it('rearms identity and exposes only real DOM phase boundaries', () => {
    const first = reconcileWords([], 'weather', 0, 100, 0)
    const armed = rearmWords(first.words, 500, 100)
    const word = armed[0]
    expect(word?.id).toBe(first.words[0]?.id)
    if (!word) throw new Error('expected one word')
    expect(wordPhase(word, 599, 300)).toBe('held')
    expect(wordPhase(word, 600, 300)).toBe('pluming')
    expect(wordPhase(word, 900, 300)).toBe('gone')
    expect(nextTimelineBoundary(armed, 550, 300)).toBe(600)
    expect(nextTimelineBoundary(armed, 700, 300)).toBe(900)
  })
})

describe('plume release grid', () => {
  it('stamps one anchor and leaves every outside grain unreleased', () => {
    const grid = buildPlumeGrid(40, 20, 10)
    const word = reconcileWords([], 'ink', 0, 1000, 0).words[0]
    if (!word) throw new Error('expected one word')
    stampPlumeReleases(grid, [word], {
      [word.id]: {
        uMin: 0.25,
        uMax: 0.75,
        vMin: 0.5,
        vMax: 1,
        cssWidth: 20,
        cssHeight: 10,
      },
    })
    const values = Array.from(grid.geometry.getAttribute('aRelease').array)
    const cells = Array.from({ length: 8 }, (_, cell) => values[cell * 4])
    expect(cells).toEqual([1e9, 1, 1, 1e9, 1e9, 1e9, 1e9, 1e9])
    grid.geometry.dispose()
  })
})
