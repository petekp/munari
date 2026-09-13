// @vitest-environment happy-dom
// A block that turns. What a caller needs back is the page slot's box as the
// block itself states it, and a transform that lands the host on that box —
// both measured through a rect, which is the one thing a turn hides.
import { afterEach, expect, it } from 'vitest'
import { boxInHostSpace, hostSpace, inHostSpace, markerSpace, registerHostSpace } from './surfaceHostSpace'

afterEach(() => document.body.replaceChildren())

/** A marker in a block whose map to the screen is `place`. happy-dom lays
 *  nothing out, so the probes report what a browser would have measured. */
const parked = (place: DOMMatrix) => {
  const marker = document.createElement('div')
  const host = document.createElement('div')
  document.body.append(marker, host)
  registerHostSpace(host, marker)
  // The probes dock on the first measurement; stubbing them needs them standing.
  markerSpace(marker)
  for (const probe of marker.children) {
    if (!(probe instanceof HTMLElement)) continue
    const at = place.transformPoint(new DOMPoint(parseFloat(probe.style.left), parseFloat(probe.style.top)))
    probe.getBoundingClientRect = () => new DOMRect(at.x, at.y, 0, 0)
  }
  return { host, marker }
}

/** A slot of `width` x `height` standing at (x, y) in the block, reporting
 *  the bounding rect the block would give it. */
const slot = (place: DOMMatrix, box: { x: number; y: number; width: number; height: number }) => {
  const element = document.createElement('div')
  element.style.cssText = `box-sizing:border-box;width:${box.width}px;height:${box.height}px`
  document.body.append(element)
  const corners: DOMPoint[] = []
  for (const [dx, dy] of [[0, 0], [box.width, 0], [0, box.height], [box.width, box.height]] as const) {
    corners.push(place.transformPoint(new DOMPoint(box.x + dx, box.y + dy)))
  }
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y)
  element.getBoundingClientRect = () => new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  return element
}

const TURNED = new DOMMatrix().translateSelf(300, 120).rotateSelf(12).scaleSelf(1.5)

it('reads a page slot in the coordinates of the block that turns it', () => {
  const { host } = parked(TURNED)
  const space = hostSpace(host)
  if (!space) throw new Error('the block is measurable')
  const box = { x: 7.25, y: 12.5, width: 80.5, height: 40.25 }
  const read = boxInHostSpace(slot(TURNED, box), space)
  expect(read?.width).toBeCloseTo(box.width, 6)
  expect(read?.height).toBeCloseTo(box.height, 6)
  expect(read?.x).toBeCloseTo(box.x, 6)
  expect(read?.y).toBeCloseTo(box.y, 6)
})

it('reads a page slot from its rect alone while the block stays square to the screen', () => {
  const square = new DOMMatrix().translateSelf(40, 90).scaleSelf(2)
  const { host } = parked(square)
  const space = hostSpace(host)
  if (!space) throw new Error('the block is measurable')
  const element = document.createElement('div')
  element.getBoundingClientRect = () => new DOMRect(40 + 2 * 10, 90 + 2 * 20, 2 * 60, 2 * 30)
  expect(boxInHostSpace(element, space)).toEqual({ x: 10, y: 20, width: 60, height: 30 })
})

it('writes a transform that lands the host on the box the caller asked for', () => {
  const { host } = parked(TURNED)
  const space = hostSpace(host)
  if (!space) throw new Error('the block is measurable')
  const asked = [2, 0, 0, 0.8, 410, 260]
  const landed = space.multiply(new DOMMatrix(inHostSpace(space, asked)))
  for (const [i, key] of (['a', 'b', 'c', 'd', 'e', 'f'] as const).entries()) {
    expect(landed[key]).toBeCloseTo(asked[i]!, 6)
  }
})

it('refuses a block that has collapsed, having no space to place anything in', () => {
  const { host, marker } = parked(new DOMMatrix([0, 0, 0, 0, 0, 0]))
  expect(markerSpace(marker)).toBeNull()
  expect(hostSpace(host)).toBeNull()
})

it('answers the identity for a host nobody registered, which is parked at the viewport', () => {
  expect(hostSpace(document.createElement('div'))?.isIdentity).toBe(true)
})
