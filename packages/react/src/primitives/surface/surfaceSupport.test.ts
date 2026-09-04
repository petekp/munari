// @vitest-environment happy-dom
//
// The hook's contract, which is not the function's.
//
// `supportsDOMSurfaces` only renames a core probe, and that probe's honesty
// — booleans in any environment, never a throw — is pinned in
// `tests/conformance/paint/capabilityProbe.test.ts`. What is pinned HERE is
// the reason a hook exists beside it: the first client pass must answer
// `false` even when the browser CAN present, because React compares that
// pass against server markup. A `useMemo` reading the capability directly
// disagrees with the server on exactly the machines this library is for,
// which is why the three lab scenes that wrote one had a latent hydration
// mismatch (2026-08-23).
//
// The trial is stubbed the same way core stubs it — no runner has it.
//
// No JSX: the runner only discovers `.test.ts`.
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectHtmlInCanvas } from '@munari/core'
import { supportsSurfaces, useSurfaceSupport } from './surfaceSupport'

const containers: HTMLElement[] = []

afterEach(() => {
  for (const container of containers.splice(0)) container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Give the runner the one trial member a Surface needs. */
function stubTrial() {
  class WithTrial {
    drawElementImage() {}
  }
  vi.stubGlobal('CanvasRenderingContext2D', WithTrial)
}

/** Hydrate a probe against server markup that always says `no`. */
function hydrate() {
  const container = document.createElement('div')
  container.innerHTML = '<p>no</p>'
  document.body.append(container)
  containers.push(container)
  const seen: string[] = []
  const Probe = () => {
    const answer = useSurfaceSupport() ? 'yes' : 'no'
    seen.push(answer)
    return createElement('p', null, answer)
  }
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  flushSync(() => {
    hydrateRoot(container, createElement(Probe))
  })
  return { seen, errors, text: () => container.textContent }
}

describe('supportsSurfaces', () => {
  it('names the one trial entry point a Surface needs, of the two core reports', () => {
    expect(supportsSurfaces()).toBe(detectHtmlInCanvas().drawElementImage)
    stubTrial()
    expect(supportsSurfaces()).toBe(true)
  })
})

describe('useSurfaceSupport', () => {
  it('answers no on the first pass in a browser that can present, then yes', () => {
    stubTrial()
    const { seen, errors, text } = hydrate()
    expect(seen[0]).toBe('no')
    expect(text()).toBe('yes')
    expect(errors).not.toHaveBeenCalled()
  })

  it('settles once — a capability cannot change under a mounted page', () => {
    stubTrial()
    const { seen } = hydrate()
    expect(seen.slice(1).every((answer) => answer === 'yes')).toBe(true)
    expect(seen.length).toBeLessThanOrEqual(3)
  })

  it('stays no throughout when the browser cannot present', () => {
    const { seen, errors, text } = hydrate()
    expect(new Set(seen)).toEqual(new Set(['no']))
    expect(text()).toBe('no')
    expect(errors).not.toHaveBeenCalled()
  })
})
