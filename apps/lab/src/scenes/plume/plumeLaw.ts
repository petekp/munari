// Plume word ledger — stable word identity across ordinary text edits.
//
// The law: exact words that survive an edit keep their release time, while a
// changed or newly inserted word gets a fresh hold. LCS supplies that identity
// without asking the textarea to surrender selection or caret ownership.
//
// The failure mode this prevents, 2026-08-30: position-derived keys make one
// insertion restart every later word; in a 20-word line, inserting at the
// front would restart 19 unrelated timers. Ownership: this module owns text
// segmentation and time classification only. React owns state and the shader
// owns motion.

export interface TimedWord {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly releaseAt: number
}

export interface ReconciledWords {
  readonly words: readonly TimedWord[]
  readonly nextId: number
}

interface RawWord {
  readonly text: string
  readonly start: number
  readonly end: number
}

export type WordPhase = 'held' | 'pluming' | 'gone'

/** Find every non-whitespace run while retaining offsets into the textarea. */
export function splitWords(value: string): readonly RawWord[] {
  const words: RawWord[] = []
  for (const match of value.matchAll(/\S+/gu)) {
    const start = match.index
    words.push({ text: match[0], start, end: start + match[0].length })
  }
  return words
}

/** Keep the longest ordered set of exact words through an edit. */
function retainedPairs(
  previous: readonly TimedWord[],
  next: readonly RawWord[],
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
export function reconcileWords(
  previous: readonly TimedWord[],
  value: string,
  nowMs: number,
  holdMs: number,
  nextId: number,
): ReconciledWords {
  const raw = splitWords(value)
  const retained = retainedPairs(previous, raw)
  let id = nextId
  const words = raw.map((word, index): TimedWord => {
    const oldIndex = retained.get(index)
    const old = oldIndex === undefined ? undefined : previous[oldIndex]
    if (old) {
      return { ...word, id: old.id, releaseAt: old.releaseAt }
    }
    const created: TimedWord = {
      ...word,
      id: `plume-word-${id}`,
      releaseAt: nowMs + holdMs,
    }
    id++
    return created
  })
  return { words, nextId: id }
}

/** Give every retained word another full hold without changing its identity. */
export function rearmWords(
  words: readonly TimedWord[],
  nowMs: number,
  holdMs: number,
): readonly TimedWord[] {
  return words.map((word) => ({ ...word, releaseAt: nowMs + holdMs }))
}

export function wordPhase(word: TimedWord, nowMs: number, durationMs: number): WordPhase {
  if (nowMs < word.releaseAt) return 'held'
  if (nowMs < word.releaseAt + durationMs) return 'pluming'
  return 'gone'
}

/** The next moment React must change a DOM word's phase. */
export function nextTimelineBoundary(
  words: readonly TimedWord[],
  nowMs: number,
  durationMs: number,
): number | null {
  let next = Number.POSITIVE_INFINITY
  for (const word of words) {
    if (word.releaseAt > nowMs) next = Math.min(next, word.releaseAt)
    const goneAt = word.releaseAt + durationMs
    if (goneAt > nowMs) next = Math.min(next, goneAt)
  }
  return Number.isFinite(next) ? next : null
}
