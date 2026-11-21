// @vitest-environment happy-dom
// Deep-link URL preservation across the lab shell and its framed scene iframe.
import { afterEach, describe, expect, it } from 'vitest'
import { sceneUrl } from './captureMode'

describe('sceneUrl', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('preserves scene-specific query parameters when framing the active scene', () => {
    window.history.replaceState(null, '', '/?scene=candidates&candidate=unroll')
    expect(sceneUrl('candidates', { framed: true })).toBe('/?scene=candidates&candidate=unroll&framed=')
  })

  it('drops scene-specific query parameters when navigating to a different scene', () => {
    window.history.replaceState(null, '', '/?scene=candidates&candidate=unroll')
    expect(sceneUrl('home')).toBe('/?scene=home')
    expect(sceneUrl('flight')).toBe('/?scene=flight')
  })

  it('never leaks framed or bare shell flags into full-page links', () => {
    window.history.replaceState(null, '', '/?scene=workspace&framed=&bare=&probe=dom-surface-demand')
    expect(sceneUrl('workspace')).toBe('/?scene=workspace&probe=dom-surface-demand')
  })
})
