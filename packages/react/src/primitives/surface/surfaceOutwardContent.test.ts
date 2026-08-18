// @vitest-environment happy-dom
// Outward content identity — source updates reconcile focused controls.

import { createElement, memo } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SurfaceOutwardContent,
  createSurfaceOutwardContentStore,
} from './surfaceOutwardContent'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => container.remove())

describe('outward source content', () => {
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

  it('reconciles a component that owns captured markup', () => {
    const Source = memo(({ label }: { label: string }) =>
      createElement('div', {
        'data-label': label,
        dangerouslySetInnerHTML: { __html: '<label><input type="checkbox"> choice</label>' },
      }))
    const store = createSurfaceOutwardContentStore()
    const root = createRoot(container)
    flushSync(() => {
      root.render(createElement(SurfaceOutwardContent, { store }))
      store.publish(createElement(Source, { label: 'same' }))
    })

    const input = container.querySelector('input')
    input?.focus()
    flushSync(() => {
      store.publish(createElement(Source, { label: 'same' }))
    })

    expect(container.querySelector('input')).toBe(input)
    expect(document.activeElement).toBe(input)
    flushSync(() => root.unmount())
  })
})
