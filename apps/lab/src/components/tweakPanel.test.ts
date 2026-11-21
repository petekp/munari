// @vitest-environment happy-dom
// Tweak panel contract — pasteable TypeScript output, storage round-trip
// normalization, number-field blur clamping/NaN rejection, and error curtain reveal.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  clearStoredTuning,
  readStoredTuning,
  serializeTweakValues,
  TweakNumberField,
  writeStoredTuning,
  type TweakStorage,
} from './tweakPanel'
import { SceneBoundary } from './SceneBoundary'

function fakeStorage(): TweakStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

interface FixtureTuning {
  readonly flameSize: number
  readonly label: string
  readonly enabled: boolean
}

const defaults: FixtureTuning = Object.freeze({ flameSize: 1, label: 'default', enabled: false })

function normalize(raw: FixtureTuning): FixtureTuning {
  const flameSize = Number.isFinite(raw.flameSize) ? Math.min(2, Math.max(0.5, raw.flameSize)) : defaults.flameSize
  const label = raw.label === undefined ? defaults.label : String(raw.label)
  const enabled = raw.enabled === true || raw.enabled === false ? raw.enabled : defaults.enabled
  return { flameSize, label, enabled }
}

describe('serializeTweakValues', () => {
  it('produces a TypeScript object literal keyed exactly like the tuning bag', () => {
    const values = { flameSize: 1.35, flickerRate: 1.2 }
    expect(runInNewContext(`(${serializeTweakValues(values)})`)).toEqual(values)
  })

  it('quotes strings, leaves numbers and booleans bare, and preserves key order', () => {
    const snippet = serializeTweakValues({ fontFamily: 'sans', motionEnabled: true, scale: 0.69 })
    const copied = runInNewContext(`(${snippet})`)
    expect(copied).toEqual({ fontFamily: 'sans', motionEnabled: true, scale: 0.69 })
    expect(Object.keys(copied)).toEqual(['fontFamily', 'motionEnabled', 'scale'])
  })

  it('escapes an embedded double quote so the literal stays valid', () => {
    const values = { note: 'say "hi"\npath \\file' }
    expect(runInNewContext(`(${serializeTweakValues(values)})`)).toEqual(values)
  })
})

describe('tuning storage round trip', () => {
  it('returns null when nothing has been stored yet', () => {
    const storage = fakeStorage()
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toBeNull()
  })

  it('writes the live tuning and reads it back through normalize unchanged', () => {
    const storage = fakeStorage()
    const live: FixtureTuning = { flameSize: 1.4, label: 'dialed in', enabled: true }
    writeStoredTuning(storage, 'lamp-tuning', live)
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toEqual(live)
  })

  // The scene's own normalizer repairs the entry. Each scene tests its
  // normalizer; this checks that a stored entry cannot bypass it.
  it('passes a stale, partial entry through normalize instead of trusting it', () => {
    const storage = fakeStorage()
    storage.setItem('lamp-tuning', JSON.stringify({ flameSize: 99 }))
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toEqual({
      flameSize: 2,
      label: defaults.label,
      enabled: defaults.enabled,
    })
  })

  it('treats corrupt JSON as nothing stored, without throwing', () => {
    const storage = fakeStorage()
    storage.setItem('lamp-tuning', '{not json')
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toBeNull()
  })

  it('reset clears the stored entry so the next mount sees no override', () => {
    const storage = fakeStorage()
    writeStoredTuning(storage, 'lamp-tuning', { flameSize: 1.9, label: 'x', enabled: true })
    clearStoredTuning(storage, 'lamp-tuning')
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toBeNull()
  })

  it('never throws when the underlying storage rejects reads or writes', () => {
    const brokenStorage: TweakStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(() => writeStoredTuning(brokenStorage, 'k', defaults)).not.toThrow()
    expect(() => clearStoredTuning(brokenStorage, 'k')).not.toThrow()
    expect(readStoredTuning(brokenStorage, 'k', normalize)).toBeNull()
  })
})

describe('TweakNumberField blur validation', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('rejects empty/NaN blur and clamps + snaps out-of-range drafts to step precision', () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const commits: number[] = []

    const renderField = (value: number) => {
      act(() => {
        root.render(
          createElement(TweakNumberField, {
            id: 'flame',
            label: 'Flame size',
            min: 0.5,
            max: 2,
            step: 0.05,
            value,
            onChange: (next) => commits.push(next),
          }),
        )
      })
    }

    renderField(1.25)
    const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
    const setInputValue = (raw: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, raw)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }

    // Clearing the field and blurring must restore 1.25 without committing NaN.
    act(() => input.focus())
    act(() => setInputValue(''))
    act(() => input.blur())
    expect(commits).toEqual([])
    expect(input.value).toBe('1.25')

    // Typing an out-of-range value and blurring clamps to max (2).
    act(() => input.focus())
    act(() => setInputValue('99'))
    act(() => input.blur())
    expect(commits).toEqual([2])

    // Typing an off-step value snaps to the nearest 0.05 increment on blur.
    commits.length = 0
    renderField(1.25)
    act(() => input.focus())
    act(() => setInputValue('0.53'))
    renderField(0.53)
    act(() => input.blur())
    expect(commits.at(-1)).toBe(0.55)

    act(() => root.unmount())
  })
})

describe('SceneBoundary cold-load curtain reveal', () => {
  afterEach(() => {
    delete document.documentElement.dataset.opening
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('lifts #site-opening and clears #root[inert] when a scene throws during mount', () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })

    document.documentElement.dataset.opening = ''
    const cover = document.createElement('div')
    cover.id = 'site-opening'
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    appRoot.setAttribute('inert', '')
    document.body.append(cover, appRoot)

    const Thrower = () => {
      throw new Error('GPU explosion')
    }

    const root = createRoot(appRoot)
    act(() => {
      // eslint-disable-next-line react/no-children-prop
      root.render(createElement(SceneBoundary, { scene: 'glass', children: createElement(Thrower) }))
    })

    expect(document.getElementById('site-opening')).toBeNull()
    expect(appRoot.hasAttribute('inert')).toBe(false)
    expect(appRoot.querySelector('[role="alert"]')?.textContent).toContain('GPU explosion')
    act(() => root.unmount())
  })
})
