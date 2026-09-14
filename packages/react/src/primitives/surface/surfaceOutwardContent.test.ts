// @vitest-environment happy-dom
// Outward content identity — source updates reconcile focused controls.

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SurfaceOutwardContent,
  createSurfaceOutwardContentStore,
} from './surfaceOutwardContent'
import { SurfaceHandleContext } from './surfaceContext'
import { createSurface, surfaceStoreOf, useSurfaceState } from './surfaceHandle'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => container.remove())

describe('outward source content', () => {
  it('keeps the source handle context through the outward portal', () => {
    const handle = createSurface('outward')
    const store = surfaceStoreOf(handle)
    let requested = ''
    const Probe = () => {
      requested = useSurfaceState().requested
      return null
    }
    const outward = createSurfaceOutwardContentStore()
    const root = createRoot(container)
    flushSync(() => {
      root.render(createElement(SurfaceOutwardContent, { store: outward }))
      outward.publish(
        createElement(
          SurfaceHandleContext,
          { value: { handle, store } },
          createElement(Probe),
        ),
      )
    })
    expect(requested).toBe('page')
    flushSync(() => root.unmount())
  })

  it('updates props without replacing or blurring the live control', () => {
    const store = createSurfaceOutwardContentStore()
    const root = createRoot(container)
    flushSync(() => {
      root.render(createElement(SurfaceOutwardContent, { store }))
      store.publish(createElement('input', { 'aria-label': 'first' }))
    })

    const input = container.querySelector('input')
    input?.focus()
    expect(document.activeElement).toBe(input)

    flushSync(() => {
      store.publish(createElement('input', { 'aria-label': 'updated' }))
    })

    expect(container.querySelector('input')).toBe(input)
    expect(input?.getAttribute('aria-label')).toBe('updated')
    expect(document.activeElement).toBe(input)
    flushSync(() => root.unmount())
  })

})
