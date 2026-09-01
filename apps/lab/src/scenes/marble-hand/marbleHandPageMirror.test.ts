// @vitest-environment happy-dom
//
// The full-page mirror contract — copied content, unchanged native ownership.
// The 2026-08-30 field approximation lost all type. These tests pin exact
// subtree copying and later DOM edits; the browser gate owns raster evidence.

import { afterEach, describe, expect, it } from 'vitest'
import { cloneMarbleHandPage } from './marbleHandPageMirror'

afterEach(() => document.body.replaceChildren())

function nativePage(): HTMLElement {
  const page = document.createElement('main')
  page.className = 'mh-sheet'
  page.innerHTML = '<h1>The cursor<br>has weight now.</h1><button type="button" data-selected="">Carta</button>'
  document.body.append(page)
  return page
}

describe('the marble hand full-page mirror', () => {
  it('preserves the complete content and CSS hooks without changing the native node', () => {
    const page = nativePage()
    page.querySelector('button')?.setAttribute('data-hover', '')
    const before = page.outerHTML
    const clone = cloneMarbleHandPage(page, 1280, 800)
    expect(page.parentNode).toBe(document.body)
    expect(page.outerHTML).toBe(before)
    expect(clone.parentNode).toBeNull()
    expect(clone.className).toBe('mh-sheet')
    expect(clone.hasAttribute('data-marble-reflection-copy')).toBe(true)
    expect(clone.querySelector('h1')?.innerHTML).toBe(page.querySelector('h1')?.innerHTML)
    expect(clone.querySelector('button')?.hasAttribute('data-selected')).toBe(true)
    expect(clone.querySelector('button')?.hasAttribute('data-hover')).toBe(true)
    expect(clone.style.width).toBe('1280px')
    expect(clone.style.height).toBe('800px')
  })

  it('leaves the copy root unpainted so the reflected field shows through', () => {
    const page = nativePage()
    page.style.background = 'rgb(244, 169, 207)'
    const clone = cloneMarbleHandPage(page, 1280, 800)
    expect(clone.style.background).toBe('transparent')
    expect(page.style.background).toBe('rgb(244, 169, 207)')
  })

  it('copies native text and style changes made outside React', () => {
    const page = nativePage()
    const heading = page.querySelector('h1')!
    const previous = cloneMarbleHandPage(page, 1280, 800)
    heading.textContent = 'A different page'
    heading.style.color = 'rgb(220, 30, 40)'
    const current = cloneMarbleHandPage(page, 1280, 800)
    expect(current.querySelector('h1')?.textContent).toBe('A different page')
    expect(current.querySelector('h1')?.style.color).toBe('rgb(220, 30, 40)')
    expect(previous.querySelector('h1')?.textContent).not.toBe('A different page')
  })

  it('copies live form properties that need not have matching HTML attributes', () => {
    const page = nativePage()
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.indeterminate = true
    const text = document.createElement('textarea')
    text.value = 'Live words'
    page.append(checkbox, text)
    const clone = cloneMarbleHandPage(page, 1280, 800)
    expect(clone.querySelector('input')?.checked).toBe(true)
    expect(clone.querySelector('input')?.indeterminate).toBe(true)
    expect(clone.querySelector('textarea')?.value).toBe('Live words')
    expect(checkbox.parentNode).toBe(page)
  })
})
