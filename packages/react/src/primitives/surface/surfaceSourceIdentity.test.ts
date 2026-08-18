// Source identity: one registry entry per Surface declaration, not per name.
//
// The fault, 2026-08-17: a Canvas-side source was keyed by
// `${name}:${part}`, and a `<Surface>` is allowed to have no name. Two
// unnamed panels in one Canvas published under the same key, the registry
// replaced by key, and the second commit took the first one's content
// away — a panel that mounts, paints once and goes blank, with nothing
// anywhere reporting it.
import { describe, expect, it } from 'vitest'
import { DEFAULT_PART, nextSurfaceInstanceId, sourceContentKey } from './surfaceContext'
import { resetSurfaceHosts, surfaceHost } from './surfaceHostRegistry'

describe('source identity', () => {
  it('mints a new instance id for every root', () => {
    const minted = Array.from({ length: 4 }, nextSurfaceInstanceId)
    expect(new Set(minted).size).toBe(4)
  })

  it('separates two unnamed Surfaces, and their parts', () => {
    const first = nextSurfaceInstanceId()
    const second = nextSurfaceInstanceId()
    expect(sourceContentKey(first, DEFAULT_PART)).not.toBe(
      sourceContentKey(second, DEFAULT_PART),
    )
    expect(sourceContentKey(first, DEFAULT_PART)).not.toBe(sourceContentKey(first, 'film'))
  })

  it('is stable for one instance, so a re-render replaces rather than piles up', () => {
    const instance = nextSurfaceInstanceId()
    expect(sourceContentKey(instance, 'film')).toBe(sourceContentKey(instance, 'film'))
  })

  it('keeps two unnamed sources in the registry at once', () => {
    resetSurfaceHosts()
    const host = surfaceHost('scene')
    // SAFETY: the registry stores containers and hands them back untouched;
    // nothing on this path reads a DOM property off one.
    const container = () => ({}) as HTMLElement
    const a = { key: sourceContentKey(nextSurfaceInstanceId(), DEFAULT_PART), container: container(), content: 'a' }
    const b = { key: sourceContentKey(nextSurfaceInstanceId(), DEFAULT_PART), container: container(), content: 'b' }
    const leaveA = host.registerSource(a)
    const leaveB = host.registerSource(b)
    expect(host.sources().map((entry) => entry.content)).toEqual(['a', 'b'])
    leaveA()
    expect(host.sources().map((entry) => entry.content)).toEqual(['b'])
    leaveB()
    expect(host.sources()).toEqual([])
  })
})
