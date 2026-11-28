// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { attachSurfaceLight, createSurfaceLight } from './surfaceLight'

function makeTrusted(ev: PointerEvent): PointerEvent {
  Object.defineProperty(ev, 'isTrusted', { value: true })
  return ev
}

describe('createSurfaceLight pointer follow guard', () => {
  it('tracks trusted viewport pointermove and ignores synthetic/relayed events', () => {
    const light = createSurfaceLight({ follow: 'pointer' })
    let invalidations = 0
    const detach = attachSurfaceLight(light, () => {
      invalidations += 1
    })

    const realMove = makeTrusted(new PointerEvent('pointermove', { clientX: 640, clientY: 360, pointerType: 'mouse' }))
    window.dispatchEvent(realMove)
    expect(light.get().x).toBe(640)
    expect(light.get().y).toBe(360)
    const countAfterReal = invalidations
    expect(countAfterReal).toBeGreaterThan(0)

    const syntheticRelayed = new PointerEvent('pointermove', { clientX: 12, clientY: 8, pointerType: 'mouse' })
    window.dispatchEvent(syntheticRelayed)

    expect(light.get().x).toBe(640)
    expect(light.get().y).toBe(360)
    expect(invalidations).toBe(countAfterReal)

    detach()
  })
})
