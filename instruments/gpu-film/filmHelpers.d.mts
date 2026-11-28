export interface FilmRegionRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface FilmRegionDiff {
  readonly meanAbsDiff: number
  readonly p95AbsDiff: number
  readonly maxAbsDiff: number
}

export interface FilmTransitionVerdict {
  readonly ok: boolean
  readonly reasons: string[]
  readonly maxStep: number
}

export function computeRegionDiff(
  pxA: Uint8ClampedArray | readonly number[],
  pxB: Uint8ClampedArray | readonly number[],
  width: number,
  height: number,
  rect: FilmRegionRect,
  dpr?: number,
): FilmRegionDiff

export function verifyTransitionSequence(
  adjacentDiffs: readonly number[],
  endToEndDiff: number,
  options?: {
    readonly minTotalDiff?: number
    readonly maxStepRatio?: number
    readonly maxAdjacentDiff?: number
  },
): FilmTransitionVerdict
