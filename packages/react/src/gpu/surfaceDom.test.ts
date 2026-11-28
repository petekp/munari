// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { makeCaptureRoot, writeCaptureBodyColor } from './surfaceDom'

describe('surfaceDom capture container helpers', () => {
  it('creates transparent .ui-root capture containers so host backgrounds never bleed behind surfaces', () => {
    const captureRoot = makeCaptureRoot()
    expect(captureRoot.className).toBe('ui-root')
    expect(captureRoot.style.backgroundColor).toBe('transparent')
  })

  it('mirrors --munari-body across scene and page transitions without clobbering backgroundColor', () => {
    const captureRoot = makeCaptureRoot()
    const repaint = vi.fn()
    const source = { repaint }

    writeCaptureBodyColor(captureRoot, '#6a0a16', false, source)
    expect(captureRoot.style.getPropertyValue('--munari-body')).toBe('transparent')
    expect(captureRoot.style.backgroundColor).toBe('transparent')
    expect(repaint).toHaveBeenCalledTimes(1)

    writeCaptureBodyColor(captureRoot, '#6a0a16', false, source)
    expect(repaint).toHaveBeenCalledTimes(1)

    writeCaptureBodyColor(captureRoot, '#6a0a16', true, source)
    expect(captureRoot.style.getPropertyValue('--munari-body')).toBe('#6a0a16')
    expect(captureRoot.style.backgroundColor).toBe('transparent')
    expect(repaint).toHaveBeenCalledTimes(2)

    writeCaptureBodyColor(captureRoot, null, false, source)
    expect(captureRoot.style.getPropertyValue('--munari-body')).toBe('')
    expect(repaint).toHaveBeenCalledTimes(3)
  })
})
