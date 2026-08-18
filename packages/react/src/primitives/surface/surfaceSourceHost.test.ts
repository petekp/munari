// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { surfaceChromeElement } from './surfaceChromeElement'

describe('surface chrome element', () => {
  it('reads the one authored React root rather than its square capture container', () => {
    const capture = document.createElement('div')
    const card = document.createElement('article')
    capture.appendChild(card)
    expect(surfaceChromeElement(capture, false)).toBe(card)
  })

  it('keeps the container when React authored several roots', () => {
    const capture = document.createElement('div')
    capture.append(document.createElement('article'), document.createElement('aside'))
    expect(surfaceChromeElement(capture, false)).toBe(capture)
  })

  it('measures an adopted element itself', () => {
    const adopted = document.createElement('article')
    adopted.appendChild(document.createElement('button'))
    expect(surfaceChromeElement(adopted, true)).toBe(adopted)
  })
})
