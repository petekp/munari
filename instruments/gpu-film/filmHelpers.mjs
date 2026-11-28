export function computeRegionDiff(pxA, pxB, width, height, rect, dpr = 1) {
  const x0 = Math.max(0, Math.round(rect.left * dpr))
  const y0 = Math.max(0, Math.round(rect.top * dpr))
  const x1 = Math.min(width, Math.round((rect.left + rect.width) * dpr))
  const y1 = Math.min(height, Math.round((rect.top + rect.height) * dpr))
  const diffs = []
  let sum = 0
  let maxAbsDiff = 0
  let count = 0

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4
      const dr = Math.abs(pxA[idx] - pxB[idx])
      const dg = Math.abs(pxA[idx + 1] - pxB[idx + 1])
      const db = Math.abs(pxA[idx + 2] - pxB[idx + 2])
      const mean = (dr + dg + db) / 3
      const peak = Math.max(dr, dg, db)
      sum += mean
      if (peak > maxAbsDiff) maxAbsDiff = peak
      diffs.push(mean)
      count++
    }
  }
  diffs.sort((a, b) => a - b)
  const p95AbsDiff = diffs[Math.min(diffs.length - 1, Math.round(0.95 * (diffs.length - 1)))] ?? 0
  return {
    meanAbsDiff: Number((sum / Math.max(1, count)).toFixed(2)),
    p95AbsDiff: Number(p95AbsDiff.toFixed(2)),
    maxAbsDiff,
  }
}

export function verifyTransitionSequence(
  adjacentDiffs,
  endToEndDiff,
  { minTotalDiff = 1.5, maxStepRatio = 0.9, maxAdjacentDiff = 40 } = {},
) {
  const reasons = []
  if (adjacentDiffs.length < 2) {
    reasons.push(`Need at least 2 adjacent diffs, got ${adjacentDiffs.length}`)
  }
  if (endToEndDiff < minTotalDiff) {
    reasons.push(`Transition moved too little (endToEndDiff=${endToEndDiff} < ${minTotalDiff})`)
  }
  const maxStep = Math.max(0, ...adjacentDiffs)
  if (maxStep > maxAdjacentDiff) {
    reasons.push(`Frame spike detected (maxStep=${maxStep} > ${maxAdjacentDiff})`)
  }
  const restSum = adjacentDiffs.reduce((acc, v) => acc + v, 0) - maxStep
  if (endToEndDiff >= minTotalDiff && maxStep > endToEndDiff * maxStepRatio && restSum <= Math.max(0.5, maxStep * 0.1)) {
    reasons.push(`Instantaneous snap detected (maxStep=${maxStep}, restSum=${restSum.toFixed(2)}, endToEndDiff=${endToEndDiff})`)
  }
  return { ok: reasons.length === 0, reasons, maxStep }
}
