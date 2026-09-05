// Plume ledger tests — the exact text and cells that keep their clocks.
//
// The law: editing one unit cannot disturb another unit's identity, and an
// anchor can stamp only the grains inside its own UV box. These are the two
// quiet errors that turn a delayed word effect into a page-wide restart.
//
// The regression budget, 2026-08-31: append, middle edit, duplicate words,
// rearm, phase boundaries, a 4×2 grain field, and character mode — grapheme
// clusters, identity through a middle insertion, and one clock per letter.
// Ownership: this suite pins pure scene behavior; browser evidence must
// still judge typography and air.

import { describe, expect, it } from 'vitest'
import { buildPlumeGrid, stampPlumeReleases } from './plumeCloud'
import {
  nextTimelineBoundary,
  rearmUnits,
  reconcileUnits,
  splitUnits,
  unitPhase,
} from './plumeLaw'

describe('plume word identity', () => {
  it('retains exact words and refreshes only the word being edited', () => {
    const first = reconcileUnits([], 'one quiet thought', 'word', 100, 900, 0)
    const second = reconcileUnits(first.units, 'one quieter thought', 'word', 500, 900, first.nextId)
    expect(second.units.map((unit) => unit.id)).toEqual([
      first.units[0]?.id,
      'plume-unit-3',
      first.units[2]?.id,
    ])
    expect(second.units.map((unit) => unit.releaseAt)).toEqual([1000, 1400, 1000])
  })

  it('keeps duplicate words in stable order around an insertion', () => {
    const first = reconcileUnits([], 'air air', 'word', 0, 1000, 0)
    const second = reconcileUnits(first.units, 'soft air air', 'word', 20, 1000, first.nextId)
    expect(second.units.slice(1).map((unit) => unit.id)).toEqual(
      first.units.map((unit) => unit.id),
    )
  })

  it('retains whitespace offsets and reconstructs the source exactly', () => {
    const value = '  one\n two\tthree  '
    const units = splitUnits(value, 'word')
    expect(units.map((unit) => [unit.text, unit.start, unit.end])).toEqual([
      ['one', 2, 5],
      ['two', 7, 10],
      ['three', 11, 16],
    ])
  })

  it('rearms identity and exposes only real DOM phase boundaries', () => {
    const first = reconcileUnits([], 'weather', 'word', 0, 100, 0)
    const armed = rearmUnits(first.units, 500, 100)
    const unit = armed[0]
    expect(unit?.id).toBe(first.units[0]?.id)
    if (!unit) throw new Error('expected one unit')
    expect(unitPhase(unit, 599, 300)).toBe('held')
    expect(unitPhase(unit, 600, 300)).toBe('pluming')
    expect(unitPhase(unit, 900, 300)).toBe('gone')
    expect(nextTimelineBoundary(armed, 550, 300)).toBe(600)
    expect(nextTimelineBoundary(armed, 700, 300)).toBe(900)
  })
})

describe('plume character identity', () => {
  it('splits on grapheme clusters and drops whitespace between them', () => {
    // A letter and its combining acute are two code units and one mark.
    const units = splitUnits('á b', 'character')
    expect(units.map((unit) => [unit.text, unit.start, unit.end])).toEqual([
      ['á', 0, 2],
      ['b', 3, 4],
    ])
  })

  it('treats an emoji with a modifier as one releasable mark', () => {
    // A waving hand plus a skin-tone modifier is four UTF-16 code units and
    // one thing a reader sees; splitting it would release half a glyph.
    const units = splitUnits('\u{1F44B}\u{1F3FD}', 'character')
    expect(units).toHaveLength(1)
    expect(units[0]?.end).toBe(4)
  })

  it('gives every typed character its own clock in typing order', () => {
    let ledger = reconcileUnits([], '', 'character', 0, 500, 0)
    for (let typed = 1; typed <= 3; typed++) {
      ledger = reconcileUnits(
        ledger.units,
        'ink'.slice(0, typed),
        'character',
        typed * 300,
        500,
        ledger.nextId,
      )
    }
    expect(ledger.units.map((unit) => unit.text)).toEqual(['i', 'n', 'k'])
    expect(ledger.units.map((unit) => unit.releaseAt)).toEqual([800, 1100, 1400])
  })

  it('keeps each character clock through an insertion in the middle', () => {
    const first = reconcileUnits([], 'air', 'character', 0, 500, 0)
    const spaced = reconcileUnits(first.units, 'a i r', 'character', 900, 500, first.nextId)
    expect(spaced.units.map((unit) => unit.id)).toEqual(first.units.map((unit) => unit.id))
    expect(spaced.units.map((unit) => unit.releaseAt)).toEqual([500, 500, 500])
    const inserted = reconcileUnits(spaced.units, 'ahir', 'character', 1200, 500, spaced.nextId)
    expect(inserted.units.map((unit) => unit.text)).toEqual(['a', 'h', 'i', 'r'])
    expect(inserted.units.map((unit) => unit.releaseAt)).toEqual([500, 1700, 500, 500])
  })
})

describe('plume release grid', () => {
  it('stamps one anchor and leaves every outside grain unreleased', () => {
    const grid = buildPlumeGrid(40, 20, 10)
    const unit = reconcileUnits([], 'ink', 'word', 0, 1000, 0).units[0]
    if (!unit) throw new Error('expected one unit')
    stampPlumeReleases(grid, [unit], {
      [unit.id]: {
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

describe('plume restore while flying', () => {
  // A mid-flight Restore is the path the demand-canvas invalidation contract
  // in PlumeFrames must cover. The timeline `now` only advances when a boundary
  // setTimeout fires, so while ink is flying it stays pinned at the last
  // boundary (the unit's releaseAt). Restore re-arms with live wall time, which
  // has already moved past releaseAt. Against the stale `now`, every unit reads
  // 'held' again — flipping `animating` false in the same commit that stamps
  // the future-dated `aRelease` buffer — and the next boundary jumps to the
  // new releaseAt, ~holdMs away. That is the window a final invalidate must
  // paint, or the demand canvas freezes on its last flying-particle framebuffer
  // until the boundary timer finally fires (the freeze-and-pop in #2b4410f).
  it('flips every flying unit back to held and pushes the next boundary to the new release', () => {
    const heldMs = 1500
    const durationMs = 300
    const releaseAt = 1000
    const timelineNow = releaseAt
    const wallNow = releaseAt + 200
    const flying = reconcileUnits([], 'weather', 'word', releaseAt - heldMs, heldMs, 0)
    const unit = flying.units[0]
    if (!unit) throw new Error('expected one flying unit')
    expect(unit.releaseAt).toBe(releaseAt)
    expect(unitPhase(unit, timelineNow, durationMs)).toBe('pluming')

    const restored = rearmUnits(flying.units, wallNow, heldMs)
    const restoredUnit = restored[0]
    if (!restoredUnit) throw new Error('expected one restored unit')
    expect(restoredUnit.id).toBe(unit.id)
    expect(restoredUnit.releaseAt).toBe(wallNow + heldMs)
    // Against the stale timeline `now`, every unit reads held, so the derived
    // animating flag (units.some(phaseOf === 'pluming')) flips false.
    expect(restored.map((restoredUnit) => unitPhase(restoredUnit, timelineNow, durationMs))).toEqual(['held'])
    expect(restored.some((restoredUnit) => unitPhase(restoredUnit, timelineNow, durationMs) === 'pluming')).toBe(false)
    // The next boundary is the new releaseAt — holdMs ahead of the wall time
    // Restore used — the freeze window the final invalidate must cover.
    expect(nextTimelineBoundary(restored, timelineNow, durationMs)).toBe(wallNow + heldMs)
  })
})
