// Windowless import and field math check for the vendorable SDF glass module.
import { describe, expect, it } from 'vitest'

describe('glassSdf in a windowless SSR/Node environment', () => {
  it('imports without touching window and returns empty panel inspection state', async () => {
    expect('window' in globalThis).toBe(false)
    const mod = await import('./glassSdf')
    expect(mod.sdfPanelLabels()).toEqual([])
    expect(mod.sdfPanelParams('glass-card')).toBeNull()
    expect(mod.sdRoundRect(0, 0, 1, 1, 0.2)).toBeLessThan(0)
  })
})
