// @vitest-environment happy-dom
// Presenter phases — committed mounts fill every LOD slot, including Strict Mode.
// On 2026-09-07, render-time ordinal allocation still occupied only five of
// ten slots under Strict Mode even after its second counter use was removed.

import { Fragment, StrictMode, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it } from 'vitest'
import { useSurfaceLodPhase } from './SurfaceMesh'

describe('committed LOD phases', () => {
  it.each(['normal', 'strict-root', 'strict-child'] as const)('uses ten distinct slots with %s mounts', (mode) => {
    const phases = new Map<number, number | null>()
    const renders = new Map<number, number>()
    const setups = new Map<number, (number | null)[]>()
    function Probe({ id }: { id: number }) {
      const phase = useSurfaceLodPhase()
      renders.set(id, (renders.get(id) ?? 0) + 1)
      useLayoutEffect(() => {
        phases.set(id, phase.current)
        setups.set(id, [...(setups.get(id) ?? []), phase.current])
      })
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const render = (count: number) => {
      const children = Array.from({ length: count }, (_, id) => createElement(Probe, { key: id, id }))
      const nested = mode === 'strict-child'
        ? createElement('main', null, createElement(StrictMode, null, children))
        : createElement(Fragment, null, children)
      flushSync(() => root.render(mode === 'strict-root' ? createElement(StrictMode, null, nested) : nested))
    }
    try {
      render(10)
      expect([...phases.values()].sort((a, b) => (a ?? -1) - (b ?? -1))).toEqual([0,1,2,3,4,5,6,7,8,9])
      if (mode !== 'normal') expect(renders.get(0)).toBeGreaterThanOrEqual(2)
      if (mode === 'strict-root') expect(setups.get(0)).toHaveLength(2)
      const initial = new Map(phases)
      render(10)
      expect(phases).toEqual(initial)
      render(11)
      expect(phases.get(10)).toBe(initial.get(0))
      for (const [id, phase] of initial) {
        expect(phases.get(id)).toBe(phase)
        expect(new Set(setups.get(id))).toEqual(new Set([phase]))
      }
    } finally {
      flushSync(() => root.unmount())
      container.remove()
    }
  })
})
