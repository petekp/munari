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
// happy-dom declares neither context type, so each case stubs the globals it
// needs. A browser without the trial has both types and neither member.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectHtmlInCanvas } from '@munari/core'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectHtmlInCanvas', () => {
  it('reports the trial absent when the context types exist without its members', () => {
    // The probe must read the member, not the existence of the context type.
    vi.stubGlobal('CanvasRenderingContext2D', class {})
    vi.stubGlobal('WebGL2RenderingContext', class {})
    expect(detectHtmlInCanvas()).toEqual({
      drawElementImage: false,
      texElementImage2D: false,
    })
  })

  it('reports each entry point present when its prototype carries the member', () => {
    class WithTrial {
      drawElementImage() {}
    }
    vi.stubGlobal('CanvasRenderingContext2D', WithTrial)
    vi.stubGlobal('WebGL2RenderingContext', class {})
    expect(detectHtmlInCanvas()).toEqual({
      drawElementImage: true,
      texElementImage2D: false,
    })
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
