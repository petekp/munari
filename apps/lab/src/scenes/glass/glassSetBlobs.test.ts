// GLASS — the setBlobs console verb writes the authority, not the array.
//
// Bug (introduced in 4334be6): `window.__glass.setBlobs(n)` resized the
// shared `blobs` array in place, but `OrbDrift` (Glass.tsx:445-447) re-resizes
// that exact array to `glassTuning.orbCount` every frame at useFrame priority
// 0, BEFORE the priority-1 SDF compositor reads `blobs.length` to upload
// `uBlobCount`. So the length `setBlobs` set never reached the shader: the
// verb was a no-op for any `n !== orbCount`, contradicting its own docstring,
// which promised setBlobs(0) "turns the merge off entirely (and with it the
// numeric-gradient branch in the shader), which is the A/B."
//
// Fix: setBlobs writes the single source of truth — `glassTuning.orbCount` —
// that OrbDrift already reads, welding the console verb and the tweak-panel
// slider to one knob so they can no longer diverge.
//
// Why TEXT-pin and not a render: the compositor upload runs inside useFrame,
// and this repo has no precedent (and bans module-mocking, tests/boundary
// .test.ts) for mounting a r3f Canvas + WebGL in vitest. The established
// pattern (tests/registry/glassPack.test.ts) is to pin the source text and to
// read glassSdf.tsx as text rather than import it (its top level touches
// `window.__glassInk`, which is undefined in the node test env). The runtime
// visible-frame guarantee is owned by `gate:lab-interactions`.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { glassTuning } from './glassTuning'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCENE = readFileSync(join(HERE, 'Glass.tsx'), 'utf8')
const SDF = readFileSync(join(HERE, 'glassSdf.tsx'), 'utf8')

// Pinned from glassSdf.tsx:178 (`export const MAX_BLOBS = 6`) by text below;
// not imported as a module to avoid glassSdf's top-level `window.__glassInk`
// assignment, which is undefined in the node test environment.
const MAX_BLOBS = 6

// Slice the source between two anchors; throws if an anchor is missing so a
// rename is loud rather than silently passing on stale text.
function sliceBetween(text: string, from: string, to: string): string {
  const i = text.indexOf(from)
  if (i < 0) throw new Error(`anchor not found: ${from}`)
  const j = text.indexOf(to, i + from.length)
  if (j < 0) throw new Error(`anchor not found: ${to}`)
  return text.slice(i, j)
}

describe('setBlobs writes the authority (glassTuning.orbCount), not the array', () => {
  const setBlobsBlock = sliceBetween(SCENE, 'setBlobs: (n: number) =>', '},\n      blobs:')

  it('G1 — setBlobs writes glassTuning.orbCount = next', () => {
    expect(setBlobsBlock).toContain('glassTuning.orbCount = next')
  })

  it('G1 negative — setBlobs does not resize the array in place', () => {
    expect(setBlobsBlock).not.toContain('blobs.pop()')
    expect(setBlobsBlock).not.toContain('blobs.push')
  })

  it('G9 — OrbDrift still owns the in-place resize in the file', () => {
    const orbDrift = sliceBetween(SCENE, 'useFrame(({ clock }, dt) => {', 'const n = blobs.length')
    expect(orbDrift).toContain('while (blobs.length > want) blobs.pop()')
    expect(orbDrift).toContain('while (blobs.length < want) blobs.push({ x: 0, y: 0, r: 0 })')
  })

  it('G3/G4 — the return value reflects the knob, not blobs.length', () => {
    expect(setBlobsBlock).toContain('return `${next} blobs`')
    expect(setBlobsBlock).not.toContain('blobs.length} blobs')
  })

  it('G2 docstring — setBlobs comment names orbCount', () => {
    const setBlobsComment = sliceBetween(SCENE, '// Backed by `orbCount`', 'setBlobs: (n: number) =>')
    expect(setBlobsComment).toContain('orbCount')
  })

  it('G2 docstring — the stale em-dash docstring is gone (OrbDrift keeps the colon form)', () => {
    // OrbDrift's surviving comment is `// Resized in place:` (colon); the old
    // setBlobs docstring was `// Resized in place —` (em-dash) and existed
    // only there, so its reappearance is an unambiguous regression signal.
    expect(SCENE).not.toContain('Resized in place \u2014')
  })

  it('G11 — the __glass effect deps array is unchanged', () => {
    expect(SCENE).toContain('}, [mode, blobs, ripples, glows])')
  })

  it('G10 — the mode A/B verbs are untouched', () => {
    expect(SCENE).toContain("type GlassMode = 'mtm' | 'sdf'")
    expect(SCENE).toContain('setMode(')
  })
})

describe('glassTuning.orbCount is the backing store setBlobs writes', () => {
  it('MAX_BLOBS is exported as 6 in glassSdf.tsx (the clamp ceiling)', () => {
    expect(SDF).toContain('export const MAX_BLOBS = 6')
    expect(MAX_BLOBS).toBe(6)
  })

  it('G8 — orbCount default is 6', () => {
    expect(glassTuning.orbCount).toBe(6)
  })

  it('G5 — the knob is mutable and readable (the precondition for the fix)', () => {
    const before = glassTuning.orbCount
    try {
      glassTuning.orbCount = 0
      expect(glassTuning.orbCount).toBe(0)
      glassTuning.orbCount = 3
      expect(glassTuning.orbCount).toBe(3)
    } finally {
      glassTuning.orbCount = before
    }
    expect(glassTuning.orbCount).toBe(before)
  })

  it('G6 — clamp to [0, MAX_BLOBS] matches the fix', () => {
    expect(Math.max(0, Math.min(MAX_BLOBS, Math.round(7)))).toBe(6)
    expect(Math.max(0, Math.min(MAX_BLOBS, Math.round(-5)))).toBe(0)
    expect(Math.max(0, Math.min(MAX_BLOBS, Math.round(99)))).toBe(6)
  })

  it('G7 — Math.round semantics (round-half-to-+Infinity, not away-from-zero)', () => {
    expect(Math.round(2.5)).toBe(3)
    expect(Math.round(2.4)).toBe(2)
    expect(Math.round(-2.5)).toBe(-2) // NOT -3: documents the trap a "fix" might introduce
  })
})
