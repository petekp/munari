// Plume unit ledger — stable identity for words or characters across edits.
//
// The law: units that survive an edit keep their release time, while a
// changed or newly inserted unit gets a fresh hold. LCS supplies that identity
// without asking the textarea to surrender selection or caret ownership.
//
// The failure mode this prevents, 2026-08-30: position-derived keys make one
// insertion restart every later unit; in a 20-word line, inserting at the
// front would restart 19 unrelated timers. Ownership: this module owns text
// segmentation and time classification only. React owns state and the shader
// owns motion.

export type PlumeReleaseUnit = 'word' | 'character'

export interface TimedUnit {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly releaseAt: number
}

export interface ReconciledUnits {
  readonly units: readonly TimedUnit[]
  readonly nextId: number
}

interface RawUnit {
  readonly text: string
  readonly start: number
  readonly end: number
}

export type UnitPhase = 'held' | 'pluming' | 'gone'

// One clock per grapheme cluster, not per code unit: an emoji with a skin-tone
// modifier releases as the single mark a reader sees, and a combining accent
// never leaves its letter behind. Segmenter is absent in older Safari, where
// code points are the closest available split.
function graphemes(value: string): readonly string[] {
  if (!('Segmenter' in Intl)) return Array.from(value)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return [...segmenter.segment(value)].map((segment) => segment.segment)
}

/** Find every releasable unit while retaining offsets into the textarea. */
export function splitUnits(value: string, unit: PlumeReleaseUnit): readonly RawUnit[] {
  const units: RawUnit[] = []
  if (unit === 'word') {
    for (const match of value.matchAll(/\S+/gu)) {
      const start = match.index
      units.push({ text: match[0], start, end: start + match[0].length })
    }
    return units
  }
  let start = 0
  for (const cluster of graphemes(value)) {
    const end = start + cluster.length
    if (!/^\s+$/u.test(cluster)) units.push({ text: cluster, start, end })
    start = end
  }
  return units
}

/** Keep the longest ordered set of exact units through an edit. */
function retainedPairs(
  previous: readonly TimedUnit[],
  next: readonly RawUnit[],
): ReadonlyMap<number, number> {
  const width = next.length + 1
  const table = new Uint16Array((previous.length + 1) * width)
  for (let left = previous.length - 1; left >= 0; left--) {
    for (let right = next.length - 1; right >= 0; right--) {
      const cell = left * width + right
      table[cell] =
        previous[left]?.text === next[right]?.text
          ? 1 + (table[(left + 1) * width + right + 1] ?? 0)
          : Math.max(
              table[(left + 1) * width + right] ?? 0,
              table[left * width + right + 1] ?? 0,
            )
    }
  }

  const pairs = new Map<number, number>()
  let left = 0
  let right = 0
  while (left < previous.length && right < next.length) {
    if (previous[left]?.text === next[right]?.text) {
      pairs.set(right, left)
      left++
      right++
    } else if (
      (table[(left + 1) * width + right] ?? 0) >=
      (table[left * width + right + 1] ?? 0)
    ) {
      left++
    } else {
      right++
    }
  }
  return pairs
}

/** Reconcile one textarea value without touching the textarea itself. */
export function reconcileUnits(
  previous: readonly TimedUnit[],
  value: string,
  unit: PlumeReleaseUnit,
  nowMs: number,
  holdMs: number,
  nextId: number,
): ReconciledUnits {
  const raw = splitUnits(value, unit)
  const retained = retainedPairs(previous, raw)
  let id = nextId
  const units = raw.map((item, index): TimedUnit => {
    const oldIndex = retained.get(index)
    const old = oldIndex === undefined ? undefined : previous[oldIndex]
    if (old) {
      return { ...item, id: old.id, releaseAt: old.releaseAt }
    }
    const created: TimedUnit = {
      ...item,
      id: `plume-unit-${id}`,
      releaseAt: nowMs + holdMs,
    }
    id++
    return created
  })
  return { units, nextId: id }
}

/** Give every retained unit another full hold without changing its identity. */
export function rearmUnits(
  units: readonly TimedUnit[],
  nowMs: number,
  holdMs: number,
): readonly TimedUnit[] {
  return units.map((unit) => ({ ...unit, releaseAt: nowMs + holdMs }))
}

export function unitPhase(unit: TimedUnit, nowMs: number, durationMs: number): UnitPhase {
  if (nowMs < unit.releaseAt) return 'held'
  if (nowMs < unit.releaseAt + durationMs) return 'pluming'
  return 'gone'
}

/** The next moment React must change a DOM unit's phase. */
export function nextTimelineBoundary(
  units: readonly TimedUnit[],
  nowMs: number,
  durationMs: number,
): number | null {
  let next = Number.POSITIVE_INFINITY
  for (const unit of units) {
    if (unit.releaseAt > nowMs) next = Math.min(next, unit.releaseAt)
    const goneAt = unit.releaseAt + durationMs
    if (goneAt > nowMs) next = Math.min(next, goneAt)
  }
  return Number.isFinite(next) ? next : null
}
