import { describe, expect, it } from 'vitest'
import { judgeEntry } from './budget'

const entry = { name: 'encodedOutput', recordedBytes: 129_800, marginBytes: 1_500 }

describe('payload budget rule', () => {
  it('passes an entry at its recorded size plus its margin', () => {
    expect(judgeEntry({ ...entry, measuredBytes: 131_300 }).ok).toBe(true)
  })

  it('fails an entry one byte past its recorded size plus its margin', () => {
    expect(judgeEntry({ ...entry, measuredBytes: 131_301 }).ok).toBe(false)
  })

  it('fails the entry that regressed and names it', () => {
    const results = [
      judgeEntry({ ...entry, measuredBytes: 129_800 }),
      judgeEntry({ name: 'surface', recordedBytes: 531_600, marginBytes: 2_000, measuredBytes: 700_000 }),
    ]
    expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual(['surface'])
  })
})
