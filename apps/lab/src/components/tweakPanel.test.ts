// Tweak panel contract — the two pieces this schema-driven panel could get
// wrong without a browser: the pasteable snippet Copy values produces, and
// the storage round trip that survives an older or hand-edited entry.
//
// No jsdom is configured in this workspace, so rendering the panel itself
// is out of scope here; instruments/ browser probes cover each scene's
// rendered controls (see AGENTS.md's four test homes).

import { describe, expect, it } from 'vitest'
import {
  clearStoredTuning,
  readStoredTuning,
  serializeTweakValues,
  writeStoredTuning,
  type TweakBag,
  type TweakStorage,
} from './tweakPanel'

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

interface FixtureTuning extends TweakBag {
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
    expect(serializeTweakValues({ flameSize: 1.35, flickerRate: 1.2 })).toBe(
      '{\n  flameSize: 1.35,\n  flickerRate: 1.2,\n}',
    )
  })

  it('quotes strings, leaves numbers and booleans bare, and preserves key order', () => {
    const snippet = serializeTweakValues({ fontFamily: 'sans', motionEnabled: true, scale: 0.69 })
    expect(snippet).toBe('{\n  fontFamily: "sans",\n  motionEnabled: true,\n  scale: 0.69,\n}')
  })

  it('escapes an embedded double quote so the literal stays valid', () => {
    expect(serializeTweakValues({ note: 'say "hi"' })).toContain('note: "say \\"hi\\""')
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

  it('clamps a stale value outside the current range instead of trusting it', () => {
    const storage = fakeStorage()
    storage.setItem('lamp-tuning', JSON.stringify({ flameSize: 99, label: 'old build', enabled: true }))
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toEqual({
      flameSize: 2,
      label: 'old build',
      enabled: true,
    })
  })

  it('falls back to defaults field by field when a stored field is missing', () => {
    const storage = fakeStorage()
    storage.setItem('lamp-tuning', JSON.stringify({ flameSize: 1.2 }))
    expect(readStoredTuning(storage, 'lamp-tuning', normalize)).toEqual({
      flameSize: 1.2,
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
