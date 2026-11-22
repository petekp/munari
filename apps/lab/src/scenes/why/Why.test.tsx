// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMOS } from '../../components/sceneCatalog'
import { WhyApp } from './Why'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('WhyApp visual walkthrough', () => {
  it('renders selective DOM promotion framing and links strictly to promoted catalog demos', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('')))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(WhyApp))
      })

      expect(container.querySelector('h1.m-display')?.textContent).toBe('Why Munari')
      expect(container.querySelector('.why-intro .m-lead')?.textContent).toContain(
        'Native-grade lighting, optics, and physical motion on real DOM components',
      )
      expect(container.querySelector('#paradigm')?.querySelectorAll('.why-decision')).toHaveLength(3)
      expect(container.querySelector('#paradigm')?.querySelectorAll('.why-mode')).toHaveLength(2)

      const promotedIds = new Set<string>(DEMOS.map((d) => d.id))
      const unlockLinks = [...container.querySelectorAll<HTMLAnchorElement>('#unlocks .why-unlock-demos a')]
      expect(unlockLinks.length).toBeGreaterThanOrEqual(5)
      for (const link of unlockLinks) {
        const scene = new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('scene')
        expect(promotedIds.has(scene ?? '')).toBe(true)
      }
    } finally {
      await act(async () => {
        root.unmount()
      })
    }
  })

  it('switches specimen/code tabs with keyboard and mounts at most one live demo iframe at a time', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('')))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(createElement(WhyApp))
      })

      expect(container.querySelectorAll('.why-walk-section')).toHaveLength(6)
      expect(container.querySelector('[role="region"] table.why-table')).not.toBeNull()
      expect(container.querySelectorAll('iframe')).toHaveLength(0)

      // Tab keyboard navigation in Section 01: ArrowRight switches from Interactive specimen to JSX snippet.
      const firstSection = container.querySelector('#handoff')
      const tabs = firstSection?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      const tablist = firstSection?.querySelector<HTMLElement>('[role="tablist"]')
      expect(tabs?.length).toBe(2)
      expect(tabs?.[0]?.getAttribute('aria-selected')).toBe('true')
      expect(tabs?.[1]?.getAttribute('aria-selected')).toBe('false')

      await act(async () => {
        tablist?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      expect(tabs?.[0]?.getAttribute('aria-selected')).toBe('false')
      expect(tabs?.[1]?.getAttribute('aria-selected')).toBe('true')
      expect(firstSection?.querySelector('.m-copy code')?.textContent).toContain('LitCardHandoff')

      // Running Postcard mounts 1 iframe; running Genie replaces it so only 1 WebGPU stage runs at once.
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
      const runPostcard = buttons.find((b) => b.textContent === 'Run Postcard live')
      const runGenie = buttons.find((b) => b.textContent === 'Run Genie live')
      expect(runPostcard).toBeDefined()
      expect(runGenie).toBeDefined()

      for (const panel of container.querySelectorAll<HTMLElement>('.why-stage-panel')) {
        Object.defineProperty(panel, 'clientWidth', { configurable: true, value: 800 })
      }
      await act(async () => {
        runPostcard?.click()
      })
      expect(container.querySelectorAll('iframe')).toHaveLength(1)
      expect(container.querySelector('iframe')?.getAttribute('src')).toContain('scene=postcard')

      await act(async () => {
        runGenie?.click()
      })
      expect(container.querySelectorAll('iframe')).toHaveLength(1)
      expect(container.querySelector('iframe')?.getAttribute('src')).toContain('scene=genie')

      // Off-screen content-visibility skip on the owning section parks the active WebGPU iframe.
      const inputSection = container.querySelector('#input')
      const skipEvent = new Event('contentvisibilityautostatechange')
      Object.defineProperty(skipEvent, 'skipped', { value: true })
      await act(async () => {
        inputSection?.dispatchEvent(skipEvent)
      })
      expect(container.querySelectorAll('iframe')).toHaveLength(0)

      // Manual Stop live demo also parks an active stage.
      const runPostcardAgain = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Run Postcard live',
      )
      await act(async () => {
        runPostcardAgain?.click()
      })
      expect(container.querySelectorAll('iframe')).toHaveLength(1)
      const stopBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Stop live demo',
      )
      await act(async () => {
        stopBtn?.click()
      })
      expect(container.querySelectorAll('iframe')).toHaveLength(0)
    } finally {
      await act(async () => {
        root.unmount()
      })
    }
  })
})
