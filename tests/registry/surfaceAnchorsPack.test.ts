import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DomPaintReceipt } from '@petepetrash/munari'
import {
  collectSurfaceAnchors,
  projectSurfaceAnchor,
} from '../../registry/surface-anchors/surfaceAnchors'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const paint = (generation: number, width = 200, height = 100): DomPaintReceipt =>
  Object.freeze({
    frame: Object.freeze({ sourceId: 7, generation }),
    paintedSize: Object.freeze([width, height] as const),
    storeSize: Object.freeze([width * 2, height * 2] as const),
  })
const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
})
const node = (key: string, rect: ReturnType<typeof box>) =>
  ({ dataset: { munariAnchor: key }, getBoundingClientRect: () => rect }) as unknown as HTMLElement
const root = (nodes: HTMLElement[], rect = box(10, 20, 200, 100)) =>
  ({
    getBoundingClientRect: () => rect,
    querySelectorAll: () => nodes,
  }) as unknown as HTMLElement

describe('surface-anchor registry weld', () => {
  it('is byte-identical to the two-consumer lab module', () => {
    expect(read('registry/surface-anchors/surfaceAnchors.ts')).toBe(
      read('apps/lab/src/lib/surfaceAnchors.ts'),
    )
  })
})

describe('one complete painted anchor transaction', () => {
  it('uses bottom-left normalized source UVs and freezes the receipt', () => {
    const receipt = collectSurfaceAnchors(
      root([node('film', box(60, 45, 80, 40))]),
      paint(3),
      ['film'] as const,
    )
    expect(receipt?.anchors.film).toEqual({
      uMin: 0.25,
      vMin: 0.35,
      uMax: 0.65,
      vMax: 0.75,
      cssWidth: 80,
      cssHeight: 40,
    })
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt?.anchors.film)).toBe(true)
  })

  it('rejects duplicate, missing, and wrong-generation boxes without a partial map', () => {
    expect(
      collectSurfaceAnchors(root([node('film', box(10, 20, 80, 40)), node('film', box(90, 20, 80, 40))]), paint(1), ['film']),
    ).toBeNull()
    expect(collectSurfaceAnchors(root([]), paint(1), ['film'])).toBeNull()
    expect(
      collectSurfaceAnchors(root([node('film', box(10, 20, 80, 40))], box(10, 20, 201.1, 100)), paint(1), ['film']),
    ).toBeNull()
  })

  it('tracks a same-size reorder with a newer paint generation', () => {
    const before = collectSurfaceAnchors(root([node('film', box(30, 30, 80, 40))]), paint(1), ['film'])
    const after = collectSurfaceAnchors(root([node('film', box(30, 70, 80, 40))]), paint(2), ['film'])
    expect(after?.paint.frame.generation).toBe(2)
    expect(after?.anchors.film.vMin).not.toBe(before?.anchors.film.vMin)
  })

  it('keeps the physical size while position follows the Surface and mirror', () => {
    const receipt = collectSurfaceAnchors(
      root([node('hardware', box(50, 40, 66, 24))]),
      paint(1),
      ['hardware'] as const,
    )
    const anchor = receipt!.anchors.hardware
    const compact = projectSurfaceAnchor(anchor, 200, 100)
    const wide = projectSurfaceAnchor(anchor, 560, 100, true)
    expect(compact.cssWidth).toBe(66)
    expect(wide.cssWidth).toBe(66)
    expect(compact.cssHeight).toBe(24)
    expect(wide.cssHeight).toBe(24)
    expect(wide.x).toBeCloseTo((1 - compact.x / 200) * 560)
  })
})
