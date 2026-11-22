// Key specifications, LED presets, and live-geometry 2D spatial focus law
// (`SignatureKeywell`), adhering to `modern-web-guidance` `spatial-navigation`.

export interface KeySpec {
  readonly index: number
  readonly num: string
  readonly code: string
  readonly defaultMacro: string
  readonly ledHex: string
}

export const INITIAL_KEYS: readonly KeySpec[] = [
  { index: 0, num: '01', code: 'SYN', defaultMacro: 'POLY SAW', ledHex: '#ff9f1c' },
  { index: 1, num: '02', code: 'OSC', defaultMacro: 'DETUNE +7C', ledHex: '#ff9f1c' },
  { index: 2, num: '03', code: 'SUB', defaultMacro: 'OCTAVE -1', ledHex: '#38bdf8' },
  { index: 3, num: '04', code: 'NOI', defaultMacro: 'TAPE HISS', ledHex: '#a855f7' },
  { index: 4, num: '05', code: 'FLT', defaultMacro: 'LADDER 24D', ledHex: '#10b981' },
  { index: 5, num: '06', code: 'DLY', defaultMacro: 'TAPE 1/8D', ledHex: '#00e5ff' },
  { index: 6, num: '07', code: 'ARP', defaultMacro: 'UP/DN 16T', ledHex: '#22c55e' },
  { index: 7, num: '08', code: 'LFO', defaultMacro: 'SINE 2.4HZ', ledHex: '#f59e0b' },
  { index: 8, num: '09', code: 'DRV', defaultMacro: 'WARM TUBE', ledHex: '#f43f5e' },
  { index: 9, num: '10', code: 'REV', defaultMacro: 'SHIMMER 4S', ledHex: '#38bdf8' },
  { index: 10, num: '11', code: 'CMP', defaultMacro: 'BUS GLUE', ledHex: '#ec4899' },
  { index: 11, num: '12', code: 'MST', defaultMacro: 'LIMIT -1DB', ledHex: '#ff2e93' },
]

// Default Triad Bounce (`02 OSC`, `06 DLY`, `12 MST`) surrounds 3 jewel-toned LEDs
// with 9 dark smoked-obsidian keycaps so lateral bevel bounce reads at `t = 0`.
export const TRIAD_PRESET: readonly boolean[] = [
  false, true, false, false,
  false, true, false, false,
  false, false, false, true,
]

export const SOLO_CENTER_PRESET: readonly boolean[] = [
  false, false, false, false,
  false, true, false, false,
  false, false, false, false,
]

export const CHORD_PRESET: readonly boolean[] = [
  true, false, true, false,
  false, true, true, false,
  true, false, false, true,
]

export type ArrowDir = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export function isArrowKey(key: string): key is ArrowDir {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
}

export interface RectLike {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface DirectionalMetric {
  readonly gap: number
  readonly overlapsPerp: boolean
  readonly perpOffset: number
}

export function measureDirectionalRelation(
  curr: RectLike,
  c: RectLike,
  dir: ArrowDir,
): DirectionalMetric | null {
  const tol = 4
  if (dir === 'ArrowLeft' || dir === 'ArrowRight') {
    const rawGap = dir === 'ArrowRight' ? c.left - curr.right : curr.left - c.right
    if (rawGap < -tol) return null
    return {
      gap: Math.max(0, rawGap),
      overlapsPerp: Math.min(c.bottom, curr.bottom) > Math.max(c.top, curr.top),
      perpOffset: Math.abs((c.top + c.bottom - (curr.top + curr.bottom)) * 0.5),
    }
  }
  const rawGap = dir === 'ArrowDown' ? c.top - curr.bottom : curr.top - c.bottom
  if (rawGap < -tol) return null
  return {
    gap: Math.max(0, rawGap),
    overlapsPerp: Math.min(c.right, curr.right) > Math.max(c.left, curr.left),
    perpOffset: Math.abs((c.left + c.right - (curr.left + curr.right)) * 0.5),
  }
}

export function pickBestSpatialIndex(
  rects: readonly RectLike[],
  currentIdx: number,
  dir: ArrowDir,
): number | null {
  const curr = rects[currentIdx]
  if (!curr) return null

  let bestOverlap: { idx: number; gap: number; perp: number } | null = null
  let bestFallback: { idx: number; score: number } | null = null

  for (let i = 0; i < rects.length; i++) {
    if (i === currentIdx) continue
    const c = rects[i]!
    if (c.width <= 0 || c.height <= 0) continue
    const rel = measureDirectionalRelation(curr, c, dir)
    if (!rel) continue

    if (rel.overlapsPerp) {
      const beats =
        !bestOverlap ||
        rel.gap < bestOverlap.gap - 0.5 ||
        (Math.abs(rel.gap - bestOverlap.gap) <= 0.5 && rel.perpOffset < bestOverlap.perp)
      if (beats) bestOverlap = { idx: i, gap: rel.gap, perp: rel.perpOffset }
    } else {
      const score = rel.gap + 2.5 * rel.perpOffset
      if (!bestFallback || score < bestFallback.score) bestFallback = { idx: i, score }
    }
  }

  return bestOverlap?.idx ?? bestFallback?.idx ?? null
}

/**
 * Live geometry-driven directional focus finder per `modern-web-guidance`
 * `spatial-navigation`: filters visible candidates strictly by near/far edge,
 * prefers perpendicular overlap first, and returns `null` at boundaries so
 * callers leave native scrolling intact.
 */
export function findSpatialCandidate(
  container: HTMLElement,
  currentEl: HTMLElement,
  dir: ArrowDir,
): HTMLElement | null {
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button[data-key-index]')).filter(
    (el) => ('checkVisibility' in el ? el.checkVisibility() : true),
  )
  const currentIdx = buttons.indexOf(currentEl)
  if (currentIdx < 0) return null
  const rects = buttons.map((el) => el.getBoundingClientRect())
  const chosenIdx = pickBestSpatialIndex(rects, currentIdx, dir)
  return chosenIdx !== null ? (buttons[chosenIdx] ?? null) : null
}
