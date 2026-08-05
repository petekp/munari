// The kernel exports `paintStats` with no window global; where it
// hangs is the consumer's choice.

// @vitest-environment happy-dom
//
// The paint ledger. Parked source canvases all stack at the same fixed
// position, occluding each other — per-source counters are the only way to
// see whether the occluded ones keep painting (a source whose `paints`
// stalls while siblings advance is starved). Two clauses carry the weight:
// `[]` after a lifecycle is the canonical nothing-left-painting proof,
// and `paints` deltas are the idle-zero gate's raw feed. happy-dom has
// no compositor, so the trial surface is stubbed and paints are driven
// by hand.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDomTextureSource, paintStats } from '@munari/core'

interface StubCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

/** The paint path's whole context vocabulary, controllable per test. */
const ctx = {
  setTransform: () => {},
  clearRect: () => {},
  drawElementImage: vi.fn(),
}

beforeEach(() => {
  const proto = HTMLCanvasElement.prototype as unknown as StubCanvas
  proto.layoutSubtree = false
  proto.onpaint = null
  proto.requestPaint = function () {}
  // The factory's capability gate reads the PROTOTYPE, not the instance the
  // getContext spy below hands back — a browser with one and not the other
  // does not exist, and the gate refuses to pretend otherwise. happy-dom has
  // no CanvasRenderingContext2D global (the probe reaches it via `typeof`),
  // so the constructor itself has to be stubbed in.
  class Ctx2D {}
  ;(Ctx2D.prototype as unknown as Record<string, unknown>).drawElementImage = function () {}
  vi.stubGlobal('CanvasRenderingContext2D', Ctx2D)
  ctx.drawElementImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  // A test that leaks a live source would poison every later `[]`
  // assertion; drain deliberately instead of trusting test order.
  expect(paintStats()).toEqual([])
})

function make(label?: string) {
  return createDomTextureSource('<div></div>', 100, 50, label ? { label } : {})
}

/** The single live entry — asserting there IS exactly one while narrowing. */
function only() {
  const all = paintStats()
  expect(all).toHaveLength(1)
  return all[0]!
}

/** Fire the compositor's callback by hand — one "paint". */
function paint(s: { canvas: HTMLCanvasElement }) {
  ;(s.canvas as StubCanvas).onpaint?.()
}

describe('paintStats', () => {
  it('registers every live source under its label and forgets it on dispose — [] is the cleanup proof', () => {
    const a = make('a')
    const b = make('b')
    expect(paintStats().map((s) => s.label).sort()).toEqual(['a', 'b'])

    a.dispose()
    expect(paintStats().map((s) => s.label)).toEqual(['b'])

    b.dispose()
    expect(paintStats()).toEqual([])
  })

  it('returns copies — a mutated snapshot changes nothing', () => {
    const s = make('copy')
    const snap = only()
    snap.paints = 999
    snap.label = 'vandalized'
    expect(only()).toMatchObject({ label: 'copy', paints: 0 })
    s.dispose()
  })

  it('advances paints on each successful paint, agreeing with the source\'s own paintCount', () => {
    const s = make('live')
    paint(s)
    paint(s)
    const entry = only()
    expect(entry.paints).toBe(2)
    expect(entry.errors).toBe(0)
    // One ledger per source: the registry reads the same counter
    // paintCount() reports, so the two views cannot disagree.
    expect(s.paintCount()).toBe(2)
    s.dispose()
  })

  it('records a failing paint as errors + lastError, and painted() stays false', () => {
    const s = make('broken')
    ctx.drawElementImage = vi.fn(() => {
      throw new Error('No cached paint record for element')
    })
    paint(s)
    const entry = only()
    expect(entry.paints).toBe(0)
    expect(entry.errors).toBe(1)
    expect(entry.lastError).toContain('No cached paint record')
    expect(s.painted()).toBe(false)
    s.dispose()
  })

  it('mirrors the live LOD scale, so a stalled tier swap is visible from outside', () => {
    const s = make('lod')
    s.setScale(2)
    expect(only().scale).toBe(2)
    s.dispose()
  })

  it('gives unlabeled sources distinct default labels — entries never shadow each other', () => {
    const a = make()
    const b = make()
    const labels = paintStats().map((s) => s.label)
    expect(labels[0]).not.toBe(labels[1])
    expect(labels.every((l) => l.length > 0)).toBe(true)
    a.dispose()
    b.dispose()
  })
})
