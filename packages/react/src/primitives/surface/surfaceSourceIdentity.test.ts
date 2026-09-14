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
  it('keeps unnamed sources and their parts independent through replacement and cleanup', () => {
    resetSurfaceHosts()
    const host = surfaceHost('scene')
    // SAFETY: the registry stores containers and hands them back untouched;
    // nothing on this path reads a DOM property off one.
    const container = () => ({}) as HTMLElement
    const first = nextSurfaceInstanceId()
    const a = { key: sourceContentKey(first, DEFAULT_PART), container: container(), content: 'a' }
    const b = { key: sourceContentKey(nextSurfaceInstanceId(), DEFAULT_PART), container: container(), content: 'b' }
    const leaveA = host.registerSource(a)
    const leaveB = host.registerSource(b)
    const leaveFilm = host.registerSource({ key: sourceContentKey(first, 'film'), container: container(), content: 'film' })
    expect(host.sources().map((entry) => entry.content)).toEqual(['a', 'b', 'film'])
    const leaveReplacement = host.registerSource({ ...a, key: sourceContentKey(first, DEFAULT_PART), content: 'updated a' })
    leaveA()
    expect(host.sources().map((entry) => entry.content)).toEqual(['updated a', 'b', 'film'])
    leaveFilm()
    leaveReplacement()
    expect(host.sources().map((entry) => entry.content)).toEqual(['b'])
    leaveB()
    expect(host.sources()).toEqual([])
  })
})
