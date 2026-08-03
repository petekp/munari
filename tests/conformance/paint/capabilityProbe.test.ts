// @vitest-environment happy-dom
//
// The capability probe. A library built entirely on an origin-trial API owes
// its consumer one honest question — "is the API here at all?" — and the
// contract is the honesty, not the detection trick: in ANY environment,
// including one with no DOM globals whatsoever, the probe returns booleans
// and never throws. A probe that throws in Node would poison SSR and test
// runners; a probe that guesses `true` would let a UI advertise a capability
// the first Surface then fails to deliver.
//
// happy-dom has the 2D context type but not the trial members, which makes
// it exactly the "browser without the trial" case the chips exist to catch.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectHtmlInCanvas } from '@anamorph/core'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectHtmlInCanvas', () => {
  it('reports the trial absent in a browser without it, as two booleans', () => {
    const support = detectHtmlInCanvas()
    expect(Object.keys(support).sort()).toEqual(['drawElementImage', 'texElementImage2D'])
    // happy-dom defines CanvasRenderingContext2D without drawElementImage —
    // the probe must read that as absence, not existence of the context type.
    expect(support.drawElementImage).toBe(false)
  })

  it('reports the trial present when the prototype carries the member', () => {
    class WithTrial {}
    ;(WithTrial.prototype as Record<string, unknown>).drawElementImage = () => {}
    vi.stubGlobal('CanvasRenderingContext2D', WithTrial)
    expect(detectHtmlInCanvas().drawElementImage).toBe(true)
  })

  it('never throws without DOM globals — absence is an answer, not an error', () => {
    vi.stubGlobal('CanvasRenderingContext2D', undefined)
    vi.stubGlobal('WebGL2RenderingContext', undefined)
    expect(detectHtmlInCanvas()).toEqual({
      drawElementImage: false,
      texElementImage2D: false,
    })
  })
})
