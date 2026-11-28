// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { writeCaptureBodyColor } from './surfaceDom'

describe('writeCaptureBodyColor', () => {
  it('clears .ui-root background in scene for finish surfaces and restores on page return', () => {
    const captureRoot = document.createElement('div')
    captureRoot.className = 'ui-root'
    const repaint = vi.fn()
    const source = { repaint }

    writeCaptureBodyColor(captureRoot, '#6a0a16', false, source, true)
    expect(captureRoot.style.getPropertyValue('--munari-body')).toBe('transparent')
    expect(captureRoot.style.backgroundColor).toBe('transparent')
    expect(repaint).toHaveBeenCalledTimes(1)

    writeCaptureBodyColor(captureRoot, '#6a0a16', false, source, true)
    expect(repaint).toHaveBeenCalledTimes(1)

    writeCaptureBodyColor(captureRoot, '#6a0a16', true, source, true)
    expect(captureRoot.style.getPropertyValue('--munari-body')).toBe('#6a0a16')
    expect(captureRoot.style.backgroundColor).toBe('')
    expect(repaint).toHaveBeenCalledTimes(2)

    writeCaptureBodyColor(captureRoot, null, false, source, false)
    expect(captureRoot.style.getPropertyValue('--munari-body')).toBe('')
    expect(captureRoot.style.backgroundColor).toBe('')
    expect(repaint).toHaveBeenCalledTimes(3)
  })
})
