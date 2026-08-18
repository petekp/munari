// @vitest-environment happy-dom
//
// The anchor transaction — all of a paint's anchors, or none of them.
//
// Real elements, not stubs: the attribute selector is half of what this
// pins, and a stub answering every query with the same list would pass
// whatever selector the code drifted to.
import { describe, expect, it } from 'vitest'
import {
  anchorReceiptMatchesDrawn,
  collectSurfaceAnchors,
  projectSurfaceAnchor,
  stampSurfaceAnchors,
  type DomPaintReceipt,
} from '@munari/core'

const paint = (generation: number, width = 200, height = 100): DomPaintReceipt =>
  Object.freeze({
    frame: Object.freeze({ sourceId: 7, generation }),
    paintedSize: Object.freeze([width, height] as const),
    storeSize: Object.freeze([width * 2, height * 2] as const),
  })

const box = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
})

const node = (key: string, rect: DOMRect) => {
  const el = document.createElement('div')
  el.dataset.munariAnchor = key
  el.getBoundingClientRect = () => rect
  return el
}

const root = (nodes: HTMLElement[], rect = box(10, 20, 200, 100)) => {
  const el = document.createElement('div')
  el.append(...nodes)
  el.getBoundingClientRect = () => rect
  return el
}

describe('one complete painted anchor transaction', () => {
  it('publishes bottom-left normalized source UVs and keeps CSS size physical', () => {
    const receipt = collectSurfaceAnchors(
      root([node('meter', box(60, 45, 80, 40))]),
      paint(3),
      ['meter'] as const,
    )
    expect(receipt).not.toBeNull()
    const meter = receipt?.anchors.meter
    // Left edge 50px into a 200px root; the v axis runs up from the bottom,
    // so the DOM's TOP edge is the larger v.
    expect(meter?.uMin).toBeCloseTo(0.25, 12)
    expect(meter?.uMax).toBeCloseTo(0.65, 12)
    expect(meter?.vMin).toBeCloseTo(1 - 65 / 100, 12)
    expect(meter?.vMax).toBeCloseTo(1 - 25 / 100, 12)
    expect(meter?.cssWidth).toBe(80)
    expect(meter?.cssHeight).toBe(40)
  })

  it('freezes the receipt and its anchor map', () => {
    const receipt = collectSurfaceAnchors(
      root([node('meter', box(60, 45, 80, 40))]),
      paint(1),
      ['meter'] as const,
    )
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt?.anchors)).toBe(true)
  })
})

describe('an incomplete set is refused whole', () => {
  it('rejects a duplicate key', () => {
    // Two boxes claiming one name: whichever the selector reaches second
    // would silently win, and the matter parked on the first would move to
    // the second's place with nothing reporting a change.
    expect(
      collectSurfaceAnchors(
        root([node('meter', box(0, 0, 10, 10)), node('meter', box(50, 0, 10, 10))]),
        paint(1),
        ['meter'] as const,
      ),
    ).toBeNull()
  })

  it('rejects a missing required key, keeping the ones that were found out of reach', () => {
    expect(
      collectSurfaceAnchors(
        root([node('meter', box(0, 0, 10, 10))]),
        paint(1),
        ['meter', 'readout'] as const,
      ),
    ).toBeNull()
  })

  it('rejects a live root whose box no longer matches the paint', () => {
    // The root relaid out after the paint. Half the matter placed from this
    // measurement and half from the last one is a picture nobody reads as
    // wrong — every piece is plausibly placed.
    expect(
      collectSurfaceAnchors(
        root([node('meter', box(0, 0, 10, 10))], box(10, 20, 260, 100)),
        paint(1, 200, 100),
        ['meter'] as const,
      ),
    ).toBeNull()
  })

  it('admits a whole pixel of fractional-layout drift', () => {
    // A root measured at 200.5 and painted at 200 is the same root, and a
    // pixel is far below the smallest box anyone anchors to.
    expect(
      collectSurfaceAnchors(
        root([node('meter', box(0, 0, 10, 10))], box(10, 20, 200.5, 100)),
        paint(1, 200, 100),
        ['meter'] as const,
      ),
    ).not.toBeNull()
  })

  it('rejects a root with no box at all', () => {
    expect(
      collectSurfaceAnchors(
        root([node('meter', box(0, 0, 10, 10))], box(0, 0, 0, 0)),
        paint(1, 0, 0),
        ['meter'] as const,
      ),
    ).toBeNull()
  })
})

describe('projection into a live Surface box', () => {
  it('places the anchor centre by UV and keeps its captured CSS size', () => {
    const anchor = {
      uMin: 0.25,
      uMax: 0.75,
      vMin: 0.25,
      vMax: 0.75,
      cssWidth: 40,
      cssHeight: 20,
    }
    const placed = projectSurfaceAnchor(anchor, 800, 400)
    expect(placed.x).toBeCloseTo(400, 12)
    expect(placed.y).toBeCloseTo(200, 12)
    // Physical, not proportional: a control keeps its real size when the
    // panel it stands on resizes.
    expect(placed.cssWidth).toBe(40)
    expect(placed.cssHeight).toBe(20)
  })

  it('mirrors u only, never v', () => {
    const anchor = { uMin: 0, uMax: 0.5, vMin: 0, vMax: 0.5, cssWidth: 1, cssHeight: 1 }
    const placed = projectSurfaceAnchor(anchor, 100, 100, true)
    expect(placed.x).toBeCloseTo(75, 12)
    expect(placed.y).toBeCloseTo(75, 12)
  })
})

describe('a receipt speaks for one generation', () => {
  it('matches only the paint currently drawn', () => {
    const receipt = stampSurfaceAnchors(paint(4), { meter: {
      uMin: 0, uMax: 1, vMin: 0, vMax: 1, cssWidth: 1, cssHeight: 1,
    } })
    expect(anchorReceiptMatchesDrawn(receipt, 7, 4)).toBe(true)
    // A newer collection than the texture carries places matter where the
    // content is ABOUT to be — during a resize, one step ahead of the pixels.
    expect(anchorReceiptMatchesDrawn(receipt, 7, 3)).toBe(false)
    expect(anchorReceiptMatchesDrawn(receipt, 7, 5)).toBe(false)
    expect(anchorReceiptMatchesDrawn(receipt, 8, 4)).toBe(false)
  })

  it('re-stamping carries validated boxes to a newer paint without a layout read', () => {
    const first = collectSurfaceAnchors(
      root([node('meter', box(60, 45, 80, 40))]),
      paint(1),
      ['meter'] as const,
    )
    expect(first).not.toBeNull()
    if (!first) return
    const restamped = stampSurfaceAnchors(paint(2), first.anchors)
    expect(restamped.anchors).toEqual(first.anchors)
    expect(anchorReceiptMatchesDrawn(restamped, 7, 2)).toBe(true)
  })
})
